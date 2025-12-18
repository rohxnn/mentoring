const connectionsService = require('@services/connections')

module.exports = class Connection {
	/**
	 * Get information about a connection between the authenticated user and another user.
	 * @param {Object} req - The request object.
	 * @param {Object} req.body - The body of the request.
	 * @param {string} req.body.user_id - The ID of the user to get connection info for.
	 * @param {Object} req.decodedToken - The decoded token containing authenticated user info.
	 * @param {string} req.decodedToken.id - The ID of the authenticated user.
	 * @returns {Promise<Object>} The connection information.
	 * @throws Will throw an error if the request fails.
	 */
	async getInfo(req) {
		try {
			return await connectionsService.getInfo(req.body.user_id, req.decodedToken.id, req.decodedToken.tenant_code)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Initiate a connection request between the authenticated user and another user.
	 * @param {Object} req - The request object.
	 * @param {Object} req.body - The body of the request.
	 * @param {Object} req.decodedToken - The decoded token containing authenticated user info.
	 * @param {string} req.decodedToken.id - The ID of the authenticated user.
	 * @returns {Promise<Object>} The response from the connection initiation.
	 * @throws Will throw an error if the request fails.
	 */
	async initiate(req) {
		try {
			return await connectionsService.initiate(
				req.body,
				req.decodedToken.id,
				req.decodedToken.tenant_code,
				req.decodedToken.organization_code
			)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Get a list of pending connection requests for the authenticated user.
	 * @param {Object} req - The request object.
	 * @param {Object} req.decodedToken - The decoded token containing authenticated user info.
	 * @param {string} req.decodedToken.id - The ID of the authenticated user.
	 * @param {number} req.pageNo - The page number for pagination.
	 * @param {number} req.pageSize - The number of items per page.
	 * @returns {Promise<Object[]>} The list of pending connection requests.
	 * @throws Will throw an error if the request fails.
	 */
	async pending(req) {
		try {
			return await connectionsService.pending(
				req.decodedToken.id,
				req.pageNo,
				req.pageSize,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Accept a connection request for the authenticated user.
	 * @param {Object} req - The request object.
	 * @param {Object} req.body - The body of the request.
	 * @param {Object} req.decodedToken - The decoded token containing authenticated user info.
	 * @param {string} req.decodedToken.id - The ID of the authenticated user.
	 * @returns {Promise<Object>} The response from accepting the connection.
	 * @throws Will throw an error if the request fails.
	 */
	async accept(req) {
		try {
			return await connectionsService.accept(
				req.body,
				req.decodedToken.id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Reject a connection request for the authenticated user.
	 * @param {Object} req - The request object.
	 * @param {Object} req.body - The body of the request.
	 * @param {Object} req.decodedToken - The decoded token containing authenticated user info.
	 * @param {string} req.decodedToken.id - The ID of the authenticated user.
	 * @returns {Promise<Object>} The response from rejecting the connection.
	 * @throws Will throw an error if the request fails.
	 */
	async reject(req) {
		try {
			return await connectionsService.reject(
				req.body,
				req.decodedToken.id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Get a list of connections for the authenticated user.
	 * @param {Object} req - The request object.
	 * @param {number} req.pageNo - The page number for pagination.
	 * @param {number} req.pageSize - The number of items per page.
	 * @param {string} req.searchText - The search text for filtering connections.
	 * @param {Object} req.query - Additional query parameters for filtering.
	 * @param {Object} req.decodedToken - The decoded token containing authenticated user info.
	 * @param {string} req.decodedToken.id - The ID of the authenticated user.
	 * @param {string} req.decodedToken.organization_code - The organization ID of the authenticated user.
	 * @returns {Promise<Object[]>} The list of connections.
	 * @throws Will throw an error if the request fails.
	 */
	async list(req) {
		try {
			return await connectionsService.list(
				req.pageNo,
				req.pageSize,
				req.searchText,
				req.query,
				req.decodedToken.id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			throw error
		}
	}
	/**
	 * Check if a connection already exists for the authenticated user.
	 * @param {Object} req - The request object.
	 * @param {Object} req.body - The request body containing connection details to check.
	 * @param {Object} req.decodedToken - The decoded token containing authenticated user info.
	 * @param {string} req.decodedToken.id - The ID of the authenticated user.
	 * @returns {Promise<Object>} The result of the connection existence check.
	 * @throws Will throw an error if the request fails.
	 */
	async checkConnection(req) {
		try {
			return await connectionsService.checkConnectionIfExists(req.decodedToken.id, req.body)
		} catch (error) {
			throw error
		}
	}
}
