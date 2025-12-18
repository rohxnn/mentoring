/**
 * Cache Key Generation Utilities
 * Provides standardized tenant-aware cache key generation for all namespaces
 */

/**
 * Generate base tenant-organization key pattern
 * @param {string} tenantCode - Tenant code for isolation
 * @param {string} orgCode - Organization code
 * @param {string} namespace - Cache namespace (sessions, mentor, etc.)
 * @returns {string} Base cache key
 */
const generateBaseKey = (tenantCode, orgCode, namespace) => {
	if (!tenantCode || !orgCode || !namespace) {
		throw new Error('tenantCode, orgCode, and namespace are required for cache key generation')
	}
	return `tenant:${tenantCode}:org:${orgCode}:${namespace}`
}

/**
 * Generate session cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:sessions:${id}
 */
const generateSessionKey = (tenantCode, orgCode, sessionId) => {
	return `${generateBaseKey(tenantCode, orgCode, 'sessions')}:${sessionId}`
}

/**
 * Generate entity type cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:model:${modelName}:entityTypes:${value}
 */
const generateEntityTypeKey = (tenantCode, orgCode, modelName, value) => {
	return `${generateBaseKey(tenantCode, orgCode, 'model')}:${modelName}:entityTypes:${value}`
}

/**
 * Generate forms cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:forms:${type}:${subtype}
 */
const generateFormKey = (tenantCode, orgCode, type, subtype) => {
	return `${generateBaseKey(tenantCode, orgCode, 'forms')}:${type}:${subtype}`
}

/**
 * Generate organization cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:organizations:${id}
 */
const generateOrganizationKey = (tenantCode, orgCode, orgId) => {
	return `${generateBaseKey(tenantCode, orgCode, 'organizations')}:${orgId}`
}

/**
 * Generate mentor cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:mentor:${id}
 */
const generateMentorKey = (tenantCode, orgCode, mentorId) => {
	return `${generateBaseKey(tenantCode, orgCode, 'mentor')}:${mentorId}`
}

/**
 * Generate mentee cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:mentee:${id}
 */
const generateMenteeKey = (tenantCode, orgCode, menteeId) => {
	return `${generateBaseKey(tenantCode, orgCode, 'mentee')}:${menteeId}`
}

/**
 * Generate platform config cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:platformConfig
 */
const generatePlatformConfigKey = (tenantCode, orgCode) => {
	return `${generateBaseKey(tenantCode, orgCode, 'platformConfig')}`
}

/**
 * Generate notification template cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:templateCode:${code}
 */
const generateNotificationTemplateKey = (tenantCode, orgCode, templateCode) => {
	return `${generateBaseKey(tenantCode, orgCode, 'templateCode')}:${templateCode}`
}

/**
 * Generate display properties cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:displayProperties
 */
const generateDisplayPropertiesKey = (tenantCode, orgCode) => {
	return `${generateBaseKey(tenantCode, orgCode, 'displayProperties')}`
}

/**
 * Generate permissions cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:permissions:${role}
 */
const generatePermissionsKey = (tenantCode, orgCode, role) => {
	return `${generateBaseKey(tenantCode, orgCode, 'permissions')}:${role}`
}

/**
 * Generate API permissions cache key
 * Pattern: tenant:${tenantCode}:org:${orgCode}:apiPermissions:role:${role}:module:${module}:api_path:${apiPath}
 */
const generateApiPermissionsKey = (tenantCode, orgCode, role, module, apiPath) => {
	// Sanitize apiPath for use in cache key
	const sanitizedApiPath = apiPath.replace(/[/:]/g, '_')
	return `${generateBaseKey(
		tenantCode,
		orgCode,
		'apiPermissions'
	)}:role:${role}:module:${module}:api_path:${sanitizedApiPath}`
}

/**
 * Generate namespace pattern key for bulk operations
 * Pattern: tenant:${tenantCode}:org:${orgCode}:${namespace}:*
 */
const generateNamespacePattern = (tenantCode, orgCode, namespace) => {
	return `${generateBaseKey(tenantCode, orgCode, namespace)}:*`
}

/**
 * Extract tenant and org codes from cache key
 * @param {string} cacheKey - Full cache key
 * @returns {object} Object with tenantCode and orgCode
 */
const extractTenantOrgFromKey = (cacheKey) => {
	const keyParts = cacheKey.split(':')
	if (keyParts.length < 4 || keyParts[0] !== 'tenant' || keyParts[2] !== 'org') {
		throw new Error('Invalid cache key format')
	}
	return {
		tenantCode: keyParts[1],
		orgCode: keyParts[3],
	}
}

/**
 * Validate cache key format
 * @param {string} cacheKey - Cache key to validate
 * @returns {boolean} True if valid
 */
const validateCacheKey = (cacheKey) => {
	try {
		const { tenantCode, orgCode } = extractTenantOrgFromKey(cacheKey)
		return !!(tenantCode && orgCode)
	} catch {
		return false
	}
}

module.exports = {
	generateBaseKey,
	generateSessionKey,
	generateEntityTypeKey,
	generateFormKey,
	generateSessionRequestKey,
	generateOrganizationKey,
	generateMentorKey,
	generateMenteeKey,
	generatePlatformConfigKey,
	generateNotificationTemplateKey,
	generateDisplayPropertiesKey,
	generatePermissionsKey,
	generateApiPermissionsKey,
	generateNamespacePattern,
	extractTenantOrgFromKey,
	validateCacheKey,
}
