const RoleExtension = require('@database/models/index').RoleExtension

module.exports = class RoleExtensionService {
	static async createRoleExtension(data, organizationId, organizationCode, tenantCode) {
		try {
			// Check if a soft-deleted record exists
			const existingRecord = await RoleExtension.findOne({
				where: {
					title: data.title,
					tenant_code: tenantCode,
				},
				paranoid: false, // Include soft-deleted records
			})

			if (existingRecord && existingRecord.deleted_at) {
				// Restore the soft-deleted record with new data
				const updateData = {
					...data,
					tenant_code: tenantCode,
					organization_code: organizationCode,
					organization_id: organizationId,
					deleted_at: null,
					updated_at: new Date(),
				}

				const [rowsUpdated, updatedRecords] = await RoleExtension.update(updateData, {
					where: { title: data.title, tenant_code: tenantCode },
					returning: true,
					paranoid: false, // Update even soft-deleted records
				})
				return updatedRecords[0]
			} else if (existingRecord) {
				// Already exists and is active — return existing record
				return existingRecord
			}

			// Create new record if no existing one found
			data.tenant_code = tenantCode
			data.organization_code = organizationCode
			data.organization_id = organizationId
			return await RoleExtension.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async findRoleExtensionByTitle(title, tenantCode) {
		try {
			return await RoleExtension.findOne({
				where: { title, tenant_code: tenantCode },
			})
		} catch (err) {
			throw err
		}
	}

	static async findAllRoleExtensions(filter = {}, tenantCode, attributes = null, options = {}) {
		try {
			filter.tenant_code = tenantCode

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			return await RoleExtension.findAndCountAll({
				where: {
					...optionsWhere, // Allow additional where conditions
					...filter, // But tenant filtering takes priority
				},
				attributes,
				...otherOptions,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateRoleExtension(title, updateData, tenantCode) {
		try {
			const filter = { title: title, tenant_code: tenantCode }

			const [rowsUpdated, updatedExtension] = await RoleExtension.update(updateData, {
				where: filter,
				returning: true,
			})

			// Return null if no rows were updated (record not found)
			if (rowsUpdated === 0) {
				return null
			}

			// Return the first updated record
			return updatedExtension[0]
		} catch (error) {
			throw error
		}
	}

	static async deleteRoleExtension(title, tenantCode) {
		try {
			const deletedRows = await RoleExtension.destroy({
				where: { title, tenant_code: tenantCode },
			})
			return deletedRows // Soft delete (paranoid enabled)
		} catch (error) {
			throw error
		}
	}
}
