/**
 * name : utils.js
 * author : Aman
 * created-date : 04-Nov-2021
 * Description : Utils helper function.
 */

const bcryptJs = require('bcryptjs')
const { cloudClient } = require('@configs/cloud-service')
const momentTimeZone = require('moment-timezone')
const moment = require('moment')
const path = require('path')
const md5 = require('md5')
const fs = require('fs')
const startCase = require('lodash/startCase')
const common = require('@constants/common')
const crypto = require('crypto')
const _ = require('lodash')

const hash = (str) => {
	const salt = bcryptJs.genSaltSync(10)
	let hashstr = bcryptJs.hashSync(str, salt)
	return hashstr
}

const elapsedMinutes = (date1, date2) => {
	var difference = date1 - date2
	let result = difference / 60000
	return result
}

const getIstDate = () => {
	return new Date(new Date().getTime() + (5 * 60 + 30) * 60000)
}

const getCurrentMonthRange = () => {
	const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	let month = new Date().getMonth()
	const year = new Date().getFullYear()
	let dayInMonth = monthDays[month]
	if (month === 1 && year % 4 === 0) {
		// Feb for leap year
		dayInMonth = 29
	}
	month += 1
	month = month < 10 ? '0' + month : month
	return [new Date(`${year}-${month}-01`), new Date(`${year}-${month}-${dayInMonth}`)]
}

const getCurrentWeekRange = () => {
	const currentDate = new Date().getTime() // in ms
	const currentDay = new Date().getDay() * 24 * 60 * 60 * 1000 // in ms
	const firstDay = currentDate - currentDay
	const lastDay = firstDay + 6 * 24 * 60 * 60 * 1000
	return [new Date(firstDay), new Date(lastDay)]
}

const getCurrentQuarterRange = () => {
	const today = new Date()
	const quarter = Math.floor(today.getMonth() / 3)
	const startFullQuarter = new Date(today.getFullYear(), quarter * 3, 1)
	const endFullQuarter = new Date(startFullQuarter.getFullYear(), startFullQuarter.getMonth() + 3, 0)
	return [startFullQuarter, endFullQuarter]
}

const composeEmailBody = (body, params) => {
	return body.replace(/{([^{}]*)}/g, (a, b) => {
		var r = params[b]
		return typeof r === 'string' || typeof r === 'number' ? r : a
	})
}

const extractEmailTemplate = (input, conditions) => {
	const allConditionsRegex = /{{(.*?)}}(.*?){{\/\1}}/g
	let result = input

	for (const match of input.matchAll(allConditionsRegex)) {
		result = conditions.includes(match[1]) ? result.replace(match[0], match[2]) : result.replace(match[0], '')
	}

	return result
}

const getDownloadableUrl = async (filePath) => {
	let bucketName = process.env.CLOUD_STORAGE_BUCKETNAME
	let expiryInSeconds = parseInt(process.env.DOWNLOAD_URL_EXPIRATION_DURATION) || 300
	let updatedExpiryTime = convertExpiryTimeToSeconds(expiryInSeconds)
	let response = await cloudClient.getSignedUrl(bucketName, filePath, updatedExpiryTime, common.READ_ACCESS)
	return Array.isArray(response) ? response[0] : response
}

const getPublicDownloadableUrl = async (bucketName, filePath) => {
	let downloadableUrl = await cloudClient.getDownloadableUrl(bucketName, filePath)
	return downloadableUrl
}

const getTimeZone = (date, format, tz = null) => {
	let timeZone = typeof date === 'number' || !isNaN(date) ? moment.unix(date) : moment(date)

	if (tz) {
		timeZone.tz(tz)
	}
	timeZone = moment(timeZone).format(format)
	return timeZone
}

const utcFormat = () => {
	return momentTimeZone().utc().format('YYYY-MM-DDTHH:mm:ss')
}

/**
 * md5 hash
 * @function
 * @name md5Hash
 * @returns {String} returns uuid.
 */

function md5Hash(value) {
	return md5(value)
}

const capitalize = (str) => {
	return startCase(str)
}
const isAMentor = (roles) => {
	return roles && Array.isArray(roles) ? roles.some((role) => role.title == common.MENTOR_ROLE) : false
}
function isNumeric(value) {
	return /^\d+$/.test(value)
}

function validateInput(input, validationData, modelName, skipValidation = false) {
	const errors = []

	function addError(param, value, dataType, message) {
		errors.push({
			param,
			msg: `${value} is invalid for data type ${dataType}. ${message}`,
		})
	}

	for (const field of validationData) {
		const fieldValue = input[field.value]

		if (!skipValidation && field.required && !(field.value in input)) {
			errors.push({
				param: field.value,
				msg: `${field.value} is required but missing in the input data.`,
			})
			continue
		}

		if (modelName && !field.model_names.includes(modelName) && fieldValue) {
			errors.push({
				param: field.value,
				msg: `${field.value} is not allowed for the ${modelName} model.`,
			})
			continue
		}

		if (fieldValue !== undefined) {
			switch (field.data_type) {
				case 'ARRAY[STRING]':
					if (!Array.isArray(fieldValue)) {
						addError(field.value, field.value, 'ARRAY[STRING]', 'It should be an array.')
						break
					}
					for (const element of fieldValue) {
						if (typeof element !== 'string')
							addError(field.value, element, 'STRING', 'It should be a string.')
						else if (field.allow_custom_entities) validateCustomEntity(element, field)
					}
					break

				case 'STRING':
					if (typeof fieldValue !== 'string')
						addError(field.value, fieldValue, 'STRING', 'It should be a string.')
					else if (field.allow_custom_entities) validateCustomEntity(fieldValue, field)
					break

				case 'INTEGER':
				case 'NUMBER':
					if (typeof fieldValue !== 'number')
						addError(field.value, fieldValue, field.data_type, 'It should be a number.')
					break
			}
		}

		if (fieldValue && !field.allow_custom_entities && field.has_entities !== false)
			input[field.value] = validateEntities(fieldValue, field)
	}

	return errors.length === 0 ? { success: true, message: 'Validation successful' } : { success: false, errors }

	function validateCustomEntity(value, field) {
		if (field.regex && !new RegExp(field.regex).test(value))
			addError(field.value, value, 'STRING', `Does not match the required pattern: ${field.regex}`)
		else if (!field.regex && /[^A-Za-z0-9\s_]/.test(value))
			addError(field.value, value, 'STRING', 'It should not contain special characters except underscore.')
	}

	function validateEntities(value, field) {
		let values = Array.isArray(value) ? value : [value]
		values = values.filter((val) => field.entities.some((entity) => entity.value === val))
		return Array.isArray(value) ? values : values[0]
	}
}

const entityTypeMapGenerator = (entityTypeData) => {
	try {
		const entityTypeMap = new Map()
		entityTypeData.forEach((entityType) => {
			const labelsMap = new Map()
			const entities = entityType.entities.map((entity) => {
				labelsMap.set(entity.value, entity.label)
				return entity.value
			})
			if (!entityTypeMap.has(entityType.value)) {
				const entityMap = new Map()
				entityMap.set('allow_custom_entities', entityType.allow_custom_entities)
				entityMap.set('entities', new Set(entities))
				entityMap.set('labels', labelsMap)
				entityTypeMap.set(entityType.value, entityMap)
			}
		})
		return entityTypeMap
	} catch (err) {
		console.log(err)
	}
}

function restructureBody(requestBody, entityData, allowedKeys) {
	try {
		const entityTypeMap = entityTypeMapGenerator(entityData)
		const doesAffectedFieldsExist = Object.keys(requestBody).some((element) => entityTypeMap.has(element))
		// if request body doesn't have field to restructure break the operation return requestBody
		if (!doesAffectedFieldsExist) return requestBody
		// add object custom_entity_text to request body
		requestBody.custom_entity_text = {}
		// If request body does not contain meta add meta object
		if (!requestBody.meta) requestBody.meta = {}
		// Iterate through each key in request body
		for (const currentFieldName in requestBody) {
			// store correct key's value
			const [currentFieldValue, isFieldValueAnArray] = Array.isArray(requestBody[currentFieldName])
				? [[...requestBody[currentFieldName]], true] //If the requestBody[currentFieldName] is array, make a copy in currentFieldValue than a reference
				: [requestBody[currentFieldName], false]
			// Get entity type mapped to current data
			const entityType = entityTypeMap.get(currentFieldName)
			// Check if the current data have any entity type associated with and if allow_custom_entities= true enter to if case
			if (entityType && entityType.get('allow_custom_entities')) {
				// If current field value is of type Array enter to this if condition
				if (isFieldValueAnArray) {
					requestBody[currentFieldName] = [] //Set the original field value as empty array so that it can be re-populated again
					const recognizedEntities = []
					const customEntities = []
					// Iterate though correct fields value of type Array
					for (const value of currentFieldValue) {
						// If entity has entities which matches value push the data into recognizedEntities array
						// Else push to customEntities as { value: 'other', label: value }
						if (entityType.get('entities').has(value)) recognizedEntities.push(value)
						else customEntities.push({ value: 'other', label: value })
					}
					// If we have data in recognizedEntities
					if (recognizedEntities.length > 0)
						if (allowedKeys.includes(currentFieldName))
							// If the current field have a concrete column in db assign recognizedEntities to requestBody[currentFieldName]
							// Else add that into meta
							requestBody[currentFieldName] = recognizedEntities
						else requestBody.meta[currentFieldName] = recognizedEntities
					if (customEntities.length > 0) {
						requestBody[currentFieldName].push('other') //This should cause error at DB write
						requestBody.custom_entity_text[currentFieldName] = customEntities
					}
					if (
						recognizedEntities.length === 0 &&
						customEntities.length === 0 &&
						!allowedKeys.includes(currentFieldName)
					) {
						requestBody.meta[currentFieldName] = []
					}
				} else {
					if (!entityType.get('entities').has(currentFieldValue)) {
						requestBody.custom_entity_text[currentFieldName] = {
							value: 'other',
							label: currentFieldValue,
						}
						if (allowedKeys.includes(currentFieldName))
							requestBody[currentFieldName] = 'other' //This should cause error at DB write
						else requestBody.meta[currentFieldName] = 'other'
					} else if (!allowedKeys.includes(currentFieldName))
						requestBody.meta[currentFieldName] = currentFieldValue
				}
			}

			if (entityType && !entityType.get('allow_custom_entities') && !entityType.get('has_entities')) {
				// check allow = false has entiy false
				if (!allowedKeys.includes(currentFieldName))
					requestBody.meta[currentFieldName] = requestBody[currentFieldName]
			}
		}
		if (Object.keys(requestBody.meta).length === 0) requestBody.meta = null
		if (Object.keys(requestBody.custom_entity_text).length === 0) requestBody.custom_entity_text = null
		return requestBody
	} catch (error) {
		console.log(error)
	}
}

function processDbResponse(responseBody, entityType) {
	// Check if the response body has a "meta" property
	if (responseBody.meta) {
		entityType.forEach((entity) => {
			const entityTypeValue = entity.value
			if (responseBody?.meta?.hasOwnProperty(entityTypeValue)) {
				// Move the key from responseBody.meta to responseBody root level
				responseBody[entityTypeValue] = responseBody.meta[entityTypeValue]
				// Delete the key from responseBody.meta
				delete responseBody.meta[entityTypeValue]
			}
		})
	}

	const output = { ...responseBody } // Create a copy of the responseBody object
	// Iterate through each key in the output object
	for (const key in output) {
		// Check if the key corresponds to an entity type and is not null
		if (entityType.some((entity) => entity.value === key) && output[key] !== null) {
			// Find the matching entity type for the current key
			const matchingEntity = entityType.find((entity) => entity.value === key)

			// Filter and map the matching entity values
			const matchingValues = matchingEntity.entities
				.filter((entity) => (Array.isArray(output[key]) ? output[key].includes(entity.value) : true))
				.map((entity) => ({
					value: entity.value,
					label: entity.label,
				}))

			// Check if there are matching values
			if (matchingValues.length > 0) {
				const newValue = Array.isArray(output[key])
					? matchingValues
					: matchingValues.find((entity) => entity.value === output[key])
				output[key] = newValue
			} else if (Array.isArray(output[key])) {
				const filteredValue = output[key].filter((item) => item.value && item.label)
				output[key] = filteredValue
			}
		}

		if (output.meta && output.meta[key] && entityType.some((entity) => entity.value === output.meta[key].value)) {
			const matchingEntity = entityType.find((entity) => entity.value === output.meta[key].value)
			output.meta[key] = {
				value: matchingEntity.value,
				label: matchingEntity.label,
			}
		}
	}

	const data = output

	// Merge "custom_entity_text" into the respective arrays
	for (const key in data.custom_entity_text) {
		if (Array.isArray(data[key])) data[key] = [...data[key], ...data.custom_entity_text[key]]
		else data[key] = data.custom_entity_text[key]
	}
	delete data.custom_entity_text

	// Check if the response body has a "meta" property
	if (data.meta && Object.keys(data.meta).length > 0) {
		// Merge properties of data.meta into the top level of data
		Object.assign(data, data.meta)
		// Remove the "meta" property from the output
		delete output.meta
	}

	return data
}

function removeParentEntityTypes(data) {
	const parentIds = data.filter((item) => item.parent_id !== null).map((item) => item.parent_id)
	return data.filter((item) => !parentIds.includes(item.id))
}
const epochFormat = (date, format) => {
	return moment.unix(date).utc().format(format)
}
function processQueryParametersWithExclusions(query) {
	const queryArrays = {}
	const excludedKeys = common.excludedQueryParams
	for (const queryParam in query) {
		if (query.hasOwnProperty(queryParam) && !excludedKeys.includes(queryParam)) {
			queryArrays[queryParam] = query[queryParam].split(',').map((item) => item.trim())
		}
	}

	return queryArrays
}

/**
 * Calculate the time difference in milliseconds between a current date
 * and a modified date obtained by subtracting a specified time value and unit from startDate.
 *
 * @param {string} startDate - The start date.
 * @param {number} timeValue - The amount of time to subtract.
 * @param {string} timeUnit - The unit of time to subtract (e.g., 'hours', 'days').
 * @returns {number} The time difference in milliseconds.
 */
function getTimeDifferenceInMilliseconds(startDate, timeValue, timeUnit) {
	// Get current date
	const currentUnixTimestamp = moment().unix()

	// Subtract the specified time value and unit
	const modifiedDate = moment.unix(startDate).subtract(timeValue, timeUnit).unix()

	// Calculate the duration and get the time difference in milliseconds
	const duration = moment.duration(moment.unix(modifiedDate).diff(moment.unix(currentUnixTimestamp)))

	return duration.asMilliseconds()
}

function deleteProperties(obj, propertiesToDelete) {
	try {
		return Object.keys(obj).reduce((result, key) => {
			if (!propertiesToDelete.includes(key)) {
				result[key] = obj[key]
			}
			return result
		}, {})
	} catch (error) {
		return obj
	}
}
/**
 * Generate security checksum.
 * @method
 * @name generateCheckSum
 * @param {String} queryHash - Query hash.
 * @returns {Number} - checksum key.
 */

function generateCheckSum(queryHash) {
	var shasum = crypto.createHash('sha1')
	shasum.update(queryHash)
	const checksum = shasum.digest('hex')
	return checksum
}
/**
 * validateRoleAccess.
 * @method
 * @name validateRoleAccess
 * @param {Array} roles - roles array.
 * @param {String} requiredRole - role to check.
 * @returns {Number} - checksum key.
 */

const validateRoleAccess = (roles, requiredRoles) => {
	if (!roles || roles.length === 0) return false

	if (!Array.isArray(requiredRoles)) {
		requiredRoles = [requiredRoles]
	}

	// Check the type of the first element.
	const firstElementType = typeof roles[0]
	if (firstElementType === 'object') {
		return roles.some((role) => requiredRoles.includes(role.title))
	} else {
		return roles.some((role) => requiredRoles.includes(role))
	}
}

const removeDefaultOrgEntityTypes = (entityTypes, orgCode) => {
	const entityTypeMap = new Map()
	entityTypes.forEach((entityType) => {
		if (!entityTypeMap.has(entityType.value)) {
			entityTypeMap.set(entityType.value, entityType)
		} else if (entityType.organization_code === orgCode) {
			entityTypeMap.set(entityType.value, entityType)
		}
	})

	const result = Array.from(entityTypeMap.values())
	return result
}

const generateWhereClause = (tableName) => {
	let whereClause = ''

	switch (tableName) {
		case 'sessions':
			const currentEpochDate = Math.floor(new Date().getTime() / 1000) // Get current date in epoch format
			whereClause = `deleted_at IS NULL AND start_date >= ${currentEpochDate}`
			break
		case 'mentor_extensions':
			whereClause = `deleted_at IS NULL`
			break
		case 'user_extensions':
			whereClause = `deleted_at IS NULL`
			break
		default:
			whereClause = 'deleted_at IS NULL'
	}

	return whereClause
}

/**
 * Validates the input against validation data and builds a SQL query filter.
 *
 * @param {Object} input - The input object containing filters.
 * @param {Array} validationData - Array of objects containing entity type and data type information.
 * @returns {Object} An object containing the SQL query string and replacements for Sequelize.
 */
function validateAndBuildFilters(input, validationData) {
	const entityTypes = {}

	// Ensure validationData is an array
	if (!Array.isArray(validationData)) {
		throw new Error('Validation data must be an array')
	}

	// Build the entityTypes dictionary
	validationData.forEach((entityType) => {
		entityTypes[entityType.value] = entityType.data_type
	})

	const queryParts = [] // Array to store parts of the query
	const replacements = {} // Object to store replacements for Sequelize

	// Function to handle string types
	function handleStringType(key, values) {
		const orConditions = values
			.map((value, index) => {
				replacements[`${key}_${index}`] = value
				return `${key} = :${key}_${index}`
			})
			.join(' OR ')
		queryParts.push(`(${orConditions})`)
	}

	// Function to handle array types
	function handleArrayType(key, values) {
		const arrayValues = values
			.map((value, index) => {
				replacements[`${key}_${index}`] = value
				return `:${key}_${index}`
			})
			.join(', ')
		queryParts.push(`"${key}" @> ARRAY[${arrayValues}]::character varying[]`)
	}

	// Iterate over each key in the input object
	for (const key in input) {
		if (input.hasOwnProperty(key)) {
			const dataType = entityTypes[key]

			if (dataType) {
				if (common.ENTITY_TYPE_DATA_TYPES.STRING_TYPES.includes(dataType)) {
					handleStringType(key, input[key])
				} else if (common.ENTITY_TYPE_DATA_TYPES.ARRAY_TYPES.includes(dataType)) {
					handleArrayType(key, input[key])
				}
			} else {
				// Remove keys that are not in the validationData
				delete input[key]
			}
		}
	}

	// Join all query parts with AND
	const query = queryParts.join(' AND ')

	return { query, replacements }
}

function validateFilters(input, validationData, modelName) {
	const entityTypes = []
	validationData.forEach((entityType) => {
		// Extract the 'value' property from the main object
		entityTypes.push(entityType.value)

		// Extract the 'value' property from the 'entities' array
	})

	for (const key in input) {
		if (input.hasOwnProperty(key)) {
			if (entityTypes.includes(key)) {
				continue
			} else {
				delete input[key]
			}
		}
	}
	return input
}

function extractFilename(fileString) {
	const match = fileString.match(/([^/]+)(?=\.\w+$)/)
	return match ? match[0] : null
}

const generateRedisConfigForQueue = () => {
	const parseURL = new URL(process.env.REDIS_HOST)
	return {
		connection: {
			host: parseURL.hostname,
			port: parseURL.port,
		},
	}
}

const generateFileName = (name, extension) => {
	const currentDate = new Date()
	const fileExtensionWithTime = moment(currentDate).tz('Asia/Kolkata').format('YYYY_MM_DD_HH_mm') + extension
	return name + fileExtensionWithTime
}

function generateCSVContent(data) {
	if (data.length === 0) {
		return 'No Data Found'
	}

	const headers = Object.keys(data[0])

	const csvRows = data.map((row) => {
		return headers
			.map((fieldName) => {
				const value = row[fieldName]
				if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
					// Stringify object values and enclose them in double quotes
					return '"' + JSON.stringify(value) + '"'
				} else if (Array.isArray(value)) {
					// Join array values with comma and space, and enclose them in double quotes
					return '"' + value.join(', ') + '"'
				} else {
					return JSON.stringify(value)
				}
			})
			.join(',')
	})
	return [headers.join(','), ...csvRows].join('\n')
}

const clearFile = (filePath) => {
	fs.unlink(filePath, (err) => {
		if (err) console.error(err)
	})
}
function convertKeysToSnakeCase(obj) {
	if (Array.isArray(obj)) {
		return obj.map(convertKeysToSnakeCase)
	} else if (typeof obj === 'object' && obj !== null) {
		return Object.fromEntries(
			Object.entries(obj).map(([key, value]) => [_.snakeCase(key), convertKeysToSnakeCase(value)])
		)
	}
	return obj
}

function isValidEmail(email) {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	return emailRegex.test(email)
}

function transformCustomFields(customFields) {
	const customEntities = {}

	for (const [key, value] of Object.entries(customFields)) {
		customEntities[key] = value
			? value
					.replace(/"/g, '')
					.split(',')
					.map((item) => item.trim())
			: []
	}

	return customEntities
}

function validateProfileData(profileData, validationData) {
	const profileMandatoryFields = []
	for (const field of validationData) {
		if (profileData.hasOwnProperty(field.value)) {
			if (field.required === true && profileData[field.value] === null) {
				profileMandatoryFields.push(field.value)
			}
		} else {
			if (field.required === true) {
				profileMandatoryFields.push(field.value)
			}
		}
	}
	return profileMandatoryFields
}

function convertExpiryTimeToSeconds(expiryTime) {
	expiryTime = String(expiryTime)
	const match = expiryTime.match(/^(\d+)([m]?)$/)
	if (match) {
		const value = parseInt(match[1], 10) // Numeric value
		const unit = match[2]
		if (unit === 'm') {
			return Math.floor(value / 60)
		} else {
			return value
		}
	}
}

function convertEntitiesForFilter(entityTypes) {
	const result = {}

	entityTypes.forEach((entityType) => {
		const key = entityType.value

		if (!result[key]) {
			result[key] = []
		}

		if (entityType.allow_custom_entities) {
			entityType.entities.push({
				value: 'other',
				label: 'other',
			})
		}

		const newObj = {
			id: entityType.id,
			label: entityType.label,
			value: entityType.value,
			parent_id: entityType.parent_id,
			organization_id: entityType.organization_id,
			entities: entityType.entities || [],
		}

		result[key].push(newObj)
	})
	return result
}

function filterEntitiesBasedOnParent(data, defaultOrgCode, doNotRemoveDefaultOrg) {
	let result = {}

	for (let key in data) {
		let countWithParentId = 0
		let countOfEachKey = data[key].length
		data[key].forEach((obj) => {
			if (obj.parent_id !== null && obj.organization_code != defaultOrgCode) {
				countWithParentId++
			}
		})

		let outputArray = data[key]
		if (countOfEachKey > 1 && countWithParentId == countOfEachKey - 1 && !doNotRemoveDefaultOrg) {
			outputArray = data[key].filter(
				(obj) => !(obj.organization_code === defaultOrgCode && obj.parent_id === null)
			)
		}

		result[key] = outputArray
	}
	return result
}

function convertToTitleCase(str) {
	return str.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

function removeLimitAndOffset(sql) {
	return sql.replace(/\s*LIMIT\s+\S+\s+OFFSET\s+\S+/, '')
}

const generateFilters = (data, entityTypeKeys, defaultValueKeys, columnConfigs) => {
	const filters = {}

	const entityTypeKeySet = entityTypeKeys
		? new Set(entityTypeKeys.split(',')) // Convert entityTypeKeys to a Set if provided
		: null // Set to null if not provided

	const defaultValueKeySet = defaultValueKeys
		? new Set(defaultValueKeys.split(',')) // Convert defaultValueKeys to a Set if provided
		: null // Set to null if not provided

	// Loop through keys in the first item of data
	for (const key in data[0]) {
		if (!entityTypeKeySet || !entityTypeKeySet.has(key)) {
			if (defaultValueKeySet && defaultValueKeySet.has(key)) {
				const columnConfig = columnConfigs.find((col) => col.key === key)
				if (columnConfig && columnConfig.defaultValues) {
					filters[key] = columnConfig.defaultValues.map(({ value, label }) => ({
						value: value, // Use the value directly from the defaultValues object
						label: ['<=', '>='].includes(columnConfig.filterType)
							? `${columnConfig.filterType} ${label}` // Add filterType to label if it's '<=' or '>='
							: label, // Otherwise, just use the label
					}))
				} else {
					// If no defaultValues found, use unique values from data
					const uniqueValues = [...new Set(data.map((item) => item[key]))]
					filters[key] = uniqueValues.map((value) => ({
						value: value,
						label: value,
					}))
				}
			} else {
				// If not in defaultValueKeys, use unique values from data
				const uniqueValues = [...new Set(data.map((item) => item[key]))]
				filters[key] = uniqueValues.map((value) => ({
					value: value,
					label: value,
				}))
			}
		}
	}

	return filters
}

Date.prototype.getWeek = function () {
	var target = new Date(this.valueOf())
	var dayNr = (this.getDay() + 6) % 7
	target.setDate(target.getDate() - dayNr + 3)
	var firstThursday = target.valueOf()
	target.setMonth(0, 1)
	if (target.getDay() != 4) {
		target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7))
	}
	return 1 + Math.ceil((firstThursday - target) / 604800000)
}

Date.prototype.getWeek = function () {
	var target = new Date(this.valueOf())
	var dayNr = (this.getDay() + 6) % 7
	target.setDate(target.getDate() - dayNr + 3)
	var firstThursday = target.valueOf()
	target.setMonth(0, 1)
	if (target.getDay() != 4) {
		target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7))
	}
	return 1 + Math.ceil((firstThursday - target) / 604800000)
}

const generateDateRanges = (startEpoch, endEpoch, interval, timeZone = 'UTC') => {
	const startMoment = moment.unix(startEpoch).tz(timeZone)
	const endMoment = moment.unix(endEpoch).tz(timeZone)

	const dateRanges = []
	let current = startMoment.clone()

	while (current.isSameOrBefore(endMoment)) {
		let next, rangeStart, rangeEnd

		switch (interval) {
			case 'day':
				rangeStart = current.clone().startOf('day')
				rangeEnd = current.clone().endOf('day')

				if (rangeEnd.isAfter(endMoment)) {
					rangeEnd = endMoment.clone()
				}

				dateRanges.push({
					start_date: rangeStart.unix(),
					end_date: rangeEnd.unix(),
				})

				current = current.clone().add(1, 'day')
				break

			case 'week':
				rangeStart = current.clone().startOf('week') // Sunday by default
				rangeEnd = current.clone().endOf('week')

				if (rangeEnd.isAfter(endMoment)) {
					rangeEnd = endMoment.clone()
				}

				dateRanges.push({
					start_date: rangeStart.unix(),
					end_date: rangeEnd.unix(),
				})

				current = current.clone().add(1, 'week')
				break

			case 'month':
				rangeStart = current.clone().startOf('month')
				rangeEnd = current.clone().endOf('month')

				if (rangeEnd.isAfter(endMoment)) {
					rangeEnd = endMoment.clone()
				}

				dateRanges.push({
					start_date: rangeStart.unix(),
					end_date: rangeEnd.unix(),
				})

				current = current.clone().add(1, 'month')
				break

			default:
				throw new Error('Invalid interval. Valid options: "day", "week", "month"')
		}
	}

	return dateRanges
}

const mapEntityTypesToData = (data, entityTypes) => {
	return data.map((item) => {
		const newItem = { ...item }
		entityTypes.forEach((entityType) => {
			const key = entityType.value
			if (newItem[key]) {
				const values = newItem[key].split(',').map((val) => val.trim())
				const mappedValues = values
					.map((value) => {
						const entity = entityType.entities.find((e) => e.value === value)
						return entity ? entity.label : value
					})
					.join(', ')

				newItem[key] = mappedValues
			}
		})
		return newItem
	})
}

function extractColumnMappings(sqlQuery) {
	let selectPart = ''

	// Match SELECT after WITH clause (handling multiple subqueries)
	const withMatch = sqlQuery.match(/\)\s*SELECT\s+([\s\S]+?)\s+FROM\s+\w+/i)

	// Match SELECT from subquery (e.g., FROM (SELECT * FROM table) AS alias)
	const subqueryMatch = sqlQuery.match(/SELECT\s+([\s\S]+?)\s+FROM\s+\(\s*SELECT/i)

	// Match normal SELECT without subquery
	const regularSelectMatch = sqlQuery.match(/SELECT\s+([\s\S]+?)\s+FROM\s+\w+/i)

	if (withMatch) {
		selectPart = withMatch[1].trim()
	} else if (subqueryMatch) {
		selectPart = subqueryMatch[1].trim()
	} else if (regularSelectMatch) {
		selectPart = regularSelectMatch[1].trim()
	} else {
		return {} // No match found
	}

	return processSelectPart(selectPart)
}

function processSelectPart(selectPart) {
	// Split columns by commas, ignoring commas inside functions (parentheses)
	const columns = selectPart.split(/,(?![^\(\)]*\))/).map((col) => col.trim())

	const columnMappings = {}

	columns.forEach((column) => {
		// Match alias expressions like `COUNT(*) AS number_of_sessions`
		const aliasMatch = column.match(/(.*?)\s+AS\s+"?(.*?)"?$/i)

		if (aliasMatch) {
			const original = aliasMatch[1].trim()
			const alias = aliasMatch[2].trim()

			// Preserve complex SQL expressions in the correct format
			columnMappings[alias] = original.replace(/\s+/g, ' ').trim()
		} else {
			// Handle case where there is no alias
			let cleanColumn = column.trim()
			cleanColumn = cleanColumn.replace(/^subquery\."(.*?)"$/, '$1')

			columnMappings[cleanColumn] = column.trim()
		}
	})

	return columnMappings
}

function applyDefaultFilters(filters, columnConfigs) {
	columnConfigs.forEach((column) => {
		if (
			column.key in filters && // Check if the key exists in the filters object
			column.defaultValues && // Ensure there are default values
			Array.isArray(column.defaultValues) // Ensure defaultValues is an array
		) {
			const currentFilterValues = filters[column.key]
			if (Array.isArray(currentFilterValues) && currentFilterValues.includes('ALL')) {
				// Exclude "ALL" and include the rest of the default values
				filters[column.key] = column.defaultValues.filter((value) => value !== 'ALL')
			}
		}
	})
	return filters
}

function getDynamicFilterCondition(filters, columnMappings, baseQuery, columnConfig) {
	if (!filters || typeof filters !== 'object') {
		return baseQuery // Return the base query unchanged
	}

	const conditions = Object.entries(filters)
		.map(([column, value]) => {
			let mappedColumn = columnMappings[column]
			if (!mappedColumn) {
				return null // Skip if no mapping is found for the column
			}

			const columnConfigEntry = columnConfig.find((config) => config.key === column)
			const filterType = columnConfigEntry ? columnConfigEntry.filterType || '=' : '=' // Default to '=' if not found

			// Handle time filtering dynamically
			if (column === 'hours_of_mentoring_sessions') {
				if (typeof value === 'string' && value.includes(':')) {
					// Convert HH:MM:SS to total seconds
					const [hh, mm, ss] = value.split(':').map(Number)
					const totalSeconds = hh * 3600 + mm * 60 + (ss || 0)
					return `total_mentoring_seconds ${filterType} ${totalSeconds}`
				} else if (typeof value === 'number') {
					// If value is already in seconds, use it directly
					return `total_mentoring_seconds ${filterType} ${value}`
				}

				return null
			}

			if (value) {
				if (Array.isArray(value)) {
					if (
						Array.isArray(value) &&
						(mappedColumn.includes('categories') || mappedColumn.includes('recommended_for'))
					) {
						const conditions = value.map((val) => `'${val}' = ANY(${mappedColumn})`).join(' OR ')
						return `(${conditions})` // Wrap in parentheses for clarity/precedence
					}

					return `(${value
						.map((val) => {
							if (val instanceof Date) {
								return `${mappedColumn} ${filterType} TO_TIMESTAMP('${val.toISOString()}', 'YYYY-MM-DD"T"HH24:MI:SS')`
							} else if (typeof val === 'string' && isStrictValidDate(val)) {
								return `${mappedColumn} ${filterType} TO_TIMESTAMP('${val}', 'YYYY-MM-DD')`
							} else if (typeof val === 'number') {
								return `${mappedColumn} ${filterType} ${val}`
							}
							return `${mappedColumn} ${filterType} '${val}'`
						})
						.join(' OR ')})`
				} else if (value instanceof Date) {
					return `${mappedColumn} ${filterType} TO_TIMESTAMP('${value.toISOString()}', 'YYYY-MM-DD"T"HH24:MI:SS')`
				} else if (typeof value === 'string' && isStrictValidDate(value)) {
					return `${mappedColumn} ${filterType} TO_TIMESTAMP('${value}', 'YYYY-MM-DD')`
				} else if (typeof value === 'number') {
					return `${mappedColumn} ${filterType} ${value}`
				}
				return `${mappedColumn} ${filterType} '${value}'`
			}

			return null
		})
		.filter(Boolean)

	const conditionsString = conditions.join(' AND ')
	if (conditionsString) {
		const hasWhereClause = /\bDYNAMIC_WHERE_CLAUSE\b/i.test(baseQuery)
		// More robust WHERE check
		let dynamicQuery
		const checkClause = hasWhereClause ? ` WHERE ${conditionsString}` : ` AND ${conditionsString}`
		dynamicQuery = checkClause
		return dynamicQuery
	}
	return ''
}

function getDynamicEntityCondition(entityData, sessionModel, baseQuery) {
	if (!entityData || Object.keys(entityData).length === 0) {
		return ''
	}

	// Ensure sessionModel is a string
	if (typeof sessionModel !== 'string') {
		throw new Error('sessionModel must be a string representing the table or model name')
	}

	const conditions = []

	// Iterate over entityData to handle conditions
	for (const [column, values] of Object.entries(entityData)) {
		if (Array.isArray(values) && values.length > 0) {
			// Generate combined condition for all values as a single array
			const combinedValues = `{${values.join(',')}}`
			conditions.push(`${sessionModel}.${column} IN ('${combinedValues}')`)
		}
	}
	// Join all conditions with OR instead of AND
	return ` AND (${conditions})`
}

// Utility function to check strict date validity
function isStrictValidDate(dateString) {
	// Match dates in 'YYYY-MM-DD' format
	const dateRegex = /^\d{4}-\d{2}-\d{2}$/
	return dateRegex.test(dateString) && !isNaN(new Date(dateString).getTime())
}

function getDynamicSearchCondition(search, columnMappings, baseQuery) {
	if (!search || typeof search !== 'object') {
		return '' // Early exit if search is not valid
	}

	const conditions = Object.entries(search)
		.map(([column, value]) => {
			const mappedColumn = columnMappings[column]
			if (!mappedColumn) {
				return null // Skip if no mapping is found for the column
			}

			if (value) {
				if (Array.isArray(value)) {
					// If value is an array, combine with OR for multiple values
					const arrayConditions = value
						.map((val) => {
							if (mappedColumn === 's.seats_limit-s.seats_remaining') {
								// Ensure both seats_limit and seats_remaining are treated as integers and subtract
								return `((s.seats_limit - s.seats_remaining)::TEXT ILIKE '%${val}%')`
							} else if (val instanceof Date) {
								return `${mappedColumn} = TO_TIMESTAMP('${val.toISOString()}', 'YYYY-MM-DD"T"HH24:MI:SS')`
							} else if (typeof val === 'string' && isStrictValidDate(val)) {
								return `${mappedColumn} = TO_TIMESTAMP('${val}', 'YYYY-MM-DD')`
							} else if (typeof val === 'string') {
								return `${mappedColumn}::TEXT ILIKE '%${val}%'` // Partial text match
							} else {
								return `${mappedColumn} = '${val}'` // Exact match for other types
							}
						})
						.join(' OR ')
					return `(${arrayConditions})`
				} else {
					// If it's a single value, handle accordingly
					if (mappedColumn === 's.seats_limit-s.seats_remaining') {
						return `((s.seats_limit - s.seats_remaining)::TEXT ILIKE '%${value}%')`
					} else if (value instanceof Date) {
						return `${mappedColumn} = TO_TIMESTAMP('${value.toISOString()}', 'YYYY-MM-DD"T"HH24:MI:SS')`
					} else if (typeof value === 'string' && isStrictValidDate(value)) {
						return `${mappedColumn} = TO_TIMESTAMP('${value}', 'YYYY-MM-DD')`
					} else if (typeof value === 'string') {
						return `${mappedColumn}::TEXT ILIKE '%${value}%'`
					} else {
						return `${mappedColumn} = '${value}'`
					}
				}
			}

			return null
		})
		.filter(Boolean)

	const conditionsString = conditions.join(' AND ')
	if (conditionsString) {
		const hasWhereClause = /\bDYNAMIC_WHERE_CLAUSE\b/i.test(baseQuery) // More robust WHERE check
		let dynamicQuery
		const checkClause = hasWhereClause ? ` WHERE ${conditionsString}` : ` AND ${conditionsString}`
		dynamicQuery = checkClause
		return dynamicQuery
	}
	return ''
}

function extractFiltersAndEntityType(data) {
	let filters = []
	let entityType = []
	let defaultValues = []

	data.forEach((item) => {
		if (item.filter) {
			if (item.isEntityType) {
				// Add to entityType if filter is true and isEntityType is true
				entityType.push(item.key)
			} else if (item.defaultValues && Array.isArray(item.defaultValues)) {
				// Check if defaultValues is present and an array
				defaultValues.push(item.key)
			} else {
				// Add to filters if filter is true and not an entityType
				filters.push(item.key)
			}
		}
	})

	// Join arrays into comma-separated strings
	filters = filters.join(',')
	entityType = entityType.join(',')
	defaultValues = defaultValues.join(',')

	return { filters, entityType, defaultValues }
}

// Function to map EntityTypes to data
const mapEntityTypeToData = (data, entityTypes) => {
	return data.map((item) => {
		const newItem = { ...item }

		// Loop through EntityTypes to check for matching keys
		entityTypes.forEach((entityType) => {
			const key = entityType.value
			// If the key exists in the data item
			if (newItem[key]) {
				const values = newItem[key]
					.toString()
					.split(',')
					.map((val) => val.trim())

				// Map values to corresponding entity labels
				const mappedValues = values
					.map((value) => {
						const entity = entityType.entities.find((e) => e.value === value)
						return entity ? entity.label : value
					})
					.join(', ')

				newItem[key] = mappedValues
			}
		})

		return newItem
	})
}

function transformEntityTypes(input) {
	// Flatten all group arrays into a single entityTypes array
	const entityTypes = Object.keys(input).flatMap((key) =>
		input[key].map((group) => ({
			id: group.id,
			label: group.label,
			value: group.value,
			parent_id: group.parent_id,
			organization_id: group.organization_id,
			entities: group.entities.map((entity) => ({
				id: entity.id,
				value: entity.value,
				label: entity.label,
				status: entity.status,
				type: entity.type,
				created_at: entity.created_at,
				updated_at: entity.updated_at,
			})),
		}))
	)

	return { entityTypes }
}

/**
 * Generate tenant-specific materialized view name
 * @function
 * @name getTenantViewName
 * @param {String} tenantCode - Tenant code
 * @param {String} tableName - Table name
 * @returns {String} returns tenant-specific view name.
 */
const getTenantViewName = (tenantCode, tableName) => {
	return `${tenantCode}_m_${tableName}`
}

function sortData(data = [], path = 'meta.sequence') {
	const getValue = (obj, path) => {
		return path.split('.').reduce((acc, key) => acc?.[key], obj)
	}

	return [...data].sort((a, b) => {
		const aVal = getValue(a, path)
		const bVal = getValue(b, path)

		if (aVal !== undefined && bVal !== undefined) {
			const aNum = Number(aVal)
			const bNum = Number(bVal)
			if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum
			// Fallback to string comparison for non-numeric values
			return String(aVal).localeCompare(String(bVal))
		}
		if (aVal !== undefined) return -1
		if (bVal !== undefined) return 1
		return 0
	})
}
function removeDefaultOrgData(data, defaulOrgCode, key) {
	// 1. Collect all form types that exist for non-default tenants
	const orgData = new Set(data.filter((f) => f.organization_code !== defaulOrgCode).map((f) => f[key]))

	// 2. Filter out default forms that have a tenant override
	return data.filter((f) => {
		if (f.organization_code === defaulOrgCode && orgData.has(f[key])) {
			return false // remove default version
		}
		return true // keep tenant version or default with no override
	})
}

module.exports = {
	hash: hash,
	getCurrentMonthRange,
	getCurrentWeekRange,
	getCurrentQuarterRange,
	elapsedMinutes,
	getIstDate,
	composeEmailBody,
	getDownloadableUrl,
	getPublicDownloadableUrl,
	getTimeZone,
	utcFormat,
	md5Hash,
	extractEmailTemplate,
	capitalize,
	isAMentor,
	isNumeric,
	epochFormat,
	processDbResponse,
	restructureBody,
	validateInput,
	removeParentEntityTypes,
	getTimeDifferenceInMilliseconds,
	deleteProperties,
	generateCheckSum,
	validateRoleAccess,
	removeDefaultOrgEntityTypes,
	generateWhereClause,
	validateFilters,
	processQueryParametersWithExclusions,
	extractFilename,
	generateRedisConfigForQueue,
	generateFileName,
	generateCSVContent,
	clearFile,
	convertKeysToSnakeCase,
	isValidEmail,
	transformCustomFields,
	validateProfileData,
	validateAndBuildFilters,
	convertExpiryTimeToSeconds,
	convertEntitiesForFilter,
	filterEntitiesBasedOnParent,
	convertToTitleCase,
	removeLimitAndOffset,
	generateFilters,
	mapEntityTypesToData,
	extractColumnMappings,
	getDynamicFilterCondition,
	getDynamicSearchCondition,
	extractFiltersAndEntityType,
	generateDateRanges,
	mapEntityTypeToData,
	getDynamicEntityCondition,
	transformEntityTypes,
	getTenantViewName,
	sortData,
	removeDefaultOrgData,
}
