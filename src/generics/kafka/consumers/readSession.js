const SessionsHelper = require('@services/sessions')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			// Check if this is a batch message or individual message (backward compatibility)
			if (message.sessionBatch) {
				// New batch message format
				const { tenantCode, organizationCode, sessionBatch } = message
				if (!tenantCode || !organizationCode || !sessionBatch || !Array.isArray(sessionBatch)) {
					console.log('❌ [Kafka Background] Session batch message missing required fields, skipping')
					return resolve('Session batch message incomplete')
				}

				console.log(`🔄 [Kafka Background] Processing session batch: ${sessionBatch.length} sessions`)

				const results = []

				// Process all sessions in batch
				for (const sessionInfo of sessionBatch) {
					try {
						const {
							sessionId,
							tenantCode: sessionTenantCode,
							organizationCode: sessionOrgCode,
						} = sessionInfo

						console.log(`🎯 [Kafka Background] Processing session ${sessionId}`)

						// Call service method to get complete session details and auto-cache
						const sessionDetails = await SessionsHelper.details(
							sessionId, // id
							'', // userId - default
							'', // isAMentor - default
							{}, // queryParams
							[], // roles
							sessionOrgCode, // orgCode (session-specific)
							sessionTenantCode // tenantCode (session-specific)
						)

						results.push({ sessionId, success: true })
						console.log(`✅ [Kafka Background] Session ${sessionId} processed and cached`)
					} catch (error) {
						console.error(
							`❌ [Kafka Background] Failed to process session ${sessionInfo.sessionId}:`,
							error.message
						)
						results.push({ sessionId: sessionInfo.sessionId, success: false, error: error.message })
					}
				}

				const successCount = results.filter((r) => r.success).length
				const totalCount = results.length
				console.log(
					`✅ [Kafka Background] Session batch processing complete: ${successCount}/${totalCount} sessions processed successfully`
				)

				return resolve({ batchResults: results, successCount, totalCount })
			} else {
				// Legacy individual message format (backward compatibility)
				const { sessionId, tenantCode, organizationCode } = message
				if (!sessionId || !tenantCode || !organizationCode) {
					console.log(`Read session event missing required fields; skipping`, {
						sessionId,
						tenantCode,
						organizationCode,
					})
					return resolve('Individual session message incomplete')
				}

				console.log(`🔄 [Kafka Background] Processing individual session ${sessionId} for cache warming`)

				// Call service method to get complete session details and auto-cache
				const sessionDetails = await SessionsHelper.details(
					sessionId, // id
					'', // userId - default
					'', // isAMentor - default
					{}, // queryParams
					[], // roles
					organizationCode, // orgCode
					tenantCode // tenantCode
				)

				console.log(`✅ [Kafka Background] Individual session ${sessionId} processed and cached`)
				return resolve(sessionDetails)
			}
		} catch (error) {
			console.error(`❌ [Kafka Background] Failed to process session message:`, error.message)
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
