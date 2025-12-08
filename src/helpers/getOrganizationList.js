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
			const missingOrg = []

			// Check cache for each org code and tenant code combination
			for (const org of organizations) {
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
				} catch (cacheError) {}

				if (!cacheData) {
					missingOrg.push(org)
				}
			}
			if (missingOrg.length == 0) {
				return orgData
			}

			const organizationCodes = missingOrg.map((orgExt) => orgExt.organization_code)

			// Fetch organization details from database
			const filter = {
				organization_code: {
					[Op.in]: Array.from(organizationCodes),
				},
				tenant_code: tenantCode,
			}

			const organizationDetails = await organisationExtensionQueries.findAll(filter, {
				attributes: ['name', 'organization_id', 'organization_code', 'tenant_code'],
			})

			// Cache the fetched organizations for future use
			if (organizationDetails?.length > 0) {
				orgData.push(...organizationDetails)
			}
		} catch (error) {
			throw error(error)
		}
	}
}
