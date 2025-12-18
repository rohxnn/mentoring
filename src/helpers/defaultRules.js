'use strict'
const defaultRuleQueries = require('@database/queries/defaultRule')
const mentorQueries = require('@database/queries/mentorExtension')
const menteeQueries = require('@database/queries/userExtension')
const common = require('@constants/common')

const { isAMentor } = require('@generics/utils')
const cacheHelper = require('@generics/cacheHelper')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const { Op } = require('sequelize')

const operatorMapping = new Map([
	['equals', '='],
	['notEquals', '!='],
	['contains', '@>'],
	['containedBy', '<@'],
	['overlap', '&&'],
	['lessThan', '<'],
	['greaterThan', '>'],
	['lessThanOrEqual', '<='],
	['greaterThanOrEqual', '>='],
])
/**
 * Gets the valid configurations based on user roles.
 *
 * @param {Array<Object>} config - The configuration array.
 * @param {Array<Object>} userRoles - The user roles array.
 * @returns {Array<Object>} - The array of valid configurations.
 */
function getValidConfigs(config, userRoles) {
	// Add null/undefined checks for userRoles
	if (!userRoles || !Array.isArray(userRoles)) {
		return []
	}
	const userRoleTitles = userRoles.map((role) => role?.title).filter(Boolean)
	const validConfigs = []

	function hasMatchingRole(requesterRoles) {
		if (requesterRoles.includes('ALL')) {
			return true
		}
		return requesterRoles.some((role) => userRoleTitles.includes(role))
	}

	for (let conf of config) {
		const { requester_roles, requester_roles_config } = conf
		let { exclude } = requester_roles_config

		exclude = exclude.toString() == 'true' ? true : false
		//check exclusion or inclusion based on the flag
		const isValid = exclude ? !hasMatchingRole(requester_roles) : hasMatchingRole(requester_roles)

		if (isValid) {
			validConfigs.push(conf)
		}
	}

	return validConfigs
}

/**
 * Gets the user details based on user roles.
 *
 * @param {string} userId - The ID of the user.
 * @param {Array<string>} userRoles - The roles of the user.
 * @returns {Promise<Object>} - A promise that resolves to the user details.
 * @throws {Error} - Throws an error if the user details cannot be retrieved.
 */
async function getUserDetailsFromView(userId, isAMentor, tenantCode) {
	try {
		if (isAMentor) {
			return await mentorQueries.findOneFromView(userId, tenantCode)
		} else {
			return await menteeQueries.findOneFromView(userId, tenantCode)
		}
	} catch (error) {
		console.log(error)
		throw new Error(`Failed to get user details: ${error.message}`)
	}
}
/**
 * Gets the user details based on user roles.
 *
 * @param {string} userId - The ID of the user.
 * @param {Array<string>} userRoles - The roles of the user.
 * @returns {Promise<Object>} - A promise that resolves to the user details.
 * @throws {Error} - Throws an error if the user details cannot be retrieved.
 */
async function getUserDetails(userId, isAMentor, tenantCode) {
	try {
		if (isAMentor) {
			return await mentorQueries.getMentorExtension(userId, [], false, tenantCode)
		} else {
			return await menteeQueries.getMenteeExtension(userId, [], false, tenantCode)
		}
	} catch (error) {
		console.log(error)
		throw new Error(`Failed to get user details: ${error.message}`)
	}
}

/**
 * Gets the user details based on user roles from cache or db.
 *
 * @param {string} userId - The ID of the user.
 * @param {Array<string>} userRoles - The roles of the user.
 * @returns {Promise<Object>} - A promise that resolves to the user details.
 * @throws {Error} - Throws an error if the user details cannot be retrieved.
 */
async function getUserDetailsFromCache(userId, isAMentor, tenantCode, organisationCodes) {
	try {
		if (isAMentor) {
			return await cacheHelper.mentor.get(tenantCode, organisationCodes, userId)
		} else {
			return await cacheHelper.mentee.get(tenantCode, organisationCodes, userId)
		}
	} catch (error) {
		console.log(error)
		throw new Error(`Failed to get user details: ${error.message}`)
	}
}

exports.defaultRulesFilter = async function defaultRulesFilter({
	ruleType,
	requesterId,
	roles,
	requesterOrganizationCode,
	tenantCode,
}) {
	try {
		const [userDetails, defaultRules] = await Promise.all([
			getUserDetails(requesterId, isAMentor(roles), tenantCode),
			defaultRuleQueries.findAll({ type: ruleType, organization_code: requesterOrganizationCode }, tenantCode),
		])

		const validConfigs = getValidConfigs(defaultRules || [], roles)

		if (validConfigs.length === 0) {
			return ''
		}

		const whereClauses = []
		const mentorWhereClause = []
		let error = false
		validConfigs.forEach((config) => {
			const { is_target_from_sessions_mentor, target_field, operator, requester_field } = config
			const requesterValue = getNestedValue(userDetails, requester_field)

			if (requesterValue === undefined || requesterValue === null) {
				error = {
					error: {
						missingField: true,
						message: `Missing field: ${requester_field}`,
					},
				}
			}

			const keys = target_field.split('.')
			const jsonPath = keys
				.map((key, index) => {
					if (index === 0) {
						return key // First key does not have quotes
					} else if (index === keys.length - 1) {
						return `->>'${key}'` // Last key gets '>>' to retrieve text
					} else {
						return `->'${key}'` // Other keys get '->' to access nested JSON object
					}
				})
				.join('')

			const sqlOperator = operatorMapping.get(operator)
			if (!sqlOperator) {
				throw new Error(`Unsupported operator: ${operator}`)
			}

			if (is_target_from_sessions_mentor) {
				if (Array.isArray(requesterValue)) {
					const formattedValues = requesterValue.map((value) =>
						typeof value === 'string' ? `'${value}'` : value
					)
					mentorWhereClause.push(
						`(${jsonPath} ${sqlOperator} ARRAY[${formattedValues.join(', ')}]::character varying[])`
					)
				} else {
					mentorWhereClause.push(`${jsonPath} ${sqlOperator} '${requesterValue}'`)
				}
			} else {
				if (Array.isArray(requesterValue)) {
					const formattedValues = requesterValue.map((value) =>
						typeof value === 'string' ? `'${value}'` : value
					)
					whereClauses.push(
						`(${jsonPath} ${sqlOperator} ARRAY[${formattedValues.join(', ')}]::character varying[])`
					)
				} else {
					whereClauses.push(`${jsonPath} ${sqlOperator} '${requesterValue}'`)
				}
			}
		})
		if (error) {
			console.error('Error:', error.message)
			throw error
		}

		if (mentorWhereClause.length > 0) {
			const filterClause = mentorWhereClause.join(' AND ')

			whereClauses.push(
				`mentor_id IN (SELECT user_id FROM ${
					common.materializedViewsPrefix + (await mentorQueries.getTableName())
				} WHERE ${filterClause})`
			)
		}

		return whereClauses.join(' AND ')
	} catch (error) {
		console.error('Error:', error.message)
		throw error // Re-throw the error after logging it
	}
}

exports.validateDefaultRulesFilter = async function validateDefaultRulesFilter({
	ruleType,
	requesterId,
	roles,
	requesterOrganizationCode,
	data,
	tenant_code,
}) {
	try {
		const defaults = await getDefaults()
		let orgCodes = { [Op.in]: [requesterOrganizationCode, defaults.orgCode] }
		let tenantCodes = { [Op.in]: [tenant_code, defaults.tenantCode] }
		const [userDetails, defaultRules] = await Promise.all([
			getUserDetailsFromCache(requesterId, isAMentor(roles), tenant_code, requesterOrganizationCode),
			defaultRuleQueries.findAll({ type: ruleType, organization_code: orgCodes }, tenantCodes),
		])

		const validConfigs = getValidConfigs(defaultRules || [], roles)

		if (validConfigs.length === 0) {
			return true //no rules to check, data is valid by default
		}

		const mentorChecks = []

		for (const config of validConfigs) {
			const { is_target_from_sessions_mentor, target_field, operator, requester_field } = config

			const requesterValue =
				getNestedValue(userDetails, requester_field) ||
				(userDetails.meta && getNestedValue(userDetails.meta, requester_field))

			if (requesterValue === undefined || requesterValue === null) {
				return {
					error: {
						missingField: true,
						message: `Missing field: ${requester_field}`,
					},
				}
			}

			if (is_target_from_sessions_mentor) {
				mentorChecks.push({ target_field, operator, requesterValue })
			} else {
				const targetFieldValue =
					getNestedValue(data, target_field) || (data.meta && getNestedValue(data.meta, target_field))

				if (targetFieldValue === undefined || targetFieldValue === null) {
					return false
				}
				if (!evaluateCondition(targetFieldValue, operator, requesterValue)) {
					return false //data does not meet the condition
				}
			}
		}

		if (mentorChecks.length > 0 && data.mentor_id) {
			const mentorDetails = await getUserDetails(data.mentor_id, true, tenantCode)

			for (const { target_field, operator, requesterValue } of mentorChecks) {
				const targetFieldValue =
					getNestedValue(mentorDetails, target_field) || getNestedValue(mentorDetails.meta, target_field)
				if (targetFieldValue === undefined || targetFieldValue === null) {
					return false
				}
				if (!evaluateCondition(targetFieldValue, operator, requesterValue)) {
					return false //mentor details do not meet the condition
				}
			}
		}

		return true // Data meets all conditions
	} catch (error) {
		console.error('Error:', error.message)
		throw error // Re-throw the error after logging it
	}
}

function evaluateCondition(targetValue, operator, requesterValue) {
	const symbol = operatorMapping.get(operator)
	if (!symbol) {
		throw new Error(`Unsupported operator: ${operator}`)
	}
	if (Array.isArray(requesterValue)) {
		switch (symbol) {
			case '@>':
				// Check if targetValue contains all elements of requesterValue
				return requesterValue.every((value) => targetValue.includes(value))
			case '&&':
				// Check if targetValue and requesterValue have any elements in common
				return requesterValue.some((value) => targetValue.includes(value))
			case '<@':
				// Check if requesterValue is contained by targetValue
				return targetValue.every((value) => requesterValue.includes(value))
			default:
				throw new Error(`Unsupported array operator: ${operator}`)
		}
	} else {
		switch (symbol) {
			case '=':
				return targetValue === requesterValue
			case '!=':
				return targetValue !== requesterValue
			case '<':
				return targetValue < requesterValue
			case '>':
				return targetValue > requesterValue
			case '<=':
				return targetValue <= requesterValue
			case '>=':
				return targetValue >= requesterValue
			default:
				throw new Error(`Unsupported operator: ${operator}`)
		}
	}
}

function getNestedValue(obj, fieldPath) {
	const fields = fieldPath.split('.')
	let value = obj
	for (const field of fields) {
		if (value && value[field] !== undefined) {
			value = value[field]
		} else if (value && value.meta && value.meta[field] !== undefined) {
			value = value.meta[field]
		} else {
			return undefined
		}
	}
	return value
}
