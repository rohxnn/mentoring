// Dependencies
const httpStatusCode = require('@generics/http-status')
const entityTypeQueries = require('../database/queries/entityType')
const menteeExtensionQueries = require('../database/queries/userExtension')
const mentorExtensionQueries = require('../database/queries/mentorExtension')
const sessionQueries = require('../database/queries/sessions')
const { UniqueConstraintError } = require('sequelize')
const { Op } = require('sequelize')
const { removeDefaultOrgEntityTypes } = require('@generics/utils')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const utils = require('@generics/utils')
const responses = require('@helpers/responses')
const common = require('@constants/common')
const cacheHelper = require('@generics/cacheHelper')
const entityTypeCache = require('@helpers/entityTypeCache')

module.exports = class EntityHelper {
	/**
	 * Create entity type.
	 * @method
	 * @name create
	 * @param {Object} bodyData - entity type body data.
	 * @param {String} id -  id.
	 * @returns {JSON} - Created entity type response.
	 */

	static async create(bodyData, id, orgId, orgCode, tenantCode, roles) {
		bodyData.created_by = id
		bodyData.updated_by = id
		bodyData.organization_id = orgId
		bodyData.organization_code = orgCode
		bodyData.tenant_code = tenantCode
		bodyData.value = bodyData.value.toLowerCase()
		try {
			if (bodyData.allow_filtering) {
				const isAdmin =
					roles && Array.isArray(roles) ? roles.some((role) => role.title === common.ADMIN_ROLE) : false
				bodyData.allow_filtering = isAdmin ? bodyData.allow_filtering : false
			}

			const entityType = await entityTypeQueries.createEntityType(bodyData, tenantCode)

			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'ENTITY_TYPE_CREATED_SUCCESSFULLY',
				result: entityType,
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Update entity type.
	 * @method
	 * @name update
	 * @param {Object} bodyData -  body data.
	 * @param {String} id - entity type id.
	 * @param {String} loggedInUserId - logged in user id.
	 * @returns {JSON} - Updated Entity Type.
	 */

	static async update(bodyData, id, loggedInUserId, orgCode, tenantCode, roles) {
		bodyData.updated_by = loggedInUserId
		if (bodyData.value) {
			bodyData.value = bodyData.value.toLowerCase()
		}

		try {
			// Get original entity before update to handle cache cleanup
			const originalEntity = await entityTypeQueries.findOneEntityType(
				{ id, organization_code: orgCode },
				tenantCode
			)

			if (bodyData.allow_filtering) {
				const isAdmin =
					roles && Array.isArray(roles) ? roles.some((role) => role.title === common.ADMIN_ROLE) : false
				bodyData.allow_filtering = isAdmin ? bodyData.allow_filtering : false
			}
			const [updateCount, updatedEntityType] = await entityTypeQueries.updateOneEntityType(
				id,
				orgCode,
				tenantCode,
				bodyData,
				{
					returning: true,
					raw: true,
				}
			)

			if (updateCount === 0) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Cache invalidation after successful update: just delete using original entity data
			try {
				if (originalEntity && originalEntity.model_names && originalEntity.value) {
					// Delete cache entries using original entity's model_names and value
					for (const modelName of originalEntity.model_names) {
						await cacheHelper.entityTypes.delete(tenantCode, orgCode, modelName, originalEntity.value)
					}
				}
			} catch (cacheError) {
				// Failed to invalidate entity type cache - continue operation
			}

			// Clear user caches since entity types affect user profiles
			const updatedEntity = updatedEntityType[0]
			await this._clearUserCachesForEntityTypeChange(
				orgCode,
				tenantCode,
				updatedEntity.model_names ? updatedEntity.model_names[0] : null,
				updatedEntity.value
			)

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'ENTITY_TYPE_UPDATED_SUCCESSFULLY',
				result: updatedEntityType,
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	static async readAllSystemEntityTypes(orgCode, tenantCode) {
		try {
			const attributes = ['value', 'label', 'id']
			const defaults = await getDefaults()
			if (!defaults.orgCode)
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			if (!defaults.tenantCode)
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			const entities = await entityTypeQueries.findAllEntityTypes(
				{ [Op.or]: [orgCode, defaults.orgCode] },
				{ [Op.in]: [tenantCode, defaults.tenantCode] },
				attributes
			)

			if (!entities.length) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'ENTITY_TYPE_FETCHED_SUCCESSFULLY',
				result: entities,
			})
		} catch (error) {
			throw error
		}
	}

	static async readUserEntityTypes(body, orgCode, tenantCode) {
		try {
			// Try to get from cache first
			const entityValue = body.value

			try {
				// Check if data exists in cache
				for (const modelName of common.entityTypeModelNames) {
					const cachedEntity = await cacheHelper.entityTypes.get(tenantCode, orgCode, modelName, entityValue)
					if (cachedEntity) {
						console.log(`Entity type '${entityValue}' found in cache for model '${modelName}'`)

						// Return cached data if it has entities array (complete data)
						if (cachedEntity.entities) {
							return responses.successResponse({
								statusCode: httpStatusCode.ok,
								message: 'ENTITY_TYPE_FETCHED_SUCCESSFULLY',
								result: { entity_types: [cachedEntity] },
							})
						}
					}
				}
			} catch (cacheError) {
				console.log('Cache lookup failed, falling back to database:', cacheError.message)
			}

			const defaults = await getDefaults()
			if (!defaults.orgCode)
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			if (!defaults.tenantCode)
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})

			// Cache miss - fetch from database
			const filter = {
				value: body.value,
				status: 'ACTIVE',
				organization_code: {
					[Op.in]: [orgCode, defaults.orgCode],
				},
				tenant_code: { [Op.in]: [defaults.tenantCode, tenantCode] },
			}
			const entityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(filter, {
				[Op.in]: [defaults.tenantCode, tenantCode],
			})

			const prunedEntities = removeDefaultOrgEntityTypes(entityTypes, defaults.orgCode)

			if (prunedEntities.length == 0) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Cache the fetched data
			try {
				for (const entityType of prunedEntities) {
					const modelNames = entityType.model_names || []
					for (const modelName of modelNames) {
						await cacheHelper.entityTypes.set(tenantCode, orgCode, modelName, entityType.value, entityType)
						console.log(`Cached entity type '${entityType.value}' for model '${modelName}'`)
					}
				}
			} catch (cacheError) {
				console.log('Failed to cache entity types:', cacheError.message)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'ENTITY_TYPE_FETCHED_SUCCESSFULLY',
				result: { entity_types: prunedEntities },
			})
		} catch (error) {
			throw error
		}
	}
	/**
	 * Delete entity type.
	 * @method
	 * @name delete
	 * @param {String} id - Delete entity type.
	 * @returns {JSON} - Entity deleted response.
	 */

	static async delete(id, organizationCode, tenantCode) {
		try {
			// FIRST: Get the entity details before deleting it
			const entityToDelete = await entityTypeQueries.findOneEntityType(
				{ id, organization_code: organizationCode, tenant_code: tenantCode },
				tenantCode
			)

			if (!entityToDelete) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Clear cache for affected models before deletion
			await this._clearUserCachesForEntityTypeChange(organizationCode, tenantCode, {
				id: entityToDelete.id,
				value: entityToDelete.value,
				modelNames: entityToDelete.model_names,
			})

			// SECOND: Delete from database
			const deleteCount = await entityTypeQueries.deleteOneEntityType(id, organizationCode, tenantCode)
			if (deleteCount === 0) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// THIRD: Remove individual entity type from cache
			try {
				// For each model this entity belonged to
				if (entityToDelete.model_names && Array.isArray(entityToDelete.model_names)) {
					for (const modelName of entityToDelete.model_names) {
						// Remove the specific entity type cache
						await cacheHelper.entityTypes.delete(
							tenantCode,
							organizationCode,
							modelName,
							entityToDelete.value
						)
					}
				}
			} catch (cacheError) {
				// Failed to perform selective cache removal - continue operation

				// Fallback: retry removing only this specific entity's cache
				if (entityToDelete.model_names && Array.isArray(entityToDelete.model_names)) {
					for (const modelName of entityToDelete.model_names) {
						try {
							await cacheHelper.entityTypes.delete(
								tenantCode,
								organizationCode,
								modelName,
								entityToDelete.value
							)
						} catch (retryError) {
							// Failed to retry clear cache - continue operation
						}
					}
				}
			}

			// Clear user caches since entity types affect user profiles
			await this._clearUserCachesForEntityTypeChange(
				organizationCode,
				tenantCode,
				entityToDelete.model_names ? entityToDelete.model_names[0] : null,
				entityToDelete.value
			)

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'ENTITY_TYPE_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * @description 							- process data to add value and labels in case of entity type
	 * @method
	 * @name processEntityTypesToAddValueLabels
	 * @param {Array} responseData 				- data to modify
	 * @param {Array} orgCods					- org ids
	 * @param {String} modelName 				- model name which the entity search is associated to.
	 * @param {String} orgCodeKey 				- In responseData which key represents org id
	 * @param {ARRAY} entityType 				- Array of entity types value
	 * @returns {JSON} 							- modified response data
	 */
	static async processEntityTypesToAddValueLabels(
		responseData,
		orgCodes,
		modelName,
		orgCodeKey,
		entityType,
		tenantCodes = []
	) {
		try {
			const defaults = await getDefaults()
			if (!defaults.orgCode)
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			if (!defaults.tenantCode)
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})

			if (!orgCodes.includes(defaults.orgCode)) {
				orgCodes.push(defaults.orgCode)
			}

			if (!tenantCodes.includes(defaults.tenantCode)) {
				tenantCodes.push(defaults.tenantCode)
			}

			const additionalFilters = {
				has_entities: true,
			}
			if (entityType && entityType.length > 0) {
				additionalFilters.value = entityType
			}
			// get entityTypes with entities data using cache
			// Use first tenant/org as user context - cache helper handles defaults internally
			const primaryTenantCode = tenantCodes[0] || defaults.tenantCode
			const primaryOrgCode = orgCodes[0] || defaults.orgCode
			let entityTypesWithEntities = await entityTypeCache.getEntityTypesAndEntitiesForModel(
				Array.isArray(modelName) ? modelName[0] : modelName,
				primaryTenantCode,
				primaryOrgCode,
				additionalFilters
			)
			entityTypesWithEntities = JSON.parse(JSON.stringify(entityTypesWithEntities))
			if (!entityTypesWithEntities.length > 0) {
				return responseData
			}

			// Use Array.map with async to process each element asynchronously
			const result = responseData.map(async (element) => {
				// Prepare the array of orgCodes to search
				const orgIdToSearch = [element[orgCodeKey], defaults.orgCode]

				// Filter entity types based on orgCodes and remove parent entity types
				let entitTypeData = entityTypesWithEntities.filter((obj) =>
					orgIdToSearch.includes(obj.organization_code)
				)
				entitTypeData = utils.removeParentEntityTypes(entitTypeData)

				// Process the data asynchronously to add value labels
				const processDbResponse = await utils.processDbResponse(element, entitTypeData)

				// Return the processed result
				return processDbResponse
			})
			return Promise.all(result)
		} catch (err) {
			return err
		}
	}

	/**
	 * Delete All entity type and entities based on entityType value.
	 * @method
	 * @name delete
	 * @param {Object} bodyData -  body data.
	 * @returns {JSON} - Entity deleted response.
	 */

	static async deleteEntityTypesAndEntities(value, tenantCode) {
		try {
			// Get entity types before deletion to clear cache
			const entitiesToDelete = await entityTypeQueries.findAllEntityTypes(
				{}, // No org code filter for this operation
				{ [Op.in]: [tenantCode] },
				['value', 'model_names', 'organization_code'],
				{
					status: common.ACTIVE_STATUS,
					value: { [Op.in]: value },
				}
			)

			const deleteCount = await entityTypeQueries.deleteEntityTypesAndEntities({
				status: common.ACTIVE_STATUS,
				value: { [Op.in]: value },
				tenant_code: tenantCode,
			})

			if (deleteCount === 0) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Clear cache for deleted entities
			try {
				for (const entityToDelete of entitiesToDelete) {
					const modelNames = entityToDelete.model_names || []
					for (const modelName of modelNames) {
						await cacheHelper.entityTypes.delete(
							tenantCode,
							entityToDelete.organization_code,
							modelName,
							entityToDelete.value
						)
					}
				}
			} catch (cacheError) {
				console.log('Failed to clear cache for deleted entities:', cacheError.message)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'ENTITY_TYPE_AND_ENTITES_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Get grouped entity types from cache by reading individual model caches
	 * This avoids data duplication by formatting raw cached data
	 */
	/**
	 * Clear user caches when entity types change
	 * When entity types are created/updated/deleted, user profiles become stale
	 * because they contain processed entity type data and display properties
	 * @method
	 * @name _clearUserCachesForEntityTypeChange
	 * @param {String} organizationCode - organization code affected
	 * @param {String} tenantCode - tenant code affected
	 * @param {String} modelName - model name affected (optional)
	 * @param {String} entityValue - entity value affected (optional)
	 * @returns {Promise<void>}
	 */
	static async _clearUserCachesForEntityTypeChange(
		organizationCode,
		tenantCode,
		modelName = null,
		entityValue = null
	) {
		try {
			const logContext = modelName ? `${modelName}:${entityValue}` : 'global'

			// Strategy: Clear model-specific caches based on entity type model since:
			// 1. Entity types affect profile validation and display properties
			// 2. Users can have entity values in their profiles
			// 3. Display properties are built from entity types
			// 4. User profiles are cached with processed entity type data

			const clearPromises = []

			// 1. Clear display properties cache (affects all users in org)
			clearPromises.push(
				cacheHelper.displayProperties.delete(tenantCode, organizationCode).catch((error) => {
					/* Failed to clear display properties cache - continue operation */
				})
			)

			// 2. Clear entity type caches for unified model strategy
			if (modelName) {
				clearPromises.push(
					cacheHelper.entityTypes
						.delete(tenantCode, organizationCode, `model:${modelName}:__ALL__`)
						.catch((error) => {
							/* Failed to clear unified entity type cache - continue operation */
						})
				)
			}

			// 3. Clear model-specific user caches based on the entity type model
			if (modelName) {
				// Get model names to determine which caches need clearing
				const [menteeModelName, mentorModelName, sessionModelName] = await Promise.all([
					menteeExtensionQueries.getModelName(),
					mentorExtensionQueries.getModelName(),
					sessionQueries.getModelName(),
				])

				// Active cache clearing for specific models based on entity type
				// Clear user caches immediately when entity types affect specific models

				if (modelName === menteeModelName) {
					// Clear all mentee caches for this organization
					try {
						const users = await menteeExtensionQueries.getAllUsersByOrgId([organizationCode], tenantCode)
						const menteeUserIds = users.map((user) => user.user_id)

						// Clear mentee caches for all users in organization
						const menteeClearPromises = menteeUserIds.map((userId) =>
							cacheHelper.mentee.delete(tenantCode, userId).catch((error) => {
								/* Failed to clear mentee cache - continue operation */
							})
						)
						clearPromises.push(...menteeClearPromises)
					} catch (error) {
						// Failed to enumerate mentee users - continue operation
					}
				}

				if (modelName === mentorModelName) {
					// Clear all mentor caches for this organization
					try {
						// Get all users who might be mentors in this organization
						const users = await menteeExtensionQueries.getAllUsersByOrgId([organizationCode], tenantCode)
						const mentorUserIds = users.map((user) => user.user_id)

						// Clear mentor caches for all users in organization (users can be both mentee and mentor)
						const mentorClearPromises = mentorUserIds.map((userId) =>
							cacheHelper.mentor.delete(tenantCode, userId).catch((error) => {
								/* Failed to clear mentor cache - continue operation */
							})
						)
						clearPromises.push(...mentorClearPromises)
					} catch (error) {
						// Failed to enumerate mentor users - continue operation
					}
				}

				if (modelName === sessionModelName) {
					// For session model, we don't have session enumeration by org
					// Session caches are typically cleared by individual session operations
					// Entity types affecting sessions would be rare (custom session fields)
					// Skip organization-wide session cache clearing to avoid performance impact
				}
			}

			// Execute all cache clearing operations in parallel
			await Promise.all(clearPromises)

			// For high-frequency entity type changes, consider implementing:
			// - Background cache warming after entity type changes
			// - Batch user cache clearing with organization user enumeration
			// - Event-driven cache invalidation system
		} catch (error) {
			// Failed to clear user caches for entity type change - continue operation
			throw error
		}
	}

	static async _getGroupedEntityTypesFromCache(tenantCode, orgCode) {
		try {
			// We need to know which models to check - get from database once to know models
			const defaults = await getDefaults()
			const allEntityTypes = await entityTypeQueries.findAllEntityTypes(
				{ [Op.or]: [orgCode, defaults.orgCode] },
				{ [Op.in]: [tenantCode, defaults.tenantCode] },
				['model_names']
			)

			// Get unique model names
			const allModels = new Set()
			allEntityTypes.forEach((entity) => {
				const modelNames = entity.model_names || []
				modelNames.forEach((modelName) => allModels.add(modelName))
			})

			const groupedByModel = {}
			let foundAnyCache = false

			// Check cache for each model
			for (const modelName of allModels) {
				const modelEntityTypes = await cacheHelper.entityTypes.get(tenantCode, orgCode, modelName)

				if (modelEntityTypes && Array.isArray(modelEntityTypes)) {
					groupedByModel[modelName] = modelEntityTypes
					foundAnyCache = true
				} else {
					// If any model is missing from cache, we need to rebuild all
					return null
				}
			}

			if (foundAnyCache) {
				return groupedByModel
			}

			return null
		} catch (error) {
			// Error getting grouped data from cache - continue operation
			return null
		}
	}

	/**
	 * Clear all entity type caches and force rebuild with new format
	 * This should be called after updating cache structure
	 */
	static async clearAndRebuildCache(tenantCode, orgCode) {
		try {
			await cacheHelper.evictNamespace({ tenantCode, orgCode, ns: 'entityTypes' })

			const result = await this.readAllSystemEntityTypes(orgCode, tenantCode)

			return result
		} catch (error) {
			// Error clearing and rebuilding cache - continue operation
			throw error
		}
	}
}
