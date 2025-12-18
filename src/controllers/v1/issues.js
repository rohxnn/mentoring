const issuesService = require('@services/issues')

module.exports = class Help {
	/**
	 * Report an issue
	 * @method
	 * @name create
	 * @param {Object} req -request data.
	 * @param {Object} req.body -request body contains issue details.
	 * @param {string} req.body.description - Issue description.
	 * @returns {JSON} - returns success response.
	 */

	async create(req) {
		try {
			const createdIssue = await issuesService.create(req.body, req.decodedToken, req.decodedToken.tenant_code)
			return createdIssue
		} catch (error) {
			return error
		}
	}
}
