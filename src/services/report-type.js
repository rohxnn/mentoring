const httpStatusCode = require('@generics/http-status')
const responses = require('@helpers/responses')
const reportTypeQueries = require('@database/queries/reportTypes')
const { getDefaults } = require('@helpers/getDefaultOrgId')

module.exports = class ReportsHelper {
	static async createReportType(data, organizationCode, tenantCode) {
		try {
			data.organization_code = organizationCode
			// Attempt to create a new report directly
			const reportTypeCreation = await reportTypeQueries.createReportType(data, tenantCode)
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_TYPE_CREATED_SUCCESS',
				result: reportTypeCreation?.dataValues,
			})
		} catch (error) {
			// Handle unique constraint violation error
			if (error.name === 'SequelizeUniqueConstraintError') {
				return responses.failureResponse({
					message: 'REPORT_TYPE_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.failureResponse({
				message: 'REPORT_TYPE_CREATION_FAILED',
				statusCode: httpStatusCode.internalServerError,
				responseCode: 'SERVER_ERROR',
			})
		}
	}

	static async getReportType(title, tenantCode) {
		try {
			const defaults = await getDefaults()
			if (!defaults.tenantCode) {
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Try both current tenant and default tenant using array
			const tenantCodes = [tenantCode, defaults.tenantCode]
			const reportTypes = await reportTypeQueries.findReportTypesByTitle(title, tenantCodes)

			if (!reportTypes || reportTypes.length === 0) {
				return responses.failureResponse({
					message: 'REPORT_TYPE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Business logic: Prefer current tenant over default tenant
			const reportType = reportTypes.find((rt) => rt.tenant_code === tenantCode) || reportTypes[0]

			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_TYPE_FETCHED_SUCCESSFULLY',
				result: reportType,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateReportType(filter, updateData, tenantCode) {
		try {
			const updatedReport = await reportTypeQueries.updateReportType(filter, updateData, tenantCode)
			if (!updatedReport) {
				return responses.failureResponse({
					message: 'REPORT_TYPE_UPDATE_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_TYPE_UPATED_SUCCESSFULLY',
				result: updatedReport.dataValues,
			})
		} catch (error) {
			throw error
		}
	}

	static async deleteReportType(id, tenantCode) {
		try {
			const deletedRows = await reportTypeQueries.deleteReportType(id, tenantCode)
			if (deletedRows === 0) {
				return responses.failureResponse({
					message: 'REPORT_TYPE_DELETION_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_TYPE_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}
}
