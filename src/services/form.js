const httpStatusCode = require('@generics/http-status')
const utils = require('@generics/utils')
const form = require('@generics/form')
const KafkaProducer = require('@generics/kafka-communication')

const formQueries = require('../database/queries/form')
const { UniqueConstraintError } = require('sequelize')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const { Op } = require('sequelize')

const responses = require('@helpers/responses')
const cacheHelper = require('@generics/cacheHelper')

module.exports = class FormsHelper {
	/**
	 * Create Form.
	 * @method
	 * @name create
	 * @param {Object} bodyData - Form data
	 * @param {String} orgId - Organization ID
	 * @param {String} orgCode - Organization code
	 * @param {String} tenantCode - Tenant code
	 * @returns {JSON} - Form creation data.
	 */

	static async create(bodyData, orgId, orgCode, tenantCode) {
		try {
			bodyData['organization_id'] = orgId
			bodyData['organization_code'] = orgCode
			const form = await formQueries.createForm(bodyData, tenantCode, orgCode)

			await KafkaProducer.clearInternalCache('formVersion')

			// delete form versions
			try {
				if (form) {
					await cacheHelper.formVersions.delete(tenantCode, form.organization_code || orgCode)
				}
			} catch (error) {
				console.warn('Failed to invalidate form form versions:', error)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'FORM_CREATED_SUCCESSFULLY',
				result: form,
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'FORM_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Update Form.
	 * @method
	 * @name update
	 * @param {Object} bodyData
	 * @returns {JSON} - Update form data.
	 */

	static async update(id, bodyData, orgCode, tenantCode) {
		try {
			let filter = {}
			let originalForm = null

			if (id) {
				// ID-based update: use direct database query
				filter = { id: id }
				originalForm = await formQueries.findOne({ id: id }, tenantCode)
			} else {
				// Type/subtype based update: use cache first, then fallback to database query
				filter = { type: bodyData.type, sub_type: bodyData.sub_type }

				// Try cache first for type/subtype lookup
				originalForm = await cacheHelper.forms.get(tenantCode, orgCode, bodyData.type, bodyData.sub_type)

				if (!originalForm) {
					// Cache miss: fallback to database query
					const originalForms = await formQueries.findFormsByFilter(filter, [tenantCode])
					originalForm = originalForms && originalForms.length > 0 ? originalForms[0] : null
				}
			}

			const result = await formQueries.updateOneForm(filter, bodyData, tenantCode, orgCode)

			if (result === 'ENTITY_ALREADY_EXISTS') {
				return responses.failureResponse({
					message: 'FORM_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			} else if (result === 'ENTITY_NOT_FOUND') {
				return responses.failureResponse({
					message: 'FORM_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			await KafkaProducer.clearInternalCache('formVersion')

			// Cache invalidation after successful update: just delete, don't re-set
			try {
				if (originalForm && originalForm.type && originalForm.sub_type) {
					// Delete the form cache using original form's type/subtype information
					await cacheHelper.forms.delete(
						tenantCode,
						originalForm.organization_code || orgCode,
						originalForm.type,
						originalForm.sub_type
					)
				}
			} catch (error) {
				console.warn('Failed to invalidate form cache:', error)
			}

			// delete form verions
			try {
				if (originalForm?.organization_code) {
					await cacheHelper.formVersions.delete(tenantCode, originalForm.organization_code)
				}
			} catch (error) {
				console.warn('Failed to invalidate form form versions:', error)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'FORM_UPDATED_SUCCESSFULLY',
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'FORM_ALREADY_EXISTS',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			throw error
		}
	}

	/**
	 * Read Form.
	 * @method
	 * @name read
	 * @param {Object} bodyData
	 * @returns {JSON} - Read form data.
	 */

	static async read(id, bodyData, orgCode, tenantCode) {
		try {
			// Try to get from cache first if searching by type and subtype (not by ID)
			if (!id && bodyData?.type && bodyData?.sub_type) {
				const cachedData = await cacheHelper.forms.get(tenantCode, orgCode, bodyData.type, bodyData.sub_type)
				if (cachedData) {
					return responses.successResponse({
						statusCode: httpStatusCode.ok,
						message: 'FORM_FETCHED_SUCCESSFULLY',
						result: cachedData,
					})
				}
			}

			let filter = {}
			if (id) {
				filter = { id: id, tenant_code: tenantCode }
			} else {
				filter = { ...bodyData, tenant_code: tenantCode }
			}
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
			// Add organization code to filter if provided
			if (orgCode) {
				filter.organization_code = { [Op.in]: [orgCode, defaults.orgCode] }
			}

			// Business logic: Try both current tenant and default tenant
			const tenantCodes = [tenantCode, defaults.tenantCode]
			const forms = await formQueries.findFormsByFilter(filter, tenantCodes)

			if (!forms || forms.length === 0) {
				return responses.failureResponse({
					message: 'FORM_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			// Business logic: Prefer current tenant over default tenant
			const form = forms.find((f) => f.tenant_code === tenantCode) || forms[0]

			// Cache the result if it was searched by type and subtype
			if (!id && bodyData?.type && bodyData?.sub_type) {
				await cacheHelper.forms.set(tenantCode, orgCode, bodyData.type, bodyData.sub_type, form)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'FORM_FETCHED_SUCCESSFULLY',
				result: form,
			})
		} catch (error) {
			throw error
		}
	}
	static async readAllFormsVersion(tenantCode, orgCode) {
		try {
			const defaults = await getDefaults()
			if (!defaults.orgCode) {
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			if (!defaults.tenantCode) {
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let formsVersionData = null

			try {
				formsVersionData = await cacheHelper.formVersions.get(tenantCode, orgCode)
			} catch (cacheError) {
				console.error('Failed to get form versions from cache:', cacheError)
			}

			if (!formsVersionData) {
				formsVersionData = await form.getAllFormsVersion(tenantCode, orgCode)
				let defaultForms = await form.getAllFormsVersion(defaults.tenantCode, defaults.orgCode)
				formsVersionData.push(...defaultForms)
			}

			const usersForms = utils.removeDefaultOrgData(formsVersionData, defaults.orgCode, 'type')

			try {
				await cacheHelper.formVersions.set(tenantCode, orgCode, usersForms)
			} catch (cacheError) {
				console.error('Failed to set form versions in cache:', cacheError)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'FORM_VERSION_FETCHED_SUCCESSFULLY',
				result: usersForms,
			})
		} catch (error) {
			return error
		}
	}
}
