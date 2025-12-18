const ReportRoleMapping = require('@database/models/index').ReportRoleMapping
const { Op } = require('sequelize')

module.exports = class ReportRoleMappingQueries {
	static async createReportRoleMapping(data, tenantCode) {
		try {
			data.tenant_code = tenantCode
			return await ReportRoleMapping.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async findAllReportRoleMappings(filter, tenantCode, attributes, options = {}) {
		try {
			filter.tenant_code = tenantCode

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			const reportRoleMappings = await ReportRoleMapping.findAndCountAll({
				where: {
					...optionsWhere, // Allow additional where conditions
					...filter, // But tenant filtering takes priority
				},
				attributes,
				...otherOptions,
			})
			return reportRoleMappings
		} catch (error) {
			throw error
		}
	}

	static async updateReportRoleMappings(filter, updateData, tenantCode) {
		try {
			filter.tenant_code = tenantCode
			const [rowsUpdated, [updatedReportRoleMapping]] = await ReportRoleMapping.update(updateData, {
				where: filter,
				returning: true,
			})
			return updatedReportRoleMapping
		} catch (error) {
			throw error
		}
	}

	static async deleteReportRoleMappingById(id, tenantCode) {
		try {
			const deletedRows = await ReportRoleMapping.destroy({
				where: { id, tenant_code: tenantCode },
			})
			return deletedRows
		} catch (error) {
			throw error
		}
	}

	static async findReportRoleMappingByReportCode(reportCode, tenantCodes, organizationCodes) {
		try {
			return await ReportRoleMapping.findOne({
				where: {
					report_code: reportCode,
					tenant_code: { [Op.in]: tenantCodes },
					organization_code: { [Op.in]: organizationCodes },
				},
			})
		} catch (error) {
			throw error
		}
	}
}
