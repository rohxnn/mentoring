const PostSessionDetail = require('@database/models/index').PostSessionDetail

exports.create = async (data, tenantCode) => {
	try {
		data.tenant_code = tenantCode
		return await PostSessionDetail.create(data)
	} catch (error) {
		return error
	}
}

exports.createWithSessionValidation = async (data, tenantCode) => {
	try {
		// Sequelize approach: Validate session exists before creating post session details
		const Session = PostSessionDetail.sequelize.models.Sessions
		const session = await Session.findOne({
			where: {
				id: data.session_id,
				tenant_code: tenantCode,
			},
			attributes: ['id'], // Only verify existence
		})

		if (!session) {
			throw new Error('SESSION_NOT_FOUND')
		}

		// Create post session details with validated session_id
		data.tenant_code = tenantCode
		return await PostSessionDetail.create(data)
	} catch (error) {
		return error
	}
}

exports.updateOne = async (filter, update, tenantCode, options = {}) => {
	try {
		filter.tenant_code = tenantCode

		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		const [rowsAffected] = await PostSessionDetail.update(update, {
			where: {
				...optionsWhere, // Allow additional where conditions
				...filter, // But tenant filtering takes priority
			},
			...otherOptions,
			individualHooks: true,
		})

		return rowsAffected
	} catch (error) {
		return error
	}
}

exports.findOne = async (filter, tenantCode, options = {}) => {
	try {
		filter.tenant_code = tenantCode

		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		return await PostSessionDetail.findOne({
			where: {
				...optionsWhere, // Allow additional where conditions
				...filter, // But tenant filtering takes priority
			},
			...otherOptions,
		})
	} catch (error) {
		return error
	}
}
