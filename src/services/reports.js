const httpStatusCode = require('@generics/http-status')
const responses = require('@helpers/responses')
const path = require('path')
const common = require('@constants/common')
const menteeQueries = require('@database/queries/userExtension')
const sessionQueries = require('@database/queries/sessions')
const mentorQueries = require('@database/queries/mentorExtension')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const utils = require('@generics/utils')
const getOrgIdAndEntityTypes = require('@helpers/getOrgIdAndEntityTypewithEntitiesBasedOnPolicy')
const reportMappingQueries = require('@database/queries/reportRoleMapping')
const reportQueryQueries = require('@database/queries/reportQueries')
const reportsQueries = require('@database/queries/reports')
const { sequelize } = require('@database/models')
const fs = require('fs')
const ProjectRootDir = path.join(__dirname, '../')
const inviteeFileDir = ProjectRootDir + common.tempFolderForBulkUpload
const fileUploadPath = require('@helpers/uploadFileToCloud')
const { Op } = require('sequelize')

module.exports = class ReportsHelper {
	/**
	 * Get Entity Types for Reports
	 * @method
	 * @name getFilterList
	 * @param {String} entity_type - Type of entity to filter (e.g., user, organization, session).
	 * @param {String} filterType - Type of filter to apply (e.g., date, role, status).
	 * @param {Object} tokenInformation - Decoded token containing user and organization details.
	 * @param {String} reportFilter - Specific report filter criteria.
	 * @returns {Object} - JSON object containing the report filter list.
	 */
	static async getFilterList(entity_type, filterType, tokenInformation, reportFilter, tenantCode) {
		try {
			let result = {
				entity_types: {},
			}

			const filter_type = filterType !== '' ? filterType : common.MENTOR_ROLE
			const report_filter = reportFilter === '' ? {} : { report_filter: reportFilter }

			let organization_codes = []
			let tenantCodes = []

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

			const organizations = await getOrgIdAndEntityTypes.getOrganizationIdBasedOnPolicy(
				tokenInformation.id,
				tokenInformation.organization_code,
				filter_type,
				{ [Op.in]: [tenantCode, defaults.tenantCode] }
			)

			if (organizations.success && organizations.result) {
				organization_codes = [...organizations.result.organizationCodes]
				tenantCodes = [...organizations.result.tenantCodes]

				if (organization_codes.length > 0) {
					const defaults = await getDefaults()
					const modelName = []
					const queryMap = {
						[common.MENTEE_ROLE]: menteeQueries.getModelName,
						[common.MENTOR_ROLE]: mentorQueries.getModelName,
						[common.SESSION]: sessionQueries.getModelName,
					}
					if (queryMap[filter_type.toLowerCase()]) {
						const modelNameResult = await queryMap[filter_type.toLowerCase()]()
						modelName.push(modelNameResult)
					}
					// get entity type with entities list
					const getEntityTypesWithEntities = await getOrgIdAndEntityTypes.getEntityTypeWithEntitiesBasedOnOrg(
						organization_codes,
						entity_type,
						defaults.orgCode ? defaults.orgCode : '',
						modelName,
						report_filter,
						tenantCodes,
						defaults.tenantCode ? defaults.tenantCode : ''
					)

					if (getEntityTypesWithEntities.success && getEntityTypesWithEntities.result) {
						let entityTypesWithEntities = getEntityTypesWithEntities.result
						if (entityTypesWithEntities.length > 0) {
							let convertedData = utils.convertEntitiesForFilter(entityTypesWithEntities)
							let doNotRemoveDefaultOrg = false
							if (organization_codes.includes(defaults.orgCode)) {
								doNotRemoveDefaultOrg = true
							}
							result.entity_types = utils.filterEntitiesBasedOnParent(
								convertedData,
								defaults.orgCode,
								doNotRemoveDefaultOrg
							)
						}
					}
				}
			}

			// search for type entityType and add 'ALL' to entities list of type
			// added roles inside the result
			if (result.entity_types.type) {
				result.entity_types.type.forEach((typeObj) => {
					if (typeObj.entities) {
						typeObj.entities.push({
							entity_type_id: typeObj.id,
							value: common.ALL,
							label: common.All,
							status: common.ACTIVE_STATUS,
							type: common.SYSTEM,
						})
					}
				})
			}
			result = utils.transformEntityTypes(result.entity_types)
			result.roles = tokenInformation.roles
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'REPORT_FILTER_FETCHED_SUCCESSFULLY',
				result,
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Get report data for reports
	 * @method
	 * @name getReportData
	 * @param {String} userId - ID of the user requesting the report.
	 * @param {String} orgCode - ID of the organization.
	 * @param {Number} page - Page number for pagination.
	 * @param {Number} limit - Number of items per page.
	 * @param {String} reportCode - Code identifying the report type.
	 * @param {String} reportRole - Role associated with the report access.
	 * @param {String} startDate - Start date for filtering the data (format: YYYY-MM-DD).
	 * @param {String} endDate - End date for filtering the data (format: YYYY-MM-DD).
	 * @param {String} sessionType - Type of session to filter (e.g., online, offline).
	 * @param {Array} entitiesValue - List of entity values for filtering.
	 * @param {String} sortColumn - Column name to sort the data.
	 * @param {String} sortType - Sorting order (asc/desc).
	 * @param {String} searchColumn - Column name to search within.
	 * @param {String} searchValue - Value to search for.
	 * @param {Boolean} downloadCsv - Flag to indicate if the data should be downloaded as a CSV file.
	 * @returns {Object} - JSON object containing the report data list.
	 */

	static async getReportData(
		userId,
		orgCode, //token id
		page,
		limit,
		reportCode,
		reportRole,
		startDate,
		endDate,
		sessionType,
		entityTypesColumns,
		entityTypesValues,
		sortColumn,
		sortType,
		searchColumns,
		searchValues,
		downloadCsv,
		groupBy,
		filterColumns,
		filterValues,
		timeZone,
		tenantCode
	) {
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
			// Validate report permissions
			const reportPermission = await reportMappingQueries.findReportRoleMappingByReportCode(
				reportCode,
				[tenantCode, defaults.tenantCode],
				[defaults.orgCode, orgCode]
			)
			if (!reportPermission || reportPermission.dataValues.role_title !== reportRole) {
				return responses.failureResponse({
					message: 'REPORT_CODE_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let reportConfig

			// Fetch report configuration for the given organization ID
			const reportConfigWithOrgId = await reportsQueries.findReport(
				{
					code: reportCode,
					organization_code: { [Op.in]: [orgCode, defaults.orgCode] },
				},
				{ [Op.in]: [tenantCode, defaults.tenantCode] }
			)
			if (reportConfigWithOrgId.length > 0) {
				reportConfig = reportConfigWithOrgId
			} else {
				// Fetch report configuration for the default organization ID
				const reportConfigWithDefaultOrgId = await reportsQueries.findReport(
					{
						code: reportCode,
						organization_code: { [Op.in]: [orgCode, defaults.orgCode] },
					},
					{ [Op.in]: [tenantCode, defaults.tenantCode] }
				)
				reportConfig = reportConfigWithDefaultOrgId
			}

			let reportQuery

			const reportQueryWithOrgId = await reportQueryQueries.findReportQueries(
				{
					report_code: reportCode,
					organization_code: { [Op.in]: [orgCode, defaults.orgCode] },
				},
				{ [Op.in]: [tenantCode, defaults.tenantCode] }
			)

			if (reportQueryWithOrgId.length > 0) {
				reportQuery = reportQueryWithOrgId
			} else {
				const reportQueryWithDefaultOrgId = await reportQueryQueries.findReportQueries(
					{
						report_code: reportCode,
						organization_code: { [Op.in]: [orgCode, defaults.orgCode] },
					},
					{ [Op.in]: [tenantCode, defaults.tenantCode] }
				)
				reportQuery = reportQueryWithDefaultOrgId
			}
			if (!reportConfig || !reportQuery) {
				return responses.failureResponse({
					message: 'REPORT_CONFIG_OR_QUERY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			const columnConfig = reportConfig[0]?.config
			const reportDataResult = {
				report_type: reportConfig[0].report_type_title,
				config: columnConfig,
			}

			// Handle BAR_CHART report type with groupBy
			if (reportConfig[0].report_type_title === common.BAR_CHART && groupBy) {
				//	const listOfDates = await utils.getAllEpochDates(startDate, endDate, groupBy)

				const dateRanges = await utils.generateDateRanges(startDate, endDate, groupBy, timeZone)

				// Initialize the array to store results
				const dateRangeResults = []

				for (let dateRange of dateRanges) {
					const replacements = {
						userId: userId || null,
						//	entities_value: entitiesValue ? `{${entitiesValue}}` : null,
						session_type: sessionType ? utils.convertToTitleCase(sessionType) : null,
						start_date: dateRange.start_date || null,
						end_date: dateRange.end_date || null,
						tenantCode: tenantCode,
					}

					let query = reportQuery[0].query.replace(/:sort_type/g, replacements.sort_type)
					const sessionModel = await sessionQueries.getModelName()
					if (!entityTypesColumns && !entityTypesValues) {
						query = query.includes('DYNAMIC_WHERE_CLAUSE')
							? query.replace('DYNAMIC_WHERE_CLAUSE', '')
							: query.replace('DYNAMIC_AND_CLAUSE', '')
					}

					if (entityTypesColumns && entityTypesValues) {
						const entityConditions = await utils.getDynamicEntityCondition(
							Object.fromEntries(entityTypesColumns.map((col, idx) => [col, entityTypesValues[idx]])),
							sessionModel.toLowerCase(),
							query
						)

						// Add dynamic entity conditions to the query
						if (entityConditions) {
							query = reportQuery[0].query.replace(';', '')
							query = query.includes('DYNAMIC_WHERE_CLAUSE')
								? query.replace('DYNAMIC_WHERE_CLAUSE', entityConditions)
								: query.replace('DYNAMIC_AND_CLAUSE', entityConditions)
						}
					}
					// Execute query with the current date range
					const result = await sequelize.query(query, { replacements, type: sequelize.QueryTypes.SELECT })

					// Create a dynamic object to store the result for the date range
					const dateRangeResult = {}

					// Dynamically assign values to the dateRangeResult
					const resultData = result?.[0] || {}
					Object.keys(resultData).forEach((key) => {
						dateRangeResult[key] = resultData[key] || 0
					})

					// Push the dynamically created result into the results array
					dateRangeResults.push(dateRangeResult)
				}

				// Now dateRangeResults will contain dynamically structured data without start_date and end_date
				reportDataResult.data = dateRangeResults
			} else {
				// Prepare query replacements for the report
				const defaultLimit = common.pagination.DEFAULT_LIMIT
				const replacements = {
					userId: userId || null,
					start_date: startDate || null,
					end_date: endDate || null,
					session_type: sessionType ? utils.convertToTitleCase(sessionType) : null,
					limit: limit || defaultLimit,
					offset: common.getPaginationOffset(page, limit),
					sort_column: sortColumn || '',
					sort_type: sortType.toUpperCase() || 'ASC',
					tenantCode: tenantCode,
				}

				const noPaginationReplacements = {
					...replacements,
					limit: null,
					offset: null,
					sort_column: sortColumn || '',
					sort_type: sortType.toUpperCase() || 'ASC',
				}
				const sessionModel = await sessionQueries.getModelName()
				let filterCompleteQuery = ''
				let query = reportQuery[0].query
				if (entityTypesColumns && entityTypesValues) {
					const entityConditions = await utils.getDynamicEntityCondition(
						Object.fromEntries(entityTypesColumns.map((col, idx) => [col, entityTypesValues[idx]])),
						sessionModel,
						query
					)
					// Add dynamic entity conditions to the query
					if (entityConditions) {
						query = reportQuery[0].query.replace(';', '')
						filterCompleteQuery = entityConditions
					}
				}

				if (reportConfig[0].report_type_title === common.REPORT_TABLE) {
					query = query.replace(';', '') // Base query for report table
					const columnMappings = await utils.extractColumnMappings(query)
					// Generate dynamic WHERE conditions for filters
					if (filterColumns && filterValues) {
						const filterConditions = await utils.getDynamicFilterCondition(
							Object.fromEntries(filterColumns.map((col, idx) => [col, filterValues[idx]])),
							columnMappings,
							query,
							columnConfig.columns
						)
						if (filterConditions) {
							if (filterCompleteQuery.includes('WHERE')) {
								if (filterConditions.includes('WHERE')) {
									filterCompleteQuery += filterConditions.replace('WHERE', 'AND')
								}
							} else {
								filterCompleteQuery += filterConditions
							}
						}
					}

					// Generate dynamic WHERE conditions for search
					if (searchColumns && searchValues) {
						const searchConditions = await utils.getDynamicSearchCondition(
							Object.fromEntries(searchColumns.map((col, idx) => [col, searchValues[idx]])),
							columnMappings,
							query,
							columnConfig.columns
						)
						if (searchConditions) {
							if (filterCompleteQuery.includes('WHERE')) {
								if (searchConditions.includes('WHERE')) {
									filterCompleteQuery += searchConditions.replace('WHERE', 'AND')
								}
							} else {
								filterCompleteQuery += searchConditions
							}
						}
					}
					query = query.includes('DYNAMIC_WHERE_CLAUSE')
						? query.replace('DYNAMIC_WHERE_CLAUSE', filterCompleteQuery)
						: query.replace('DYNAMIC_AND_CLAUSE', filterCompleteQuery)
					// Add sorting
					if (sortColumn && columnMappings[sortColumn]) {
						// Validate sortType against whitelist
						const validSortTypes = ['ASC', 'DESC']
						const safeSortType = validSortTypes.includes(sortType.toUpperCase())
							? sortType.toUpperCase()
							: 'ASC'
						const mappedColumn = columnMappings[sortColumn]

						const orderByClause = `ORDER BY 
							${mappedColumn} ${safeSortType} NULLS LAST`

						// Remove any existing ORDER BY clause (case-insensitive)
						query = query.replace(/order\s+by[\s\S]*?(?=(limit|offset|fetch|\)|$))/i, '')

						// Append the new ORDER BY clause
						query += ` ${orderByClause}`
					}

					// Add pagination
					query += ` LIMIT :limit OFFSET :offset;`
				}
				query = query.includes('DYNAMIC_WHERE_CLAUSE')
					? query.replace('DYNAMIC_WHERE_CLAUSE', filterCompleteQuery)
					: query.replace('DYNAMIC_AND_CLAUSE', filterCompleteQuery)

				// Replace sort type placeholder in query
				query = query.replace(/:sort_type/g, replacements.sort_type)
				// Execute query with pagination
				const [result, resultWithoutPagination] = await Promise.all([
					sequelize.query(query, { replacements, type: sequelize.QueryTypes.SELECT }),
					sequelize.query(utils.removeLimitAndOffset(query), {
						replacements: noPaginationReplacements,
						type: sequelize.QueryTypes.SELECT,
					}),
				])

				const sessionModelName = await sessionQueries.getModelName()
				let entityTypesDataWithPagination = await getOrgIdAndEntityTypes.getEntityTypeWithEntitiesBasedOnOrg(
					orgCode,
					'',
					defaults.orgCode ? defaults.orgCode : '',
					sessionModelName,
					{},
					tenantCode,
					defaults.tenantCode
				)

				if (reportDataResult.report_type === common.REPORT_TABLE && resultWithoutPagination) {
					reportDataResult.count = resultWithoutPagination.length
				}
				// Process query results
				if (result?.length) {
					const transformedEntityData = await utils.mapEntityTypeToData(
						result,
						entityTypesDataWithPagination.result
					)
					reportDataResult.data =
						reportDataResult.report_type === common.REPORT_TABLE ? transformedEntityData : { ...result[0] }
				} else {
					reportDataResult.data = []
					reportDataResult.count = resultWithoutPagination.length
					reportDataResult.message = common.report_session_message
				}

				// Handle CSV download
				if (resultWithoutPagination?.length) {
					const sessionModelName = await sessionQueries.getModelName()
					if (reportConfig[0].report_type_title === common.REPORT_TABLE) {
						const ExtractFilterAndEntityTypesKeys = await utils.extractFiltersAndEntityType(
							columnConfig.columns
						)

						let entityTypeFilters = await getOrgIdAndEntityTypes.getEntityTypeWithEntitiesBasedOnOrg(
							orgCode,
							ExtractFilterAndEntityTypesKeys.entityType,
							defaults.orgCode ? defaults.orgCode : '',
							sessionModelName,
							{},
							tenantCode,
							defaults.tenantCode
						)

						const filtersEntity = entityTypeFilters.result.reduce((acc, item) => {
							acc[item.value] = item.entities
							return acc
						}, {})

						reportDataResult.filters = await utils.generateFilters(
							resultWithoutPagination,
							ExtractFilterAndEntityTypesKeys.entityType,
							ExtractFilterAndEntityTypesKeys.defaultValues,
							columnConfig.columns
						)

						if (ExtractFilterAndEntityTypesKeys.entityType) {
							ExtractFilterAndEntityTypesKeys.entityType.split(',').forEach((key) => {
								reportDataResult.filters[key] = filtersEntity[key]
							})
						}
					}

					if (downloadCsv === 'true') {
						let entityTypesData = await getOrgIdAndEntityTypes.getEntityTypeWithEntitiesBasedOnOrg(
							orgCode,
							'',
							defaults.orgCode ? defaults.orgCode : '',
							sessionModelName,
							{},
							tenantCode,
							defaults.tenantCode
						)

						// Process the data
						const transformedData = await utils.mapEntityTypeToData(
							resultWithoutPagination,
							entityTypesData.result
						)

						const keyToLabelMap = Object.fromEntries(
							columnConfig.columns.map(({ key, label }) => [key, label])
						)

						// Transform objects in the array
						const transformedResult = transformedData.map((item) =>
							Object.fromEntries(
								Object.entries(item).map(([key, value]) => [
									keyToLabelMap[key] || key, // Use label if key exists, otherwise retain original key
									value,
								])
							)
						)

						const outputFilePath = await this.generateAndUploadCSV(transformedResult, userId, orgCode)
						reportDataResult.reportsDownloadUrl = await utils.getDownloadableUrl(outputFilePath)
						utils.clearFile(outputFilePath)
					}
				}
			}

			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_DATA_SUCCESSFULLY_FETCHED',
				result: reportDataResult,
			})
		} catch (error) {
			throw error
		}
	}

	static async createReport(data, organizationId, organizationCode, tenantCode) {
		try {
			data.organization_id = organizationId
			data.organization_code = organizationCode
			data.created_at = new Date().toISOString()
			data.updated_at = new Date().toISOString()

			// Attempt to create a new report directly
			const reportCreation = await reportsQueries.createReport(data, tenantCode)
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'REPORT_CREATED_SUCCESS',
				result: reportCreation?.dataValues,
			})
		} catch (error) {
			// Handle unique constraint violation error
			if (error.name === 'SequelizeUniqueConstraintError') {
				return responses.failureResponse({
					message: 'REPORT_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.failureResponse({
				message: 'REPORT_CREATION_FAILED',
				statusCode: httpStatusCode.internalServerError,
				responseCode: 'SERVER_ERROR',
			})
		}
	}

	static async getReportById(id, tenantCode) {
		try {
			const readReport = await reportsQueries.findReportById(id, tenantCode)
			if (!readReport) {
				return responses.failureResponse({
					message: 'REPORT_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'REPORT_FETCHED_SUCCESSFULLY',
				result: readReport.dataValues,
			})
		} catch (error) {
			throw error
		}
	}

	static async updateReport(id, updateData, organizationId, organizationCode, tenantCode) {
		try {
			const filter = {
				id: id,
				organization_code: organizationCode,
				organization_id: organizationId,
				tenant_code: tenantCode,
			}
			const updatedReport = await reportsQueries.updateReport(filter, updateData, tenantCode)
			if (!updatedReport) {
				return responses.failureResponse({
					message: 'REPORT_UPDATE_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'REPORT_UPATED_SUCCESSFULLY',
				result: updatedReport.dataValues,
			})
		} catch (error) {
			throw error
		}
	}

	static async deleteReportById(id, tenantCode) {
		try {
			const deletedRows = await reportsQueries.deleteReportById(id, tenantCode)
			if (deletedRows === 0) {
				return responses.failureResponse({
					message: 'REPORT_DELETION_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'REPORT_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Generates and uploads a CSV from the provided data.
	 */
	static async generateAndUploadCSV(data, userId, orgCode) {
		const outputFileName = utils.generateFileName(common.reportOutputFile, common.csvExtension)
		const csvData = await utils.generateCSVContent(data)
		const outputFilePath = path.join(inviteeFileDir, outputFileName)
		fs.writeFileSync(outputFilePath, csvData)

		const outputFilename = path.basename(outputFilePath)
		const uploadRes = await fileUploadPath.uploadFileToCloud(outputFilename, inviteeFileDir, userId, orgCode)
		return uploadRes.result.uploadDest
	}
}
