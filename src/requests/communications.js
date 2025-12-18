// File: communications.js

const axios = require('axios')
const apiEndpoints = require('@constants/endpoints')

const baseUrl = process.env.COMMUNICATION_SERVICE_HOST + process.env.COMMUNICATION_SERVICE_BASE_URL
const internalAccessToken = process.env.INTERNAL_ACCESS_TOKEN

// Create Axios instance with default configurations for base URL and headers
const apiClient = axios.create({
	baseURL: baseUrl,
	headers: {
		internal_access_token: internalAccessToken,
	},
})

// Axios response interceptor to handle specific HTTP errors centrally
apiClient.interceptors.response.use(
	(response) => response,
	(error) => {
		if (error.response && error.response.status === 401) {
			return Promise.reject(new Error('unauthorized'))
		}
		return Promise.reject(error)
	}
)

/**
 * Signs up a new user with the communication service.
 * @async
 * @param {Object} params - Parameters for signup.
 * @param {string} params.userId - The unique identifier for the user.
 * @param {string} params.name - The name of the user.
 * @param {string} params.email - The email of the user.
 * @param {string} params.image - URL for the user's profile image.
 * @returns {Promise<Object>} The response data from the signup request.
 * @throws Will throw an error if the signup request fails.
 */
exports.signup = async ({ userId, name, email, image, tenantCode }) => {
	try {
		const url = apiEndpoints.COMMUNICATION_SIGNUP
		const body = { user_id: userId, name, email, tenant_code: tenantCode }
		if (image) {
			body.image_url = image
		}
		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}

/**
 * Logs in a user with the communication service.
 * @async
 * @param {Object} params - Parameters for login.
 * @param {string} params.userId - The unique identifier for the user.
 * @returns {Promise<Object>} The response data from the login request.
 * @throws Will throw an error if the login request fails.
 */
exports.login = async ({ userId, tenantCode }) => {
	try {
		const url = apiEndpoints.COMMUNICATION_LOGIN
		const body = { user_id: userId, tenant_code: tenantCode }
		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		if (err.response && err.response.data && err.response.data.message) {
			const error = new Error(err.response.data.message)
			error.statusCode = err.response.status
			throw error
		}
		throw err
	}
}

/**
 * Logs out a user from the communication service.
 * @async
 * @param {Object} params - Parameters for logout.
 * @param {string} params.userId - The unique identifier for the user.
 * @returns {Promise<Object>} The response data from the logout request.
 * @throws Will throw an error if the logout request fails.
 */
exports.logout = async ({ userId, tenantCode }) => {
	try {
		const url = apiEndpoints.COMMUNICATION_LOGOUT
		const body = { user_id: userId, tenant_code: tenantCode }
		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}

/**
 * Creates a chat room with an optional initial message.
 * @async
 * @param {Object} params - Parameters for creating a chat room.
 * @param {Array<string>} params.userIds - Array of user IDs to be added to the chat room.
 * @param {string} [params.initialMessage] - An optional initial message for the chat room.
 * @returns {Promise<Object>} The response data from the create chat room request.
 * @throws Will throw an error if the request fails.
 */
exports.createChatRoom = async ({ userIds, initialMessage, tenantCode }) => {
	try {
		const url = apiEndpoints.COMMUNICATION_CREATE_CHAT_ROOM
		const body = { usernames: userIds, initial_message: initialMessage, tenant_code: tenantCode }

		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}

/**
 * Updates a user's avatar in the communication service.
 * @async
 * @param {string} userId - The unique identifier for the user.
 * @param {string} imageUrl - The new avatar URL.
 * @returns {Promise<Object>} The response data from the update avatar request.
 * @throws Will throw an error if the request fails.
 */
exports.updateAvatar = async (userId, imageUrl, tenantCode) => {
	try {
		const url = apiEndpoints.COMMUNICATION_UPDATE_AVATAR
		const body = { user_id: userId, image_url: imageUrl, tenant_code: tenantCode }

		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}

/**
 * Updates a user's details in the communication service.
 * @async
 * @param {string} userId - The unique identifier for the user.
 * @param {string} name - The new name of the user.
 * @returns {Promise<Object>} The response data from the update user request.
 * @throws Will throw an error if the request fails.
 */
exports.updateUser = async (userId, name, tenantCode) => {
	try {
		const url = apiEndpoints.COMMUNICATION_UPDATE_USER
		const body = { user_id: userId, name, tenant_code: tenantCode }

		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}

/**
 * Sends a POST request to the communication service to fetch the internal user ID
 * corresponding to the provided external user ID.
 *
 * @async
 * @function getUserId
 * @param {string} userId - The external user ID to be resolved.
 * @returns {Promise<Object>} The response data containing the internal user ID.
 * @throws {Error} Throws the error if the API request fails.
 *
 * @example
 * const data = await getUserId('external-user-123');
 * // data => { result: { user_id: 'internal-user-456' }, ... }
 */
exports.getUserId = async (userId, tenantCode) => {
	try {
		const url = apiEndpoints.COMMUNICATION_GET_USER_ID
		const body = { external_user_id: userId, tenant_code: tenantCode }

		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}

/**
 * Sends a POST request to the communication service to update the active status
 * of a user in Rocket.Chat.
 *
 * @async
 * @function setActiveStatus
 * @param {string} userId - The internal Rocket.Chat user ID.
 * @param {boolean} active_status - `true` to activate the user, `false` to deactivate.
 * @param {boolean} confirm_relinquish - `true` to confirm relinquishing active sessions (required when deactivating).
 * @returns {Promise<Object>} The full response data from the API (e.g., { result: { success: true }, ... }).
 * @throws {Error} If the API request fails or returns an error.
 *
 * @example
 * const result = await setActiveStatus('5HmCfpoB7jp2uibTC', false, true);
 * // result => { result: { success: true }, statusCode: 200, message: 'NAME_UPDATED' }
 */
exports.setActiveStatus = async (userId, active_status, confirm_relinquish = false, tenantCode) => {
	try {
		const url = apiEndpoints.COMMUNICATION_USERS_SET_ACTIVE_STATUS
		const body = {
			user_id: userId,
			activeStatus: active_status,
			confirmRelinquish: confirm_relinquish,
			tenant_code: tenantCode,
		}

		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}

/**
 * Sends a POST request to the communication service to remove the profile avatar
 * of a specified user in Rocket.Chat.
 *
 * @async
 * @function removeAvatar
 * @param {string} userId - The internal Rocket.Chat user ID whose avatar should be removed.
 * @returns {Promise<Object>} The full response data from the API (e.g., { result: { success: true }, ... }).
 * @throws {Error} If the API request fails or returns an error.
 *
 * @example
 * const result = await removeAvatar('5HmCfpoB7jp2uibTC');
 * // result => { result: { success: true }, statusCode: 200, message: 'AVATAR_REMOVED' }
 */
exports.removeAvatar = async (userId, tenantCode) => {
	try {
		const url = apiEndpoints.COMMUNICATION_USERS_REMOVE_AVATAR
		const body = { user_id: userId, tenant_code: tenantCode }

		const response = await apiClient.post(url, body)
		return response.data
	} catch (err) {
		throw err
	}
}
