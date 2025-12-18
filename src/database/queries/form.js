const Form = require('../models/index').Form
const { Op } = require('sequelize')

module.exports = class FormsData {
	static async createForm(data, tenantCode, orgCode) {
		try {
			data.tenant_code = tenantCode
			data.organization_code = orgCode
			let form = await Form.create(data, { returning: true })
			return form
		} catch (error) {
			throw error
		}
	}

	static async findOne(filter, tenantCode, options = {}) {
		try {
			filter.tenant_code = tenantCode

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			return await Form.findOne({
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

	static async findFormsByFilter(filter, tenantCodes, options = {}) {
		try {
			const whereClause = {
				...filter,
				tenant_code: { [Op.in]: tenantCodes },
			}

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			return await Form.findAll({
				where: {
					...optionsWhere, // Allow additional where conditions
					...whereClause, // But tenant filtering takes priority
				},
				...otherOptions,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateOneForm(filter, update, tenantCode, orgCode, options = {}) {
		try {
			filter.tenant_code = tenantCode
			if (orgCode) {
				filter.organization_code = orgCode
			}

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			const [rowsAffected] = await Form.update(update, {
				where: {
					...optionsWhere, // Allow additional where conditions
					...filter, // But tenant filtering takes priority
				},
				...otherOptions,
				individualHooks: true, // Pass 'individualHooks: true' option to ensure proper triggering of 'beforeUpdate' hook.
			})

			if (rowsAffected > 0) {
				return 'ENTITY_UPDATED'
			} else {
				return 'ENTITY_NOT_FOUND'
			}
		} catch (error) {
			throw error
		}
	}

	static async findAllTypeFormVersion(tenantCode, orgCode) {
		try {
			const whereClause = { tenant_code: tenantCode }
			if (orgCode) {
				whereClause.organization_code = orgCode
			}
			const formData = await Form.findAll({
				where: whereClause,
				attributes: ['id', 'type', 'version'],
			})
			return formData
		} catch (error) {
			throw error
		}
	}
}
