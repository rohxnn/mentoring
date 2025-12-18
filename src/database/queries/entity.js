const { Op } = require('sequelize')

const Entity = require('../models/index').Entity
module.exports = class UserEntityData {
	static async createEntity(data, tenantCode) {
		// Ensure tenant_code is set in data
		data.tenant_code = tenantCode
		try {
			return await Entity.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async createEntityWithValidation(data, tenantCode) {
		try {
			// Sequelize approach: Validate entity_type exists first and fetch details for cache invalidation
			const EntityType = Entity.sequelize.models.EntityType
			const entityType = await EntityType.findOne({
				where: {
					id: data.entity_type_id,
					tenant_code: tenantCode,
				},
				attributes: ['id', 'value', 'model_names', 'organization_code'], // Fetch details needed for cache invalidation
			})

			if (!entityType) {
				throw new Error('ENTITY_TYPE_NOT_FOUND')
			}

			// Create entity with validated entity_type_id
			data.tenant_code = tenantCode
			const createdEntity = await Entity.create(data, { returning: true })

			// Return both the created entity and entityType details for cache invalidation
			return {
				entity: createdEntity,
				entityTypeDetails: entityType,
			}
		} catch (error) {
			throw error
		}
	}

	static async findAllEntities(filter, tenantCode, options = {}) {
		try {
			if (tenantCode) {
				filter.tenant_code = tenantCode
			}
			return await Entity.findAll({
				where: filter,
				...options,
				raw: true,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateOneEntity(whereClause, tenantCode, update, options = {}) {
		try {
			// MANDATORY: Include tenant_code in whereClause
			const where = { ...(whereClause || {}), tenant_code: tenantCode }
			const sanitized = { ...update }
			delete sanitized.tenant_code
			return await Entity.update(sanitized, {
				where,
				...options,
			})
		} catch (error) {
			throw error
		}
	}

	static async deleteOneEntityType(whereClause, tenantCode) {
		try {
			// MANDATORY: Include tenant_code in whereClause
			whereClause.tenant_code = tenantCode
			return await Entity.destroy({
				where: whereClause,
			})
		} catch (error) {
			throw error
		}
	}

	static async findEntityTypeById(filter, tenantCode) {
		try {
			const whereClause = { id: filter, tenant_code: tenantCode }
			const entityData = await Entity.findOne({ where: whereClause })
			return entityData
		} catch (error) {
			throw error
		}
	}

	static async getAllEntities(filters, tenantCode, attributes, page, limit, search) {
		try {
			let whereClause = {
				...filters,
				// MANDATORY: Include tenant_code filtering
				tenant_code: tenantCode,
			}

			if (search) {
				whereClause[Op.or] = [{ label: { [Op.iLike]: `%${search}%` } }]
			}

			return await Entity.findAndCountAll({
				where: whereClause,
				attributes: attributes,
				offset: limit * (page - 1),
				limit: limit,
				order: [
					['created_at', 'DESC'],
					['id', 'ASC'],
				],
			})
		} catch (error) {
			throw error
		}
	}

	static async getAllEntitiesWithEntityTypeDetails(filters, tenantCode, page, limit, search) {
		try {
			let whereClause = {
				...filters,
				// MANDATORY: Include tenant_code filtering
				tenant_code: Array.isArray(tenantCode) ? { [Op.in]: tenantCode } : tenantCode,
			}

			if (search) {
				whereClause[Op.or] = [{ label: { [Op.iLike]: `%${search}%` } }]
			}

			// Optimized: Include entity_type details via association instead of forcing N+1 queries
			return await Entity.findAndCountAll({
				where: whereClause,
				attributes: ['id', 'entity_type_id', 'value', 'label', 'status', 'type', 'created_by', 'created_at'],
				include: [
					{
						model: Entity.sequelize.models.EntityType,
						as: 'entity_type',
						attributes: ['id', 'value', 'label'], // Include entity_type details
						where: { tenant_code: Array.isArray(tenantCode) ? { [Op.in]: tenantCode } : tenantCode },
					},
				],
				offset: limit * (page - 1),
				limit: limit,
				order: [
					['created_at', 'DESC'],
					['id', 'ASC'],
				],
			})
		} catch (error) {
			throw error
		}
	}
}
