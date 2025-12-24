'use strict'

const sessionRequestQueries = require('@database/queries/requestSessions')
const connectionQueries = require('@database/queries/connection')
const common = require('@constants/common')
const cacheHelper = require('@generics/cacheHelper')
module.exports = class UserServiceHelper {
	/**
	 * Fetches counts of pending session and connection requests for a given user.
	 *
	 * @param {string} userId - The user ID to check requests for.
	 * @returns {Promise<{connectionRequestCount: number, sessionRequestcount: number} | null>}
	 */
	static async findRequestCounts(userId, tenantCode) {
		try {
			if (!userId) {
				throw new Error('User ID is required')
			}
			let sessionRequestCount = 0,
				connectionRequestCount = 0
			if (process.env.ENABLE_CHAT) {
				const chatRequest = await connectionQueries.getRequestsCount(userId, tenantCode)
				connectionRequestCount = chatRequest
			}

			const sessionRequest = await sessionRequestQueries.getCount(
				userId,
				[common.CONNECTIONS_STATUS.REQUESTED],
				tenantCode
			)
			sessionRequestCount = sessionRequest

			return {
				connectionRequestCount,
				sessionRequestCount,
			}
		} catch (err) {
			console.error('Error in findRequestCounts:', err)
			return null
		}
	}

	static async getMissingUserIdsAndCacheData(userList, tenantCode) {
		const missingUserIds = []
		const cacheFoundData = []

		for (const user of userList) {
			const userId = user.user_id
			const orgCode = user.organization_code

			// Check mentees cache, then mentors cache
			const cachedUser =
				(await cacheHelper.mentee.getCacheOnly(tenantCode, orgCode, userId)) ??
				(await cacheHelper.mentor.getCacheOnly(tenantCode, orgCode, userId))

			if (cachedUser) {
				cacheFoundData.push(cachedUser)
			} else {
				missingUserIds.push(userId)
			}
		}

		return {
			missingUserIds,
			cacheFoundData,
		}
	}
}
