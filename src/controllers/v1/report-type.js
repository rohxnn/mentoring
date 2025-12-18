const common = require('@constants/common')
const reportTypeService = require('@services/report-type')

module.exports = class ReportType {
	async create(req) {
		try {
			const createReport = await reportTypeService.createReportType(
				req.body,
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
			const getReportById = await reportTypeService.getReportType(req.query.title, req.decodedToken.tenant_code)
			return getReportById
		} catch (error) {
			return error
		}
	}

	async update(req) {
		try {
			const filter = { id: req.query.id }
			const updatedReport = await reportTypeService.updateReportType(
				filter,
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
			const deleteReport = await reportTypeService.deleteReportType(req.query.id, req.decodedToken.tenant_code)
			return deleteReport
		} catch (error) {
			return error
		}
	}
}
