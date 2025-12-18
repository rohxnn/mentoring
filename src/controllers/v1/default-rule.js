const defaultRuleService = require('@services/default-rule')

/**
 * Class representing Default Rule operations.
 */
module.exports = class DefaultRule {
	/**
	 * Creates a Default Rule.
	 * @method
	 * @async
	 * @name create
	 * @param {Object} req - The request object.
	 * @param {Object} req.body - The request payload.
	 * @param {Object} req.decodedToken - The decoded JWT token.
	 * @param {string} req.decodedToken.id - The user ID from the token.
	 * @param {string} req.decodedToken.organization_code - The organization ID from the token.
	 * @returns {Promise<Object>} - The Default Rule creation response.
	 */
	async create(req) {
		try {
			return await defaultRuleService.create(
				req.body,
				req.decodedToken.id,
				req.decodedToken.organization_id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			return error
		}
	}

	/**
	 * Updates a Default Rule.
	 * @method
	 * @async
	 * @name update
	 * @param {Object} req - The request object.
	 * @param {Object} req.body - The request payload.
	 * @param {Object} req.params - The request parameters.
	 * @param {string} req.params.id - The Default Rule ID to be updated.
	 * @param {Object} req.decodedToken - The decoded JWT token.
	 * @param {string} req.decodedToken.id - The user ID from the token.
	 * @param {string} req.decodedToken.organization_code - The organization ID from the token.
	 * @returns {Promise<Object>} - The Default Rule update response.
	 */
	async update(req) {
		try {
			return await defaultRuleService.update(
				req.body,
				req.params.id,
				req.decodedToken.id,
				req.decodedToken.organization_id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			return error
		}
	}

	/**
	 * Reads Default Rules.
	 * @method
	 * @async
	 * @name read
	 * @param {Object} req - The request object.
	 * @param {Object} req.params - The request parameters.
	 * @param {string} [req.params.id] - Optional Default Rule ID to read a specific rule.
	 * @param {Object} req.decodedToken - The decoded JWT token.
	 * @param {string} req.decodedToken.id - The user ID from the token.
	 * @param {string} req.decodedToken.organization_code - The organization ID from the token.
	 * @returns {Promise<Object>} - The entities.
	 */
	async read(req) {
		try {
			if (req.params.id)
				return await defaultRuleService.readOne(
					req.params.id,
					req.decodedToken.organization_code,
					req.decodedToken.tenant_code
				)
			return await defaultRuleService.readAll(req.decodedToken.organization_code, req.decodedToken.tenant_code)
		} catch (error) {
			return error
		}
	}

	/**
	 * Deletes a Default Rule.
	 * @method
	 * @async
	 * @name delete
	 * @param {Object} req - The request object.
	 * @param {Object} req.params - The request parameters.
	 * @param {string} req.params.id - The Default Rule ID to be deleted.
	 * @param {Object} req.decodedToken - The decoded JWT token.
	 * @param {string} req.decodedToken.organization_code - The organization ID from the token.
	 * @returns {Promise<Object>} - The Default Rule deletion response.
	 */
	async delete(req) {
		try {
			return await defaultRuleService.delete(
				req.params.id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			return error
		}
	}
}
