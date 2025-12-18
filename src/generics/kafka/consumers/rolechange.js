const orgService = require('@services/org-admin')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			const { oldValues, newValues, entityId, tenant_code } = message
			message.userId = entityId.toString()

			// Trigger on any role difference (add/remove/change)
			const oldRoles = oldValues?.organizations?.[0]?.roles || []
			const newRoles = newValues?.organizations?.[0]?.roles || []
			const toTitles = (roles) => (roles || []).map((r) => r?.title).filter(Boolean)
			const oldSet = new Set(toTitles(oldRoles))
			const newSet = new Set(toTitles(newRoles))
			const rolesDiffer =
				oldSet.size !== newSet.size ||
				[...oldSet].some((t) => !newSet.has(t)) ||
				[...newSet].some((t) => !oldSet.has(t))

			if (rolesDiffer) {
				const bodyData = {
					user_id: entityId.toString(),
					current_roles: oldRoles,
					new_roles: newRoles,
					tenant_code: tenant_code,
				}
				const updateData = {
					updated_by: entityId,
					updated_at: new Date(),
					tenant_code: tenant_code,
				}
				await orgService.roleChange(bodyData, updateData, tenant_code)
				return resolve()
			}
		} catch (error) {
			return reject(error)
		}
	})
}

var errorTriggered = function (error) {
	return new Promise(function (resolve, reject) {
		try {
			return resolve('Error Processed')
		} catch (error) {
			return reject(error)
		}
	})
}

module.exports = {
	messageReceived: messageReceived,
	errorTriggered: errorTriggered,
}
