const httpStatusCode = require('@generics/http-status')
const responses = require('@helpers/responses')
const mappingQueries = require('@database/queries/reportRoleMapping')

module.exports = class ReportsHelper {
	static async createMapping(data, organizationCode, organizationId, tenantCode) {
		try {
			data.organization_code = organizationCode
			data.organization_id = organizationId
			// Attempt to create a new report directly
			const mappingCreation = await mappingQueries.createReportRoleMapping(data, tenantCode)
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_MAPPING_CREATED_SUCCESS',
				result: mappingCreation?.dataValues,
			})
		} catch (error) {
			if (error.name === 'SequelizeUniqueConstraintError') {
				return responses.failureResponse({
					message: 'REPORT_MAPPING_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			return responses.failureResponse({
				message: 'REPORT_MAPPING_CREATION_FAILED',
				statusCode: httpStatusCode.internalServerError,
				responseCode: 'SERVER_ERROR',
			})
		}
	}

	static async getMapping(code, organizationCode, tenantCode) {
		try {
			const readMapping = await mappingQueries.findReportRoleMappingByReportCode(
				code,
				[tenantCode],
				[organizationCode]
			)
			if (!readMapping) {
				return responses.failureResponse({
					message: 'REPORT_MAPPING_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_MAPPING_FETCHED_SUCCESSFULLY',
				result: readMapping.dataValues,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateMapping(filter, updateData, tenantCode) {
		try {
			const updateMapping = await mappingQueries.updateReportRoleMappings(filter, updateData, tenantCode)
			if (!updateMapping) {
				return responses.failureResponse({
					message: 'REPORT_MAPPING_UPDATE_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_MAPPING_UPATED_SUCCESSFULLY',
				result: updateMapping.dataValues,
			})
		} catch (error) {
			throw error
		}
	}

	static async deleteMapping(id, userId, organizationId, tenantCode) {
		try {
			const deletedRows = await mappingQueries.deleteReportRoleMappingById(id, tenantCode)
			if (deletedRows === 0) {
				return responses.failureResponse({
					message: 'REPORT_MAPPING_DELETION_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_MAPPING_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}
}
