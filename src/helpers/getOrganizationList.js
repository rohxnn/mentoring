const cacheHelper = require('@generics/cacheHelper')
const organisationExtensionQueries = require('@database/queries/organisationExtension')
const { Op } = require('sequelize')

module.exports = class OrganizationsList {
	static async organizationListFromCache(organizations, tenantCode) {
		try {
			if (organizations.length === 0) {
				return []
			}
			// Try to get cached organizations first
			const orgData = []

			// Check cache for each org code and tenant code combination
			await Promise.all(
				organizations.map(async (org) => {
					let cacheData
					try {
						cacheData = await cacheHelper.organizations.get(
							tenantCode,
							org.organization_code,
							org.organization_id
						)
						if (cacheData) {
							orgData.push(cacheData)
						}
					} catch (cacheError) {
						throw cacheError
					}
				})
			)

			return orgData
		} catch (error) {
			throw error
		}
	}
}
