/**
 * name : validators/v1/admin.js
 * author : Aman Kumar Gupta
 * created-date : 28-Oct-2025
 * Description : Validations for admin cache administration endpoints.
 */

module.exports = {
	getCacheStats: (req) => {
		// No query parameters required for cache stats
		// Admin role validation is handled in controller
	},

	clearCache: (req) => {
		// Optional query parameters for cache clearing
		req.checkQuery('namespace')
			.optional()
			.isIn([
				'sessions',
				'entityTypes',
				'forms',
				'organizations',
				'mentor',
				'mentee',
				'platformConfig',
				'notificationTemplates',
				'displayProperties',
				'permissions',
				'apiPermissions',
			])
			.withMessage('INVALID_NAMESPACE')

		req.checkQuery('tenant_code').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_TENANT_CODE')
		req.checkQuery('org_id').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_ORG_ID')
	},

	warmUpCache: (req) => {
		// Optional query parameters for cache warm up
		req.checkQuery('tenant_code').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_TENANT_CODE')
		req.checkQuery('org_id').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_ORG_ID')
	},

	getCacheHealth: (req) => {
		// No query parameters required for cache health check
		// Admin role validation is handled in controller
	},

	userDelete: (req) => {
		// Existing userDelete validation
		req.checkQuery('userId').notEmpty().withMessage('USER_ID_REQUIRED')
	},

	triggerViewRebuild: (req) => {
		// No validation needed - handled in controller
	},

	triggerPeriodicViewRefresh: (req) => {
		req.checkQuery('tenant_code').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_TENANT_CODE')
		req.checkQuery('model_name').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_MODEL_NAME')
	},

	triggerViewRebuildInternal: (req) => {
		// No validation needed - internal endpoint
	},

	triggerPeriodicViewRefreshInternal: (req) => {
		req.checkQuery('tenant_code').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_TENANT_CODE')
		req.checkQuery('model_name').optional().isLength({ min: 1, max: 255 }).withMessage('INVALID_MODEL_NAME')
	},
}
