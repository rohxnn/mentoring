const SessionAttendee = require('@database/models/index').SessionAttendee
const { Op, col } = require('sequelize')

exports.create = async (data, tenantCode) => {
	try {
		data.tenant_code = tenantCode
		return await SessionAttendee.create(data)
	} catch (error) {
		return error
	}
}

exports.findOrCreateAttendee = async (data, tenantCode) => {
	try {
		data.tenant_code = tenantCode
		// Sequelize approach: Atomic find or create - eliminates separate existence check
		const [attendee, created] = await SessionAttendee.findOrCreate({
			where: {
				session_id: data.session_id,
				mentee_id: data.mentee_id,
				tenant_code: tenantCode,
			},
			defaults: data, // Data to use if creating new record
		})

		return { attendee, created }
	} catch (error) {
		return error
	}
}

exports.findOne = async (filter, tenantCode, options = {}) => {
	try {
		filter.tenant_code = tenantCode

		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		const res = await SessionAttendee.findOne({
			where: {
				...optionsWhere, // Allow additional where conditions
				...filter, // But tenant filtering takes priority
			},
			...otherOptions,
			raw: true,
		})
		return res
	} catch (error) {
		return error
	}
}

exports.updateOne = async (filter, update, tenantCode, options = {}) => {
	try {
		filter.tenant_code = tenantCode

		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		return await SessionAttendee.update(update, {
			where: {
				...optionsWhere, // Allow additional where conditions
				...filter, // But tenant filtering takes priority
			},
			...otherOptions,
			individualHooks: true,
		})
	} catch (error) {
		return error
	}
}

exports.unEnrollFromSession = async (sessionId, userId, tenantCode) => {
	try {
		const result = await SessionAttendee.destroy({
			where: {
				session_id: sessionId,
				mentee_id: userId,
				tenant_code: tenantCode,
			},
			force: true, // Setting force to true for a hard delete
		})

		return result
	} catch (error) {
		return error
	}
}

exports.findAll = async (filter, tenantCode, options = {}) => {
	try {
		if (!tenantCode) {
			throw new Error('tenantCode is required')
		}
		filter.tenant_code = tenantCode

		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		return await SessionAttendee.findAll({
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

exports.unEnrollAllAttendeesOfSessions = async (sessionIds, tenantCode) => {
	try {
		const destroyedCount = await SessionAttendee.destroy({
			where: {
				session_id: { [Op.in]: sessionIds },
				tenant_code: tenantCode,
			},
		})

		return destroyedCount
	} catch (error) {
		return error
	}
}

exports.usersUpcomingSessions = async (userId, sessionIds, tenantCode) => {
	try {
		if (!tenantCode) {
			throw new Error('tenantCode is required')
		}
		const filter = {
			session_id: sessionIds,
			mentee_id: userId,
		}
		filter.tenant_code = tenantCode
		return await SessionAttendee.findAll({
			where: filter,
			raw: true,
		})
	} catch (error) {
		return error
	}
}

exports.unenrollFromUpcomingSessions = async (userId, sessionIds, tenantCode) => {
	try {
		const result = await SessionAttendee.destroy({
			where: {
				session_id: sessionIds,
				mentee_id: userId,
				tenant_code: tenantCode,
			},
		})
		return result
	} catch (error) {
		return error
	}
}

exports.removeUserFromAllSessions = async (userId, tenantCode) => {
	try {
		// Remove from session attendees (all sessions)
		const attendeeResult = await SessionAttendee.destroy({
			where: {
				mentee_id: userId,
				tenant_code: tenantCode,
			},
		})

		return { attendeeResult }
	} catch (error) {
		console.error('Error in removeUserFromAllSessions:', error)
		return { attendeeResult: -1 }
	}
}
exports.countEnrolledSessions = async (mentee_id, tenantCode) => {
	try {
		const whereClause = {
			mentee_id: mentee_id,
			joined_at: {
				[Op.not]: null,
			},
		}

		if (tenantCode) {
			whereClause.tenant_code = tenantCode
		}

		return await SessionAttendee.count({
			where: whereClause,
		})
	} catch (error) {
		return error
	}
}

exports.getEnrolledSessionsCountInDateRange = async (startDate, endDate, mentee_id, tenantCode) => {
	try {
		// Count session attendees created in date range
		const count = await SessionAttendee.count({
			where: {
				created_at: { [Op.between]: [startDate, endDate] },
				mentee_id: mentee_id,
				tenant_code: tenantCode,
			},
		})
		return count || 0
	} catch (error) {
		return error
	}
}

exports.getAttendedSessionsCountInDateRange = async (startDate, endDate, mentee_id, tenantCode) => {
	try {
		// Count session attendees who joined in date range
		const count = await SessionAttendee.count({
			where: {
				joined_at: { [Op.between]: [startDate, endDate] },
				mentee_id: mentee_id,
				tenant_code: tenantCode,
			},
		})
		return count || 0
	} catch (error) {
		return error
	}
}
exports.findAttendeeBySessionAndUserId = async (id, sessionId, tenantCode) => {
	try {
		const attendee = await SessionAttendee.findOne({
			where: {
				mentee_id: id,
				session_id: sessionId,
				tenant_code: tenantCode,
			},
			raw: true,
		})
		return attendee
	} catch (error) {
		return error
	}
}
exports.findPendingFeedbackSessions = async (menteeId, completedSessionIds, tenantCode) => {
	try {
		if (!tenantCode) {
			throw new Error('tenantCode is required')
		}

		// Get all session attendee records for the mentee
		let allSessionAttendees = await SessionAttendee.findAll({
			where: {
				mentee_id: menteeId,
				tenant_code: tenantCode,
			},
			raw: true,
		})

		// Get session IDs excluding those already with feedback
		const allSessionIds = allSessionAttendees.map((attendee) => attendee.session_id)
		const filteredSessionIds = allSessionIds.filter((sessionId) => !completedSessionIds.includes(sessionId))

		// Find attendees who actually joined and haven't skipped feedback
		const filter = {
			mentee_id: menteeId,
			joined_at: {
				[Op.not]: null,
			},
			is_feedback_skipped: false,
			session_id: filteredSessionIds,
			tenant_code: tenantCode,
		}

		return await SessionAttendee.findAll({
			where: filter,
			raw: true,
		})
	} catch (error) {
		return error
	}
}

exports.getCount = async (filter = {}, options = {}) => {
	try {
		return await SessionAttendee.count({
			where: filter,
			...options,
		})
	} catch (error) {
		return error
	}
}
