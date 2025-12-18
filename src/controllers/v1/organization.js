const organizationService = require('@services/organization')

module.exports = class Organization {
	async update(req) {
		try {
			return await organizationService.update(req.body, req.decodedToken, req.decodedToken.tenant_code)
		} catch (error) {
			return error
		}
	}

	async eventListener(req) {
		try {
			console.log('CONTROLLER REQUEST BODY: ', req.body)
			// Note: eventListener is an internal service call - tenant context comes from body
			return await organizationService.createOrgExtension(req.body, req.body.tenant_code)
		} catch (error) {
			throw error
		}
	}
}
