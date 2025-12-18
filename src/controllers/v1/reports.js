const common = require('@constants/common')
const reportService = require('@services/reports')

module.exports = class Reports {
	/**
	 * Get Report Filter List
	 * @method
	 * @name filterList
	 * @param {Object} req - Request object containing query parameters and token information.
	 * @param {Object} req.query - Query parameters from the request.
	 * @param {String} [req.query.entity_types=''] - Types of entities to filter (optional).
	 * @param {String} [req.query.filter_type=''] - Type of filter to apply (optional).
	 * @param {Object} req.decodedToken - Decoded user token object.
	 * @param {String} [req.query.report_filter=''] - Specific report filter criteria (optional).
	 * @returns {Object} - JSON object containing the filter list.
	 */

	async filterList(req) {
		try {
			const reportFilterList = await reportService.getFilterList(
				req.query.entity_types ? req.query.entity_types : '',
				req.query.filter_type ? req.query.filter_type : '',
				req.decodedToken,
				req.query.report_filter ? req.query.report_filter : '',
				req.decodedToken.tenant_code
			)
			return reportFilterList
		} catch (error) {
			return error
		}
	}

	/**
	 * Get Report Configuration
	 * @method
	 * @name reportData
	 * @param {Object} req - Request data object.
	 * @param {Object} req.query - Query parameters.
	 * @param {String} req.query.decodedToken.id - User ID from the decoded token.
	 * @param {String} req.query.decodedToken.organization_code - Organization code from the decoded token.
	 * @param {Number} [req.query.pageNo=1] - Page number for pagination (default is 1).
	 * @param {Number} [req.query.Limit=10] - Number of items per page (default is 10).
	 * @param {String} req.query.report_code - Code for the report type.
	 * @param {String} [req.query.report_role='mentee'] - User role for the report (default is "mentee").
	 * @param {String} [req.query.start_date=''] - Start date for filtering the report (format: YYYY-MM-DD).
	 * @param {String} [req.query.end_date=''] - End date for filtering the report (format: YYYY-MM-DD).
	 * @param {String} [req.query.session_type='all'] - Session type to filter (e.g., "online", "offline").
	 * @param {Array} req.query.entities_value - List of entity values for filtering.
	 * @param {String} [req.query.sort_column=''] - Column name to sort the data.
	 * @param {String} [req.query.sort_type=''] - Sorting order ("asc" or "desc").
	 * @param {String} [req.query.search_column=''] - Column name to search within.
	 * @param {String} [req.query.search_value=''] - Value to search for in the specified column.
	 * @param {Boolean} [req.query.download_csv=false] - Flag to indicate if the report should be downloaded as a CSV file.
	 * @returns {Object} - Report data in JSON format.
	 */

	async reportData(req) {
		try {
			let filter_column = []
			let filter_value = []
			let search_column = []
			let search_value = []
			let entity_types_column = []
			let entity_types_value = []

			// Check if req.body exists and process filters
			if (
				req.body &&
				req.body.filters &&
				typeof req.body.filters === 'object' &&
				Object.keys(req.body.filters).length > 0
			) {
				Object.entries(req.body.filters).forEach(([key, value]) => {
					if (key && Array.isArray(value)) {
						filter_column.push([key]) // Add the key as a column
						filter_value.push(value) // Add the value
					}
				})
			}

			// Check if req.body exists and process search
			if (
				req.body &&
				req.body.search &&
				typeof req.body.search === 'object' &&
				Object.keys(req.body.search).length > 0
			) {
				Object.entries(req.body.search).forEach(([key, value]) => {
					if (key && Array.isArray(value)) {
						search_column.push([key]) // Add the key as a column
						search_value.push(value) // Add the value
					}
				})
			}

			// Check if req.body exists and process entityTypes
			if (
				req.body &&
				req.body.entityTypes &&
				typeof req.body.entityTypes === 'object' &&
				Object.keys(req.body.entityTypes).length > 0
			) {
				Object.entries(req.body.entityTypes).forEach(([key, value]) => {
					if (key && Array.isArray(value)) {
						entity_types_column.push([key]) // Add the key as a column
						entity_types_value.push(value) // Add the value
					}
				})
			}

			// Call the report service with the transformed data
			const reportData = await reportService.getReportData(
				req.decodedToken.id,
				req.decodedToken.organization_code,
				req.query.pageNo ? req.query.pageNo : common.pagination.DEFAULT_PAGE_NO,
				req.query.Limit ? req.query.Limit : common.pagination.DEFAULT_LIMIT,
				req.query.report_code,
				req.query.report_role ? req.query.report_role : common.MENTEE_ROLE,
				req.query.start_date ? req.query.start_date : '',
				req.query.end_date ? req.query.end_date : '',
				req.query.session_type ? req.query.session_type : common.ALL,
				entity_types_column.length > 0 ? entity_types_column : undefined,
				entity_types_value.length > 0 ? entity_types_value : undefined,
				req.query.sort_column,
				req.query.sort_type ? req.query.sort_type : '',
				search_column.length > 0 ? search_column : undefined, // Pass search_column only if it's not empty
				search_value.length > 0 ? search_value : undefined, // Pass search_value only if it's not empty
				req.query.download_csv ? req.query.download_csv : 'false',
				req.query.group_by ? req.query.group_by : 'month',
				filter_column.length > 0 ? filter_column : undefined, // Pass filter_column only if it's not empty
				filter_value.length > 0 ? filter_value : undefined, // Pass filter_value only if it's not empty
				req.headers.timezone,
				req.decodedToken.tenant_code
			)
			return reportData
		} catch (error) {
			return error
		}
	}

	async create(req) {
		try {
			const createReport = await reportService.createReport(
				req.body,
				req.decodedToken.organization_id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
			return createReport
		} catch (error) {
			return error
		}
	}

	async read(req) {
		try {
			const getReportById = await reportService.getReportById(req.query.id, req.decodedToken.tenant_code)
			return getReportById
		} catch (error) {
			return error
		}
	}

	async update(req) {
		try {
			const updatedReport = await reportService.updateReport(
				req.query.id,
				req.body,
				req.decodedToken.organization_id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
			return updatedReport
		} catch (error) {
			return error
		}
	}

	async delete(req) {
		try {
			const deleteReport = await reportService.deleteReportById(req.query.id, req.decodedToken.tenant_code)
			return deleteReport
		} catch (error) {
			return error
		}
	}
}
