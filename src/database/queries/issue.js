const Issue = require('../models/index').Issue

module.exports = class issueData {
	static async create(data, tenantCode) {
		try {
			data.tenant_code = tenantCode
			return await Issue.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async findOne(filter, tenantCode, options = {}) {
		try {
			filter.tenant_code = tenantCode
			return await Issue.findOne({
				where: filter,
				...options,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async findAll(filter, tenantCode, options = {}) {
		try {
			filter.tenant_code = tenantCode
			return await Issue.findAll({
				where: filter,
				...options,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateOne(filter, update, tenantCode, options = {}) {
		try {
			filter.tenant_code = tenantCode
			return await Issue.update(update, {
				where: filter,
				...options,
				individualHooks: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async deleteOne(filter, tenantCode) {
		try {
			filter.tenant_code = tenantCode
			return await Issue.destroy({
				where: filter,
			})
		} catch (error) {
			throw error
		}
	}
}
