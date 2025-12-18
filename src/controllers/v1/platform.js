const platformService = require('@services/platform')

module.exports = class Config {
	/**
	 * Get app related config details
	 * @method
	 * @name getConfig
	 * @returns {JSON} - returns success response.
	 */

	async config(req) {
		try {
			const tenantCode = req.decodedToken.tenant_code
			const organizationCode = req.decodedToken.organization_code

			const config = await platformService.getConfig(tenantCode, organizationCode)
			return config
		} catch (error) {
			return error
		}
	}
}
