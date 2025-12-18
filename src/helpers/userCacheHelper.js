/**
 * User Cache Helper
 * Provides cache-aware user lookups for mentors and mentees
 * Replaces direct userExtensionQueries and mentorQueries calls
 */

const cacheHelper = require('@generics/cacheHelper')
const userExtensionQueries = require('@database/queries/userExtension')
const mentorQueries = require('@database/queries/mentorExtension')
const userRequests = require('@requests/user')
const httpStatusCode = require('@generics/http-status')

/**
 * Get user extension with cache fallback (mentee or mentor)
 * @param {String} userId - User ID
 * @param {String} tenantCode - Tenant code
 * @param {String} preferredRole - 'mentor' or 'mentee' for cache priority
 * @returns {Object|null} - User extension data or null
 */
async function getUserExtensionCached(userId, tenantCode, preferredRole = 'mentee') {
	try {
		// Get user extension to determine org code
		const userExtension = await userExtensionQueries.getMenteeExtension(userId, [], false, tenantCode)
		if (!userExtension) {
			return null
		}

		const orgCode = userExtension.organization_code
		let cachedUser = null

		// Try preferred role cache first
		if (preferredRole === 'mentor') {
			cachedUser = await cacheHelper.mentor.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}
			// Fallback to mentee cache
			cachedUser = await cacheHelper.mentee.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}
		} else {
			cachedUser = await cacheHelper.mentee.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}
			// Fallback to mentor cache
			cachedUser = await cacheHelper.mentor.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}
		}

		// Cache miss - get full profile and cache it
		const user = await userRequests.getProfileDetails({ tenantCode, userId })
		if (user.statusCode === httpStatusCode.ok && user.result) {
			const userResponse = {
				...user.result,
				...userExtension,
			}
		} // Fallback to just extension data
		return userExtension
	} catch (error) {
		return null
	}
}

/**
 * Get mentor extension with cache fallback
 * @param {String} userId - User ID
 * @param {Array} attributes - Attributes to select (default: [])
 * @param {Boolean} unScoped - Whether to use unscoped query (default: false)
 * @param {String} tenantCode - Tenant code
 * @returns {Object|null} - Mentor extension data or null
 */
async function getMentorExtensionCached(userId, attributes = [], unScoped = false, tenantCode) {
	try {
		// Get mentor extension to determine org code (always get full data for org_code)
		const mentorExtension = await mentorQueries.getMentorExtension(userId, [], false, tenantCode)
		if (!mentorExtension) {
			return null
		}

		const orgCode = mentorExtension.organization_code
		let cachedUser = null

		// Try mentor cache first (only if no specific attributes requested)
		if (attributes.length === 0) {
			cachedUser = await cacheHelper.mentor.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}

			// Fallback to mentee cache
			cachedUser = await cacheHelper.mentee.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}
		}

		// Cache miss or specific attributes requested - get from database
		const mentor = await mentorQueries.getMentorExtension(userId, attributes, unScoped, tenantCode)

		return mentor
	} catch (error) {
		return null
	}
}

/**
 * Get mentee extension with cache fallback
 * @param {String} userId - User ID
 * @param {Array} attributes - Attributes to select (default: [])
 * @param {Boolean} unScoped - Whether to use unscoped query (default: false)
 * @param {String} tenantCode - Tenant code
 * @returns {Object|null} - Mentee extension data or null
 */
async function getMenteeExtensionCached(userId, attributes = [], unScoped = false, tenantCode) {
	try {
		// Get mentee extension to determine org code (always get full data for org_code)
		const menteeExtension = await userExtensionQueries.getMenteeExtension(userId, [], false, tenantCode)
		if (!menteeExtension) {
			return null
		}

		const orgCode = menteeExtension.organization_code
		let cachedUser = null

		// Try mentee cache first (only if no specific attributes requested)
		if (attributes.length === 0) {
			cachedUser = await cacheHelper.mentee.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}

			// Fallback to mentor cache (user might have both roles)
			cachedUser = await cacheHelper.mentor.get(tenantCode, orgCode, userId)
			if (cachedUser) {
				return cachedUser
			}
		}

		// Cache miss or specific attributes requested - get from database
		const mentee = await userExtensionQueries.getMenteeExtension(userId, attributes, unScoped, tenantCode)

		return mentee
	} catch (error) {
		return null
	}
}

/**
 * Get multiple users by IDs with cache optimization
 * @param {Array} userIds - Array of user IDs
 * @param {String} tenantCode - Tenant code
 * @param {String} preferredRole - 'mentor' or 'mentee' for cache priority
 * @returns {Array} - Array of user data
 */
async function getUsersByIdsCached(userIds, tenantCode, preferredRole = 'mentee') {
	if (!userIds || userIds.length === 0) {
		return []
	}

	const results = []
	const uncachedIds = []

	// Try to get as many as possible from cache
	for (const userId of userIds) {
		const cachedUser = await getUserExtensionCached(userId, tenantCode, preferredRole)
		if (cachedUser) {
			results.push(cachedUser)
		} else {
			uncachedIds.push(userId)
		}
	}

	// Get any remaining users from database
	if (uncachedIds.length > 0) {
		try {
			const dbUsers = await userExtensionQueries.getUsersByUserIds(uncachedIds, {}, tenantCode, true)
			results.push(...dbUsers)
		} catch (error) {
			// Silent error handling
		}
	}

	return results
}

module.exports = {
	getUserExtensionCached,
	getMentorExtensionCached,
	getMenteeExtensionCached,
	getUsersByIdsCached,
}
