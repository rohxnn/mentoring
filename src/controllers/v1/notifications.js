/**
 * name : notifications.js
 * author : Rakesh Kumar
 * created-date : 09-Dec-2021
 * Description : notifications related functions.
 */

// Dependencies
const notificationsService = require('@services/notifications')
const httpStatusCode = require('@generics/http-status')

module.exports = class Notifications {
	/**
	 * @description			- Notification email cron job.
	 * @method				- post
	 * @name 				- emailCronJob
	 * @returns {JSON} 		- Send email notification.
	 */

	async emailCronJob(req) {
		try {
			// For scheduler jobs, tenant_code comes from request body since there's no decoded token
			// For regular API calls, it comes from decoded token
			const tenantCode = req.body.tenant_code || (req.decodedToken && req.decodedToken.tenant_code)

			if (!tenantCode) {
				return {
					statusCode: httpStatusCode.bad_request,
					message: 'TENANT_CODE_REQUIRED',
				}
			}

			// Make a call to notification service
			notificationsService.sendNotification(
				req.body.job_id,
				req.body.email_template_code,
				req.body.job_creator_org_id ? req.body.job_creator_org_id : '',
				tenantCode
			)
			return {
				statusCode: httpStatusCode.ok,
			}
		} catch (error) {
			return error
		}
	}
}
