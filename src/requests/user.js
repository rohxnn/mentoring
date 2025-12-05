/**
 * name : user.js
 * author : Vishnu
 * created-date : 27-Sept-2023
 * Description : Internal calls to elevate-user service.
 */

// Dependencies
const userBaseUrl = process.env.USER_SERVICE_HOST + process.env.USER_SERVICE_BASE_URL
const requests = require('@generics/requests')
const endpoints = require('@constants/endpoints')
const request = require('request')
const httpStatusCode = require('@generics/http-status')
const responses = require('@helpers/responses')
const common = require('@constants/common')
const { Op } = require('sequelize')
const cacheHelper = require('@generics/cacheHelper')
const usersHelper = require('@helpers/users')

const menteeQueries = require('@database/queries/userExtension')
const organisationExtensionQueries = require('@database/queries/organisationExtension')
// Removed cacheHelper to break circular dependency with getDefaultOrgId

const emailEncryption = require('@utils/emailEncryption')

/**
 * @method fetchOrgDetails
 * @description Fetches details of an organization from an external API based on provided parameters.
 *
 * This function takes either an `organizationId` or `organizationCode` and fetches the corresponding organization details.
 * the details from an external service. The function handles both types of requests and returns the appropriate response.
 *
 * @param {object} params - The parameters for fetching organization details.
 * @param {string} [params.organizationCode] - The organization code for identifying the organization.
 * @param {string} [params.organizationId] - The organization ID for identifying the organization.
 * @returns {Promise<object>} - A promise that resolves to the organization details.
 *
 * @example
 * const organizationId = 'org123';
 * fetchOrgDetails({ organizationId })
 *   .then(response => console.log(response))
 *   .catch(error => console.error(error));

 */

const fetchOrgDetails = async function ({ organizationCode, organizationId, tenantCode }) {
	try {
		let orgReadUrl
		if (organizationId)
			orgReadUrl = `${userBaseUrl}${endpoints.ORGANIZATION_READ}?organisation_id=${organizationId}`
		else if (organizationCode)
			orgReadUrl = `${userBaseUrl}${endpoints.ORGANIZATION_READ}?organisation_code=${organizationCode}`

		if (tenantCode) {
			orgReadUrl += `&tenant_code=${tenantCode}`
		}

		const internalToken = true
		const orgDetails = await requests.get(orgReadUrl, '', internalToken)

		return orgDetails
	} catch (error) {
		console.error('Error fetching organization details:', error)
		throw error
	}
}

/**
 * @method getOrgDetails
 * @description Fetches details of an organization from the database.
 *
 * This function takes either an `organizationId`  fetches the corresponding organization details.
 *
 * @param {object} params - The parameters for fetching organization details.
 * @param {string} [params.organizationId] - The organization ID for identifying the organization.
 * @returns {Promise<object>} - A promise that resolves to the organization details.
 *
 * @example
 * const organizationId = 'org123';
 * getOrgDetails({ organizationId })
 *   .then(response => console.log(response))
 *   .catch(error => console.error(error));

 */

const getOrgDetails = async function ({ organizationId, tenantCode }) {
	try {
		// Try to use cache first, but handle circular dependency by lazy loading cacheHelper
		let organizationDetails = null

		try {
			// Get full organization data (includes organization_code for cache key)
			organizationDetails = await organisationExtensionQueries.findOne(
				{ organization_id: organizationId },
				tenantCode
			)

			// If we got the data, populate the cache for future use
			if (organizationDetails?.organization_code) {
				try {
					await cacheHelper.organizations.set(
						tenantCode,
						organizationDetails.organization_code,
						organizationId,
						organizationDetails
					)
				} catch (setCacheError) {
					console.warn('Failed to cache organization details:', setCacheError.message)
				}
			}
		} catch (dbError) {
			console.error('Database lookup failed for organization details:', dbError.message)
			throw dbError
		}

		return {
			success: true,
			data: {
				result: organizationDetails,
			},
		}
	} catch (error) {
		console.error('Error fetching organization details:', error)
		throw error
	}
}

/**
 * User profile details.
 * @method
 * @name details
 * @param {String} [token =  ""] - token information.
 * @param {String} [userId =  ""] - user id.
 * @returns {JSON} - User profile details.
 */

const validRoles = new Set([
	common.MENTEE_ROLE,
	common.MENTOR_ROLE,
	common.ORG_ADMIN_ROLE,
	common.ADMIN_ROLE,
	common.SESSION_MANAGER_ROLE,
])

/**
 * @method fetchUserDetails
 * @description Fetches user details based on the provided `userId`. It can either retrieve the details from the database or
 * an external API, depending on the value of `db`. Additionally, it processes user roles and image URLs.
 *
 * This function fetches user details using a given `userId`. it fetches the details from an external API.
 *
 * @param {object} params - The parameters for fetching user details.
 * @param {string} params.token - The authentication token required for API requests.
 * @param {string} params.userId - The user ID to fetch details for.
 * @returns {Promise<object>} - A promise that resolves to the user details, with roles and images processed.
 *
 * @example
 * const token = 'user-auth-token';
 * const userId = '12345';
 * fetchUserDetails({ token, userId })


 */

const fetchUserDetails = async ({ token, userId, tenantCode }) => {
	try {
		const isTenantScoped = Boolean(tenantCode)
		if (isTenantScoped && !userId) {
			throw new Error('fetchUserDetails: tenantCode requires userId')
		}
		let profileUrl = `${userBaseUrl}${
			isTenantScoped ? endpoints.USER_PROFILE_DETAILS_INTERNAL : endpoints.USER_PROFILE_DETAILS
		}`
		if (userId) profileUrl += `/${userId}`
		if (isTenantScoped) profileUrl += `?tenant_code=${encodeURIComponent(tenantCode)}`

		if (tenantCode) {
			profileUrl += `?tenant_code=${tenantCode}`
		}

		const isInternalTokenRequired = true
		const userDetails = await requests.get(profileUrl, token, isInternalTokenRequired)
		userDetails.data = userDetails.data || {}
		userDetails.data.result = userDetails.data.result || {}
		// userDetails.data.result.user_roles = userDetails.data.result.user_roles || [{ title: common.MENTEE_ROLE }]

		let isMentor = false
		let isMenteeRolePresent = false

		const rawRoles = userDetails?.data?.result?.user_roles ||
			userDetails?.data?.result?.organizations?.[0]?.roles || [{ title: common.MENTEE_ROLE }]

		const roles = rawRoles.reduce((acc, role) => {
			if (validRoles.has(role.title)) {
				if (role.title === common.MENTOR_ROLE) isMentor = true
				else if (role.title === common.MENTEE_ROLE) isMenteeRolePresent = true
				acc.push(role)
			}
			return acc
		}, [])

		if (!isMentor && !isMenteeRolePresent) roles.push({ title: common.MENTEE_ROLE })
		userDetails.data.result.user_roles = roles

		const orgId = userDetails?.data?.result?.organization_id ?? userDetails?.data?.result?.organizations?.[0]?.id

		if (orgId !== undefined && orgId !== null) {
			userDetails.data.result.organization_id = orgId.toString()
		}

		return userDetails
	} catch (error) {
		console.error(error)
		throw error
	}
}

/**
 * @method getUserDetails
 * @description Fetches user details based on the provided `userId`. It  retrieve the details from the database. Additionally, it processes user roles and image URLs.
 *
 * This function fetches user details using a given `userId`. , it queries the database and adds roles
 * (`MENTEE_ROLE` and `MENTOR_ROLE`) to the user object.
 *
 * @param {string} userId - The user ID to fetch details for.
 * @returns {Promise<object>} - A promise that resolves to the user details, with roles and images processed.
 *
 * @example
 * const token = 'user-auth-token';
 * const userId = '12345';
 * getUserDetails( userId)


 */

const getUserDetails = async (userId, tenantCode) => {
	try {
		// Only pass tenantCode if it exists
		const userDetails = await menteeQueries.getMenteeExtension(userId, [], false, tenantCode)

		if (!userDetails) {
			return {
				data: {
					result: null,
				},
			}
		}

		if (userDetails.image) {
			const downloadImageResponse = await getDownloadableUrl(userDetails.image)
			userDetails.image = downloadImageResponse.result
		}

		userDetails.user_roles = [{ title: common.MENTEE_ROLE }]
		if (userDetails.is_mentor) {
			userDetails.user_roles.push({ title: common.MENTOR_ROLE })
		}

		if (userDetails.email) {
			userDetails.email = await emailEncryption.decrypt(userDetails.email)
		}

		let response = {
			data: {
				result: userDetails,
			},
		}

		return response
	} catch (error) {
		console.error(error)
		throw error
	}
}

/**
 * @method getListOfUserDetails
 * @description Fetches a list of user details by user IDs, either from the database or via an external API.
 *
 * This function retrieves user details by their user IDs. It can either query the database
 * to fetch user and organization data or call an external API endpoint based on the `db` parameter.
 * It enriches the user details with roles and organization info and resolves the result as a response.
 * If `excludeDeletedRecords` is true, it excludes deleted records from the API call.
 *
 * @param {Array<string>} userIds - An array of user IDs whose details are to be fetched.
 * @param {boolean} [excludeDeletedRecords=false] - Flag to exclude deleted records from the API response.
 * @returns {Promise<object>} - A promise that resolves to an object containing the list of user details.
 *
 * @example
 * const userIds = ['user1', 'user2'];
 * getListOfUserDetails(userIds)


 */

const getListOfUserDetails = function (userIds, excludeDeletedRecords = false, tenantCode = null) {
	return new Promise(async (resolve, reject) => {
		const options = {
			headers: {
				'Content-Type': 'application/json',
				internal_access_token: process.env.INTERNAL_ACCESS_TOKEN,
			},
			form: {
				userIds,
			},
		}

		let apiUrl = userBaseUrl + endpoints.LIST_ACCOUNTS
		if (excludeDeletedRecords) apiUrl = userBaseUrl + endpoints.LIST_ACCOUNTS + '?exclude_deleted_records=true'
		if (tenantCode) {
			apiUrl += excludeDeletedRecords ? '&' : '?'
			apiUrl += `tenant_code=${tenantCode}`
		}
		try {
			request.get(apiUrl, options, callback)
			function callback(err, data) {
				if (err) {
					reject({
						message: 'USER_SERVICE_DOWN',
					})
				} else {
					data.body = JSON.parse(data.body)
					return resolve(data.body)
				}
			}
		} catch (error) {
			return reject(error)
		}
	})
}

/**
 * @method getListOfUserDetailsByEmail
 * @description Fetches a list of user IDs based on provided email addresses, either from the database or via an external API.
 *
 * This function retrieves user details by their email addresses. It can either query the database
 * to fetch the encrypted email IDs and map them to user records, or it can call an external API to validate the emails.
 * The function returns an array of user IDs that correspond to the provided email addresses.
 *
 * @param {Array<string>} emailIds - An array of email addresses to fetch user details for.
 * @returns {Promise<object>} - A promise that resolves to an object containing a list of user IDs corresponding to the email addresses.
 *
 * @example
 * const emailIds = ['user1@example.com', 'user2@example.com'];
 * getListOfUserDetailsByEmail(emailIds, true)


 */

const getListOfUserDetailsByEmail = function (emailIds, tenantCode) {
	return new Promise(async (resolve, reject) => {
		try {
			const encryptedEmailIds = emailIds.map((email) => {
				if (typeof email !== 'string') {
					throw new TypeError('Each email ID must be a string.')
				}
				return emailEncryption.encrypt(email)
			})

			const userDetails = await menteeQueries.getUsersByEmailIds(encryptedEmailIds, tenantCode)

			let ids = []

			if (userDetails && userDetails.length > 0) {
				userDetails.map((users) => {
					ids.push(users.user_id)
				})
			}

			const response = {
				result: ids,
			}
			return resolve(response)
		} catch (error) {
			reject(error)
		}
	})
}

/**
 * Share a mentor Profile.
 * @method
 * @name share
 * @param {String} profileId - Profile id.
 * @returns {JSON} - Shareable profile link.
 */

const share = function (profileId) {
	return new Promise(async (resolve, reject) => {
		const apiUrl = userBaseUrl + endpoints.SHARE_MENTOR_PROFILE + '/' + profileId
		try {
			let shareLink = await requests.get(apiUrl, false, true)
			if (shareLink.data.responseCode === 'CLIENT_ERROR') {
				return resolve(
					responses.failureResponse({
						message: shareLink.data.message,
						statusCode: httpStatusCode.bad_request,
						responseCode: 'CLIENT_ERROR',
					})
				)
			}
			return resolve(
				responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: shareLink.data.message,
					result: shareLink.data.result,
				})
			)
		} catch (error) {
			reject(error)
		}
	})
}

/**
 * @method list
 * @description Fetches a list of users from the database
 *
 * This function retrieves a paginated list of users based on the provided filters, including `userType`,
 * `pageNo`, `pageSize`, and an optional `searchText`.
 *
 * @param {string} userType - The type of users to retrieve (e.g., 'mentor', 'mentee').
 * @param {number} pageNo - The page number to fetch.
 * @param {number} pageSize - The number of records per page.
 * @param {string} [searchText] - Optional search text to filter users.
 * @returns {Promise<object>} - A promise that resolves to an object containing the list of users.
 *
 * @example
 * const userType = 'mentor';
 * const pageNo = 1;
 * const pageSize = 10;
 * const searchText = 'john';
 * list(userType, pageNo, pageSize, searchText)


 */

const list = function (userType, pageNo, pageSize, searchText, tenantCode) {
	return new Promise(async (resolve, reject) => {
		try {
			const filter = {
				query: '',
				replacements: {},
			}

			// Add conditions to the filter based on userType or searchText
			if (userType) {
				filter.query += `is_mentor = :is_mentor `
				filter.replacements.is_mentor = userType.toLowerCase() === common.MENTOR_ROLE ? true : false
			}

			const userDetails = await menteeQueries.getAllUsers(
				[],
				pageNo,
				pageSize,
				filter,
				(saasFilter = ''),
				(additionalProjectionClause = `name,email,organization_id`),
				(returnOnlyUserId = false),
				searchText ? searchText : '',
				(defaultFilter = ''),
				tenantCode
			)

			let foundKeys = {}
			let result = []

			/* Required to resolve all promises first before preparing response object else sometime 
				it will push unresolved promise object if you put this logic in below for loop */

			if (userDetails.count == 0) {
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'USER_LIST',
					result: {
						data: [],
						count: 0,
					},
				})
			}

			await Promise.all(
				userDetails.data.map(async (user) => {
					if (user.image) {
						const downloadImageResponse = await getDownloadableUrl(user.image)
						user.image = downloadImageResponse.result
					}
					return user
				})
			)

			for (let user of userDetails.data) {
				let firstChar = user.name.charAt(0)
				firstChar = firstChar.toUpperCase()

				if (!foundKeys[firstChar]) {
					result.push({
						key: firstChar,
						values: [user],
					})
					foundKeys[firstChar] = result.length
				} else {
					let index = foundKeys[firstChar] - 1
					result[index].values.push(user)
				}
			}

			const sortedData = _.sortBy(result, 'key') || []

			return resolve({
				result: {
					data: sortedData,
				},
			})
		} catch (error) {
			return reject(error)
		}
	})
}

/**
 * User Role list.
 * @method
 * @name defaultList
 * @param {Number} page - page No.
 * @param {Number} limit - page limit.
 * @param {String} search - search field.
 * @returns {JSON} - List of roles
 */

const getListOfUserRoles = async (page, limit, search) => {
	const options = {
		headers: {
			'Content-Type': 'application/json',
			internal_access_token: process.env.INTERNAL_ACCESS_TOKEN,
		},
		json: true,
	}

	const apiUrl = userBaseUrl + endpoints.USERS_ROLE_LIST + `?page=${page}&limit=${limit}&search=${search}`

	try {
		const data = await new Promise((resolve, reject) => {
			request.get(apiUrl, options, (err, response) => {
				if (err) {
					reject({
						message: 'USER_SERVICE_DOWN',
						error: err,
					})
				} else {
					try {
						resolve(response.body)
					} catch (parseError) {
						reject({
							message: 'Failed to parse JSON response',
							error: parseError,
						})
					}
				}
			})
		})

		return data
	} catch (error) {
		throw error
	}
}

/**
 * User list.
 * @method
 * @name list
 * @param {Boolean} userType - mentor/mentee.
 * @param {Number} page - page No.
 * @param {Number} limit - page limit.
 * @param {String} search - search field.
 * @returns {JSON} - List of users
 */

const listWithoutLimit = function (userType, searchText) {
	return new Promise(async (resolve, reject) => {
		try {
			const apiUrl = userBaseUrl + endpoints.USERS_LIST + '?type=' + userType + '&search=' + searchText
			const userDetails = await requests.get(apiUrl, false, true)

			return resolve(userDetails)
		} catch (error) {
			return reject(error)
		}
	})
}
const search = function (userType, pageNo, pageSize, searchText, userServiceQueries) {
	let userSearchBody = {}
	// queryParams to search in user service. Like user_ids , name , email etc...
	if (userServiceQueries) {
		for (const [key, value] of Object.entries(userServiceQueries)) {
			userSearchBody[key] = value
		}
	}
	return new Promise(async (resolve, reject) => {
		try {
			const apiUrl =
				userBaseUrl +
				endpoints.SEARCH_USERS +
				'?type=' +
				userType +
				'&page=' +
				pageNo +
				'&limit=' +
				pageSize +
				'&search=' +
				searchText
			const userDetails = await requests.post(apiUrl, { ...userSearchBody }, '', true)

			return resolve(userDetails)
		} catch (error) {
			return reject(error)
		}
	})
}

// const listOrganization = function (organizationIds = []) {
// 	return new Promise(async (resolve, reject) => {
// 		try {
// 			const apiUrl = userBaseUrl + endpoints.ORGANIZATION_LIST
// 			const organizations = await requests.post(apiUrl, { organizationIds }, '', true)

// 			return resolve(organizations)
// 		} catch (error) {
// 			return reject(error)
// 		}
// 	})
// }

/**
 * @method listOrganization
 * @description Fetches organization details based on provided organization IDs, either from the database or an external API.
 *
 * This function retrieves details of organizations by their IDs. To fetch
 * organization details an external API call will happen to the details
 *
 * @param {Array<string>} organizationIds - An array of organization IDs to fetch details for.
 * @returns {Promise<object>} - A promise that resolves to an object containing the organization details.
 *
 * @example
 * const organizationIds = ['org1', 'org2'];
 * listOrganization(organizationIds)


 */

const listOrganization = function (organizationIds = []) {
	return new Promise(async (resolve, reject) => {
		const options = {
			headers: {
				'Content-Type': 'application/json',
				internal_access_token: process.env.INTERNAL_ACCESS_TOKEN,
			},
			form: {
				organizationIds,
			},
		}

		const apiUrl = userBaseUrl + endpoints.ORGANIZATION_LIST
		try {
			request.get(apiUrl, options, callback)
			let result = {
				success: true,
			}
			function callback(err, data) {
				if (err) {
					result.success = false
				} else {
					response = JSON.parse(data.body)
					result.data = response
				}
				return resolve(result)
			}
		} catch (error) {
			return reject(error)
		}
	})
}

/**
 * @method organizationList
 * @description Fetches organization details based on provided organization IDs, either from the database or an external API.
 *
 * This function retrieves details of organizations by their IDs from the db
 *
 * @param {Array<string>} organizationIds - An array of organization IDs to fetch details for.
 * @returns {Promise<object>} - A promise that resolves to an object containing the organization details.
 *
 * @example
 * const organizationIds = ['org1', 'org2'];
 * organizationList(organizationIds)


 */

const organizationList = function (organizationCodes = [], tenantCodes = []) {
	return new Promise(async (resolve, reject) => {
		try {
			// Try to get cached organizations first
			const cachedOrgs = []
			const missingOrgCodes = []

			// Check cache for each org code and tenant code combination
			for (const orgCode of organizationCodes) {
				for (const tenantCode of tenantCodes) {
					let foundInCache = false
					try {
						// We need organizationId to get from cache, but we only have orgCode
						// So we'll fetch from database and cache the results
						foundInCache = false
					} catch (cacheError) {
						foundInCache = false
					}

					if (!foundInCache) {
						missingOrgCodes.push({ orgCode, tenantCode })
					}
				}
			}

			// Fetch organization details from database
			const filter = {
				organization_code: {
					[Op.in]: Array.from(organizationCodes),
				},
				tenant_code: {
					[Op.in]: Array.from(tenantCodes),
				},
			}

			const organizationDetails = await organisationExtensionQueries.findAll(filter, {
				attributes: ['name', 'organization_id', 'organization_code', 'tenant_code'],
			})

			// Cache the fetched organizations for future use
			if (organizationDetails && organizationDetails.length > 0) {
				const cachePromises = []

				organizationDetails.forEach((orgInfo) => {
					orgInfo.id = orgInfo.organization_code

					// Organization caching removed to break circular dependency
				})

				try {
					await Promise.all(cachePromises)
					console.log(`💾 Cached ${organizationDetails.length} organizations from organizationList`)
				} catch (cacheError) {
					console.error(`❌ Some organizations failed to cache in organizationList:`, cacheError)
				}
			}

			return resolve({
				responseCode: httpStatusCode.ok,
				message: 'ORGANIZATION_FETCHED_SUCCESSFULLY',
				success: true,
				data: {
					result: organizationDetails,
				},
			})
		} catch (error) {
			return reject(error)
		}
	})
}

/**
 * @method getDownloadableUrl
 * @description Retrieves the downloadable URL for a given file path. If the path is already a valid URL, it returns it directly.
 * Otherwise, it constructs a URL to fetch the downloadable link from an external API.
 *
 * This function checks if the provided `path` is already a valid URL (starting with `http`). If so, it resolves with the URL.
 * Otherwise, it constructs an API request to get a downloadable URL for the file path.
 *
 * @param {string} path - The file path or URL to retrieve a downloadable URL for.
 * @returns {Promise<object|string>} - A promise that resolves to the downloadable URL (either the provided URL or fetched from the API).
 *
 * @example
 * const filePath = 'images/profile.png';
 * getDownloadableUrl(filePath)


 */

const getDownloadableUrl = function (path) {
	return new Promise(async (resolve, reject) => {
		if (/^http/i.test(path)) {
			return resolve({ result: path })
		} else {
			const options = {
				headers: {
					'Content-Type': 'application/json',
					internal_access_token: process.env.INTERNAL_ACCESS_TOKEN,
				},
			}

			let apiUrl = userBaseUrl + endpoints.DOWNLOAD_IMAGE_URL + '?filePath=' + path
			try {
				request.get(apiUrl, options, callback)
				function callback(err, data) {
					if (err) {
						reject({
							message: 'USER_SERVICE_DOWN',
						})
					} else {
						data.body = JSON.parse(data.body)
						return resolve(data.body)
					}
				}
			} catch (error) {
				return reject(error)
			}
		}
	})
}

/**
 * @method getUserDetailedList
 * @description Fetches a list of user details by user IDs, either from the database or via an external API.
 *
 * This function retrieves user details by their user IDs. It can either query the database
 * to fetch user and organization data or call an external API endpoint based on the `db` parameter.
 * It enriches the user details with roles and organization info and resolves the result as a response.
 * If `excludeDeletedRecords` is true, it excludes deleted records from the API call.
 *
 * @param {Array<string>} userIds - An array of user IDs whose details are to be fetched.
 * @returns {Promise<object>} - A promise that resolves to an object containing the list of user details.
 *
 * @example
 * const userIds = ['user1', 'user2'];
 * getUserDetailedList(userIds)


 */

const getUserDetailedList = function (userIds, tenantCode, deletedUsers = false, unscopped = false) {
	return new Promise(async (resolve, reject) => {
		try {
			// Fetch user details
			if (userIds.length == 0) {
				return resolve({
					result: [],
				})
			}

			let options = {}
			if (deletedUsers) {
				options = { paranoid: false }
			}
			const userDetails = await menteeQueries.getUsersByUserIds(userIds, options, tenantCode, unscopped)

			// Extract unique organization IDs and create a mapping for organization details
			const organizationIds = new Set()
			const orgDetails = {}

			if (userDetails && userDetails.length > 0) {
				userDetails.forEach((user) => {
					organizationIds.add(user.organization_id)
				})
			}
			// Fetch organization details
			const filter = {
				organization_id: {
					[Op.in]: Array.from(organizationIds),
				},
			}

			const organizationDetails = await organisationExtensionQueries.findAll(filter, tenantCode, {
				attributes: ['name', 'organization_id', 'organization_code'],
			})

			// Cache organization details for future use and map for quick access
			const cachePromises = []
			organizationDetails.forEach((org) => {
				orgDetails[org.organization_id] = org

				// Organization caching removed to break circular dependency
			})

			// Cache organizations in parallel without blocking the main response
			if (cachePromises.length > 0) {
				Promise.all(cachePromises)
					.then(() => {
						console.log(`💾 Cached ${cachePromises.length} organizations from getUserDetailedList`)
					})
					.catch((cacheError) => {
						console.error(`❌ Some organizations failed to cache in getUserDetailedList:`, cacheError)
					})
			}

			// Enrich user details with roles and organization info
			await Promise.all(
				userDetails.map(async function (user) {
					if (user.deleted_at) return user
					if (user.email) {
						let decryptedEmail = await emailEncryption.decryptAndValidate(user.email)
						if (decryptedEmail) {
							user.email = decryptedEmail
						}
					}

					if (user.image) {
						const downloadImageResponse = await getDownloadableUrl(user.image)
						user.image = downloadImageResponse.result
					}

					user.user_roles = [{ title: common.MENTEE_ROLE }]
					if (user.is_mentor) {
						user.user_roles.push({ title: common.MENTOR_ROLE })
					}
					user.organization = orgDetails[user.organization_id] || null // Handle potential missing org

					return user
				})
			)

			const response = {
				result: userDetails,
			}

			return resolve(response)
		} catch (error) {
			return reject(error)
		}
	})
}

const getUserDetailedListUsingCache = async function (usersMap, tenantCode, deletedUsers = false, unscopped = false) {
	try {
		// Empty input short-circuit
		if (!usersMap || !Array.isArray(usersMap) || usersMap.length === 0) {
			return { result: [] }
		}

		let options = deletedUsers ? { paranoid: false } : {}

		// Get user data: cached + missing list
		const usersInfo = await usersHelper.getMissingUserIdsAndCacheData(usersMap, tenantCode)

		let userDetails = [...(usersInfo.cacheFoundData || [])]

		// Fetch missing user records from DB
		if (usersInfo.missingUserIds.length > 0) {
			const usersFromDb = await menteeQueries.getUsersByUserIds(
				usersInfo.missingUserIds,
				options,
				tenantCode,
				true
			)
			userDetails.push(...usersFromDb)
		}

		// ---- Organization Mapping ----
		const organizations = [
			...new Map(
				userDetails.map((u) => [
					u.organization_id,
					{ organization_id: u.organization_id, organization_code: u.organization_code },
				])
			).values(),
		]

		const orgDetails = {}
		const missingOrgInfoInCache = []

		const cacheResults = await Promise.all(
			organizations.map(async (org) => ({
				org,
				orgCachedData: await cacheHelper.organizations.get(
					tenantCode,
					org.organization_code,
					org.organization_id
				),
			}))
		)

		for (const { org, orgCachedData } of cacheResults) {
			if (orgCachedData) {
				orgDetails[org.organization_id] = {
					name: orgCachedData.name,
					organization_id: orgCachedData.organization_id,
					organization_code: orgCachedData.organization_code,
				}
			} else {
				missingOrgInfoInCache.push(org)
			}
		}

		// Fetch missing organization records
		if (missingOrgInfoInCache.length > 0) {
			const organizationDetails = await organisationExtensionQueries.findAll(
				{
					organization_id: { [Op.in]: missingOrgInfoInCache.map((i) => i.organization_id) },
					organization_code: { [Op.in]: missingOrgInfoInCache.map((i) => i.organization_code) },
				},
				tenantCode,
				{ attributes: ['name', 'organization_id', 'organization_code'] }
			)

			organizationDetails.forEach((org) => {
				orgDetails[org.organization_id] = org
			})
		}

		// ---- Enrich Users ----
		await Promise.all(
			userDetails.map(async (user) => {
				if (!user.deleted_at && user.email) {
					user.email = await emailEncryption.decryptAndValidate(user.email)
				}

				if (user.image) {
					const downloadImageResponse = await getDownloadableUrl(user.image)
					user.image = downloadImageResponse.result
				}

				user.user_roles = [{ title: common.MENTEE_ROLE }]
				if (user.is_mentor) user.user_roles.push({ title: common.MENTOR_ROLE })

				user.organization = orgDetails[user.organization_id] || null

				return user
			})
		)

		return { result: userDetails }
	} catch (error) {
		console.error('[getUserDetailedListUsingCache] Error:', error)
		throw error
	}
}

const getProfileDetails = async ({ tenantCode, userId }) => {
	try {
		let profileUrl = `${userBaseUrl}${endpoints.GET_PROFILE_BY_ID}`

		profileUrl += `/${userId}?tenant_code=${tenantCode}`

		const userDetails = await requests.get(profileUrl, '', true)

		return userDetails
	} catch (error) {
		console.error(error)
		throw error
	}
}

/**
 * Get tenant domain by tenant code
 * @method
 * @name getTenantDomain
 * @param {String} tenantCode - tenant code
 * @returns {String} - domain for the tenant
 */
const getTenantDomain = async (tenantCode) => {
	try {
		if (!tenantCode) {
			throw new Error('TENANT_CODE_REQUIRED')
		}

		const apiUrl = `${userBaseUrl}/tenant/domain/${tenantCode}`
		const internalToken = true
		const domainResponse = await requests.get(apiUrl, '', internalToken)

		if (domainResponse && domainResponse.success && domainResponse.data?.result?.domain) {
			return domainResponse.data.result.domain
		} else {
			throw new Error('TENANT_DOMAIN_NOT_FOUND')
		}
	} catch (error) {
		throw error
	}
}

const getTenantList = async () => {
	try {
		// Fix: Ensure correct URL construction for internal API call
		// USER_SERVICE_BASE_URL might be undefined, so construct the correct path
		const baseUrl = process.env.USER_SERVICE_HOST
		const basePath = process.env.USER_SERVICE_BASE_URL
		const apiUrl = `${baseUrl}${basePath}/${endpoints.GET_TENANT_LIST}`
		const internalToken = true
		const listResponse = await requests.get(apiUrl, '', internalToken)

		if (listResponse && listResponse.success && listResponse.data?.result) {
			return listResponse.data.result
		} else {
			throw new Error('TENANT_LIST_NOT_FOUND')
		}
	} catch (error) {
		throw error
	}
}

const getTenantDetails = async (tenantCode) => {
	try {
		let profileUrl = `${userBaseUrl}${endpoints.GET_TENANT_DETAILS}`

		profileUrl += `/${tenantCode}`

		const tenantDeatils = await requests.get(profileUrl, '', true)

		return tenantDeatils
	} catch (error) {
		console.error(error)
		throw error
	}
}

module.exports = {
	fetchOrgDetails, // dependent on releated orgs  And query on code
	fetchUserDetails, // dependendt on languages and prefered lang etc
	getListOfUserDetails,
	list,
	share,
	listWithoutLimit, // not using
	search, // not using
	getListOfUserRoles, // not using
	listOrganization,
	getListOfUserDetailsByEmail, // need to fix
	getDownloadableUrl,
	getUserDetailedList,
	getUserDetails,
	organizationList,
	getOrgDetails,
	getProfileDetails,
	getTenantDomain,
	getTenantList,
	getTenantDetails,
	getUserDetailedListUsingCache,
}
