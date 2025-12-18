'use strict'
const common = require('@constants/common')
const httpStatusCode = require('@generics/http-status')
const organisationExtensionQueries = require('@database/queries/organisationExtension')
const questionSetQueries = require('../database/queries/question-set')
const { Op } = require('sequelize')
const { eventListenerRouter } = require('@helpers/eventListnerRouter')
const responses = require('@helpers/responses')
const cacheHelper = require('@generics/cacheHelper')

module.exports = class OrganizationService {
	static async update(bodyData, decodedToken, tenantCode) {
		try {
			const questionSets = await questionSetQueries.findQuestionSets(
				{
					code: { [Op.in]: [bodyData.mentee_feedback_question_set, bodyData.mentor_feedback_question_set] },
					tenant_code: tenantCode,
				},
				['id', 'code']
			)
			if (
				questionSets.length === 0 ||
				(questionSets.length === 1 &&
					bodyData.mentee_feedback_question_set !== bodyData.mentor_feedback_question_set)
			) {
				return responses.failureResponse({
					message: 'QUESTIONS_SET_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			const extensionData = {
				organization_id: decodedToken.organization_id,
				organization_code: decodedToken.organization_code,
				tenant_code: tenantCode,
				mentee_feedback_question_set: bodyData.mentee_feedback_question_set,
				mentor_feedback_question_set: bodyData.mentor_feedback_question_set,
				updated_by: decodedToken.id,
			}
			const orgExtension = await organisationExtensionQueries.upsert(extensionData)

			// Update cache with fresh data after update
			try {
				await cacheHelper.organizations.set(
					tenantCode,
					decodedToken.organization_code,
					decodedToken.organization_id,
					orgExtension
				)
			} catch (cacheError) {
				console.error(`❌ Failed to update organization cache after update:`, cacheError)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'ORG_DEFAULT_QUESTION_SETS_SET_SUCCESSFULLY',
				result: {
					organization_id: orgExtension.organization_id,
					mentee_feedback_question_set: orgExtension.mentee_feedback_question_set,
					mentor_feedback_question_set: orgExtension.mentor_feedback_question_set,
					updated_by: orgExtension.updated_by,
				},
			})
		} catch (error) {
			console.log(error)
			throw error
		}
	}

	static async createOrgExtension(eventBody, tenantCode) {
		try {
			console.log('🎯 [ORG EXTENSION] EVENT BODY: ', JSON.stringify(eventBody, null, 2))
			console.log('📋 [ORG EXTENSION] DEFAULT POLICY: ', common.getDefaultOrgPolicies())
			const extensionData = {
				...common.getDefaultOrgPolicies(),
				organization_id: eventBody.entityId,
				organization_code: eventBody.code,
				created_by: eventBody.created_by,
				updated_by: eventBody.created_by,
				name: eventBody.name,
				tenant_code: eventBody.tenant_code,
			}
			console.log('💾 [ORG EXTENSION] COMPLETE EXTENSION DATA: ', JSON.stringify(extensionData, null, 2))
			const orgExtension = await organisationExtensionQueries.upsert(extensionData, tenantCode)
			console.log('EXTENSION DATA AFTER INSERT: ', orgExtension)

			// Cache the newly created organization extension
			try {
				await cacheHelper.organizations.set(
					tenantCode,
					extensionData.organization_code,
					extensionData.organization_id,
					orgExtension
				)
			} catch (cacheError) {
				console.error(`❌ Failed to cache organization after creation:`, cacheError)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'ORG_EXTENSION_CREATED_SUCCESSFULLY',
				result: {
					organization_id: orgExtension.organization_id,
				},
			})
		} catch (error) {
			if (error.name === 'SequelizeUniqueConstraintError')
				throw new Error(`Extension Already Exist For Organization With Id: ${eventBody.entityId}`)
			else throw error
		}
	}

	/**
	 * Get organization extension details with cache support
	 * @method
	 * @name details
	 * @param {String} organizationCode - Organization code
	 * @param {String} organizationId - Organization ID
	 * @param {String} tenantCode - Tenant code
	 * @returns {JSON} - Organization extension details
	 */
	static async details(organizationCode, organizationId, tenantCode) {
		try {
			// Try to get from cache first
			let orgExtension = await cacheHelper.organizations.get(tenantCode, organizationCode, organizationId)

			if (orgExtension) {
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'ORG_EXTENSION_FETCHED_SUCCESSFULLY',
					result: orgExtension,
				})
			}

			// If not in cache, fetch from database
			orgExtension = await organisationExtensionQueries.getById(organizationCode, tenantCode)

			if (!orgExtension) {
				return responses.failureResponse({
					message: 'ORG_EXTENSION_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'ORG_EXTENSION_FETCHED_SUCCESSFULLY',
				result: orgExtension,
			})
		} catch (error) {
			console.log(error)
			throw error
		}
	}

	static async eventListener(eventBody) {
		try {
			//EventBody Validation - TODO: Check if this should be a middleware
			/* const { entity, eventType, entityId } = eventBody
			if (!entity || !eventType || !entityId)
				throw new Error('Entity, EventType & EntityId values are mandatory for an Event')
			return await eventListenerRouter(eventBody, {
				createFn: this.createOrgExtension,
			}) */
			return this.createOrgExtension(eventBody)
		} catch (error) {
			console.log(error)
			return error
		}
	}
}
