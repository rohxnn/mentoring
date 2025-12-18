const ReportType = require('@database/models/index').ReportType
const { Op } = require('sequelize')

module.exports = class ReportTypeQueries {
	static async createReportType(data, tenantCode) {
		try {
			data.tenant_code = tenantCode
			return await ReportType.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async findOne(filter, tenantCode, options = {}) {
		try {
			filter.tenant_code = tenantCode

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			return await ReportType.findOne({
				where: {
					...optionsWhere, // Allow additional where conditions
					...filter, // But tenant filtering takes priority
				},
				...otherOptions,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async findReportTypesByTitle(title, tenantCodes, options = {}) {
		try {
			const { where: optionsWhere = {}, ...rest } = options || {}
			const where = {
				...optionsWhere,
				title: title,
				tenant_code: { [Op.in]: tenantCodes },
			}

			return await ReportType.findAll({
				...rest,
				where,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateReportType(filter, updateData, tenantCode) {
		try {
			filter.tenant_code = tenantCode
			const [rowsUpdated, [updatedReportType]] = await ReportType.update(updateData, {
				where: filter,
				returning: true,
			})
			return updatedReportType
		} catch (error) {
			throw error
		}
	}

	static async deleteReportType(id, tenantCode) {
		try {
			const deletedRows = await ReportType.destroy({
				where: { id, tenant_code: tenantCode },
			})
			return deletedRows // Soft delete (paranoid enabled)
		} catch (error) {
			throw error
		}
	}
}
