const jwt = require('jsonwebtoken')
const httpStatusCode = require('@generics/http-status')
const common = require('@constants/common')
const requests = require('@generics/requests')
const endpoints = require('@constants/endpoints')
const rolePermissionMappingQueries = require('@database/queries/role-permission-mapping')
const responses = require('@helpers/responses')
const { Op } = require('sequelize')
const fs = require('fs')
const MenteeExtensionQueries = require('@database/queries/userExtension')
const utils = require('@generics/utils')
const path = require('path')
const cacheHelper = require('@generics/cacheHelper')

module.exports = async function (req, res, next) {
	try {
		const authHeader = req.get(process.env.AUTH_TOKEN_HEADER_NAME)
		let adminHeader = false
		if (process.env.ADMIN_ACCESS_TOKEN) adminHeader = req.get(process.env.ADMIN_TOKEN_HEADER_NAME)

		const isInternalAccess = common.internalAccessUrls.some((path) => {
			if (req.path.includes(path)) {
				if (req.headers.internal_access_token === process.env.INTERNAL_ACCESS_TOKEN) return true
				// throw createUnauthorizedResponse()
			}
			return false
		})

		if (isInternalAccess && !authHeader) return next()
		if (!authHeader) {
			const isPermissionValid = await checkPermissions(common.PUBLIC_ROLE, req.path, req.method)
			if (isPermissionValid) return next()
			else throw createUnauthorizedResponse('PERMISSION_DENIED')
		}

		let [decodedToken, skipFurtherChecks] = await authenticateUser(authHeader, req)

		// Path to config.json
		const configFilePath = path.resolve(__dirname, '../', 'config.json')

		// Initialize variables
		let configData = {}
		let defaultTokenExtraction = false
		req.decodedToken = {}

		// Check if config.json exists
		if (fs.existsSync(configFilePath)) {
			// Read and parse the config.json file
			const rawData = fs.readFileSync(configFilePath)
			try {
				configData = JSON.parse(rawData)
				if (!configData.authTokenUserInformation) {
					defaultTokenExtraction = true
				}
				configData = configData.authTokenUserInformation
			} catch (error) {
				console.error('Error parsing config.json:', error)
			}
		} else {
			// If file doesn't exist, set defaultTokenExtraction to true
			defaultTokenExtraction = true
		}

		let organizationKey = 'organization_id'

		// defaultTokenExtraction = true
		// performing default token data extraction
		if (defaultTokenExtraction) {
			// decodedToken[organizationKey] = getOrgId(req.headers, decodedToken, 'data.organization_ids[0]')
			// decodedToken.data[organizationKey] = decodedToken[organizationKey]

			// const resolvedRolePath = resolvePathTemplate(
			// 	'data.organizations[?organization_id={{organization_id}}].roles',
			// 	decodedToken
			// )
			// const roles = getNestedValue(decodedToken, resolvedRolePath) || []
			// decodedToken.data['roles'] = roles

			req.decodedToken = {
				...decodedToken.data,
			}
		} else {
			// Iterate through each key in the config object
			for (let key in configData) {
				if (configData.hasOwnProperty(key)) {
					let keyValue = getNestedValue(decodedToken, configData[key])
					if (key === 'id') {
						keyValue = keyValue?.toString()
					}
					if (key === organizationKey) {
						req.decodedToken[key] = getOrgId(req.headers, decodedToken, configData[key])
						continue
					}
					if (key === 'roles') {
						let orgId = getOrgId(req.headers, decodedToken, configData[organizationKey])

						// Now extract roles using fully dynamic path
						const rolePathTemplate = configData['roles']

						decodedToken[organizationKey] = orgId
						const resolvedRolePath = resolvePathTemplate(rolePathTemplate, decodedToken)
						const roles = getNestedValue(decodedToken, resolvedRolePath) || []
						req.decodedToken[key] = roles
						continue
					}

					if (key === 'organization_code') {
						let orgId = getOrgId(req.headers, decodedToken, configData[organizationKey])

						// Now extract roles using fully dynamic path
						const rolePathTemplate = configData['organization_code']

						decodedToken[organizationKey] = orgId
						const resolvedOrgPath = resolvePathTemplate(rolePathTemplate, decodedToken)
						const org = getNestedValue(decodedToken, resolvedOrgPath) || []
						req.decodedToken[key] = org
						continue
					}

					// For each key in config, assign the corresponding value from decodedToken
					req.decodedToken[key] = keyValue
				}
			}
		}

		req.decodedToken.id =
			typeof req.decodedToken?.id === 'number' ? req.decodedToken?.id?.toString() : req.decodedToken?.id
		req.decodedToken.organization_id =
			typeof req.decodedToken?.organization_id === 'number'
				? req.decodedToken?.organization_id?.toString()
				: req.decodedToken?.organization_id

		if (!req.decodedToken[organizationKey]) {
			throw createUnauthorizedResponse()
		}
		req.decodedToken.token = authHeader

		if (adminHeader) {
			if (adminHeader != process.env.ADMIN_ACCESS_TOKEN) throw createUnauthorizedResponse()
			const organizationId = req.get(process.env.ORG_ID_HEADER_NAME)

			if (!organizationId) {
				throw responses.failureResponse({
					message: {
						key: 'ADD_ORG_HEADER',
						interpolation: {
							orgIdHeader: process.env.ORG_ID_HEADER_NAME,
							adminHeader: process.env.ADMIN_TOKEN_HEADER_NAME,
						},
					},
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			req.decodedToken.organization_id = organizationId.toString()
			req.decodedToken.roles.push({ title: common.ADMIN_ROLE })
		}

		if (!skipFurtherChecks) {
			if (process.env.SESSION_VERIFICATION_METHOD === common.SESSION_VERIFICATION_METHOD.USER_SERVICE)
				await validateSession(authHeader)

			const roleValidation = common.roleValidationPaths.some((path) => req.path.includes(path))

			if (roleValidation) {
				if (process.env.AUTH_METHOD === common.AUTH_METHOD.NATIVE)
					await nativeRoleValidation(decodedToken, authHeader)
				else if (process.env.AUTH_METHOD === common.AUTH_METHOD.KEYCLOAK_PUBLIC_KEY)
					await dbBasedRoleValidation(decodedToken)
			}

			const isPermissionValid = await checkPermissions(
				req.decodedToken.roles.map((role) => role.title),
				req.path,
				req.method
			)

			if (!isPermissionValid) throw createUnauthorizedResponse('PERMISSION_DENIED')
		}

		next()
	} catch (err) {
		if (err.message === 'USER_SERVICE_DOWN') {
			err = responses.failureResponse({
				message: 'USER_SERVICE_DOWN',
				statusCode: httpStatusCode.internal_server_error,
				responseCode: 'SERVER_ERROR',
			})
		}
		console.error(err)
		next(err)
	}
}

function getOrgId(headers, decodedToken, orgConfigData) {
	if (headers['organization_id']) {
		return (orgId = headers['organization_id'].toString())
	} else {
		const orgIdPath = orgConfigData
		return (orgId = getNestedValue(decodedToken, orgIdPath)?.toString())
	}
}
function getNestedValue(obj, path) {
	const parts = path.split('.')
	let current = obj

	for (const part of parts) {
		if (!current) return undefined

		// Match conditional array access: key[?field=value]
		const conditionalMatch = part.match(/^(\w+)\[\?(\w+)=([^\]]+)\]$/)
		if (conditionalMatch) {
			const [, arrayKey, field, expected] = conditionalMatch
			const array = current[arrayKey]
			if (!Array.isArray(array)) return undefined
			current = array.find((item) => item[field]?.toString() === expected)
			continue
		}

		// Match array index: key[0]
		const indexMatch = part.match(/^(\w+)\[(\d+)\]$/)
		if (indexMatch) {
			const [, key, index] = indexMatch
			const array = current[key]
			if (!Array.isArray(array)) return undefined
			current = array[parseInt(index)]
			continue
		}

		// Simple object property
		current = current[part]
	}

	return current
}

function resolvePathTemplate(template, contextObject) {
	return template.replace(/\{\{(.*?)\}\}/g, (_, path) => {
		const value = getNestedValue(contextObject, path.trim())
		return value?.toString?.() ?? ''
	})
}

function createUnauthorizedResponse(message = 'UNAUTHORIZED_REQUEST') {
	return responses.failureResponse({
		message,
		statusCode: httpStatusCode.unauthorized,
		responseCode: 'UNAUTHORIZED',
	})
}

async function checkPermissions(roleTitle, requestPath, requestMethod) {
	const parts = requestPath.match(/[^/]+/g)
	const apiPath = getApiPaths(parts)
	const allowedPermissions = await fetchPermissions(roleTitle, apiPath, parts[2])
	return allowedPermissions.some((permission) => permission.request_type.includes(requestMethod))
}

function getApiPaths(parts) {
	const apiPath = [`/${parts[0]}/${parts[1]}/${parts[2]}/*`]
	if (parts[4]) apiPath.push(`/${parts[0]}/${parts[1]}/${parts[2]}/${parts[3]}*`)
	else
		apiPath.push(
			`/${parts[0]}/${parts[1]}/${parts[2]}/${parts[3]}`,
			`/${parts[0]}/${parts[1]}/${parts[2]}/${parts[3]}*`
		)
	return apiPath
}

async function fetchPermissions(roleTitle, apiPath, module) {
	if (Array.isArray(roleTitle) && !roleTitle.includes(common.PUBLIC_ROLE)) roleTitle.push(common.PUBLIC_ROLE)

	const roles = Array.isArray(roleTitle) ? roleTitle : [roleTitle]
	const apiPaths = Array.isArray(apiPath) ? apiPath : [apiPath]

	// Try to get cached permissions for all role-path combinations (global cache)
	const cachedPermissions = await cacheHelper.apiPermissions.getMultipleRoles(roles, module, apiPaths)

	// Check if we have all required role/path combinations cached
	const requiredKeys = new Set()
	roles.forEach((role) => {
		apiPaths.forEach((path) => requiredKeys.add(`${role}::${path}`))
	})

	const permissionsFromCache = cachedPermissions || []
	permissionsFromCache.forEach((permission) =>
		requiredKeys.delete(`${permission.role_title}::${permission.api_path}`)
	)

	// If all combinations are cached, return them
	if (requiredKeys.size === 0) {
		return permissionsFromCache
	}

	// Only query DB if there are actually missing combinations
	let dbPermissions = []
	if (requiredKeys.size > 0) {
		// Build precise filter for only the missing role-path combinations
		const filter = {
			[Op.or]: Array.from(requiredKeys).map((key) => {
				const [role, path] = key.split('::')
				return { role_title: role, module, api_path: path }
			}),
		}
		const attributes = ['request_type', 'api_path', 'module', 'role_title']
		dbPermissions = (await rolePermissionMappingQueries.findAll(filter, attributes)) || []

		// Cache the newly fetched results
		if (dbPermissions.length > 0) {
			// Extract unique API paths for caching
			const missingApiPaths = [...new Set(Array.from(requiredKeys).map((key) => key.split('::')[1]))]
			await cacheHelper.apiPermissions.setFromDatabaseResults(module, missingApiPaths, dbPermissions)
		}
	}

	// Merge cached and database results
	const allPermissions = [...permissionsFromCache, ...(dbPermissions || [])]
	return allPermissions
}

async function verifyToken(token) {
	try {
		return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
	} catch (err) {
		if (err.name === 'TokenExpiredError') throw createUnauthorizedResponse('ACCESS_TOKEN_EXPIRED')

		throw createUnauthorizedResponse()
	}
}

async function validateSession(authHeader) {
	const userBaseUrl = `${process.env.USER_SERVICE_HOST}${process.env.USER_SERVICE_BASE_URL}`
	const validateSessionEndpoint = `${userBaseUrl}${endpoints.VALIDATE_SESSIONS}`
	const reqBody = { token: authHeader }

	const isSessionActive = await requests.post(validateSessionEndpoint, reqBody, '', true)

	if (isSessionActive?.data?.responseCode === 'UNAUTHORIZED') throw createUnauthorizedResponse('ACCESS_TOKEN_EXPIRED')
	if (!isSessionActive?.success || !isSessionActive?.data?.result?.data?.user_session_active)
		throw new Error('USER_SERVICE_DOWN')
}

async function fetchUserProfile(authHeader) {
	const userBaseUrl = `${process.env.USER_SERVICE_HOST}${process.env.USER_SERVICE_BASE_URL}`
	const profileUrl = `${userBaseUrl}${endpoints.USER_PROFILE_DETAILS}`
	const user = await requests.get(profileUrl, authHeader, false)

	if (!user || !user.success) throw createUnauthorizedResponse('USER_NOT_FOUND')
	if (!user.data || !user.data.result) throw createUnauthorizedResponse('USER_NOT_FOUND')
	if (user.data.result.deleted_at !== null) throw createUnauthorizedResponse('USER_ROLE_UPDATED')
	return user.data.result
}

function isMentorRole(roles) {
	return roles.some((role) => role.title === common.MENTOR_ROLE)
}

async function dbBasedRoleValidation(decodedToken) {
	const userId = decodedToken.data.id
	const roles = decodedToken.data.roles
	const tenantCode = decodedToken.data.tenant_code
	const isMentor = isMentorRole(roles)

	const menteeExtension = await MenteeExtensionQueries.getMenteeExtension(
		userId.toString(),
		['user_id', 'is_mentor'],
		false,
		tenantCode
	)
	if (!menteeExtension) throw createUnauthorizedResponse('USER_NOT_FOUND')

	const roleMismatch = (isMentor && !menteeExtension.is_mentor) || (!isMentor && menteeExtension.is_mentor)
	if (roleMismatch) throw createUnauthorizedResponse('USER_ROLE_UPDATED')
}

function isAdminRole(roles) {
	return roles.some((role) => role.title === common.ADMIN_ROLE)
}

async function authenticateUser(authHeader, req) {
	if (!authHeader) throw createUnauthorizedResponse()

	let token
	if (process.env.IS_AUTH_TOKEN_BEARER === 'true') {
		const [authType, extractedToken] = authHeader.split(' ')
		if (authType.toLowerCase() !== 'bearer') throw createUnauthorizedResponse()
		token = extractedToken.trim()
	} else token = authHeader.trim()

	let decodedToken = null
	if (process.env.AUTH_METHOD === common.AUTH_METHOD.NATIVE) decodedToken = await verifyToken(token)
	else if (process.env.AUTH_METHOD === common.AUTH_METHOD.KEYCLOAK_PUBLIC_KEY)
		decodedToken = await keycloakPublicKeyAuthentication(token)
	if (!decodedToken) throw createUnauthorizedResponse()
	if (decodedToken.data.roles && isAdminRole(decodedToken.data.roles)) {
		req.decodedToken = decodedToken.data
		return [decodedToken, true]
	}

	return [decodedToken, false]
}

async function nativeRoleValidation(decodedToken, authHeader) {
	const userProfile = await fetchUserProfile(authHeader)
	decodedToken.data.roles = userProfile.user_roles
	decodedToken.data.organization_id = userProfile.organization_id
}

const keycloakPublicKeyPath = `${process.env.KEYCLOAK_PUBLIC_KEY_PATH}/`
const PEM_FILE_BEGIN_STRING = '-----BEGIN PUBLIC KEY-----'
const PEM_FILE_END_STRING = '-----END PUBLIC KEY-----'

const validRoles = new Set([
	common.MENTEE_ROLE,
	common.MENTOR_ROLE,
	common.ORG_ADMIN_ROLE,
	common.ADMIN_ROLE,
	common.SESSION_MANAGER_ROLE,
])

async function keycloakPublicKeyAuthentication(token) {
	try {
		const tokenClaims = jwt.decode(token, { complete: true })
		if (!tokenClaims || !tokenClaims.header) throw createUnauthorizedResponse()
		const kid = tokenClaims.header.kid
		const path = keycloakPublicKeyPath + kid.replace(/\.\.\//g, '')
		const accessKeyFile = await fs.promises.readFile(path, 'utf8')
		const cert = accessKeyFile.includes(PEM_FILE_BEGIN_STRING)
			? accessKeyFile
			: `${PEM_FILE_BEGIN_STRING}\n${accessKeyFile}\n${PEM_FILE_END_STRING}`

		const verifiedClaims = await verifyKeycloakToken(token, cert)
		const externalUserId = verifiedClaims.sub.split(':').pop()

		let isMentor = false
		let isMenteeRolePresent = false
		let roles = []

		if (verifiedClaims.user_roles) {
			const rawRoles = Array.isArray(verifiedClaims.user_roles)
				? verifiedClaims.user_roles
				: [verifiedClaims.user_roles] // wrap single string in array

			roles = rawRoles.reduce((acc, item) => {
				const role =
					typeof item === 'string'
						? item.toLowerCase()
						: item && typeof item.role === 'string'
						? item.role.toLowerCase()
						: null

				if (role && validRoles.has(role)) {
					if (role === common.MENTOR_ROLE) isMentor = true
					else if (role === common.MENTEE_ROLE) isMenteeRolePresent = true
					acc.push({ title: role })
				}

				return acc
			}, [])
		}

		if (!isMentor && !isMenteeRolePresent) roles.push({ title: common.MENTEE_ROLE })

		return {
			data: {
				id: externalUserId,
				roles: roles,
				name: verifiedClaims.name,
				organization_id: verifiedClaims.org || null,
			},
		}
	} catch (err) {
		if (err.message === 'USER_NOT_FOUND') throw createUnauthorizedResponse('USER_NOT_FOUND')
		else {
			throw createUnauthorizedResponse()
		}
	}
}

async function verifyKeycloakToken(token, cert) {
	try {
		return jwt.verify(token, cert, { algorithms: ['sha1', 'RS256', 'HS256'] })
	} catch (err) {
		if (err.name === 'TokenExpiredError') throw createUnauthorizedResponse('ACCESS_TOKEN_EXPIRED')

		throw createUnauthorizedResponse()
	}
}
