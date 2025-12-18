const formQueries = require('../database/queries/form')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const utils = require('@generics/utils')

async function getAllFormsVersion(tenantCode, orgCode) {
	try {
		if (!tenantCode || !orgCode) {
			const defaults = await getDefaults()
			tenantCode = tenantCode || defaults?.tenantCode
			orgCode = orgCode || defaults?.orgCode
		}
		return await formQueries.findAllTypeFormVersion(tenantCode, orgCode)
	} catch (error) {
		console.error(error)
	}
}
module.exports = { getAllFormsVersion }
