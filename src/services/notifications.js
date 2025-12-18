// Dependenices
const common = require('@constants/common')
const kafkaCommunication = require('@generics/kafka-communication')
const utils = require('@generics/utils')
const sessionQueries = require('@database/queries/sessions')
const sessionAttendeesQueries = require('@database/queries/sessionAttendees')
const userRequests = require('@requests/user')
const menteeQueries = require('@database/queries/userExtension')
const cacheHelper = require('@generics/cacheHelper')

module.exports = class Notifications {
	/**
	 * @description				- Send Notifications.
	 * @method
	 * @name 					- sendNotification
	 * @returns
	 */

	static async sendNotification(notificationJobId, notificataionTemplate, jobCreatorOrgCode = '', tenantCode) {
		try {
			// Data contains notificationJobId and notificationTemplate.
			// Extract sessionId from incoming notificationJobId.
			// Split the string by underscores and get the last part
			const parts = notificationJobId.split('_')
			const lastPart = parts[parts.length - 1]

			// Convert the last part to an integer
			const sessionId = Number(lastPart)

			// Find session data
			let sessions = await sessionQueries.findOne(
				{
					id: sessionId,
					status: common.PUBLISHED_STATUS,
				},
				tenantCode
			)

			// Get email template based on incoming request.
			let emailTemplate = await cacheHelper.notificationTemplates.get(
				tenantCode,
				jobCreatorOrgCode,
				notificataionTemplate
			)

			if (emailTemplate && sessions) {
				// if notificataionTemplate is {MENTEE_SESSION_REMAINDER_EMAIL_CODE} then notification to all personal registered for the session has to be send.
				if (notificataionTemplate === common.MENTEE_SESSION_REMAINDER_EMAIL_CODE) {
					await this.sendNotificationToAttendees(sessions, emailTemplate, tenantCode)
				} else {
					await this.sendNotificationsToMentor(sessions, emailTemplate, tenantCode)
				}
			}
		} catch (error) {
			throw error
		}
	}

	/**
	 * @description 		- Send Notification to attendees.
	 * @method
	 * @name 				- sendNotificationToAttendees
	 * @returns
	 */

	static async sendNotificationToAttendees(session, emailTemplate, tenantCode) {
		try {
			let allAttendees = []
			let attendeesInfo = []

			// Get all sessionAttendees joined for the session
			const sessionAttendees = await sessionAttendeesQueries.findAll(
				{
					session_id: session.id,
				},
				tenantCode
			)

			// If sessionAttendees data is available process the data
			if (sessionAttendees && sessionAttendees.length > 0) {
				sessionAttendees.forEach((attendee) => {
					allAttendees.push(attendee.mentee_id)
					attendeesInfo.push({
						userId: attendee.mentee_id,
						title: session.title,
					})
				})
			}

			// Get attendees accound details
			const attendeesAccounts = await menteeQueries.getUsersByUserIds(
				allAttendees,
				{
					attributes: ['user_id', 'name', 'email'],
				},
				tenantCode,
				true
			)

			// Get attendees accound details
			// const attendeesAccounts = await userRequests.getListOfUserDetails(allAttendees)

			if (attendeesAccounts && attendeesAccounts.length > 0) {
				attendeesInfo.forEach(async function (attendee) {
					let emailBody = emailTemplate.body.replace('{sessionTitle}', attendee.title)
					var foundElement = attendeesAccounts.find((e) => e.user_id === attendee.userId)
					if (foundElement && foundElement.email && foundElement.name) {
						emailBody = emailBody.replace('{name}', foundElement.name)
						const payload = {
							type: 'email',
							email: {
								to: foundElement.email,
								subject: emailTemplate.subject,
								body: emailBody,
							},
						}
						await kafkaCommunication.pushEmailToKafka(payload)
					}
				})
			}
		} catch (error) {
			throw error
		}
	}

	/**
	 * @description			- Send Notification to Mentors.
	 * @method
	 * @name 				- sendNotificationsToMentor
	 * @returns
	 */

	static async sendNotificationsToMentor(session, emailTemplate, tenantCode) {
		try {
			const mentorIds = []
			mentorIds.push(session.mentor_id.toString())

			// Get mentor details
			const userAccounts = await userRequests.getUserDetailedList(mentorIds, tenantCode, false, true)

			if (userAccounts && userAccounts.result.length > 0) {
				const userAccountDetails = userAccounts.result[0]
				let emailBody = emailTemplate.body
				if (
					process.env.DEFAULT_MEETING_SERVICE.toUpperCase() != common.BBB_VALUE &&
					!session.meeting_info?.link
				) {
					emailBody = utils.extractEmailTemplate(emailBody, ['default', 'linkWarning'])
				} else {
					emailBody = utils.extractEmailTemplate(emailBody, ['default'])
				}
				emailBody = emailBody.replace('{sessionTitle}', session.title)
				if (userAccountDetails && userAccountDetails.email && userAccountDetails.name) {
					emailBody = emailBody.replace('{name}', userAccountDetails.name)
					const payload = {
						type: 'email',
						email: {
							to: userAccountDetails.email,
							subject: emailTemplate.subject,
							body: emailBody,
						},
					}
					await kafkaCommunication.pushEmailToKafka(payload)
				}
			}
		} catch (error) {
			throw error
		}
	}
}
