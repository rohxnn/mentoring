// Dependencies
const common = require('@constants/common')
const httpStatusCode = require('@generics/http-status')
const sessionQueries = require('@database/queries/sessions')
const questionSetQueries = require('@database/queries/question-set')
const questionsQueries = require('@database/queries/questions')
const feedbackQueries = require('@database/queries/feedback')
const sessionAttendeesQueries = require('@database/queries/sessionAttendees')
const mentorExtensionQueries = require('@database/queries/mentorExtension')
const responses = require('@helpers/responses')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const { Op } = require('sequelize')
const cacheHelper = require('@generics/cacheHelper')

module.exports = class MenteesHelper {
	/**
	 * Pending feedback.
	 * @method
	 * @name pending
	 * @param {String} userId - user id.
	 * @param {Boolean} isAMentor
	 * @param {String} organizationCode - organization code.
	 * @param {String} tenantCode - tenant code.
	 * @returns {JSON} - pending feedback.
	 */

	static async pending(userId, isAMentor, organizationCode, tenantCode) {
		try {
			const sessions = []
			const completedSessionsFeedback = await feedbackQueries.findAll(
				{
					user_id: userId,
				},
				tenantCode
			)
			const completedSessionIds = completedSessionsFeedback.map((feedback) => feedback.session_id)

			if (isAMentor) {
				const options = {
					attributes: ['id', 'title', 'description', 'mentor_feedback_question_set'],
				}

				const sessionDetails = await sessionQueries.mentorsSessionWithPendingFeedback(
					userId,
					tenantCode,
					options,
					completedSessionIds
				)

				// Add null safety check for sessionDetails
				if (sessionDetails && Array.isArray(sessionDetails)) {
					sessions.push(...sessionDetails)
				}
			}

			const menteeSessionAttendances = await sessionAttendeesQueries.findPendingFeedbackSessions(
				userId,
				completedSessionIds,
				tenantCode
			)

			// Add null/array checks for menteeSessionAttendances
			if (
				!menteeSessionAttendances ||
				!Array.isArray(menteeSessionAttendances) ||
				menteeSessionAttendances.length === 0
			) {
				// Don't return here - continue to proper response formatting
			} else {
				const sessionIds = menteeSessionAttendances
					.map((menteeSessionAttendance) => menteeSessionAttendance?.session_id)
					.filter(Boolean)

				const sessionOptions = {
					attributes: ['id', 'title', 'description', 'mentee_feedback_question_set'],
				}

				const menteeSessionDetails = await sessionQueries.findAll(
					{ id: sessionIds, status: 'COMPLETED' },
					tenantCode,
					sessionOptions
				)

				// Add null safety for menteeSessionDetails
				if (menteeSessionDetails && Array.isArray(menteeSessionDetails)) {
					sessions.push(...menteeSessionDetails)
				}
			}

			// Getting unique form codes with null safety
			const formCodes = [
				...new Set(
					(sessions || [])
						.map(
							(session) => session?.mentee_feedback_question_set || session?.mentor_feedback_question_set
						)
						.filter(Boolean)
				),
			]

			// Fetch feedback form data
			const feedbackForm = {}

			for (const formCode of formCodes) {
				const formData = await getFeedbackQuestions(formCode, tenantCode)
				if (formData) {
					feedbackForm[formCode] = formData
				}
			}

			// Attach feedback forms to sessions
			for (const sessionData of sessions) {
				const formCode = sessionData.mentee_feedback_question_set || sessionData.mentor_feedback_question_set
				sessionData['form'] = feedbackForm[formCode] || []
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'PENDING_FEEDBACK_FETCHED_SUCCESSFULLY',
				result: sessions,
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Feedback forms.
	 * @method
	 * @name forms
	 * @param {String} sessionId - session id.
	 * @param {Boolean} isAMentor
	 * @returns {JSON} - Feedback forms.
	 */

	static async forms(sessionId, roles, tenantCode, orgCode) {
		try {
			let sessioninfo =
				(await cacheHelper.sessions.get(tenantCode, sessionId)) ??
				(await sessionQueries.findById(sessionId, tenantCode))

			if (!sessioninfo) {
				return responses.failureResponse({
					message: 'SESSION_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let formCode
			const isAMentor = roles.some((role) => role.title == common.MENTOR_ROLE)
			if (isAMentor) {
				formCode = sessioninfo.mentor_feedback_question_set
			} else {
				formCode = sessioninfo.mentee_feedback_question_set
			}

			let formData = await getFeedbackQuestions(formCode, tenantCode)

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'FEEDBACKFORM_MESSAGE',
				result: {
					form: formData,
				},
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Feedback submission.
	 * @method
	 * @name submit
	 * @param {String} sessionId - session id.
	 * @param {Object} updateData
	 * @param {String} userId - user id.
	 * @param {Boolean} isAMentor
	 * @returns {JSON} - Feedback submission.
	 */

	static async submit(sessionId, updateData, userId, isAMentor, tenantCode, orgCode) {
		let feedback_as
		if (isAMentor) {
			feedback_as = updateData.feedback_as
			delete updateData.feedback_as
		}
		try {
			//get session details
			let sessionInfo =
				(await cacheHelper.sessions.get(tenantCode, sessionId)) ??
				(await sessionQueries.findById(sessionId, tenantCode))
			if (!sessionInfo) {
				return responses.failureResponse({
					message: 'SESSION_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			//get the feedbacks of that particular user for that session
			const feedbacks = await feedbackQueries.findAll(
				{
					session_id: sessionId,
					user_id: userId,
				},
				tenantCode
			)

			//check the feedback is exist
			let feedbackNotExists = []
			if (updateData.feedbacks && updateData.feedbacks.length > 0) {
				if (feedbacks && feedbacks.length > 0) {
					feedbackNotExists = updateData.feedbacks.filter(
						(data) => !feedbacks.some((feedback) => data.question_id == feedback.question_id)
					)
				} else {
					feedbackNotExists = updateData.feedbacks
				}
			}

			if (feedbackNotExists && feedbackNotExists.length > 0) {
				feedbackNotExists.map(async function (feedback) {
					feedback.session_id = sessionId
					feedback.user_id = userId
					feedback.response = feedback.value
					feedback.tenant_code = tenantCode
				})
			}

			//mentor feedback
			if (isAMentor && feedback_as === 'mentor') {
				//check for already submitted feedback
				if (
					sessionInfo.is_feedback_skipped == true ||
					(feedbacks.length > 0 && feedbackNotExists.length == 0)
				) {
					return responses.failureResponse({
						message: 'FEEDBACK_ALREADY_SUBMITTED',
						statusCode: httpStatusCode.bad_request,
						responseCode: 'CLIENT_ERROR',
					})
				}

				//update session
				if (updateData.is_feedback_skipped) {
					const rowsAffected = await sessionQueries.updateOne(
						{ id: sessionId, tenant_code: tenantCode },
						updateData
					)
					if (rowsAffected == 0) {
						return responses.failureResponse({
							message: 'SESSION_NOT_FOUND',
							statusCode: httpStatusCode.bad_request,
							responseCode: 'CLIENT_ERROR',
						})
					}
					try {
						await cacheHelper.sessions.delete(tenantCode, sessionId)
					} catch (cacheError) {
						console.error(`❌ Failed to delete session cache after deletion:`, cacheError)
					}
				}

				//create feedback
				if (feedbackNotExists && feedbackNotExists.length > 0) {
					await feedbackQueries.bulkCreate(feedbackNotExists)

					// Invalidate mentor cache after feedback submission (may affect mentor ratings/profile)
					// Note: We already have mentorDetails from ratingCalculation, but userId here refers to the feedback submitter
					// The actual mentor cache invalidation will happen in ratingCalculation function where we have mentor data
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'FEEDBACK_SUBMITTED',
				})
			} else {
				// mentee feedback
				const sessionAttendesInfo = await sessionAttendeesQueries.findOne(
					{
						session_id: sessionId,
						mentee_id: userId,
					},
					tenantCode,
					{
						attributes: ['is_feedback_skipped'],
					}
				)

				if (
					sessionAttendesInfo.is_feedback_skipped == true ||
					(feedbacks.length > 0 && feedbackNotExists.length == 0)
				) {
					return responses.failureResponse({
						message: 'FEEDBACK_ALREADY_SUBMITTED',
						statusCode: httpStatusCode.bad_request,
						responseCode: 'CLIENT_ERROR',
					})
				}

				if (updateData.is_feedback_skipped) {
					const attendeeRowsAffected = await sessionAttendeesQueries.updateOne(
						{
							session_id: sessionId,
							mentee_id: userId,
							tenant_code: tenantCode,
						},
						updateData
					)
					if (attendeeRowsAffected[0] == 0) {
						return responses.failureResponse({
							message: 'SESSION_NOT_FOUND',
							statusCode: httpStatusCode.bad_request,
							responseCode: 'CLIENT_ERROR',
						})
					}
				} else {
					if (feedbackNotExists && feedbackNotExists.length > 0) {
						await feedbackQueries.bulkCreate(feedbackNotExists)
						for (const feedbackInfo of feedbackNotExists) {
							let questionData = await questionsQueries.findOneQuestion({
								id: feedbackInfo.question_id,
								tenant_code: tenantCode,
							})
							if (
								questionData &&
								questionData.category &&
								questionData.category.evaluating == common.MENTOR_EVALUATING
							) {
								await ratingCalculation(feedbackInfo, sessionInfo.mentor_id, tenantCode, orgCode)
							}
						}
					}
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'FEEDBACK_SUBMITTED',
				})
			}
		} catch (error) {
			throw error
		}
	}
}

/**
 * Get Feedback Questions.
 * @method
 * @name getFeedbackQuestions
 * @param {String} formCode - form code
 * @returns {JSON} - Feedback forms.
 */

const getFeedbackQuestions = async function (formCode, tenantCode) {
	try {
		const defaults = await getDefaults()
		if (!defaults.orgCode)
			return responses.failureResponse({
				message: 'DEFAULT_ORG_CODE_NOT_SET',
				statusCode: httpStatusCode.bad_request,
				responseCode: 'CLIENT_ERROR',
			})
		if (!defaults.tenantCode)
			return responses.failureResponse({
				message: 'DEFAULT_TENANT_CODE_NOT_SET',
				statusCode: httpStatusCode.bad_request,
				responseCode: 'CLIENT_ERROR',
			})

		let questionSet = await questionSetQueries.findOneQuestionSet({
			code: formCode,
			tenant_code: { [Op.in]: [tenantCode, defaults.tenantCode] },
		})

		let result = {}
		if (questionSet && questionSet.questions) {
			let questions = await questionsQueries.find({
				id: questionSet.questions,
				tenant_code: { [Op.in]: [tenantCode, defaults.tenantCode] },
			})
			const questionIndexMap = new Map()
			questionSet.questions.forEach((id, index) => {
				questionIndexMap.set(id.toString(), index)
			})
			questions.sort((x, y) => {
				const idX = parseInt(x.id)
				const idY = parseInt(y.id)
				return questionIndexMap.get(idX.toString()) - questionIndexMap.get(idY.toString())
			})

			if (questions && questions.length > 0) {
				questions.map((data) => {
					if (data.question) {
						data['label'] = data.question
						delete data.question
						return data
					}
				})
				result = questions
			}
		}
		return result
	} catch (error) {
		return error
	}
}

/**
 * Rating Calculation
 * @method
 * @name ratingCalculation
 * @param {Object} feedbackData - feedback data
 * @param {String} mentor_id - mentor id
 * @returns {JSON} - mentor data.
 */

const ratingCalculation = async function (ratingData, mentor_id, tenantCode, orgCode) {
	try {
		let mentorDetails = await cacheHelper.mentor.get(tenantCode, mentor_id)
		let mentorRating = mentorDetails.rating
		let updateData

		if (mentorRating?.average || mentorRating !== null) {
			let totalRating = parseFloat(ratingData.response)
			let ratingBreakup = []
			if (mentorRating.breakup && mentorRating.breakup.length > 0) {
				let breakupFound = false
				ratingBreakup = await Promise.all(
					mentorRating.breakup.map((breakupData) => {
						totalRating = totalRating + parseFloat(breakupData.star * breakupData.votes)

						if (breakupData['star'] == Number(ratingData.response)) {
							breakupFound = true
							return {
								star: breakupData.star,
								votes: breakupData.votes + 1,
							}
						} else {
							return breakupData
						}
					})
				)

				if (!breakupFound) {
					ratingBreakup.push({
						star: Number(ratingData.response),
						votes: 1,
					})
				}
			}

			let totalVotesCount = mentorRating.votes + 1
			let avg = Math.round(parseFloat(totalRating) / totalVotesCount)
			updateData = {
				rating: {
					average: avg,
					votes: totalVotesCount,
					breakup: ratingBreakup,
				},
			}
		} else {
			updateData = {
				rating: {
					average: parseFloat(ratingData.response),
					votes: 1,
					breakup: [
						{
							star: Number(ratingData.response),
							votes: 1,
						},
					],
				},
			}
		}
		await mentorExtensionQueries.updateMentorExtension(mentor_id, updateData, tenantCode)

		// Invalidate mentor profile cache after rating update
		try {
			await cacheHelper.mentor.delete(tenantCode, mentor_id)
		} catch (cacheError) {
			console.error(`❌ Failed to invalidate mentor cache after rating update:`, cacheError)
		}

		return
	} catch (error) {
		return error
	}
}
