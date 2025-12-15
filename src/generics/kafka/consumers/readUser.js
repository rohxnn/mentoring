const MenteesHelper = require('@services/mentees')
const MentorsHelper = require('@services/mentors')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			const { users } = message
			let results = []
			if (Array.isArray(users) && users.length > 0) {
				results = await Promise.all(
					users.map(async (user) => {
						if (user.is_mentor) {
							try {
								await MentorsHelper.read(
									user.user_id,
									user.organization_code,
									'', // userId - default
									'', // isMentor - default
									[], // roles - empty array
									user.tenant_code
								)
								return { userId: user.user_id, is_mentor: user.is_mentor, success: true }
							} catch (error) {
								console.error(
									`❌ [Kafka Background] Failed to process mentor ${user.user_id}:`,
									error.message
								)
								return {
									userId: user.user_id,
									is_mentor: user.is_mentor,
									success: false,
									error: error.message,
								}
							}
						} else {
							try {
								await MenteesHelper.read(
									user.user_id,
									user.organization_code,
									[], // roles - empty array
									user.tenant_code
								)
								return { userId: user.user_id, is_mentor: user.is_mentor, success: true }
							} catch (error) {
								console.error(
									`❌ [Kafka Background] Failed to process mentee ${user.user_id}:`,
									error.message
								)
								return {
									userId: user.user_id,
									is_mentor: user.is_mentor,
									success: false,
									error: error.message,
								}
							}
						}
					})
				)
			}
			const successCount = results.filter((r) => r.success).length
			const totalCount = results.length
			console.log(
				`✅ [Kafka Background] processing of read users complete: ${successCount}/${totalCount} users processed successfully`
			)

			return resolve({ results: results, successCount, totalCount })
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
