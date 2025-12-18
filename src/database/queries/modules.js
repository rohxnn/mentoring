const Modules = require('@database/models/index').Module
const { Op } = require('sequelize')

module.exports = class UserRoleModulesData {
	static async createModules(data, tenantCode) {
		try {
			const payload = { ...data, tenant_code: tenantCode }
			return await Modules.create(payload, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async findModulesById(id, tenantCode) {
		try {
			return await Modules.findOne({ where: { id, tenant_code: tenantCode } })
		} catch (error) {
			throw error
		}
	}

	static async findAllModules(filter = {}, attributes, options, tenantCode) {
		try {
			const { where: optionsWhere = {}, ...rest } = options || {}
			const where = { ...optionsWhere, ...(filter || {}), tenant_code: tenantCode }
			const modules = await Modules.findAndCountAll({
				where,
				attributes,
				...rest,
			})
			return modules
		} catch (error) {
			throw error
		}
	}

	static async updateModules(filter, updatedata, tenantCode) {
		try {
			const [rowsUpdated, [updatedModules]] = await Modules.update(updatedata, {
				where: filter,
				returning: true,
				raw: true,
			})
			return updatedModules
		} catch (error) {
			throw error
		}
	}

	static async deleteModulesById(id, tenantCode) {
		try {
			const deletedRows = await Modules.destroy({
				where: { id: id, tenant_code: tenantCode },
				individualHooks: true,
			})
			return deletedRows
		} catch (error) {
			throw error
		}
	}
}
