// Dependencies
const httpStatusCode = require('@generics/http-status')
const entityTypeQueries = require('../database/queries/entityType')
const { Op } = require('sequelize')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const responses = require('@helpers/responses')
const cacheHelper = require('@generics/cacheHelper')
const common = require('@constants/common')

/**
 * Get entity types and entities with user-centric cache strategy and defaults fallback
 * @method
 * @name getEntityTypesAndEntitiesWithCache
 * @param {Object} originalFilter - complete original database filter
 * @param {String} tenantCode - user tenant code (single value, not array)
 * @param {String} orgCode - user organization code (single value, not array)
 * @param {String} modelName - model name (optional, for cache optimization)
 * @returns {JSON} - Entity types with entities
 */
async function getEntityTypesAndEntitiesWithCache(originalFilter, tenantCode, orgCode, modelName = null) {
	try {
		// If no modelName provided, use direct database query with user-centric approach
		if (!modelName) {
			// Get defaults internally for database query
			let defaults = null
			try {
				defaults = await getDefaults()
			} catch (error) {
				console.error('Failed to get defaults for getEntityTypesAndEntitiesWithCache:', error.message)
			}

			// Step 1: ALWAYS fetch from user tenant and org codes
			let userFilter = {
				...originalFilter,
				organization_code: orgCode,
			}
			const userResults = await entityTypeQueries.findUserEntityTypesAndEntities(userFilter, [tenantCode])
			let dbResult = userResults ? [...userResults] : []

			// Step 2: ALSO ALWAYS fetch from default codes (if different from user codes)
			if (
				defaults &&
				defaults.orgCode &&
				defaults.tenantCode &&
				(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
			) {
				let defaultFilter = {
					...originalFilter,
					organization_code: defaults.orgCode,
				}
				const defaultResults = await entityTypeQueries.findUserEntityTypesAndEntities(defaultFilter, [
					defaults.tenantCode,
				])
				if (defaultResults && defaultResults.length > 0) {
					// Merge defaults, avoiding duplicates by ID
					const existingIds = new Set(dbResult.map((et) => et.id))
					const newEntityTypes = defaultResults.filter((et) => !existingIds.has(et.id))
					dbResult.push(...newEntityTypes)
				}
			}

			return dbResult || []
		}

		// Get entity values from filter for cache checking
		const entityValues = originalFilter.value && originalFilter.value[Op.in] ? originalFilter.value[Op.in] : []

		// If we have specific entity values, try to get them from cache first
		if (entityValues.length > 0) {
			let cachedEntities = []
			let hasCachedData = false

			// Check cache for each entity value using user codes
			for (const entityValue of entityValues) {
				try {
					const cachedEntity = await cacheHelper.entityTypes.get(tenantCode, orgCode, modelName, entityValue)

					if (cachedEntity) {
						cachedEntities.push(cachedEntity)
						hasCachedData = true
					}
				} catch (cacheError) {}
			}

			// If we found cached data, apply original filter logic and return
			if (hasCachedData) {
				const filteredData = cachedEntities.filter((entityType) => {
					// Apply all original filter conditions
					for (const [key, value] of Object.entries(originalFilter)) {
						if (key === 'organization_code' || key === 'tenant_code') {
							// Skip tenant/org filtering as cache is already scoped
							continue
						}
						if (key === 'model_names' && value[Op.contains]) {
							const requiredModels = value[Op.contains]
							const entityModels = entityType.model_names || []
							const hasRequiredModel = requiredModels.some((reqModel) => entityModels.includes(reqModel))
							if (!hasRequiredModel) {
								return false
							}
						} else if (key === 'value' && value[Op.in]) {
							if (!value[Op.in].includes(entityType.value)) {
								return false
							}
						} else if (Array.isArray(value)) {
							if (!value.includes(entityType[key])) {
								return false
							}
						} else {
							if (entityType[key] !== value) {
								return false
							}
						}
					}
					return true
				})

				return filteredData
			}
		}

		// Cache miss - fetch from database with user-centric approach

		// Get defaults internally for database query
		let defaults = null
		try {
			defaults = await getDefaults()
		} catch (error) {
			console.error('Failed to get defaults for getEntityTypesAndEntitiesWithCache:', error.message)
		}

		let dbResult = null
		try {
			// First try with user tenant and org codes
			let userFilter = {
				...originalFilter,
				organization_code: orgCode,
			}
			dbResult = await entityTypeQueries.findUserEntityTypesAndEntities(userFilter, [tenantCode])

			// If not found with user codes and defaults exist, try with default codes
			if (
				(!dbResult || dbResult.length === 0) &&
				defaults &&
				defaults.orgCode &&
				defaults.tenantCode &&
				(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
			) {
				console.log(
					`💾 EntityTypes not found with user codes, trying defaults: tenant:${defaults.tenantCode}:org:${defaults.orgCode}`
				)

				let defaultFilter = {
					...originalFilter,
					organization_code: defaults.orgCode,
				}
				dbResult = await entityTypeQueries.findUserEntityTypesAndEntities(defaultFilter, [defaults.tenantCode])
			}
		} catch (dbError) {
			console.error(`Failed to fetch entity types from database:`, dbError.message)
			return []
		}

		// Cache individual entities using user tenant/org context (regardless of where they were found)
		if (dbResult && dbResult.length > 0) {
			for (const entityType of dbResult) {
				try {
					await cacheHelper.entityTypes.set(
						tenantCode, // Always cache under user context
						orgCode, // Always cache under user context
						modelName,
						entityType.value,
						entityType
					)
				} catch (cacheSetError) {}
			}
			console.log(
				`💾 Cached ${dbResult.length} entity types under user context: tenant:${tenantCode}:org:${orgCode}`
			)
		}

		return dbResult || []
	} catch (error) {
		console.error(`❌ Failed to get entity types with cache:`, error)
		// Fallback to database query with user codes
		try {
			let userFilter = {
				...originalFilter,
				organization_code: orgCode,
			}
			return await entityTypeQueries.findUserEntityTypesAndEntities(userFilter, [tenantCode])
		} catch (fallbackError) {
			console.error(`❌ Fallback database query also failed:`, fallbackError)
			return []
		}
	}
}

/**
 * Get entity types and entities for a specific model with user-centric caching and defaults fallback
 * Uses user-specific tenant/org codes with automatic default fallback
 * @method
 * @name getEntityTypesAndEntitiesForModel
 * @param {String} modelName - model name to filter by
 * @param {String} tenantCode - user tenant code (single value, not array)
 * @param {String} orgCode - user organization code (single value, not array)
 * @param {Object} additionalFilters - additional filter conditions
 * @returns {JSON} - Entity types with entities for the model
 */
async function getEntityTypesAndEntitiesForModel(modelName, tenantCode, orgCode, additionalFilters = {}) {
	try {
		// Get defaults internally for database query
		let defaults = null
		try {
			defaults = await getDefaults()
		} catch (error) {
			console.error('Failed to get defaults for getEntityTypesAndEntitiesForModel:', error.message)
		}

		if (!defaults || !defaults.orgCode || !defaults.tenantCode) {
			return responses.failureResponse({
				message: 'DEFAULT_ORG_CODE_OR_TENANT_CODE_NOT_SET',
				statusCode: httpStatusCode.bad_request,
				responseCode: 'CLIENT_ERROR',
			})
		}

		// Try to get known entity types from cache first using user codes
		const knownEntityValues = common.entityTypeModelNames // Common model names
		const cachedEntities = []

		try {
			// Check cache for each entity value using user codes only
			for (const entityValue of knownEntityValues) {
				try {
					const cachedEntity = await cacheHelper.entityTypes.get(tenantCode, orgCode, modelName, entityValue)

					if (cachedEntity && cachedEntity.entities) {
						cachedEntities.push(cachedEntity)
					}
				} catch (entityFetchError) {
					// Silent fail for cache errors
				}
			}

			// If we found cached entities, format and apply filters
			if (cachedEntities.length > 0) {
				let formattedCachedEntities = cachedEntities.map((cachedEntity) => ({
					...cachedEntity,
					entities: Array.isArray(cachedEntity.entities) ? cachedEntity.entities : [],
				}))

				// Apply additional filters to cached results
				if (additionalFilters && Object.keys(additionalFilters).length > 0) {
					formattedCachedEntities = formattedCachedEntities.filter((entityType) => {
						for (const [key, value] of Object.entries(additionalFilters)) {
							if (Array.isArray(value)) {
								if (!value.includes(entityType[key])) {
									return false
								}
							} else if (entityType[key] !== value) {
								return false
							}
						}
						return true
					})
				}

				return formattedCachedEntities
			}
		} catch (cacheError) {}

		// Cache miss - fetch from database with user-centric approach

		let allEntityTypes = []
		try {
			// Step 1: ALWAYS fetch from user tenant and org codes
			const userFilter = {
				status: 'ACTIVE',
				organization_code: orgCode,
				model_names: { [Op.contains]: [modelName] },
			}
			const userEntityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(userFilter, [tenantCode])
			if (userEntityTypes && userEntityTypes.length > 0) {
				allEntityTypes.push(...userEntityTypes)
			}

			// Step 2: ALSO ALWAYS fetch from default codes (if different from user codes)
			if (
				defaults.orgCode &&
				defaults.tenantCode &&
				(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
			) {
				const defaultFilter = {
					status: 'ACTIVE',
					organization_code: defaults.orgCode,
					model_names: { [Op.contains]: [modelName] },
				}
				const defaultEntityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(defaultFilter, [
					defaults.tenantCode,
				])
				if (defaultEntityTypes && defaultEntityTypes.length > 0) {
					// Merge defaults, avoiding duplicates by ID
					const existingIds = new Set(allEntityTypes.map((et) => et.id))
					const newEntityTypes = defaultEntityTypes.filter((et) => !existingIds.has(et.id))
					allEntityTypes.push(...newEntityTypes)
				}
			}
		} catch (dbError) {
			console.error(`Failed to fetch entity types for model ${modelName} from database:`, dbError.message)
			return []
		}

		// Cache individual entities using user tenant/org context (regardless of where they were found)
		if (allEntityTypes && allEntityTypes.length > 0) {
			for (const entityType of allEntityTypes) {
				try {
					await cacheHelper.entityTypes.set(
						tenantCode, // Always cache under user context
						orgCode, // Always cache under user context
						modelName,
						entityType.value,
						entityType
					)
				} catch (individualCacheError) {}
			}
			console.log(
				`💾 Cached ${allEntityTypes.length} entity types for model ${modelName} under user context: tenant:${tenantCode}:org:${orgCode}`
			)
		}

		// Apply additional filters to the database results
		let filteredEntityTypes = allEntityTypes || []
		if (additionalFilters && Object.keys(additionalFilters).length > 0) {
			filteredEntityTypes = filteredEntityTypes.filter((entityType) => {
				for (const [key, value] of Object.entries(additionalFilters)) {
					if (Array.isArray(value)) {
						if (!value.includes(entityType[key])) {
							return false
						}
					} else if (entityType[key] !== value) {
						return false
					}
				}
				return true
			})
		}

		return filteredEntityTypes
	} catch (error) {
		console.error(`❌ Failed to get entity types for model ${modelName}:`, error)
		return []
	}
}

// Cache filter function removed - use direct database queries instead

/**
 * Clear model-level cache when entity types are updated/deleted
 * This should be called whenever entity types change to invalidate model caches
 * @param {String} tenantCode - tenant code
 * @param {String} orgCode - organization code
 * @param {Array} modelNames - array of model names affected
 */
async function clearModelCache(tenantCode, orgCode, modelNames = []) {
	try {
		// Clear all model-level caches for affected models
		for (const modelName of modelNames) {
			// We can't easily clear specific model cache keys since they contain hashed filters
			// So we clear the entire allModels namespace for this tenant/org
			await cacheHelper.entityTypes.delete(tenantCode, orgCode, 'allModels', `*${modelName}*`)
		}
	} catch (error) {}
}

// Removed applyInMemoryFilters - no longer needed with individual entity value caching

/**
 * Get individual entity type by value with user-centric caching and defaults fallback
 * @method
 * @name getEntityTypeByValue
 * @param {String} modelName - model name
 * @param {String} entityValue - entity value to find
 * @param {String} tenantCode - user tenant code
 * @param {String} orgCode - user org code
 * @returns {Object|null} - entity type object or null if not found
 */
async function getEntityTypeByValue(modelName, entityValue, tenantCode, orgCode) {
	// Use direct cache helper for individual entity value lookup
	try {
		const cachedEntity = await cacheHelper.entityTypes.get(tenantCode, orgCode, modelName, entityValue)
		if (cachedEntity) {
			return cachedEntity
		}
	} catch (cacheError) {}

	// Get defaults internally for database query
	let defaults = null
	try {
		defaults = await getDefaults()
	} catch (error) {
		console.error('Failed to get defaults for getEntityTypeByValue:', error.message)
	}

	// Fallback to database query if not in cache
	let found = null
	try {
		// First try with user tenant and org codes
		const userFilter = {
			status: 'ACTIVE',
			value: entityValue,
			organization_code: orgCode,
			model_names: { [Op.contains]: [modelName] },
		}
		let entityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(userFilter, [tenantCode])
		found = entityTypes.length > 0 ? entityTypes[0] : null

		// If not found with user codes and defaults exist, try with default codes
		if (
			!found &&
			defaults &&
			defaults.orgCode &&
			defaults.tenantCode &&
			(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
		) {
			const defaultFilter = {
				status: 'ACTIVE',
				value: entityValue,
				organization_code: defaults.orgCode,
				model_names: { [Op.contains]: [modelName] },
			}
			entityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(defaultFilter, [defaults.tenantCode])
			found = entityTypes.length > 0 ? entityTypes[0] : null
		}
	} catch (dbError) {
		console.error(`Failed to fetch entity type ${modelName}:${entityValue} from database:`, dbError.message)
		return null
	}

	// Cache it under user context (regardless of where it was found)
	if (found) {
		try {
			await cacheHelper.entityTypes.set(tenantCode, orgCode, modelName, entityValue, found)
		} catch (cacheError) {}
	}

	return found
}

module.exports = {
	getEntityTypesAndEntitiesWithCache,
	getEntityTypesAndEntitiesForModel,
	getEntityTypeByValue,
	clearModelCache,
}
