/**
 * name : resources.js
 * author : Rakesh
 * created-date : 10-April-2025
 * Description : Resource Controller.
 */

// Dependencies
const resourcesService = require('@services/resources')

module.exports = class Resources {
	/**
	 * delete resource
	 * @method
	 * @name delete
	 * @param {Object} req -request data.
	 * @returns {JSON} - resource object.
	 */

	async delete(req) {
		try {
			const deletedResource = await resourcesService.deleteResource(
				req.params.id,
				req.query.sessionId,
				req.decodedToken.id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
			return deletedResource
		} catch (error) {
			return error
		}
	}
}
