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
			await entityTypeCache.clearUserCachesForEntityType(
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

			const prunedEntities = removeDefaultOrgEntityTypes(entityTypes, orgCode)

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


			// SECOND: Delete from database
			const deleteCount = await entityTypeQueries.deleteOneEntityType(id, organizationCode, tenantCode)
			if (deleteCount === 0) {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Clear user caches since entity types affect user profiles
			await entityTypeCache.clearUserCachesForEntityType(
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
					await entityTypeCache.clearUserCachesForEntityType(
						entityToDelete.organization_code,
						tenantCode,
						entitiesToDelete.model_names,
						entityToDelete.value
					)
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
}
