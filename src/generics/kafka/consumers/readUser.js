const MenteesHelper = require('@services/mentees')
const MentorsHelper = require('@services/mentors')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			// Check if this is a batch message or individual message (backward compatibility)
			if (message.userBatches) {
				// New batch message format
				const { tenantCode, organizationCode, userBatches } = message
				if (!tenantCode || !userBatches) {
					console.log('❌ [Kafka Background] Batch message missing required fields, skipping')
					return resolve('Batch message incomplete')
				}

				console.log(
					`🔄 [Kafka Background] Processing batch: ${userBatches.mentors?.length || 0} mentors, ${
						userBatches.mentees?.length || 0
					} mentees`
				)

				const results = []

				// Process mentors batch
				if (userBatches.mentors && userBatches.mentors.length > 0) {
					console.log(`🎯 [Kafka Background] Processing ${userBatches.mentors.length} mentors`)
					for (const user of userBatches.mentors) {
						try {
							const response = await MentorsHelper.read(
								user.userId,
								user.organizationCode,
								'', // userId - default
								'', // isMentor - default
								[], // roles - empty array
								user.tenantCode
							)
							results.push({ userId: user.userId, type: 'mentor', success: true })
						} catch (error) {
							console.error(
								`❌ [Kafka Background] Failed to process mentor ${user.userId}:`,
								error.message
							)
							results.push({ userId: user.userId, type: 'mentor', success: false, error: error.message })
						}
					}
				}

				// Process mentees batch
				if (userBatches.mentees && userBatches.mentees.length > 0) {
					console.log(`🎯 [Kafka Background] Processing ${userBatches.mentees.length} mentees`)
					for (const user of userBatches.mentees) {
						try {
							const response = await MenteesHelper.read(
								user.userId,
								user.organizationCode,
								[], // roles - empty array
								user.tenantCode
							)
							results.push({ userId: user.userId, type: 'mentee', success: true })
						} catch (error) {
							console.error(
								`❌ [Kafka Background] Failed to process mentee ${user.userId}:`,
								error.message
							)
							results.push({ userId: user.userId, type: 'mentee', success: false, error: error.message })
						}
					}
				}

				const successCount = results.filter((r) => r.success).length
				const totalCount = results.length
				console.log(
					`✅ [Kafka Background] Batch processing complete: ${successCount}/${totalCount} users processed successfully`
				)

				return resolve({ batchResults: results, successCount, totalCount })
			} else {
				// Legacy individual message format (backward compatibility)
				const { userId, tenantCode, is_mentor, user_organization_code, user_tenant_code } = message
				if (!userId || !tenantCode || !user_organization_code || !user_tenant_code) {
					return resolve('Individual message incomplete')
				}

				console.log(
					`🔄 [Kafka Background] Processing individual user ${userId} (is_mentor: ${is_mentor}) for cache warming`
				)

				let response
				// Determine which service to call based on is_mentor field
				if (is_mentor) {
					response = await MentorsHelper.read(userId, user_organization_code, '', '', [], user_tenant_code)
				} else {
					response = await MenteesHelper.read(userId, user_organization_code, [], user_tenant_code)
				}

				console.log(`✅ [Kafka Background] Individual user ${userId} processed and cached`)
				return resolve(response)
			}
		} catch (error) {
			console.error(`❌ [Kafka Background] Failed to process message:`, error.message)
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
