'use strict'
const FileUpload = require('../models/index').FileUpload

exports.create = async (data, tenantCode) => {
	try {
		data.tenant_code = tenantCode
		const createFileUpload = await FileUpload.create(data)
		const result = createFileUpload.get({ plain: true })
		return result
	} catch (error) {
		return error
	}
}

exports.findOne = async (filter, tenantCode, options = {}) => {
	try {
		filter.tenant_code = tenantCode

		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		return await FileUpload.findOne({
			where: {
				...optionsWhere, // Allow additional where conditions
				...filter, // But tenant filtering takes priority
			},
			...otherOptions,
			raw: true,
		})
	} catch (error) {
		return error
	}
}

exports.update = async (filter, tenantCode, update, options = {}) => {
	try {
		filter.tenant_code = tenantCode

		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		const whereClause = {
			...optionsWhere, // Allow additional where conditions
			...filter, // But tenant filtering takes priority
		}

		console.log(`🔍 [FILE UPLOAD UPDATE] Query details:`)
		console.log(`   - Filter (before tenant):`, JSON.stringify(filter, null, 2))
		console.log(`   - Tenant Code: ${tenantCode}`)
		console.log(`   - Update Data:`, JSON.stringify(update, null, 2))
		console.log(`   - Where Clause:`, JSON.stringify(whereClause, null, 2))
		console.log(`   - Options:`, JSON.stringify(otherOptions, null, 2))

		const [res] = await FileUpload.update(update, {
			where: whereClause,
			...otherOptions,
			individualHooks: true,
		})

		console.log(`📝 [FILE UPLOAD UPDATE RESULT] Rows updated: ${res}`)
		return res
	} catch (error) {
		console.log(`❌ [FILE UPLOAD UPDATE ERROR]`, error)
		return error
	}
}

exports.listUploads = async (page, limit, status, orgCode, tenantCode) => {
	try {
		let filterQuery = {
			where: { tenant_code: tenantCode },
			attributes: {
				exclude: ['created_at', 'updated_at', 'deleted_at', 'updated_by'],
			},
			offset: parseInt((page - 1) * limit, 10),
			limit: parseInt(limit, 10),
		}

		if (orgCode) {
			filterQuery.where.organization_code = orgCode
		}

		if (status) {
			filterQuery.where.status = status
		}

		const result = await FileUpload.findAndCountAll(filterQuery)
		const transformedResult = {
			count: result.count,
			data: result.rows.map((row) => {
				return row.get({ plain: true })
			}),
		}
		return transformedResult
	} catch (error) {
		return error
	}
}
