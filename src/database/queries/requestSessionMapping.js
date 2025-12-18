const requestSession = require('@database/models/index').RequestSession
const { Op } = require('sequelize')
const common = require('@constants/common')

exports.addSessionRequest = async (requesteeId, requestId) => {
	try {
		// This method is no longer needed since data is directly stored in session_request table
		// Keeping for backward compatibility
		return { success: true, message: 'Session request mapping no longer required' }
	} catch (error) {
		throw error
	}
}

exports.getSessionsMapping = async (userId, status, tenantCode) => {
	try {
		// Now get session requests where user is the requestee (requests sent to me)
		const statusFilter =
			status && status.length > 0
				? status
				: {
						[Op.in]: [
							common.CONNECTIONS_STATUS.ACCEPTED,
							common.CONNECTIONS_STATUS.REQUESTED,
							common.CONNECTIONS_STATUS.REJECTED,
							common.CONNECTIONS_STATUS.EXPIRED,
						],
				  }

		return await requestSession.findAll({
			where: {
				requestee_id: userId,
				status: statusFilter,
				tenant_code: tenantCode,
			},
			raw: true,
		})
	} catch (error) {
		throw error
	}
}
