const Resources = require('../models/index').Resources

module.exports = class ResourcessData {
	static async bulkCreate(data, tenantCode) {
		try {
			// Assign tenant_code to all data entries
			const dataWithTenant = data.map((item) => ({
				...item,
				tenant_code: tenantCode,
			}))

			const resources = await Resources.bulkCreate(dataWithTenant, {
				returning: true, // to return the inserted records
			})
			return resources
		} catch (error) {
			return error
		}
	}

	static async create(data, tenantCode) {
		try {
			data.tenant_code = tenantCode
			const resources = await Resources.create(data, { returning: true })
			return resources
		} catch (error) {
			return error
		}
	}

	static async findOneResources(filter, tenantCode, projection = {}) {
		try {
			const whereClause = {
				...filter,
				tenant_code: tenantCode,
			}
			const ResourcesData = await Resources.findOne({
				where: whereClause,
				attributes: projection,
				raw: true,
			})
			return ResourcesData
		} catch (error) {
			return error
		}
	}

	static async deleteResource(sessionId, tenantCode, projection = {}) {
		try {
			const ResourcesData = await Resources.destroy({
				where: { session_id: sessionId, tenant_code: tenantCode },
				raw: true,
			})
			return ResourcesData
		} catch (error) {
			return error
		}
	}

	static async deleteResourceById(resourceId, sessionId, tenantCode) {
		try {
			const ResourcesData = await Resources.destroy({
				where: { id: resourceId, session_id: sessionId, tenant_code: tenantCode },
				raw: true,
			})
			return ResourcesData
		} catch (error) {
			return error
		}
	}

	static async deleteResourceByIdWithSessionValidation(resourceId, tenantCode) {
		try {
			// Sequelize approach: Find resource with session validation through association
			const resource = await Resources.findOne({
				where: { id: resourceId, tenant_code: tenantCode },
				include: [
					{
						model: Resources.sequelize.models.Sessions,
						as: 'session',
						where: { tenant_code: tenantCode },
						attributes: ['id'], // Only verify session exists
					},
				],
			})

			if (!resource) {
				return 0 // No resource found or session invalid
			}

			await resource.destroy()
			return 1 // Successfully deleted
		} catch (error) {
			return error
		}
	}

	static async find(filter, tenantCode, projection = {}) {
		try {
			const whereClause = {
				...filter,
				deleted_at: null,
				tenant_code: tenantCode,
			}
			const ResourcesData = await Resources.findAll({
				where: whereClause,
				attributes: projection,
				raw: true,
			})
			return ResourcesData
		} catch (error) {
			return error
		}
	}
}
