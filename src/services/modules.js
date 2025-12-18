// Dependencies
const httpStatusCode = require('@generics/http-status')
const common = require('@constants/common')
const modulesQueries = require('@database/queries/modules')
const permissionsQueries = require('@database/queries/permissions')
const { UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize')
const { Op } = require('sequelize')
const responses = require('@helpers/responses')
const cacheHelper = require('@generics/cacheHelper')

module.exports = class modulesHelper {
	/**
	 * Create modules.
	 * @method
	 * @name create
	 * @param {Object} bodyData - modules body data.
	 * @param {String} id -  id.
	 * @returns {JSON} - modules created response.
	 */

	static async create(bodyData, userId, organizationId, tenantCode) {
		try {
			// Add tenant context to bodyData
			bodyData.tenant_code = tenantCode

			const modules = await modulesQueries.createModules(bodyData, tenantCode)
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'MODULES_CREATED_SUCCESSFULLY',
				result: {
					Id: modules.id,
					code: modules.code,
					status: modules.status,
				},
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'MODULES_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Update modules.
	 * @method
	 * @name update
	 * @param {Object} bodyData - modules body data.
	 * @param {String} _id - modules id.
	 * @param {String} loggedInUserId - logged in user id.
	 * @returns {JSON} - modules updated response.
	 */

	static async update(id, bodyData, userId, organizationId, tenantCode) {
		try {
			const modules = await modulesQueries.findModulesById(id, tenantCode)
			if (!modules) {
				return responses.failureResponse({
					message: 'MODULES_NOT_FOUND',
					statusCode: httpStatusCode.not_found,
					responseCode: 'CLIENT_ERROR',
				})
			}

			const updatedModules = await modulesQueries.updateModules(
				{ id, tenant_code: tenantCode },
				bodyData,
				tenantCode
			)
			const updatePermissions = await permissionsQueries.updatePermissions(
				{ module: modules.code, tenant_code: tenantCode },
				{ module: updatedModules.code }
			)

			// Cache invalidation: Clear permissions cache after permissions update
			if (updatePermissions) {
				try {
					await cacheHelper.permissions.evictAll()
				} catch (cacheError) {
					console.error(`Cache deletion failed for permissions after module update:`, cacheError)
				}
			}

			if (!updatedModules && !updatePermissions) {
				return responses.failureResponse({
					message: 'MODULES_NOT_UPDATED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			} else {
				return responses.successResponse({
					statusCode: httpStatusCode.created,
					message: 'MODULES_UPDATED_SUCCESSFULLY',
					result: {
						id: updatedModules.id,
						status: updatedModules.status,
						code: updatedModules.code,
					},
				})
			}
		} catch (error) {
			throw error
		}
	}

	/**
	 * Delete modules.
	 * @method
	 * @name delete
	 * @param {String} _id - Delete modules.
	 * @returns {JSON} - modules deleted response.
	 */

	static async delete(id, userId, organizationId, tenantCode) {
		try {
			const modules = await modulesQueries.findModulesById(id, tenantCode)

			if (!modules) {
				return responses.failureResponse({
					message: 'MODULES_ALREADY_DELETED_OR_MODULE_NOT_PRESENT',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			} else {
				const deletemodules = await modulesQueries.deleteModulesById(id, tenantCode)

				if (!deletemodules) {
					return responses.failureResponse({
						message: 'MODULES_NOT_DELETED',
						statusCode: httpStatusCode.bad_request,
						responseCode: 'CLIENT_ERROR',
					})
				}
				return responses.successResponse({
					statusCode: httpStatusCode.accepted,
					message: 'MODULES_DELETED_SUCCESSFULLY',
					result: {},
				})
			}
		} catch (error) {
			throw error
		}
	}

	/**
	 * list modules.
	 * @method
	 * @name list
	 * @param {String} id -  id.
	 * @returns {JSON} - modules list response.
	 */

	static async list(page, limit, search, userId, organizationId, tenantCode) {
		try {
			const offset = common.getPaginationOffset(page, limit)

			// Try to get modules from cache first (only cache without search)
			const cacheKey = `page${page}_limit${limit}`
			let modules = null

			if (!search || search.trim() === '') {
				modules = await cacheHelper.forms.get(
					tenantCode,
					organizationId || common.SYSTEM,
					'modules_list',
					cacheKey
				)
				if (modules) {
				}
			}

			if (!modules) {
				const filter = {
					tenant_code: tenantCode,
				}
				if (search && search.trim() !== '') {
					filter.code = { [Op.iLike]: `%${search.trim()}%` }
				}
				const options = {
					offset,
					limit,
				}
				const attributes = ['id', 'code', 'status']
				modules = await modulesQueries.findAllModules(filter, attributes, options, tenantCode)

				// Cache the result if no search text
				if ((!search || search.trim() === '') && modules) {
					try {
						await cacheHelper.forms.set(
							tenantCode,
							organizationId || common.SYSTEM,
							'modules_list',
							cacheKey,
							modules
						)
					} catch (cacheError) {
						console.error(`❌ Failed to cache modules list:`, cacheError)
					}
				}
			}

			if (modules.rows == 0 || modules.count == 0) {
				return responses.failureResponse({
					message: 'MODULES_HAS_EMPTY_LIST',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			} else {
				const results = {
					data: modules.rows,
					count: modules.count,
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'MODULES_FETCHED_SUCCESSFULLY',
					result: results,
				})
			}
		} catch (error) {
			throw error
		}
	}
}
