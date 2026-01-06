const userRequest = require('@services/users')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			const org = message.organizations?.[0]

			if (!org) {
				return resolve({ error: 'Organization missing' })
			}
			message.organization_id = org.id
			message.organization_code = org.code
			message.user_roles = (org.roles || []).map((role) => ({ title: role.title }))
			message.roles = message.user_roles

			// Convert id to string to match validation requirements
			message.id = message.id.toString()

			const response = await userRequest.add(message, message.id, message.organization_id, message.tenant_code)

			return resolve(response)
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
