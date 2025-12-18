'use strict'

const entityTypeQueries = require('@database/queries/entityType')
const cacheHelper = require('@generics/cacheHelper')
const responses = require('@helpers/responses')
const httpStatusCode = require('@generics/http-status')
const { Op } = require('sequelize')
const { getDefaults } = require('@helpers/getDefaultOrgId')

module.exports = class UserHelper {
	/**
	 * Retrieves entity types for given org codes and tenant.
	 * First tries cache; if not found, fetches from DB.
	 */
	static async findAllEntityTypes(orgCodes, tenantCode = '', attributes) {
		try {
			const cachedEntities = []

			// Handle orgCodes as either array or string
			const orgCodeArray = Array.isArray(orgCodes) ? orgCodes : [orgCodes]

			for (const orgCode of orgCodeArray) {
				try {
					// Use the modern cache helper's get method with proper fallback
					const cacheKey = `entityType:${tenantCode}:${orgCode}`
					const cachedData = await cacheHelper.get(cacheKey, { useInternal: false })
					if (cachedData) {
						cachedEntities.push(cachedData)
					}
				} catch (cacheError) {
					// Cache miss - will fetch from database
				}
			}

			if (cachedEntities.length > 0) {
				return cachedEntities
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
			// Fallback to DB if no cached data found
			const entities = await entityTypeQueries.findAllEntityTypes(
				orgCodes,
				{ [Op.in]: [defaults.tenantCode, tenantCode] },
				attributes
			)
			return entities || null
		} catch (err) {
			return null
		}
	}
}
