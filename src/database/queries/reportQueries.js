const ReportQuery = require('@database/models/index').ReportQuery

module.exports = class ReportQueryServiceQueries {
	static async createReportQuery(data, tenantCode) {
		try {
			data.tenant_code = tenantCode
			return await ReportQuery.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async findReportQueryById(id, tenantCode) {
		try {
			return await ReportQuery.findOne({
				where: { id, tenant_code: tenantCode },
			})
		} catch (error) {
			throw error
		}
	}

	static async findAllReportQueries(filter, tenantCode, attributes, options = {}) {
		try {
			filter.tenant_code = tenantCode

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			const reportQueries = await ReportQuery.findAndCountAll({
				where: {
					...optionsWhere, // Allow additional where conditions
					...filter, // But tenant filtering takes priority
				},
				attributes,
				...otherOptions,
			})
			return reportQueries
		} catch (error) {
			throw error
		}
	}

	static async updateReportQueries(filter, updateData, tenantCode) {
		try {
			filter.tenant_code = tenantCode
			const [rowsUpdated, [updatedReportQuery]] = await ReportQuery.update(updateData, {
				where: filter,
				returning: true,
			})
			return updatedReportQuery
		} catch (error) {
			throw error
		}
	}

	static async deleteReportQueryById(id, tenantCode) {
		try {
			const deletedRows = await ReportQuery.destroy({
				where: { id, tenant_code: tenantCode },
			})
			return deletedRows
		} catch (error) {
			throw error
		}
	}

	static async findReportQueryByCode(code, tenantCode, organizationCode) {
		try {
			return await ReportQuery.findOne({
				where: { report_code: code, tenant_code: tenantCode, organization_code: organizationCode },
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async findReportQueries(filter, tenantCode) {
		try {
			filter.tenant_code = tenantCode
			return await ReportQuery.findAll({
				where: filter,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}
}
