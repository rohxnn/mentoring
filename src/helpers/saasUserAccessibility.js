const menteeQueries = require('@database/queries/userExtension')
const responses = require('@helpers/responses')
const common = require('@constants/common')
const httpStatusCode = require('@generics/http-status')
const cacheHelper = require('@generics/cacheHelper')

/**
 * @description                             - Check if users are accessible based on the SaaS policy.
 * @method
 * @name checkIfUserIsAccessible
 * @param {Number} userId                   - User ID.
 * @param {Object|Array} userData           - User data (single object or array).
 * @returns {Boolean|Array}                 - Boolean (for a single user) or array of objects with user_id and isAccessible flag (for multiple users).
 */
async function checkIfUserIsAccessible(userId, userData, tenantCode, orgCode) {
	try {
		// Ensure userData is always processed as an array
		const users = Array.isArray(userData) ? userData : [userData]

		// Fetch policy details
		const userPolicyDetails =
			(await cacheHelper.mentee.getCacheOnly(tenantCode, orgCode, userId)) ||
			(await menteeQueries.getMenteeExtension(
				userId,
				['external_mentor_visibility', 'external_mentee_visibility', 'organization_id'],
				false,
				tenantCode
			))
		if (!userPolicyDetails || Object.keys(userPolicyDetails).length === 0) {
			return false // If no user policy details found, return false for accessibility
		}

		const { organization_id, external_mentor_visibility, external_mentee_visibility } = userPolicyDetails

		// Ensure data for accessibility evaluation
		if (!organization_id) {
			return false // If no organization_id is found, return false for accessibility
		}

		// For single user, return boolean indicating accessibility
		if (users.length === 1) {
			const user = users[0]
			const isMentor = user.is_mentor
			const visibilityKey = isMentor ? external_mentor_visibility : external_mentee_visibility
			const roleVisibilityKey = isMentor ? 'mentor_visibility' : 'mentee_visibility'

			let isAccessible = false

			switch (visibilityKey) {
				case common.CURRENT:
					isAccessible = user.organization_id === organization_id
					break

				case common.ASSOCIATED:
					isAccessible =
						(user.visible_to_organizations.includes(organization_id) &&
							user[roleVisibilityKey] !== common.CURRENT) ||
						user.organization_id === organization_id
					break

				case common.ALL:
					isAccessible =
						(user.visible_to_organizations.includes(organization_id) &&
							user[roleVisibilityKey] !== common.CURRENT) ||
						user[roleVisibilityKey] === common.ALL ||
						user.organization_id === organization_id
					break

				default:
					break
			}

			return isAccessible
		}

		// For multiple users, return an array with each user's accessibility status
		const accessibleUsers = users.map((user) => {
			const isMentor = user.is_mentor
			const visibilityKey = isMentor ? external_mentor_visibility : external_mentee_visibility
			const roleVisibilityKey = isMentor ? 'mentor_visibility' : 'mentee_visibility'

			let isAccessible = false

			switch (visibilityKey) {
				case common.CURRENT:
					isAccessible = user.organization_id === organization_id
					break

				case common.ASSOCIATED:
					isAccessible =
						(user.visible_to_organizations.includes(organization_id) &&
							user[roleVisibilityKey] !== common.CURRENT) ||
						user.organization_id === organization_id
					break

				case common.ALL:
					isAccessible =
						(user.visible_to_organizations.includes(organization_id) &&
							user[roleVisibilityKey] !== common.CURRENT) ||
						user[roleVisibilityKey] === common.ALL ||
						user.organization_id === organization_id
					break

				default:
					break
			}

			return {
				user_id: user.id,
				isAccessible: isAccessible,
			}
		})

		return accessibleUsers
	} catch (error) {
		throw error // Return error if something goes wrong
	}
}

// Export the function to be used in other parts of the app
module.exports = {
	checkIfUserIsAccessible,
}
