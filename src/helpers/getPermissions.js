const rolePermissionMappingQueries = require('@database/queries/role-permission-mapping')
const common = require('@constants/common')
const responses = require('@helpers/responses')
const httpStatusCode = require('@generics/http-status')
const cacheHelper = require('@generics/cacheHelper')

module.exports = class UserHelper {
	// Your other methods here

	/**
	 * Get permissions by user roles.
	 * @method
	 * @name getPermissions
	 * @param {Array} userRoles - Array of user roles.
	 * @returns {Array} - Array of mentor permissions.
	 */
	static async getPermissions(userRoles, tenantCode, orgCode) {
		try {
			const titles = userRoles.map((role) => role.title)
			let allPermissions = []

			// Try to get cached permissions for each role individually (global cache)
			const cachedPermissionsPromises = titles.map((roleTitle) => cacheHelper.permissions.get(roleTitle))
			const cachedResults = await Promise.all(cachedPermissionsPromises)

			// Check if all roles have cached permissions
			const allCached = cachedResults.every((result) => result !== null && result !== undefined)

			if (allCached) {
				// Merge all cached permissions
				const mergedPermissions = cachedResults.flat()

				// Deduplicate by module and merge request_types
				const PermissionByModules = mergedPermissions.reduce((acc, { module, request_type, service }) => {
					if (acc[module]) {
						acc[module].request_type = [...new Set([...acc[module].request_type, ...request_type])]
					} else {
						acc[module] = { module, request_type: [...request_type], service }
					}
					return acc
				}, {})

				return Object.values(PermissionByModules)
			}

			// Fetch from database if not all roles are cached
			const filter = { role_title: titles }
			const attributes = ['module', 'request_type']
			const PermissionAndModules = await rolePermissionMappingQueries.findAll(filter, attributes)
			const PermissionByModules = PermissionAndModules.reduce((PermissionByModules, { module, request_type }) => {
				if (PermissionByModules[module]) {
					PermissionByModules[module].request_type = [
						...new Set([...PermissionByModules[module].request_type, ...request_type]),
					]
				} else {
					PermissionByModules[module] = { module, request_type: [...request_type] }
				}
				return PermissionByModules
			}, {})

			allPermissions = Object.values(PermissionByModules).map(({ module, request_type }) => ({
				module,
				request_type,
				service: common.MENTORING_SERVICE,
			}))

			// Cache permissions for each individual role (global cache)
			for (const roleTitle of titles) {
				const roleFilter = { role_title: [roleTitle] }
				const rolePermissions = await rolePermissionMappingQueries.findAll(roleFilter, attributes)
				const rolePermissionsByModule = rolePermissions.reduce((acc, { module, request_type }) => {
					if (acc[module]) {
						acc[module].request_type = [...new Set([...acc[module].request_type, ...request_type])]
					} else {
						acc[module] = { module, request_type: [...request_type] }
					}
					return acc
				}, {})

				const rolePermissionsArray = Object.values(rolePermissionsByModule).map(({ module, request_type }) => ({
					module,
					request_type,
					service: common.MENTORING_SERVICE,
				}))

				await cacheHelper.permissions.set(roleTitle, rolePermissionsArray)
			}

			return allPermissions
		} catch (error) {
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'PERMISSIONS_NOT_FOUND',
				result: { permissions: [] },
			})
		}
	}
}
