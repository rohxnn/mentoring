// Dependencies
const httpStatusCode = require('@generics/http-status')
const entityQueries = require('@database/queries/entity')
const entityTypeQueries = require('@database/queries/entityType')
const { UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize')
const { Op } = require('sequelize')
const responses = require('@helpers/responses')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const cacheHelper = require('@generics/cacheHelper')
const common = require('@constants/common')
const entityTypeCache = require('@helpers/entityTypeCache')
const { removeDefaultOrgEntityTypes } = require('@generics/utils')

module.exports = class EntityHelper {
	/**
	 * Create entity.
	 * @method
	 * @name create
	 * @param {Object} bodyData - entity body data.
	 * @param {String} id -  id.
	 * @param {String} tenantCode - tenant code.
	 * @returns {JSON} - Entity created response.
	 */

	static async create(bodyData, id, tenantCode) {
		// Create sanitized data object to avoid parameter mutation
		const sanitizedData = {
			...bodyData,
			created_by: id,
			updated_by: id,
		}
		try {
			// Optimized: Validate entity_type exists before creation - better UX than constraint errors
			const result = await entityQueries.createEntityWithValidation(sanitizedData, tenantCode)
			const entity = result.entity
			const entityTypeDetails = result?.entityTypeDetails?.dataValues

			try {
				if (entityTypeDetails) {
					await entityTypeCache.clearUserCachesForEntityType(
						entityTypeDetails.organization_code,
						tenantCode,
						entityTypeDetails.model_names,
						entityTypeDetails.value
					)
				}
			} catch (cacheError) {
				console.error(`❌ Failed to invalidate entityType cache after entity creation:`, cacheError)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'ENTITY_CREATED_SUCCESSFULLY',
				result: entity,
			})
		} catch (error) {
			if (error.message === 'ENTITY_TYPE_NOT_FOUND') {
				return responses.failureResponse({
					message: 'ENTITY_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'ENTITY_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Update entity.
	 * @method
	 * @name update
	 * @param {Object} bodyData - entity body data.
	 * @param {String} _id - entity id.
	 * @param {String} loggedInUserId - logged in user id.
	 * @param {String} tenantCode - tenant code.
	 * @returns {JSON} - Entity updated response.
	 */

	static async update(bodyData, id, loggedInUserId, tenantCode) {
		// Create sanitized data object to avoid parameter mutation
		const sanitizedData = {
			...bodyData,
			updated_by: loggedInUserId,
		}
		const whereClause = {
			id: id,
			created_by: loggedInUserId,
		}
		try {
			// Get original entity to fetch its entity_type_id for cache invalidation
			const originalEntity = await entityQueries.findEntityTypeById(id, tenantCode)

			const [updateCount, updatedEntity] = await entityQueries.updateOneEntity(
				whereClause,
				tenantCode,
				sanitizedData,
				{
					returning: true,
					raw: true,
				}
			)

			if (updateCount === 0) {
				return responses.failureResponse({
					message: 'ENTITY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Invalidate entityType cache using the original entity's entity_type_id
			if (originalEntity && originalEntity.entity_type_id) {
				try {
					// Fetch entityType details for cache invalidation
					const entityTypeDetails = await entityTypeQueries.findEntityTypeById(
						originalEntity.entity_type_id,
						tenantCode
					)

					if (entityTypeDetails && entityTypeDetails.value && entityTypeDetails.model_names) {
						try {
							await entityTypeCache.clearUserCachesForEntityType(
								entityTypeDetails.organization_code,
								tenantCode,
								entityTypeDetails.model_names,
								entityTypeDetails.value
							)
						} catch (cacheError) {
							console.error(`❌ Failed to invalidate entityType cache after entity creation:`, cacheError)
						}
					}
				} catch (cacheError) {
					console.error(`❌ Failed to invalidate entityType cache after entity update:`, cacheError)
				}
			}
			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'ENTITY_UPDATED_SUCCESSFULLY',
				result: updatedEntity,
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'ENTITY_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Read entity.
	 * @method
	 * @name read
	 * @param {Object} bodyData - entity body data.
	 * @param {String} userId - user id.
	 * @param {String} tenantCode - tenant code.
	 * @returns {JSON} - Entity read response.
	 */

	static async read(query, userId, tenantCode) {
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

			let filter
			if (query.id) {
				filter = {
					[Op.or]: [
						{
							id: query.id,
							created_by: '0',
							status: common.ACTIVE_STATUS,
						},
						{ id: query.id, created_by: userId, status: common.ACTIVE_STATUS },
					],
				}
			} else {
				filter = {
					[Op.or]: [
						{
							value: query.value,
							created_by: '0',
							status: common.ACTIVE_STATUS,
						},
						{ value: query.value, created_by: userId, status: common.ACTIVE_STATUS },
					],
				}
			}
			const entities = await entityQueries.findAllEntities(filter, { [Op.in]: [tenantCode, defaults.tenantCode] })

			if (!entities.length) {
				return responses.failureResponse({
					message: 'ENTITY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'ENTITY_FETCHED_SUCCESSFULLY',
				result: entities,
			})
		} catch (error) {
			throw error
		}
	}

	static async readAll(query, userId, tenantCode) {
		try {
			const defaults = await getDefaults()
			if (!defaults.orgCode) {
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			if (!defaults.tenantCode) {
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let filter
			if (query.read_user_entity == true) {
				filter = {
					[Op.or]: [
						{
							created_by: '0',
						},
						{
							created_by: userId,
						},
					],
				}
			} else {
				filter = {
					created_by: '0',
				}
			}
			const entities = await entityQueries.findAllEntities(filter, { [Op.in]: [tenantCode, defaults.tenantCode] })

			if (!entities.length) {
				return responses.failureResponse({
					message: 'ENTITY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'ENTITY_FETCHED_SUCCESSFULLY',
				result: entities,
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Delete entity.
	 * @method
	 * @name delete
	 * @param {String} _id - Delete entity.
	 * @param {String} userId - user id.
	 * @param {String} tenantCode - tenant code.
	 * @returns {JSON} - Entity deleted response.
	 */

	static async delete(id, userId, tenantCode) {
		try {
			// Get original entity to fetch its entity_type_id for cache invalidation BEFORE deletion
			const originalEntity = await entityQueries.findEntityTypeById(id, tenantCode)

			if (!originalEntity || originalEntity.created_by !== userId) {
				return responses.failureResponse({
					message: 'ENTITY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			const whereClause = {
				id: id,
				created_by: userId,
				tenant_code: tenantCode,
			}
			const deleteCount = await entityQueries.deleteOneEntityType(whereClause, tenantCode)
			if (deleteCount === '0') {
				return responses.failureResponse({
					message: 'ENTITY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Fetch entityType details for cache invalidation before deletion
			let entityTypeDetails
			if (originalEntity.entity_type_id) {
				try {
					entityTypeDetails = await entityTypeQueries.findEntityTypeById(
						originalEntity.entity_type_id,
						tenantCode
					)
				} catch (error) {
					// Failed to fetch entityType details - continue with deletion
				}
			}

			// Invalidate entityType cache using the fetched entityType details
			if (entityTypeDetails && entityTypeDetails.value && entityTypeDetails.model_names) {
				try {
					await entityTypeCache.clearUserCachesForEntityType(
						entityTypeDetails.organization_code,
						tenantCode,
						entityTypeDetails.model_names,
						entityTypeDetails.value
					)
				} catch (cacheError) {
					console.error(`❌ Failed to invalidate entityType cache after entity deletion:`, cacheError)
				}
			}

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'ENTITY_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Get list of entity
	 * @method
	 * @name list
	 * @param {Object} query - query params
	 * @param {String} searchText - search label in entity.
	 * @param {Integer} pageNo -  page no.
	 * @param {Integer} pageSize -  page limit per api.
	 * @param {String} tenantCode - tenant code.
	 * @returns {JSON} - Entity search matched response.
	 */
	static async list(query, searchText, pageNo, pageSize, tenantCode, organization_code) {
		try {
			const defaults = await getDefaults()
			if (!defaults.orgCode) {
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			if (!defaults.tenantCode) {
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let entityType = query.entity_type_id ? query.entity_type_id : ''
			let filter = {
				tenant_code: { [Op.in]: [tenantCode, defaults.tenantCode] },
			}
			if (entityType) {
				filter['entity_type_id'] = entityType
			}
			// Optimized: Get entities with entity_type details included - eliminates N+1 queries for clients
			let entities = await entityQueries.getAllEntitiesWithEntityTypeDetails(
				filter,
				[defaults.tenantCode, tenantCode],
				pageNo,
				pageSize,
				searchText
			)

			if (entities.rows == 0 || entities.count == 0) {
				return responses.failureResponse({
					message: 'NO_RESULTS_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			} else {
				const results = {
					data: entities.rows,
					count: entities.count,
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'ENTITY_FETCHED_SUCCESSFULLY',
					result: results,
				})
			}
		} catch (error) {
			throw error
		}
	}
}
