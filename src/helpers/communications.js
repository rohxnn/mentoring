'use strict'
const communicationRequests = require('@requests/communications')
const userExtensionQueries = require('@database/queries/userExtension')
const emailEncryption = require('@utils/emailEncryption')
const common = require('@constants/common')
const utils = require('@generics/utils')
const userRequests = require('@requests/user')

/**
 * Logs in a user and retrieves authentication token and user ID.
 * @async
 * @param {string} userId - Unique identifier of the user.
 * @returns {Promise<Object>} An object containing auth_token and user_id if login is successful.
 * @throws Will throw an error if the login request fails for reasons other than unauthorized access.
 */
exports.login = async (userId, tenantCode) => {
	try {
		const login = await communicationRequests.login({ userId, tenantCode })
		return {
			auth_token: login.result.auth_token,
			user_id: login.result.user_id,
		}
	} catch (error) {
		if (error.message === common.COMMUNICATION.UNAUTHORIZED) {
			console.error('Error: Unauthorized access during login. Please check your tokens.')
		}
		throw error
	}
}

/**
 * Logs out a user from the communication service.
 * @async
 * @param {string} userId - Unique identifier of the user.
 * @returns {Promise<Object>} The status of the logout operation.
 * @throws Will throw an error if the logout request fails for reasons other than unauthorized access.
 */
exports.logout = async (userId, tenantCode) => {
	try {
		const logout = await communicationRequests.logout({ userId, tenantCode })
		return logout.result.status
	} catch (error) {
		if (error.message === common.COMMUNICATION.UNAUTHORIZED) {
			console.error('Error: Unauthorized access during logout. Please check your tokens.')
		}
		throw error
	}
}

/**
 * Updates a user's avatar.
 * @async
 * @param {string} userId - Unique identifier of the user.
 * @param {string} imageUrl - New avatar URL for the user.
 * @returns {Promise<void>} Resolves if the update is successful.
 * @throws Will throw an error if the updateAvatar request fails.
 */
exports.updateAvatar = async (userId, imageUrl, tenantCode) => {
	try {
		await communicationRequests.updateAvatar(userId, imageUrl, tenantCode)
	} catch (error) {
		console.error(`Error updating avatar for user ${userId}:`, error.message)
		throw error
	}
}

/**
 * Updates a user's name.
 * @async
 * @param {string} userId - Unique identifier of the user.
 * @param {string} name - New name for the user.
 * @returns {Promise<void>} Resolves if the update is successful.
 * @throws Will throw an error if the updateUser request fails.
 */
exports.updateUser = async (userId, name, tenantCode) => {
	try {
		await communicationRequests.updateUser(userId, name, tenantCode)
	} catch (error) {
		console.error(`Error updating user ${userId}:`, error.message)
		throw error
	}
}

/**
 * Creates or updates a user in the communication service.
 * Optimized to handle updates for avatar and name if the user already exists.
 * @async
 * @param {Object} userData - Data for the user.
 * @param {string} userData.userId - Unique identifier of the user.
 * @param {string} userData.name - Name of the user.
 * @param {string} userData.email - Email of the user.
 * @param {string} userData.image - URL of the user's profile image.
 * @returns {Promise<void>} Resolves if creation or updates are successful.
 * @throws Will throw an error if any request fails.
 */
exports.createOrUpdateUser = async ({ userId, name, email, image, tenantCode }) => {
	try {
		const user = await userExtensionQueries.getMenteeExtension(userId, ['meta'], false, tenantCode)

		if (user && user.meta?.communications_user_id) {
			// Update user information if already exists in the communication service
			await Promise.all([
				image ? this.updateAvatar(userId, image, tenantCode) : Promise.resolve(),
				name ? this.updateUser(userId, name, tenantCode) : Promise.resolve(),
			])
		} else {
			// Create new user in the communication service
			await this.create(userId, name, email, image, tenantCode)
		}
	} catch (error) {
		console.error('Error in createOrUpdateUser:', error.message)
		throw error
	}
}

/**
 * Creates a new user in the communication system, then updates the user's metadata.
 * @async
 * @param {string} userId - Unique identifier of the user.
 * @param {string} name - Name of the user.
 * @param {string} email - Email of the user.
 * @param {string} image - URL of the user's profile image.
 * @returns {Promise<Object>} An object containing the user_id from the communication service.
 * @throws Will throw an error if the signup request fails for reasons other than unauthorized access.
 */
exports.create = async (userId, name, email, image, tenantCode) => {
	try {
		const signup = await communicationRequests.signup({ userId, name, email, image, tenantCode })

		if (signup.result.user_id) {
			// Update the user's metadata with the communication service user ID
			await userExtensionQueries.updateMenteeExtension(
				userId,
				{ meta: { communications_user_id: signup.result.user_id } },
				{
					returning: true,
					raw: true,
				},
				{},
				tenantCode
			)
		}
		return {
			user_id: signup.result.user_id,
		}
	} catch (error) {
		if (error.message === common.COMMUNICATION.UNAUTHORIZED) {
			console.error('Error: Unauthorized access during signup. Please check your tokens.')
		}
		throw error
	}
}

/**
 * Creates a chat room between two users. If a user lacks a communications ID, it creates one.
 * @async
 * @param {string} recipientUserId - The ID of the user to receive the chat room invite.
 * @param {string} initiatorUserId - The ID of the user initiating the chat room.
 * @param {string} initialMessage - An initial message to be sent in the chat room.
 * @returns {Promise<Object>} The response from the communication service upon creating the chat room.
 * @throws Will throw an error if the request to create a chat room fails.
 */
exports.createChatRoom = async (recipientUserId, initiatorUserId, initialMessage, tenantCode) => {
	try {
		// Retrieve user details, ensuring each has a `communications_user_id`
		let userDetails = await userExtensionQueries.getUsersByUserIds(
			[initiatorUserId, recipientUserId],
			{
				attributes: ['name', 'user_id', 'email', 'meta', 'image'],
			},
			tenantCode,
			true
		)

		// Loop through users to ensure they have a `communications_user_id`
		for (const user of userDetails) {
			if (!user.meta || !user.meta.communications_user_id) {
				let userImage
				if (user?.image) {
					userImage = (await userRequests.getDownloadableUrl(user.image))?.result
				}
				await this.create(user.user_id, user.name, user.email, userImage, tenantCode)
			}
		}

		// Create the chat room after ensuring all users have `communications_user_id`
		const chatRoom = await communicationRequests.createChatRoom({
			userIds: [initiatorUserId, recipientUserId],
			initialMessage: initialMessage,
			tenantCode: tenantCode,
		})
		return chatRoom
	} catch (error) {
		console.error('Create Room Failed:', error)
		throw error
	}
}

/**
 * Resolves an external user ID by fetching the corresponding internal user ID
 * via a communication request. Logs an error message if unauthorized.
 *
 * @async
 * @function resolve
 * @param {string} userId - The external user ID to be resolved.
 * @returns {Promise<Object>} An object containing the resolved internal user ID.
 * @throws {Error} Throws the original error if the request fails.
 *
 * @example
 * const result = await resolve('external-user-123');
 * // result => { user_id: 'internal-user-456' }
 */
exports.resolve = async (userId, tenantCode) => {
	try {
		const userIdResponse = await communicationRequests.getUserId(userId, tenantCode)

		return {
			user_id: userIdResponse.result.user_id,
		}
	} catch (error) {
		if (error.message === common.COMMUNICATION.UNAUTHORIZED) {
			console.error('Error: Unauthorized access during resolve. Please check your tokens.')
		}
		throw error
	}
}

/**
 * Sets the active status of a Rocket.Chat user.
 *
 * Sends a request to the Rocket.Chat API to activate or deactivate a user.
 * If the operation is successful, the response will contain `{ result: { success: true } }`.
 *
 * @async
 * @function setActiveStatus
 * @param {string} userId - The Rocket.Chat user ID whose active status should be changed.
 * @param {boolean} activeStatus - `true` to activate the user, `false` to deactivate.
 * @param {boolean} confirmRelinquish - If true, confirms any relinquish prompt during deactivation.
 * @returns {Promise<boolean>} Returns `true` if status was successfully updated, otherwise `false`.
 * @throws {Error} If the API call fails or returns an unexpected result.
 *
 * @example
 * const wasUpdated = await setActiveStatus('abc123', false, true);
 * // wasUpdated => true if successful
 */
exports.setActiveStatus = async (userId, activeStatus, confirmRelinquish, tenantCode) => {
	try {
		const setUserActiveStatus = await communicationRequests.setActiveStatus(
			userId,
			activeStatus,
			confirmRelinquish,
			tenantCode
		)
		return setUserActiveStatus
	} catch (error) {
		console.error(`Error updating user ${userId}:`, error.message)
		throw error
	}
}

/**
 * Removes the avatar (profile image) of a Rocket.Chat user.
 *
 * Sends a request to the Rocket.Chat API to delete the user's profile image.
 * If the operation is successful, the response will include `{ result: { success: true } }`.
 *
 * @async
 * @function removeAvatar
 * @param {string} userId - The Rocket.Chat user ID whose avatar should be removed.
 * @returns {Promise<Object>} The full response from the API.
 * @throws {Error} If the API call fails or the request encounters an error.
 *
 * @example
 * const result = await removeAvatar('abc123');
 * // result => { result: { success: true }, statusCode: 200, message: 'AVATAR_REMOVED' }
 */
exports.removeAvatar = async (userId, tenantCode) => {
	try {
		const removeAvatarStatus = await communicationRequests.removeAvatar(userId, tenantCode)
		return removeAvatarStatus
	} catch (error) {
		console.error(`Error remove avatar of the user ${userId}:`, error.message)
		throw error
	}
}
