'use strict'

const userRequests = require('@requests/user')

/**
 * Retrieves the default organization code.
 * @returns {Promise<string|null>} Default organization code or null if not found.
 */
exports.getDefaults = async () => {
	try {
		const { DEFAULT_ORGANISATION_CODE, DEFAULT_TENANT_CODE } = process.env
		if (DEFAULT_ORGANISATION_CODE && DEFAULT_TENANT_CODE) {
			return {
				orgCode: DEFAULT_ORGANISATION_CODE,
				tenantCode: DEFAULT_TENANT_CODE,
			}
		}

		const { success, data } = await userRequests.fetchOrgDetails({
			organizationCode: DEFAULT_ORGANISATION_CODE,
			tenantCode: DEFAULT_TENANT_CODE,
		})

		return {
			orgCode: success && data?.result?.code,
			tenantCode: data?.result?.tenant_code,
		}
	} catch (err) {
		console.error('Error in getDefaults:', err)
		return null
	}
}
