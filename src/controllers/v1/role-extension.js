const common = require('@constants/common')
const roleExtensionService = require('@services/role-extension')

module.exports = class Reports {
	async create(req) {
		try {
			const createReport = await roleExtensionService.createRoleExtension(
				req.body,
				req.decodedToken.organization_id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
			return createReport
		} catch (error) {
			return error
		}
	}

	async read(req) {
		try {
			const getReportById = await roleExtensionService.roleExtensionDetails(
				req.query.title,
				req.decodedToken.tenant_code
			)
			return getReportById
		} catch (error) {
			return error
		}
	}

	async update(req) {
		try {
			const updatedReport = await roleExtensionService.updateRoleExtension(
				req.query.title,
				req.body,
				req.decodedToken.tenant_code
			)
			return updatedReport
		} catch (error) {
			return error
		}
	}

	async delete(req) {
		try {
			const deleteReport = await roleExtensionService.deleteRoleExtension(
				req.query.title,
				req.decodedToken.id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
			return deleteReport
		} catch (error) {
			return error
		}
	}
}
