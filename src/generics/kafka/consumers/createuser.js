const userRequest = require('@services/users')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			console.log('🔔 [KAFKA CONSUMER] ===== CREATE USER EVENT RECEIVED =====')
			console.log('🔔 [KAFKA CONSUMER] Raw Message:', JSON.stringify(message, null, 2))

			const org = message.organizations?.[0]
			console.log('🔔 [KAFKA CONSUMER] Organization data:', org ? JSON.stringify(org, null, 2) : 'MISSING')

			if (!org) {
				console.log('🔔 [KAFKA CONSUMER] ❌ org id is missing in create user event handling')
				return resolve({ error: 'Organization missing' })
			}

			console.log('🔔 [KAFKA CONSUMER] Processing organization...')
			message.organization_id = org.id
			message.organization_code = org.code
			message.user_roles = (org.roles || []).map((role) => ({ title: role.title }))
			message.roles = message.user_roles

			console.log('🔔 [KAFKA CONSUMER] Updated message data:')
			console.log('🔔 [KAFKA CONSUMER]   - Organization ID:', message.organization_id)
			console.log('🔔 [KAFKA CONSUMER]   - Organization Code:', message.organization_code)
			console.log('🔔 [KAFKA CONSUMER]   - User Roles:', message.user_roles)
			console.log('🔔 [KAFKA CONSUMER]   - Original ID:', message.id, 'Type:', typeof message.id)

			// Convert id to string to match validation requirements
			message.id = message.id.toString()
			console.log('🔔 [KAFKA CONSUMER]   - Converted ID:', message.id, 'Type:', typeof message.id)
			console.log('🔔 [KAFKA CONSUMER]   - Tenant Code:', message.tenant_code)

			console.log('🔔 [KAFKA CONSUMER] Calling userRequest.add with parameters:')
			console.log('🔔 [KAFKA CONSUMER]   - message:', Object.keys(message))
			console.log('🔔 [KAFKA CONSUMER]   - userId:', message.id)
			console.log('🔔 [KAFKA CONSUMER]   - organizationId:', message.organization_id)
			console.log('🔔 [KAFKA CONSUMER]   - tenantCode:', message.tenant_code)

			const response = await userRequest.add(message, message.id, message.organization_id, message.tenant_code)

			console.log('🔔 [KAFKA CONSUMER] userRequest.add response:', JSON.stringify(response, null, 2))
			console.log('🔔 [KAFKA CONSUMER] ===== CREATE USER EVENT COMPLETED =====')

			return resolve(response)
		} catch (error) {
			console.log('🔔 [KAFKA CONSUMER] ❌ ERROR in messageReceived:', error.message)
			console.log('🔔 [KAFKA CONSUMER] ❌ Error stack:', error.stack)
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
