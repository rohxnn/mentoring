const RolePermissionMapping = require('@database/models/index').RolePermission

exports.create = async (data) => {
	try {
		return RolePermissionMapping.create(data, { returning: true })
	} catch (error) {
		throw error
	}
}

exports.delete = async (filter) => {
	try {
		const deletedRows = await RolePermissionMapping.destroy({
			where: filter,
		})
		return deletedRows
	} catch (error) {
		throw error
	}
}

exports.findAll = async (filter, attributes) => {
	try {
		const findRolePermisdions = await RolePermissionMapping.findAll({
			where: filter,
			attributes,
			raw: true,
		})
		return findRolePermisdions
	} catch (error) {
		throw error
	}
}
