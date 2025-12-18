'use strict'
const entityTypeQueries = require('@database/queries/entityType')
const entityTypeCache = require('@helpers/entityTypeCache')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const entityQueries = require('@database/queries/entity')
const { Op } = require('sequelize')

/**
 * Builds search filters for a SQL query, including where clause, position query, and sort query.
 *
 * @param {Object} options - The options object.
 * @param {string[]|| false} options.searchOn - An array of field names to search on. If not provided, all fields from searchConfig will be used.
 * @param {Object} options.searchConfig - Configuration object containing search settings.
 * @param {Object} options.searchConfig.sessionSearch - Session search configuration.
 * @param {Array} options.searchConfig.sessionSearch.fields - Array of field configuration objects.
 * @param {string} options.searchConfig.sessionSearch.fields[].name - The name of the field.
 * @param {number} [options.searchConfig.sessionSearch.fields[].sortPriority=100] - The sort priority of the field. Defaults to 100 if not specified.
 * @param {string} options.search - The search term to be used in the filter.
 *
 * @returns {Object} An object containing whereClause, positionQuery, and sortQuery.
 * @returns {string} return.whereClause - The where clause for the SQL query.
 * @returns {string} return.positionQuery - The position query for the SQL query.
 * @returns {string} return.sortQuery - The sort query for the SQL query.
 *
 * @example
 * const searchFilters = buildSearchFilter({
 *   searchOn: ['field1', 'field2'],
 *   searchConfig: {
 *     sessionSearch: {
 *       fields: [
 *         { name: 'field1', sortPriority: 1 },
 *         { name: 'field2', sortPriority: 2 }
 *       ]
 *     }
 *   },
 *   search: 'example'
 * });
 * // Result:
 * // {
 * //   whereClause: "field1 ILIKE  :search OR field2 ILIKE :search",
 * //   positionQuery: "POSITION(lower(example) IN lower(field1)) AS field1_match_position, POSITION(lower(example) IN lower(field2)) AS field2_match_position",
 * //   sortQuery: "CASE WHEN POSITION(lower(example) IN lower(field1)) > 0 THEN 1 * 10000 + POSITION(lower(example) IN lower(field1)) WHEN POSITION(lower(example) IN lower(field2)) > 0 THEN 2 * 10000 + POSITION(lower(example) IN lower(field2)) END ASC"
 * // }
 */

exports.buildSearchFilter = async function buildSearchFilter({
	searchOn,
	searchConfig,
	search,
	modelName,
	tenantCode,
}) {
	try {
		if (!search || search.trim() === '') {
			return {
				whereClause: '',
				positionQuery: '',
				sortQuery: '',
			}
		}
		const configFields = searchConfig.fields

		const fieldsToSearch =
			searchOn && searchOn.length
				? searchOn
				: configFields
						.filter((field) => field.external === undefined || !field.external)
						.map((field) => field.name)

		const whereClauses = []
		const positionQueries = []
		const sortCases = []
		let hasEntityTypeField = false
		fieldsToSearch.forEach((fieldName) => {
			const fieldConfig = configFields.find((field) => field.name === fieldName)
			const sortPriority = fieldConfig ? fieldConfig.sortPriority : 100 // Default sortPriority if not found

			if (fieldConfig.isAnEntityType) {
				// If the property exists, set 'hasEntityTypeField' to true
				hasEntityTypeField = true
				sortCases.push(`WHEN ${fieldName} IS NOT NULL THEN ${sortPriority} * 10000`)
			} else {
				whereClauses.push(`${fieldName} ILIKE :search`)

				positionQueries.push(
					`POSITION(lower('${search}') IN lower(${fieldName})) AS ${fieldName}_match_position`
				)
				sortCases.push(
					`WHEN POSITION(lower('${search}') IN lower(${fieldName})) > 0 THEN ${sortPriority} * 10000 + POSITION(lower('${search}') IN lower(${fieldName}))`
				)
			}
		})
		let falseSearchOnEntity
		if (hasEntityTypeField) {
			const entityTypeQuery = await getEntityTypeFilter(modelName, searchConfig, search, searchOn, tenantCode)

			if (entityTypeQuery == false) {
				const entityFields = configFields.filter((field) => field.isAnEntityType).map((field) => field.name)

				const areAllFieldsEntityTypes = fieldsToSearch.every((field) => entityFields.includes(field))
				if (areAllFieldsEntityTypes) falseSearchOnEntity = true
			}
			if (entityTypeQuery) {
				whereClauses.push(entityTypeQuery)
			}
		}
		if (falseSearchOnEntity) {
			return false
		}

		let whereClause = ''
		if (whereClauses.length > 0) {
			whereClause = `AND (${whereClauses.join(' OR ')})`
		}

		const positionQuery = positionQueries.join(',\n    ')

		const sortQuery = `
        CASE
            ${sortCases.join('\n            ')}
        END ASC
    `.trim()

		return {
			whereClause,
			positionQuery,
			sortQuery,
		}
	} catch (error) {
		console.log('Error:', error)
	}
}
// Mapping of data types to SQL operators
const dataTypeOperators = {
	'ARRAY[STRING]': '@>',
	STRING: '=',
	NUMBER: '>',
}

/**
 * Builds a query based on entity types and entities.
 *
 * @param {Array} entityTypes - An array of entity types.
 * @param {Array} entities - An array of entities.
 *
 * @returns {string} A query string based on the provided entity types and entities.
 */
function buildQuery(entityTypes, entities) {
	try {
		const entityTypeMap = new Map()
		entityTypes.forEach((type) => {
			entityTypeMap.set(type.id, type)
		})

		const conditions = {}

		entities.forEach((entity) => {
			const entityType = entityTypeMap.get(entity.entity_type_id)
			if (entityType) {
				const field = entityType.value
				const dataType = entityType.data_type
				const operator = dataTypeOperators[dataType] || '='

				if (!conditions[field]) {
					conditions[field] = []
				}
				conditions[field].push(entity.value)
			}
		})

		const queryParts = Object.entries(conditions).map(([field, values]) => {
			const entityType = entityTypes.find((type) => type.value === field)
			const dataType = entityType.data_type
			const operator = dataTypeOperators[dataType] || '='
			if (dataType === 'ARRAY[STRING]') {
				return `${field} ${operator} ARRAY[${values
					.map((value) => `'${value}'`)
					.join(', ')}]::character varying[]`
			} else {
				return values.map((value) => `${field} ${operator} '${value}'`).join(' OR ')
			}
		})
		return queryParts.join(' OR ')
	} catch (error) {
		console.log('Error:', error)
		return error
	}
}

/**
 * Retrieves the entity type filter for the given model name and configuration.
 *
 * @param {string} modelName - The name of the model.
 * @param {Object} config - The configuration object containing fields.
 * @param {string} search - The search term to be used in the filter.
 * @param {string[]} searchOn - An array of field names to search on.
 *
 * @returns {Promise<string>} A promise that resolves to a query string based on the provided model name, configuration, and search term.
 */
async function getEntityTypeFilter(modelName, config, search, searchOn, tenantCode) {
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

	let entityTypes
	if (searchOn) {
		entityTypes = searchOn
	} else {
		entityTypes = config.fields.filter((field) => field.isAnEntityType === true).map((field) => field.name)
	}

	entityTypes = await entityTypeCache.getEntityTypesAndEntitiesWithCache(
		{
			status: 'ACTIVE',
			organization_code: defaults.orgCode,
			model_names: { [Op.contains]: [modelName] },
			allow_filtering: true,
			value: entityTypes,
		},
		tenantCode,
		defaults.orgCode,
		modelName
	)

	const entityTypeIds = entityTypes.map((entityType) => entityType.id)

	const filter = {
		label: { [Op.iLike]: `%${search}%` },
		status: 'ACTIVE',
		entity_type_id: entityTypeIds,
	}

	const entities = await entityQueries.findAllEntities(filter, { [Op.in]: [tenantCode, defaults.tenantCode] })

	if (entities.length == 0) {
		return false
	}
	const entityQuey = buildQuery(entityTypes, entities)
	return entityQuey
}
