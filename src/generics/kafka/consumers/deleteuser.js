const adminService = require('@services/admin')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			const response = await adminService.userDelete(
				message.entityId.toString(),
				message.userId,
				message.organizations?.code || message.organizations?.[0]?.code,
				message.tenant_code
			)
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
