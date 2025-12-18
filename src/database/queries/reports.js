const Report = require('@database/models/index').Report

module.exports = class ReportQueries {
	static async createReport(data, tenantCode) {
		try {
			data.tenant_code = tenantCode
			return await Report.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async findReportById(id, tenantCode) {
		try {
			return await Report.findOne({
				where: { id, tenant_code: tenantCode },
			})
		} catch (error) {
			throw error
		}
	}

	static async updateReport(filter, updateData, tenantCode) {
		try {
			filter.tenant_code = tenantCode
			const [rowsUpdated, [updatedReport]] = await Report.update(updateData, {
				where: filter,
				returning: true,
			})
			return updatedReport
		} catch (error) {
			throw error
		}
	}

	static async deleteReportById(id, tenantCode) {
		try {
			const deletedRows = await Report.destroy({
				where: { id, tenant_code: tenantCode },
			})
			return deletedRows
		} catch (error) {
			throw error
		}
	}

	static async findReportByCode(code, tenantCode) {
		try {
			return await Report.findOne({
				where: { code, tenant_code: tenantCode },
			})
		} catch (error) {
			throw error
		}
	}

	static async findReport(filter, tenantCode) {
		try {
			filter.tenant_code = tenantCode
			return await Report.findAll({
				where: filter,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}
}
