const common = require('@constants/common')
const defaultRuleQueries = require('@database/queries/defaultRule')
const entityTypeCache = require('@helpers/entityTypeCache')
const entityTypeQueries = require('@database/queries/entityType')
const mentorExtensionQueries = require('@database/queries/mentorExtension')
const menteeExtensionQueries = require('@database/queries/userExtension')
const sessionQueries = require('@database/queries/sessions')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const responses = require('@helpers/responses')
const httpStatusCode = require('@generics/http-status')
const { Op } = require('sequelize')
const { UniqueConstraintError } = require('sequelize')

const connections = require('@database/queries/connection')
const { defaultRulesFilter, validateDefaultRulesFilter } = require('@helpers/defaultRules')

module.exports = class DefaultRuleHelper {
	/**
	 * Validates the target and requester fields in the body data.
	 *
	 * @param {string} defaultOrgCode - The ID of the default organization.
	 * @param {Object} bodyData - The data to be validated.
	 * @param {string} bodyData.type - The type of the rule.
	 * @param {boolean} bodyData.is_target_from_sessions_mentor - Whether the target is from sessions mentor.
	 * @param {string} bodyData.target_field - The target field to be validated.
	 * @param {string} bodyData.requester_field - The requester field to be validated.
	 * @param {string} bodyData.operator - The operator to be validated if applicable.
	 *
	 * @returns {Promise<Object>} A promise that resolves to an object indicating the validation result.
	 * The object contains a boolean `isValid` indicating if the validation passed and an array `errors` with the validation errors if any.
	 */

	static async validateFields(orgCodes, bodyData, tenantCodes) {
		const isSessionType =
			bodyData.type === common.DEFAULT_RULES.SESSION_TYPE && !bodyData.is_target_from_sessions_mentor
		const modelNamePromise = isSessionType ? sessionQueries.getModelName() : mentorExtensionQueries.getModelName()

		const mentorModelNamePromise = mentorExtensionQueries.getModelName()

		const [modelName, mentorModelName] = await Promise.all([modelNamePromise, mentorModelNamePromise])

		const validFieldsPromise = Promise.all([
			entityTypeQueries.findAllEntityTypes(orgCodes, tenantCodes, ['id', 'data_type'], {
				status: common.ACTIVE_STATUS,
				value: bodyData.target_field,
				model_names: { [Op.contains]: [modelName] },
				required: true,
				allow_filtering: true,
			}),
			entityTypeQueries.findAllEntityTypes(orgCodes, tenantCodes, ['id', 'data_type'], {
				status: common.ACTIVE_STATUS,
				value: bodyData.requester_field,
				model_names: { [Op.contains]: [mentorModelName] },
				required: true,
				allow_filtering: true,
			}),
		])

		const [validTargetField, validRequesterField] = await validFieldsPromise

		const errors = []

		if (validTargetField.length === 0) {
			errors.push({ param: 'target_field', msg: 'Invalid target_field' })
		}

		if (validRequesterField.length === 0) {
			errors.push({ param: 'requester_field', msg: 'Invalid requester_field' })
		}

		if (validTargetField.length > 0 && validRequesterField.length > 0) {
			if (validTargetField[0]?.data_type !== validRequesterField[0]?.data_type) {
				errors.push({
					param: 'target_field,requester_field',
					msg: 'Data types of target_field and requester_field should match',
				})
			} else {
				const operatorValidation = {
					ARRAY: common.DEFAULT_RULES.ARRAY_TYPES.includes(validTargetField[0]?.data_type)
						? common.DEFAULT_RULES.VALID_ARRAY_OPERATORS
						: [],
					STRING: common.DEFAULT_RULES.STRING_TYPES.includes(validTargetField[0]?.data_type)
						? common.DEFAULT_RULES.VALID_STRING_OPERATORS
						: [],
					NUMERIC: common.DEFAULT_RULES.NUMERIC_TYPES.includes(validTargetField[0]?.data_type)
						? common.DEFAULT_RULES.VALID_NUMERIC_OPERATORS
						: [],
				}

				const validOperators = Object.values(operatorValidation).flat()
				if (!validOperators.includes(bodyData.operator)) {
					errors.push({
						param: 'operator',
						msg: `Invalid operator for ${validTargetField[0]?.data_type} field type`,
					})
				}
			}
		}

		if (errors.length !== 0) {
			return { isValid: false, errors }
		}

		return { isValid: true }
	}
	/**
	 * Create default rule.
	 * @method
	 * @name create
	 * @param {Object} bodyData - Default rule body data.
	 * @param {String} userId - User ID creating the rule.
	 * @param {String} orgId - Org Id of the user.
	 * @returns {Promise<JSON>} - Created default rule response.
	 */
	static async create(bodyData, userId, orgId, orgCode, tenantCode) {
		bodyData.created_by = userId
		bodyData.updated_by = userId
		bodyData.organization_id = orgId
		bodyData.organization_code = orgCode
		bodyData.tenant_code = tenantCode
		bodyData.target_field = bodyData.target_field.toLowerCase()
		bodyData.requester_field = bodyData.requester_field.toLowerCase()

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
			const validation = await this.validateFields({ [Op.in]: [orgCode, defaults.orgCode] }, bodyData, {
				[Op.in]: [tenantCode, defaults.tenantCode],
			})

			if (!validation.isValid) {
				return responses.failureResponse({
					message: 'VALIDATION_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
					result: validation,
				})
			}

			const defaultRule = await defaultRuleQueries.create(bodyData, tenantCode)

			if (bodyData.type === common.DEFAULT_RULES.MENTOR_TYPE) {
				let userAccounts = await menteeExtensionQueries.getAllUsersByOrgId([orgCode], tenantCode)

				for (const element of userAccounts) {
					let currentUserId = element.user_id
					let roles = [{ title: common.MENTEE_ROLE }]
					if (element.is_mentor) roles.push({ title: common.MENTOR_ROLE })

					// Check connections
					const connectionsData = await connections.getConnectedUsers(
						currentUserId,
						'friend_id',
						'user_id',
						tenantCode
					)
					for (const friendId of connectionsData) {
						const requestedUserExtension = await menteeExtensionQueries.getMenteeExtension(
							friendId,
							[],
							false,
							tenantCode
						)

						if (requestedUserExtension) {
							const validateDefaultRules = await validateDefaultRulesFilter({
								ruleType: common.DEFAULT_RULES.MENTOR_TYPE,
								requesterId: currentUserId,
								roles: roles,
								requesterOrganizationCode: orgCode,
								data: requestedUserExtension,
								tenant_code: tenantCode,
							})

							if (!validateDefaultRules) {
								await connections.deleteConnections(currentUserId, friendId, tenantCode)
								await connections.deleteConnections(friendId, currentUserId, tenantCode)
							}
						}
					}

					// Check connection requests
					const connectionsRequests = await connections.getConnectionRequestsForUser(
						currentUserId,
						tenantCode
					)
					if (connectionsRequests.count > 0) {
						for (const request of connectionsRequests.rows) {
							const friendId = request.friend_id
							const requestedUserExtension = await menteeExtensionQueries.getMenteeExtension(
								friendId,
								[],
								false,
								tenantCode
							)

							if (requestedUserExtension) {
								const validateDefaultRules = await validateDefaultRulesFilter({
									ruleType: common.DEFAULT_RULES.MENTOR_TYPE,
									requesterId: currentUserId,
									roles: roles,
									requesterOrganizationCode: orgCode,
									data: requestedUserExtension,
									tenant_code: tenantCode,
								})

								if (!validateDefaultRules) {
									await connections.deleteConnectionsRequests(currentUserId, friendId, tenantCode)
								}
							}
						}
					}
				}
			}

			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'DEFAULT_RULE_CREATED_SUCCESSFULLY',
				result: defaultRule,
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'DEFAULT_RULE_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Update default rule.
	 * @method
	 * @name update
	 * @param {Object} bodyData - Body data to update.
	 * @param {String} ruleId - Default rule ID.
	 * @param {String} userId - User ID updating the rule.
	 * @param {String} orgId - Org Id of the user.
	 * @returns {Promise<JSON>} - Updated default rule response.
	 */
	static async update(bodyData, ruleId, userId, orgId, orgCode, tenantCode) {
		bodyData.updated_by = userId
		bodyData.organization_id = orgId
		bodyData.organization_code = orgCode
		bodyData.tenant_code = tenantCode
		bodyData.target_field = bodyData.target_field.toLowerCase()
		bodyData.requester_field = bodyData.requester_field.toLowerCase()

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
			const validation = await this.validateFields({ [Op.in]: [orgCode, defaults.orgCode] }, bodyData, {
				[Op.in]: [tenantCode, defaults.tenantCode],
			})

			if (!validation.isValid) {
				return responses.failureResponse({
					message: 'VALIDATION_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
					result: validation.errors,
				})
			}

			const [updateCount, updatedDefaultRule] = await defaultRuleQueries.updateOne(
				{ id: ruleId, organization_code: orgCode, tenant_code: tenantCode },
				bodyData,
				tenantCode,
				{
					returning: true,
					raw: true,
				}
			)

			if (updateCount === 0) {
				return responses.failureResponse({
					message: 'DEFAULT_RULE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'DEFAULT_RULE_UPDATED_SUCCESSFULLY',
				result: updatedDefaultRule,
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'DEFAULT_RULE_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Read all default rules.
	 * @method
	 * @name readAll
	 * @param {String} orgCode - Org Id of the user.
	 * @returns {Promise<JSON>} - Found default rules response.
	 */
	static async readAll(orgCode, tenantCode) {
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
			const defaultRules = await defaultRuleQueries.findAndCountAll({
				organization_code: { [Op.in]: [orgCode, defaults.orgCode] },
				tenant_code: { [Op.in]: [tenantCode, defaults.tenantCode] },
			})

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'DEFAULT_RULES_FETCHED_SUCCESSFULLY',
				result: {
					data: defaultRules.rows,
					count: defaultRules.count,
				},
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Read a single default rule by ID.
	 * @method
	 * @name readOne
	 * @param {String} ruleId - Default rule ID.
	 * @param {String} orgCode - Org Id of the user.
	 * @returns {Promise<JSON>} - Found default rule response.
	 */
	static async readOne(ruleId, orgCode, tenantCode) {
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
			const defaultRule = await defaultRuleQueries.findOne({
				id: ruleId,
				organization_code: { [Op.in]: [orgCode, defaults.orgCode] },
				tenant_code: { [Op.in]: [tenantCode, defaults.tenantCode] },
			})
			if (!defaultRule) {
				return responses.failureResponse({
					message: 'DEFAULT_RULE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'DEFAULT_RULE_FETCHED_SUCCESSFULLY',
				result: defaultRule,
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Delete default rule.
	 * @method
	 * @name delete
	 * @param {String} ruleId - Default rule ID.
	 * @param {String} orgCode - Org Id of the user.
	 * @returns {Promise<JSON>} - Default rule deleted response.
	 */
	static async delete(ruleId, orgCode, tenantCode) {
		try {
			const deleteCount = await defaultRuleQueries.deleteOne(
				{ id: ruleId, organization_code: orgCode, tenant_code: tenantCode },
				tenantCode
			)
			if (deleteCount === 0) {
				return responses.failureResponse({
					message: 'DEFAULT_RULE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'DEFAULT_RULE_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}
}
