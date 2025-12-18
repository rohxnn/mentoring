// Dependencies
const httpStatusCode = require('@generics/http-status')
const responses = require('@helpers/responses')

const resourceQueries = require('@database/queries/resources')

module.exports = class SessionsHelper {
	/**
	 * Remove resources from session.
	 * @method
	 * @name deleteResource
	 * @param {String} resourceId 				- resource id.
	 * @param {String} sessionId 				- Session id.
	 * @returns {JSON} 							- deleted response
	 */

	static async deleteResource(resourceId, sessionId, userId, organizationId, tenantCode) {
		try {
			// Optimized: Single query with JOIN validation - eliminates separate session existence check
			const deletedRows = await resourceQueries.deleteResourceByIdWithSessionValidation(resourceId, tenantCode)

			if (deletedRows === 0) {
				return responses.failureResponse({
					message: 'RESOURCE_NOT_FOUND_OR_SESSION_INVALID',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'RESOURCE_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}
}
