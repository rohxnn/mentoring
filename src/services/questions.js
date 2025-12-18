const httpStatusCode = require('@generics/http-status')
const questionQueries = require('../database/queries/questions')
const responses = require('@helpers/responses')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const { Op } = require('sequelize')

module.exports = class questionsHelper {
	/**
	 * Create questions.
	 * @method
	 * @name create
	 * @param {Object} bodyData
	 * @returns {JSON} - Create questions
	 */

	static async create(bodyData, userId, organizationCode, tenantCode) {
		try {
			bodyData['created_by'] = userId
			bodyData['updated_by'] = userId
			bodyData['tenant_code'] = tenantCode
			bodyData['organization_code'] = organizationCode
			let question = await questionQueries.createQuestion(bodyData, tenantCode)
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'QUESTION_CREATED_SUCCESSFULLY',
				result: question,
			})
		} catch (error) {
			console.log(error)
			throw error
		}
	}

	/**
	 * Update questions.
	 * @method
	 * @name update
	 * @param {String} questionId - question id.
	 * @param {Object} bodyData
	 * @returns {JSON} - Update questions.
	 */

	static async update(questionId, bodyData, userId, organizationCode, tenantCode) {
		try {
			bodyData['updated_by'] = userId
			bodyData['organization_code'] = organizationCode
			const filter = { id: questionId, created_by: userId, tenant_code: tenantCode }
			const result = await questionQueries.updateOneQuestion(filter, bodyData, tenantCode)

			if (result === 'QUESTION_NOT_FOUND') {
				return responses.failureResponse({
					message: 'QUESTION_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			// Fetch the updated question data
			const updatedQuestion = await this.read(questionId, tenantCode)

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'QUESTION_UPDATED_SUCCESSFULLY',
				result: updatedQuestion.result,
			})
		} catch (error) {
			console.log(error)
			throw error
		}
	}

	/**
	 * Read question.
	 * @method
	 * @name read
	 * @param {String} questionId - question id.
	 * @returns {JSON} - Read question.
	 */

	static async read(questionId, tenantCode) {
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

			const filter = { id: questionId, tenant_code: { [Op.in]: [tenantCode, defaults.tenantCode] } }
			const question = await questionQueries.findOneQuestion(filter)
			if (!question) {
				return responses.failureResponse({
					message: 'QUESTION_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'QUESTION_FETCHED_SUCCESSFULLY',
				result: question,
			})
		} catch (error) {
			throw error
		}
	}
}
