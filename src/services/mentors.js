// Dependencies
const utils = require('@generics/utils')
const userRequests = require('@requests/user')
const common = require('@constants/common')
const httpStatusCode = require('@generics/http-status')
const mentorQueries = require('@database/queries/mentorExtension')
const menteeQueries = require('@database/queries/userExtension')
const { UniqueConstraintError } = require('sequelize')
const _ = require('lodash')
const sessionAttendeesQueries = require('@database/queries/sessionAttendees')
const sessionQueries = require('@database/queries/sessions')
const entityTypeQueries = require('@database/queries/entityType')
const entityTypeCache = require('@helpers/entityTypeCache')
const organisationExtensionQueries = require('@database/queries/organisationExtension')
const orgAdminService = require('@services/org-admin')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const { Op } = require('sequelize')
const { removeDefaultOrgEntityTypes } = require('@generics/utils')
const moment = require('moment')
const menteesService = require('@services/mentees')
const entityTypeService = require('@services/entity-type')
const responses = require('@helpers/responses')
const permissions = require('@helpers/getPermissions')
const { buildSearchFilter } = require('@helpers/search')
const defaultSearchConfig = require('@configs/search.json')
const emailEncryption = require('@utils/emailEncryption')
const { defaultRulesFilter, validateDefaultRulesFilter } = require('@helpers/defaultRules')
const connectionQueries = require('@database/queries/connection')
const communicationHelper = require('@helpers/communications')
const searchConfig = require('@root/config.json')
const cacheHelper = require('@generics/cacheHelper')
module.exports = class MentorsHelper {
	/**
	 * upcomingSessions.
	 * @method
	 * @name upcomingSessions
	 * @param {String} id - user id.
	 * @param {String} page - Page No.
	 * @param {String} limit - Page size limit.
	 * @param {String} search - Search text.
	 * @returns {JSON} - mentors upcoming session details
	 */
	static async upcomingSessions(
		id,
		page,
		limit,
		search = '',
		menteeUserId,
		queryParams,
		isAMentor,
		roles,
		orgCode,
		tenantCode
	) {
		try {
			let requestedMentorExtension = false
			if (id !== '' && isAMentor !== '' && roles !== '') {
				// Try cache first, fallback to direct query
				requestedMentorExtension = await cacheHelper.mentor.get(tenantCode, orgCode, id)

				if (!requestedMentorExtension) {
					return responses.failureResponse({
						statusCode: httpStatusCode.bad_request,
						message: 'MENTORS_NOT_FOUND',
						responseCode: 'CLIENT_ERROR',
					})
				}
			}
			const query = utils.processQueryParametersWithExclusions(queryParams)
			const sessionModelName = await sessionQueries.getModelName()

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
			let validationData = await entityTypeCache.getEntityTypesAndEntitiesWithCache(
				{
					status: common.ACTIVE_STATUS,
					allow_filtering: true,
					model_names: { [Op.contains]: [sessionModelName] },
				},
				tenantCode,
				orgCode,
				sessionModelName
			)

			if (!orgCode) {
				return responses.failureResponse({
					message: 'ORGANIZATION_CODE_REQUIRED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			const defaultRuleFilter = await defaultRulesFilter({
				ruleType: common.DEFAULT_RULES.SESSION_TYPE,
				requesterId: menteeUserId,
				roles: roles,
				requesterOrganizationCode: orgCode,
				tenantCode: { [Op.in]: [tenantCode, defaults.tenantCode] },
			})

			if (defaultRuleFilter.error && defaultRuleFilter.error.missingField) {
				return responses.failureResponse({
					message: 'PROFILE_NOT_UPDATED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			const filteredQuery = utils.validateAndBuildFilters(query, validationData, sessionModelName)

			// Filter upcoming sessions based on saas policy
			const saasFilter = await menteesService.filterSessionsBasedOnSaasPolicy(
				menteeUserId,
				isAMentor,
				tenantCode,
				orgCode
			)

			let upcomingSessions = await sessionQueries.getMentorsUpcomingSessionsFromView(
				page,
				limit,
				search,
				id,
				filteredQuery,
				tenantCode,
				saasFilter,
				defaultRuleFilter,
				menteeUserId
			)

			if (!upcomingSessions || !upcomingSessions.data || !upcomingSessions.data.length) {
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'UPCOMING_SESSION_FETCHED',
					result: {
						data: [],
						count: upcomingSessions ? upcomingSessions.count || 0 : 0,
					},
				})
			}

			// Process entity types to add value labels.
			const uniqueOrgIds =
				upcomingSessions && upcomingSessions.data && Array.isArray(upcomingSessions.data)
					? [...new Set(upcomingSessions.data.map((obj) => obj.mentor_organization_id))]
					: []
			upcomingSessions.data = await entityTypeService.processEntityTypesToAddValueLabels(
				upcomingSessions.data,
				uniqueOrgIds,
				common.sessionModelName,
				'mentor_organization_id',
				[],
				[tenantCode]
			)

			upcomingSessions.data = await this.sessionMentorDetails(upcomingSessions.data, tenantCode)

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'UPCOMING_SESSION_FETCHED',
				result: upcomingSessions,
			})
		} catch (err) {
			return err
		}
	}

	/**
	 * Profile.
	 * @method
	 * @name profile
	 * @param {String} userId - user id.
	 * @returns {JSON} - profile details
	 */
	/* 	static async profile(id) {
		try {
			const mentorsDetails = await userRequests.fetchUserDetails('', id)
			if (mentorsDetails.data.result.isAMentor && mentorsDetails.data.result.deleted === false) {
				const _id = mentorsDetails.data.result._id
				const filterSessionAttended = { userId: _id, isSessionAttended: true }
				const totalSessionsAttended = await sessionAttendees.countAllSessionAttendees(filterSessionAttended)
				const filterSessionHosted = { userId: _id, status: 'completed', isStarted: true, delete: false }
				const totalSessionHosted = await sessionsData.findSessionHosted(filterSessionHosted)
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'PROFILE_FTECHED_SUCCESSFULLY',
					result: {
						sessionsAttended: totalSessionsAttended,
						sessionsHosted: totalSessionHosted,
						...mentorsDetails.data.result,
					},
				})
			} else {
				return responses.failureResponse({
					statusCode: httpStatusCode.bad_request,
					message: 'MENTORS_NOT_FOUND',
					responseCode: 'CLIENT_ERROR',
				})
			}
		} catch (err) {
			return err
		}
	} */

	/**
	 * Mentors reports.
	 * @method
	 * @name reports
	 * @param {String} userId - user id.
	 * @param {String} filterType - MONTHLY/WEEKLY/QUARTERLY.
	 * @returns {JSON} - Mentors reports
	 */

	static async reports(userId, filterType, roles, tenantCode) {
		try {
			if (!utils.isAMentor(roles)) {
				return responses.failureResponse({
					statusCode: httpStatusCode.bad_request,
					message: 'MENTORS_NOT_FOUND',
					responseCode: 'CLIENT_ERROR',
				})
			}

			let filterStartDate, filterEndDate

			switch (filterType) {
				case 'MONTHLY':
					;[filterStartDate, filterEndDate] = utils.getCurrentMonthRange()
					break
				case 'WEEKLY':
					;[filterStartDate, filterEndDate] = utils.getCurrentWeekRange()
					break
				case 'QUARTERLY':
					;[filterStartDate, filterEndDate] = utils.getCurrentQuarterRange()
					break
				default:
					throw new Error('Invalid filterType')
			}

			const totalSessionsCreated = await sessionQueries.getCreatedSessionsCountInDateRange(
				userId,
				filterStartDate.toISOString(),
				filterEndDate.toISOString(),
				tenantCode
			)

			const totalSessionsAssigned = await sessionQueries.getAssignedSessionsCountInDateRange(
				userId,
				filterStartDate.toISOString(),
				filterEndDate.toISOString(),
				tenantCode
			)

			const totalSessionsHosted = await sessionQueries.getHostedSessionsCountInDateRange(
				userId,
				Date.parse(filterStartDate) / 1000, // Converts milliseconds to seconds
				Date.parse(filterEndDate) / 1000,
				tenantCode
			)

			const result = {
				total_session_created: totalSessionsCreated,
				total_session_hosted: totalSessionsHosted,
				total_session_assigned: totalSessionsAssigned,
			}
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'MENTORS_REPORT_FETCHED_SUCCESSFULLY',
				result,
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Shareable mentor profile link.
	 * @method
	 * @name share
	 * @param {String} _id - Mentors user id.
	 * @returns {JSON} - Returns sharable link of the mentor.
	 */
	static async share(id, userId, organizationCode, tenantCode) {
		try {
			// Try cache first using logged-in user's organization context
			let mentorsDetails = await cacheHelper.mentor.get(tenantCode, organizationCode, id)
			if (!mentorsDetails) {
				return responses.failureResponse({
					statusCode: httpStatusCode.bad_request,
					message: 'MENTORS_NOT_FOUND',
					responseCode: 'CLIENT_ERROR',
				})
			}
			const shareLink = await userRequests.share(id)
			return shareLink
		} catch (error) {
			return error
		}
	}

	static async sessionMentorDetails(session, tenantCode) {
		try {
			if (session.length > 0) {
				const userIds = _.uniqBy(session, 'mentor_id').map((item) => item.mentor_id)

				let mentorDetails = await userRequests.getUserDetailedList(userIds, tenantCode)

				mentorDetails = mentorDetails.result

				for (let i = 0; i < session.length; i++) {
					let mentorIndex = mentorDetails.findIndex((x) => x.user_id === session[i].mentor_id)

					session[i].mentor_name = mentorDetails[mentorIndex].name
					session[i].organization = mentorDetails[mentorIndex].organization
				}

				await Promise.all(
					session.map(async (sessions) => {
						if (sessions.image && sessions.image.length > 0) {
							sessions.image = sessions.image.map(async (imgPath) => {
								if (imgPath && imgPath != '') {
									return await utils.getDownloadableUrl(imgPath)
								}
							})
							sessions.image = await Promise.all(sessions.image)
						}
					})
				)

				return session
			} else {
				return session
			}
		} catch (error) {
			throw error
		}
	}

	static async menteeSessionDetails(sessions, userId, tenantCode) {
		try {
			if (sessions.length > 0) {
				const sessionIds = sessions.map((session) => session.id).filter((id) => id != null)

				if (sessionIds.length === 0) {
					return sessions
				}

				const attendees = await sessionAttendeesQueries.findAll(
					{
						session_id: sessionIds,
						mentee_id: userId,
					},
					tenantCode
				)

				await Promise.all(
					sessions.map(async (session) => {
						const attendee = attendees.find((attendee) => attendee.session_id === session.id)
						session.is_enrolled = !!attendee
						session.enrolment_type = attendee?.type
					})
				)

				const filteredSessions = sessions.filter((session) => {
					return (
						session.type === common.SESSION_TYPE.PUBLIC ||
						(session.type === common.SESSION_TYPE.PRIVATE && session.is_enrolled)
					)
				})

				return filteredSessions
			} else {
				return sessions
			}
		} catch (err) {
			return err
		}
	}

	//Functions for new APIS
	/**
	 * Create a new mentor extension.
	 * @method
	 * @name createMentorExtension
	 * @param {Object} data - Mentor extension data to be created.
	 * @param {String} userId - User ID of the mentor.
	 * @returns {Promise<Object>} - Created mentor extension details.
	 */
	static async createMentorExtension(data, userId, orgCode, tenantCode, orgId) {
		try {
			let skipValidation = data.skipValidation ? data.skipValidation : false
			if (data.email) {
				data.email = emailEncryption.encrypt(data.email.toLowerCase())
			}
			// Use organization code as temporary name and let findOrInsertOrganizationExtension handle creation
			const organization_name = orgCode // Temporary fallback, can be updated later

			// Find organisation policy from organisation_extension table
			let organisationPolicy = await organisationExtensionQueries.findOrInsertOrganizationExtension(
				orgId,
				orgCode,
				organization_name,
				tenantCode
			)

			// Cache the organization extension result
			if (organisationPolicy && organisationPolicy.organization_code && organisationPolicy.organization_id) {
				cacheHelper.organizations
					.set(
						tenantCode,
						organisationPolicy.organization_code,
						organisationPolicy.organization_id,
						organisationPolicy
					)
					.catch((cacheError) => {
						console.error(
							`❌ Failed to cache organization ${organisationPolicy.organization_id} in mentor create:`,
							cacheError
						)
					})
			}

			data.user_id = userId
			data.organization_code = orgCode

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
			const mentorExtensionsModelName = await mentorQueries.getModelName()

			let entityTypes = await entityTypeCache.getEntityTypesAndEntitiesForModel(
				mentorExtensionsModelName,
				tenantCode,
				orgCode
			)
			if (entityTypes instanceof Error) {
				throw entityTypes
			}

			//validationData = utils.removeParentEntityTypes(JSON.parse(JSON.stringify(validationData)))
			const validationData = removeDefaultOrgEntityTypes(entityTypes, orgCode)
			let res = utils.validateInput(data, validationData, mentorExtensionsModelName, skipValidation)
			if (!res.success) {
				return responses.failureResponse({
					message: 'SESSION_CREATION_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
					result: res.errors,
				})
			}
			let mentorExtensionsModel = await mentorQueries.getColumns()
			data = utils.restructureBody(data, validationData, mentorExtensionsModel)

			// construct saas policy data
			let saasPolicyData = await orgAdminService.constructOrgPolicyObject(organisationPolicy, true)

			// Set related_orgs to include current organization
			const related_orgs = [saasPolicyData.organization_id]

			// update mentee extension data
			data = {
				...data,
				...saasPolicyData,
				visible_to_organizations: related_orgs,
			}
			const response = await mentorQueries.createMentorExtension(data, tenantCode)

			const processDbResponse = utils.processDbResponse(response.toJSON(), validationData)

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'MENTOR_EXTENSION_CREATED',
				result: processDbResponse,
			})
		} catch (error) {
			if (error instanceof UniqueConstraintError) {
				return responses.failureResponse({
					message: 'MENTOR_EXTENSION_CREATION_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return error
		}
	}

	/**
	 * Update a mentor extension.
	 * @method
	 * @name updateMentorExtension
	 * @param {String} userId - User ID of the mentor.
	 * @param {Object} data - Updated mentor extension data excluding user_id.
	 * @returns {Promise<Object>} - Updated mentor extension details.
	 */
	static async updateMentorExtension(data, userId, orgCode, tenantCode) {
		try {
			// Try cache first for current mentor data
			let currentUser = await cacheHelper.mentor.get(tenantCode, orgCode, userId)
			if (!currentUser) {
				return responses.failureResponse({
					statusCode: httpStatusCode.not_found,
					message: 'MENTOR_EXTENSION_NOT_FOUND',
				})
			}
			if (data.email) data.email = emailEncryption.encrypt(data.email.toLowerCase())
			let skipValidation = data.skipValidation ? data.skipValidation : false
			// Remove certain data in case it is getting passed
			const dataToRemove = [
				'user_id',
				'mentor_visibility',
				'mentee_visibility',
				'visible_to_organizations',
				'external_session_visibility',
				'external_mentor_visibility',
				'external_mentee_visibility',
			]

			dataToRemove.forEach((key) => {
				if (data[key]) {
					delete data[key]
				}
			})

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
			const mentorExtensionsModelName = await mentorQueries.getModelName()

			let entityTypes = await entityTypeCache.getEntityTypesAndEntitiesForModel(
				mentorExtensionsModelName,
				tenantCode,
				orgCode
			)
			if (entityTypes instanceof Error) {
				throw entityTypes
			}
			const validationData = removeDefaultOrgEntityTypes(entityTypes, defaults.orgCode)
			let mentorExtensionsModel = await mentorQueries.getColumns()

			let res = utils.validateInput(data, validationData, mentorExtensionsModelName, skipValidation)
			if (!res.success) {
				return responses.failureResponse({
					message: 'PROFILE_UPDATE_FAILED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
					result: res.errors,
				})
			}

			data = utils.restructureBody(data, validationData, mentorExtensionsModel)

			if (data?.organization?.id) {
				//Do a org policy update for the user only if the data object explicitly includes an
				//organization.id. This is added for the users/update workflow where
				//both both user data and organisation can change at the same time.
				let userOrgDetails = await userRequests.fetchOrgDetails({ organizationCode: orgCode, tenantCode })
				const orgPolicies = await organisationExtensionQueries.findOrInsertOrganizationExtension(
					data.organization.id,
					orgCode,
					userOrgDetails.data.result.name,
					tenantCode
				)

				if (!orgPolicies?.organization_id) {
					return responses.failureResponse({
						message: 'ORG_EXTENSION_NOT_FOUND',
						statusCode: httpStatusCode.bad_request,
						responseCode: 'CLIENT_ERROR',
					})
				}
				data.organization_id = data.organization.id
				const newPolicy = await orgAdminService.constructOrgPolicyObject(orgPolicies, true)
				data = _.merge({}, data, newPolicy)
				data.visible_to_organizations = Array.from(
					new Set([...userOrgDetails.data.result.related_orgs, data.organization.id])
				)
			}

			const [updateCount, updatedMentor] = await mentorQueries.updateMentorExtension(
				userId,
				data,
				{
					returning: true,
					raw: true,
				},
				{},
				false,
				tenantCode
			)

			if (currentUser?.meta?.communications_user_id) {
				const promises = []
				if (data.name && data.name !== currentUser.name) {
					promises.push(communicationHelper.updateUser(userId, data.name, tenantCode))
				}

				if (data.image && data.image !== currentUser.image) {
					const downloadableUrl = (await userRequests.getDownloadableUrl(data.image))?.result
					promises.push(communicationHelper.updateAvatar(userId, downloadableUrl, tenantCode))
				}

				await Promise.all(promises)
			}

			if (updateCount === 0) {
				// Try cache first for fallback data
				let fallbackUpdatedUser = await cacheHelper.mentor.get(tenantCode, orgCode, userId)
				if (!fallbackUpdatedUser) {
					return responses.failureResponse({
						statusCode: httpStatusCode.not_found,
						message: 'MENTOR_EXTENSION_NOT_FOUND',
					})
				}

				const processDbResponse = utils.processDbResponse(fallbackUpdatedUser, validationData)
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'MENTOR_EXTENSION_UPDATED',
					result: processDbResponse,
				})
			}

			//validationData = utils.removeParentEntityTypes(JSON.parse(JSON.stringify(validationData)))

			const processDbResponse = utils.processDbResponse(updatedMentor[0], validationData)

			// Delete old cache and cache the new updated data
			if (userId && orgCode) {
				try {
					// Delete old cache first
					await cacheHelper.mentor.delete(tenantCode, orgCode, userId)
				} catch (cacheError) {
					console.error(`❌ Failed to update mentor cache after update:`, cacheError)
				}
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'MENTOR_EXTENSION_UPDATED',
				result: processDbResponse,
			})
		} catch (error) {
			return error
		}
	}

	/**
	 * Get mentor extension details by user ID.
	 * @method
	 * @name getMentorExtension
	 * @param {String} userId - User ID of the mentor.
	 * @param {String} organizationCode - Organization code from token context.
	 * @returns {Promise<Object>} - Mentor extension details.
	 */
	static async getMentorExtension(userId, organizationCode, tenantCode) {
		try {
			// Try cache first using logged-in user's organization context
			let mentor = await cacheHelper.mentor.get(tenantCode, organizationCode, userId)
			if (!mentor) {
				return responses.failureResponse({
					statusCode: httpStatusCode.not_found,
					message: 'MENTOR_EXTENSION_NOT_FOUND',
				})
			}

			const orgCode = mentor.organization_code

			// We already have mentor data from the initial cache call, no need to fetch again
			if (mentor.is_mentor) {
				// Always generate fresh downloadable URL for image (cached URLs expire)
				if (mentor.image) {
					try {
						mentor.image = await utils.getDownloadableUrl(mentor.image)
					} catch (error) {
						console.error(`Failed to get downloadable URL for cached mentor image:`, error)
						mentor.image = null
					}
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'MENTOR_EXTENSION_FETCHED',
					result: mentor,
				})
			}

			// Try mentee cache as fallback (user might have both roles)
			const cachedUser = await cacheHelper.mentee.get(tenantCode, orgCode, userId, false)
			if (cachedUser) {
				// Always generate fresh downloadable URL for image (cached URLs expire)
				if (cachedUser.image) {
					try {
						cachedUser.image = await utils.getDownloadableUrl(cachedUser.image)
					} catch (error) {
						console.error(`Failed to get downloadable URL for cached user image:`, error)
						cachedUser.image = null
					}
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'MENTOR_EXTENSION_FETCHED',
					result: cachedUser,
				})
			}

			// Cache miss - get full profile from user service
			const user = await userRequests.getProfileDetails({ tenantCode, userId })
			if (user.statusCode === httpStatusCode.ok && user.result) {
				const userResponse = {
					...user.result,
					...mentor,
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'MENTOR_EXTENSION_FETCHED',
					result: userResponse,
				})
			}

			// Fallback to just extension data if user service fails
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'MENTOR_EXTENSION_FETCHED',
				result: mentor,
			})
		} catch (error) {
			return error
		}
	}

	/**
	 * Delete a mentor extension by user ID.
	 * @method
	 * @name deleteMentorExtension
	 * @param {String} userId - User ID of the mentor.
	 * @returns {Promise<Object>} - Indicates if the mentor extension was deleted successfully.
	 */
	static async deleteMentorExtension(userId, tenantCode) {
		try {
			// Get mentor extension before deletion to retrieve organization_code for cache deletion
			const mentorExtension = await mentorQueries.getMentorExtension(
				userId,
				['organization_code'],
				false,
				tenantCode
			)

			const deleteCount = await mentorQueries.deleteMentorExtension(userId, tenantCode, false)
			if (deleteCount === '0') {
				return responses.failureResponse({
					statusCode: httpStatusCode.not_found,
					message: 'MENTOR_EXTENSION_NOT_FOUND',
				})
			}

			// Cache invalidation: Clear mentor cache after deletion
			if (mentorExtension && mentorExtension.organization_code) {
				try {
					await cacheHelper.mentor.delete(tenantCode, mentorExtension.organization_code, userId)
				} catch (cacheError) {
					console.error(`Cache deletion failed for mentor ${userId}:`, cacheError)
				}
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'MENTOR_EXTENSION_DELETED',
			})
		} catch (error) {
			return error
		}
	}

	/**
	 * Read.
	 * @method
	 * @name read
	 * @param {Number} id 						- mentor id.
	 * @param {Number} orgId 					- org id
	 * @param {Number} userId 					- User id.
	 * @param {Boolean} isAMentor 				- user mentor or not.
	 * @returns {JSON} 							- profile details
	 */
	static async read(id, orgCode, userId = '', isAMentor = '', roles = '', tenantCode) {
		try {
			// Get mentor profile first to ensure we have organization_code
			let mentorProfile = await userRequests.getUserDetails(id, tenantCode)
			if (!mentorProfile.data.result) {
				return responses.failureResponse({
					statusCode: httpStatusCode.not_found,
					message: 'MENTORS_NOT_FOUND',
				})
			}

			// Set orgCode if not provided
			if (!orgCode) {
				orgCode = mentorProfile.data.result.organization_code
			}

			// Try to get complete profile from cache first using getCacheOnly
			let cachedProfile = null
			cachedProfile = await cacheHelper.mentor.getCacheOnly(tenantCode, orgCode, id)

			// If we have cached data, use it efficiently
			if (cachedProfile) {
				let requestedMentorExtension = false
				if (userId !== '' && isAMentor !== '' && roles !== '') {
					// Use cached data for validation instead of making redundant database query
					requestedMentorExtension = cachedProfile

					const validateDefaultRules = await validateDefaultRulesFilter({
						ruleType: common.DEFAULT_RULES.MENTOR_TYPE,
						requesterId: userId,
						roles: roles,
						requesterOrganizationCode: orgCode,
						data: requestedMentorExtension,
						tenant_code: tenantCode,
					})
					if (validateDefaultRules.error && validateDefaultRules.error.missingField) {
						return responses.failureResponse({
							message: 'PROFILE_NOT_UPDATED',
							statusCode: httpStatusCode.bad_request,
							responseCode: 'CLIENT_ERROR',
						})
					}
					if (!validateDefaultRules) {
						return responses.failureResponse({
							message: 'MENTORS_NOT_FOUND',
							statusCode: httpStatusCode.bad_request,
							responseCode: 'CLIENT_ERROR',
						})
					}
					// Throw error if extension not found
					if (!requestedMentorExtension || Object.keys(requestedMentorExtension).length === 0) {
						return responses.failureResponse({
							statusCode: httpStatusCode.not_found,
							message: 'MENTORS_NOT_FOUND',
						})
					}

					// Check for accessibility for reading shared mentor profile
					const isAccessible = await this.checkIfMentorIsAccessible(
						[requestedMentorExtension],
						userId,
						isAMentor,
						tenantCode,
						orgCode
					)

					// Throw access error
					if (!isAccessible) {
						return responses.failureResponse({
							statusCode: httpStatusCode.forbidden,
							message: 'PROFILE_RESTRICTED',
						})
					}

					// Always fetch is_connected from database as it changes based on who is calling
					const connection = await connectionQueries.getConnection(userId, id, tenantCode)
					cachedProfile.is_connected = Boolean(connection)

					if (cachedProfile.is_connected) {
						cachedProfile.connection_details = connection.meta
					}
				}

				// Always generate fresh downloadable URL for image (cached URLs expire)
				if (cachedProfile.image) {
					try {
						cachedProfile.image = await utils.getDownloadableUrl(cachedProfile.image)
					} catch (error) {
						console.error(`Failed to get downloadable URL for cached profile image:`, error)
						cachedProfile.image = null
					}
				}

				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'PROFILE_FETCHED_SUCCESSFULLY',
					result: cachedProfile,
				})
			}

			// Get mentor extension data efficiently (avoid redundant queries)
			let mentorExtension = await cacheHelper.mentor.get(tenantCode, orgCode, id)

			// If user authentication is required, perform validation
			if (userId !== '' && isAMentor !== '' && roles !== '') {
				const validateDefaultRules = await validateDefaultRulesFilter({
					ruleType: common.DEFAULT_RULES.MENTOR_TYPE,
					requesterId: userId,
					roles: roles,
					requesterOrganizationCode: orgCode,
					data: mentorExtension,
					tenant_code: tenantCode,
				})
				if (validateDefaultRules.error && validateDefaultRules.error.missingField) {
					return responses.failureResponse({
						message: 'PROFILE_NOT_UPDATED',
						statusCode: httpStatusCode.bad_request,
						responseCode: 'CLIENT_ERROR',
					})
				}
				if (!validateDefaultRules) {
					return responses.failureResponse({
						message: 'MENTORS_NOT_FOUND',
						statusCode: httpStatusCode.bad_request,
						responseCode: 'CLIENT_ERROR',
					})
				}
				// Throw error if extension not found
				if (!mentorExtension || Object.keys(mentorExtension).length === 0) {
					return responses.failureResponse({
						statusCode: httpStatusCode.not_found,
						message: 'MENTORS_NOT_FOUND',
					})
				}

				// Check for accessibility for reading shared mentor profile
				const isAccessible = await this.checkIfMentorIsAccessible(
					[mentorExtension],
					userId,
					isAMentor,
					tenantCode,
					orgCode
				)

				// Throw access error
				if (!isAccessible) {
					return responses.failureResponse({
						statusCode: httpStatusCode.forbidden,
						message: 'PROFILE_RESTRICTED',
					})
				}
			}

			const mentorOrgCode = mentorProfile.data.result.organization_code

			// If no mentor extension found, but user has admin/mentor roles, check if user extension exists and update it
			if (!mentorExtension && roles && roles.some((role) => role.title === 'admin' || role.title === 'mentor')) {
				// Try to get user extension without is_mentor filter (unscoped call - cannot cache)
				const userExtension = await mentorQueries.getMentorExtension(id, [], true, tenantCode)
				if (userExtension) {
					// Update using unscoped updateMentorExtension with custom filter to bypass is_mentor constraint
					await mentorQueries.updateMentorExtension(
						id,
						{ is_mentor: true },
						{},
						{ user_id: id },
						true,
						tenantCode
					)

					// Cache invalidation: Delete old cache after mentor extension update
					try {
						await cacheHelper.mentor.delete(tenantCode, orgCode, id)
					} catch (cacheError) {
						console.error(`Cache deletion failed for mentor ${id} after update:`, cacheError)
					}
				}
			}

			if (!mentorProfile.data.result || !mentorExtension) {
				return responses.failureResponse({
					statusCode: httpStatusCode.not_found,
					message: 'MENTORS_NOT_FOUND',
				})
			}
			mentorProfile = utils.deleteProperties(mentorProfile.data.result, ['created_at', 'updated_at'])

			mentorExtension = utils.deleteProperties(mentorExtension, ['phone'])

			const mentorExtensionsModelName = await mentorQueries.getModelName()

			let entityTypes = await entityTypeCache.getEntityTypesAndEntitiesForModel(
				mentorExtensionsModelName,
				tenantCode,
				mentorOrgCode
			)
			if (entityTypes instanceof Error) {
				throw entityTypes
			}

			// validationData = utils.removeParentEntityTypes(JSON.parse(JSON.stringify(validationData)))
			const validationData = removeDefaultOrgEntityTypes(entityTypes, mentorOrgCode)

			const processDbResponse = utils.processDbResponse(mentorExtension, validationData)
			const totalSessionHosted = await sessionQueries.countHostedSessions(id, tenantCode)

			// Try to get display properties from cache (with tenant/org fallback)
			let displayProperties = await cacheHelper.displayProperties.get(tenantCode, orgCode)

			if (!displayProperties) {
				// Build display properties from entity types
				const sortedEntityType = await utils.sortData(validationData, 'meta.sequence')
				displayProperties = [
					{
						key: 'organization',
						label: 'Organization',
						visible: true,
						visibility: 'main',
						sequence: 1,
					},
				]
				for (const entityType of sortedEntityType) {
					displayProperties.push({ key: entityType.value, ...entityType.meta })
				}

				// Cache at org level
				try {
					await cacheHelper.displayProperties.set(tenantCode, orgCode, displayProperties)
				} catch (cacheError) {
					console.error(`❌ Failed to cache display properties:`, cacheError)
				}
			}

			const mentorPermissions = await permissions.getPermissions(roles, tenantCode, orgCode)

			// Add is_connected field - check connection if userId is provided (viewing others' profile)
			if (userId !== '') {
				const connection = await connectionQueries.getConnection(userId, id, tenantCode)
				processDbResponse.is_connected = Boolean(connection)

				if (processDbResponse.is_connected) {
					processDbResponse.connection_details = connection.meta
				}
			} else {
				// For own profile read or when no userId provided
				processDbResponse.is_connected = false
			}

			if (!Array.isArray(mentorProfile.permissions)) {
				mentorProfile.permissions = []
			}

			// Handle both array response (success) and response object (error)
			if (Array.isArray(mentorPermissions)) {
				mentorProfile.permissions.push(...mentorPermissions)
			} else {
				// It's the error response object, extract the permissions array
				const permissionsArray = mentorPermissions.result?.permissions || []
				mentorProfile.permissions.push(...permissionsArray)
			}

			const profileMandatoryFields = await utils.validateProfileData(processDbResponse, validationData)
			mentorProfile.profile_mandatory_fields = profileMandatoryFields

			let communications = null

			if (mentorExtension?.meta?.communications_user_id) {
				try {
					const chat = await communicationHelper.login(id, tenantCode)
					communications = chat
				} catch (error) {}
			}
			processDbResponse.meta = {
				...processDbResponse.meta,
				communications,
			}

			if (!mentorProfile.organization) {
				// Get organization details with cache-first approach
				let orgDetails = null

				// Try cache first if we have organization_id
				try {
					if (mentorProfile.organization_id) {
						orgDetails = await cacheHelper.organizations.get(
							tenantCode,
							mentorOrgCode,
							mentorProfile.organization_id
						)
					}
				} catch (cacheError) {
					console.warn('Organization cache lookup failed, falling back to database')
				}

				// Fallback to database if cache miss
				if (!orgDetails) {
					orgDetails = await organisationExtensionQueries.findOne(
						{ organization_code: mentorOrgCode },
						tenantCode,
						{
							attributes: ['name', 'organization_id', 'organization_code'],
						}
					)
				}

				mentorProfile['organization'] = {
					id: mentorOrgCode,
					name: orgDetails?.name,
				}
			}

			// Add profile_mandatory_fields
			const profileMandatoryFieldsRead = await utils.validateProfileData(processDbResponse, validationData)
			processDbResponse.profile_mandatory_fields = profileMandatoryFieldsRead

			// Conditionally fetch profile details if token exists
			let userProfile = {}
			if (tenantCode && id) {
				const profileResponse = await userRequests.getProfileDetails({ tenantCode, userId: id })
				// If profileResponse.data.result exists, include it; otherwise, keep userProfile empty
				if (profileResponse.data.result) {
					userProfile = profileResponse.data.result
				}
				// No failure response; proceed with available data
			}
			// Construct the final profile response (INCLUDE sessions_attended for read endpoint)
			const totalSessionsAttended = await sessionAttendeesQueries.countEnrolledSessions(id, tenantCode)
			const finalProfile = {
				user_id: id, // Add user_id to match mentee read response
				...mentorProfile,
				...processDbResponse,
				...userProfile, // Include userProfile only if token was provided
				meta: {
					...(userProfile.meta || {}),
					...(processDbResponse.meta || {}),
				},
				sessions_hosted: totalSessionHosted,
				visible_to_organizations: mentorExtension.visible_to_organizations, // Add to match mentee read
				settings: mentorExtension.settings, // Add settings to match mentee read
				image: mentorExtension.image, // Keep original image (may already be downloadable URL)
				sessions_attended: totalSessionsAttended, // Add sessions_attended
				profile_mandatory_fields: processDbResponse.profile_mandatory_fields, // Ensure not overwritten
				organization: mentorProfile.organization, // Ensure not overwritten
				displayProperties,
			}

			try {
				console.log(`💾 Caching complete mentor profile response for ${id}`)
				await cacheHelper.mentor.set(tenantCode, orgCode, id, finalProfile)
			} catch (cacheError) {
				console.error(`❌ Failed to cache mentor profile ${id}:`, cacheError)
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'PROFILE_FETCHED_SUCCESSFULLY',
				result: finalProfile,
			})
		} catch (error) {
			return error
		}
	}

	/**
	 * Get user policy details from cache or database
	 * @method
	 * @name _getUserPolicyDetails
	 * @param {Boolean} isAMentor - Whether user is a mentor
	 * @param {String} tenantCode - Tenant code
	 * @param {String} orgCode - Organization code
	 * @param {String} userId - User ID
	 * @returns {Object|null} - User policy details
	 */
	static async _getUserPolicyDetails(isAMentor, tenantCode, orgCode, userId) {
		const cacheKey = isAMentor ? 'mentor' : 'mentee'
		const queryFunction = isAMentor ? mentorQueries.getMentorExtension : menteeQueries.getMenteeExtension

		// Try cache first
		let userPolicyDetails = await cacheHelper[cacheKey].getCacheOnly(tenantCode, orgCode, userId)

		// Fallback to database query if cache miss
		if (!userPolicyDetails) {
			userPolicyDetails = await queryFunction(
				userId,
				['external_mentor_visibility', 'organization_id'],
				false,
				tenantCode
			)
		}

		return userPolicyDetails
	}

	/**
	 * @description 							- check if mentor is accessible based on user's saas policy.
	 * @method
	 * @name checkIfMentorIsAccessible
	 * @param {Number} userId 					- User id.
	 * @param {Array}							- Session data
	 * @param {Boolean} isAMentor 				- user mentor or not.
	 * @returns {JSON} 							- List of filtered sessions
	 */
	static async checkIfMentorIsAccessible(userData, userId, isAMentor, tenantCode, orgCode) {
		try {
			// Get user policy details using helper function
			const userPolicyDetails = await this._getUserPolicyDetails(isAMentor, tenantCode, orgCode, userId)

			// Throw error if mentor/mentee extension not found
			if (!userPolicyDetails || Object.keys(userPolicyDetails).length === 0) {
				return responses.failureResponse({
					statusCode: httpStatusCode.not_found,
					message: isAMentor ? 'MENTORS_NOT_FOUND' : 'MENTEE_EXTENSION_NOT_FOUND',
					responseCode: 'CLIENT_ERROR',
				})
			}

			// check the accessibility conditions
			let isAccessible = false
			if (userPolicyDetails.external_mentor_visibility && userPolicyDetails.organization_id) {
				const { external_mentor_visibility, organization_id } = userPolicyDetails
				const mentor = userData[0]
				switch (external_mentor_visibility) {
					/**
					 * if user external_mentor_visibility is current. He can only see his/her organizations mentors
					 * so we will check mentor's organization_id and user organization_id are matching
					 */
					case common.CURRENT:
						isAccessible = mentor.organization_id === organization_id
						break
					/**
					 * If user external_mentor_visibility is associated
					 * <<point**>> first we need to check if mentor's visible_to_organizations contain the user organization_id and verify mentor's visibility is not current (if it is ALL and ASSOCIATED it is accessible)
					 */
					case common.ASSOCIATED:
						isAccessible =
							(mentor.visible_to_organizations.includes(organization_id) &&
								mentor.mentor_visibility != common.CURRENT) ||
							mentor.organization_id === organization_id
						break
					/**
					 * We need to check if mentor's visible_to_organizations contain the user organization_id and verify mentor's visibility is not current (if it is ALL and ASSOCIATED it is accessible)
					 * OR if mentor visibility is ALL that mentor is also accessible
					 */
					case common.ALL:
						isAccessible =
							(mentor.visible_to_organizations.includes(organization_id) &&
								mentor.mentor_visibility != common.CURRENT) ||
							mentor.mentor_visibility === common.ALL ||
							mentor.organization_id === organization_id
						break
					default:
						break
				}
			}
			return isAccessible
		} catch (err) {
			return err
		}
	}
	/**
	 * Get user list.
	 * @method
	 * @name create
	 * @param {Number} pageSize -  Page size.
	 * @param {Number} pageNo -  Page number.
	 * @param {String} searchText -  Search text.
	 * @param {JSON} queryParams -  Query params.
	 * @param {Boolean} isAMentor -  Is a mentor.
	 * @returns {JSON} - User list.
	 */

	static async list(
		pageNo,
		pageSize,
		searchText,
		searchOn,
		queryParams,
		userId,
		isAMentor,
		roles,
		orgCode,
		tenantCode
	) {
		try {
			let additionalProjectionString = ''
			let userServiceQueries = {}

			// check for fields query (Adds to the projection)
			if (queryParams.fields && queryParams.fields !== '') {
				additionalProjectionString = queryParams.fields
				delete queryParams.fields
			}

			let organization_codes = []
			let directory = false

			const [sortBy, order] = ['name'].includes(queryParams.sort_by)
				? [queryParams.sort_by, queryParams.order || 'ASC']
				: [false, 'ASC']

			for (let key in queryParams) {
				if (queryParams.hasOwnProperty(key) & ((key === 'email') | (key === 'name'))) {
					userServiceQueries[key] = queryParams[key]
				}
				if (queryParams.hasOwnProperty(key) & (key === 'organization_codes')) {
					organization_codes = queryParams[key].split(',')
				}

				if (
					queryParams.hasOwnProperty(key) &
					(key === 'directory') &
					((queryParams[key] == 'true') | (queryParams[key] == true))
				) {
					directory = true
				}
			}

			const emailIds = []
			const searchTextArray = searchText ? searchText.split(',') : []

			searchTextArray.forEach((element) => {
				if (utils.isValidEmail(element)) {
					emailIds.push(emailEncryption.encrypt(element.toLowerCase()))
				}
			})
			const hasValidEmails = emailIds.length > 0

			const query = utils.processQueryParametersWithExclusions(queryParams)
			const mentorExtensionsModelName = await mentorQueries.getModelName()
			// Note: Entity types are actually configured for UserExtension model, not MentorExtension
			const userExtensionsModelName = 'UserExtension'

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

			let validationData = await entityTypeCache.getEntityTypesAndEntitiesForModel(
				userExtensionsModelName,
				tenantCode,
				orgCode,
				{ allow_filtering: true }
			)
			const filteredQuery = utils.validateAndBuildFilters(query, validationData)

			const saasFilter = await this.filterMentorListBasedOnSaasPolicy(
				userId,
				isAMentor,
				organization_codes,
				tenantCode,
				orgCode
			)

			let search_config = defaultSearchConfig
			if (searchConfig.search) {
				search_config = { search: searchConfig.search }
			}

			let searchFilter
			if (!hasValidEmails) {
				searchFilter = await buildSearchFilter({
					searchOn: searchOn ? searchOn.split(',') : false,
					searchConfig: search_config.search.mentor,
					search: searchText,
					modelName: mentorExtensionsModelName,
					tenantCode: tenantCode,
				})

				if (!searchFilter) {
					return responses.successResponse({
						statusCode: httpStatusCode.ok,
						message: 'MENTOR_LIST',
						result: {
							data: [],
							count: 0,
						},
					})
				}
			}
			if (!orgCode) {
				return responses.failureResponse({
					message: 'ORGANIZATION_CODE_REQUIRED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			const defaultRuleFilter = await defaultRulesFilter({
				ruleType: 'mentor',
				requesterId: queryParams.menteeId ? queryParams.menteeId : userId,
				roles: roles,
				requesterOrganizationCode: orgCode,
				tenantCode: { [Op.in]: [tenantCode, defaults.tenantCode] },
			})

			if (defaultRuleFilter.error && defaultRuleFilter.error.missingField) {
				return responses.failureResponse({
					message: 'PROFILE_NOT_UPDATED',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let connectedMentorsIds = []

			if (queryParams.connected_mentors === 'true') {
				const connectedQueryParams = { ...queryParams }
				delete connectedQueryParams.connected_mentors
				const connectedQuery = utils.processQueryParametersWithExclusions(connectedQueryParams)

				const connectionDetails = await connectionQueries.getConnectionsDetails(
					pageNo,
					pageSize,
					connectedQuery,
					searchText,
					queryParams.mentorId ? queryParams.mentorId : userId,
					organization_codes,
					[] // roles can be passed if needed
				)

				if (connectionDetails?.data?.length > 0) {
					connectedMentorsIds = connectionDetails.data.map((item) => item.user_id)
					if (!connectedMentorsIds.includes(userId)) {
						connectedMentorsIds.push(userId)
					}
				}

				// If there are no connected mentees, short-circuit and return empty
				if (connectedMentorsIds.length === 0) {
					return responses.successResponse({
						statusCode: httpStatusCode.ok,
						message: 'MENTEE_LIST',
						result: {
							data: [],
							count: 0,
						},
					})
				}
			}

			// Fetch mentor data
			let extensionDetails = await mentorQueries.getMentorsByUserIdsFromView(
				connectedMentorsIds ? connectedMentorsIds : [],
				pageNo,
				pageSize,
				filteredQuery,
				saasFilter,
				additionalProjectionString,
				false,
				searchFilter,
				hasValidEmails ? emailIds : searchText,
				defaultRuleFilter,
				tenantCode
			)
			// Early return for empty results
			if (
				!extensionDetails ||
				!extensionDetails.data ||
				!Array.isArray(extensionDetails.data) ||
				extensionDetails.count === 0 ||
				extensionDetails.data.length === 0
			) {
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'MENTOR_LIST',
					result: {
						data: [],
						count: extensionDetails.count,
					},
				})
			}

			const mentorIds = extensionDetails.data.map((item) => item.user_id)
			const userDetails = await userRequests.getUserDetailedList(mentorIds, tenantCode)

			//Extract unique organization_codes
			const organizationCodes = [...new Set(extensionDetails.data.map((user) => user.organization_code))]

			//Query organization table (only if there are codes to query)
			let organizationDetails = []
			if (organizationCodes.length > 0) {
				const orgFilter = {
					organization_code: {
						[Op.in]: organizationCodes,
					},
				}
				organizationDetails = await organisationExtensionQueries.findAll(orgFilter, tenantCode, {
					attributes: ['name', 'organization_code', 'organization_id'],
					raw: true, // Ensure plain objects
				})

				// Cache the organization details
				if (organizationDetails && organizationDetails.length > 0) {
					const cachePromises = organizationDetails
						.map((org) => {
							if (org.organization_code && org.organization_id) {
								return cacheHelper.organizations
									.set(tenantCode, org.organization_code, org.organization_id, org)
									.catch((cacheError) => {
										console.error(
											`❌ Failed to cache organization ${org.organization_id} in mentor list:`,
											cacheError
										)
									})
							}
						})
						.filter(Boolean)

					Promise.all(cachePromises)
						.then(() => {})
						.catch((cacheError) => {
							console.error(`❌ Some organizations failed to cache in mentor list:`, cacheError)
						})
				}
			}

			//Create a map of organization_code to organization details
			const orgMap = {}
			organizationDetails.forEach((org) => {
				orgMap[org.organization_code] = {
					id: org.organization_code,
					name: org.name,
				}
			})

			//Attach organization details and decrypt email for each user
			extensionDetails.data = await Promise.all(
				extensionDetails.data.map(async (user) => ({
					...user,
					id: user.user_id, // Add 'id' key, to be removed later
					email: user.email ? (await emailEncryption.decryptAndValidate(user.email)) || user.email : null, // Decrypt email
					organization: orgMap[user.organization_code] || null,
				}))
			)

			const connectedUsers = await connectionQueries.getConnectionsByUserIds(userId, mentorIds, tenantCode)
			const connectedMentorIds = new Set(connectedUsers.map((connectedUser) => connectedUser.friend_id))

			if (extensionDetails.data && Array.isArray(extensionDetails.data) && extensionDetails.data.length > 0) {
				// Process all entity types for UserExtension model (don't filter by specific entity types)
				extensionDetails.data = await entityTypeService.processEntityTypesToAddValueLabels(
					extensionDetails.data,
					organizationCodes,
					userExtensionsModelName, // Use UserExtension model name for entity processing
					'organization_code',
					[], // Empty array means process ALL entity types for this model
					[tenantCode]
				)
			}

			// Create a map from userDetails.result for quick lookups
			const userDetailsMap = new Map(userDetails.result.map((userDetail) => [userDetail.user_id, userDetail]))

			// Map over extensionDetails.data to merge with the corresponding userDetail
			extensionDetails.data = extensionDetails.data
				.map((extensionDetail) => {
					const user_id = `${extensionDetail.user_id}`
					const isConnected = connectedMentorIds.has(extensionDetail.user_id)

					if (userDetailsMap.has(user_id)) {
						let userDetail = userDetailsMap.get(user_id)
						// Merge userDetail with extensionDetail, prioritize extensionDetail properties
						userDetail = { ...userDetail, ...extensionDetail, is_connected: isConnected }
						delete userDetail.user_id
						delete userDetail.mentor_visibility
						delete userDetail.mentee_visibility
						delete userDetail.organization_code
						delete userDetail.meta
						return userDetail
					}
					return null
				})
				.filter((extensionDetail) => extensionDetail !== null)
			if (directory) {
				let foundKeys = {}
				let result = []
				for (let user of extensionDetails.data) {
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
				extensionDetails.data = sortedData
			} else {
				// Check if sortBy and order have values before applying sorting
				if (sortBy) {
					extensionDetails.data = extensionDetails.data.sort((a, b) => {
						// Determine the sorting order based on the 'order' value
						const sortOrder = order.toLowerCase() === 'asc' ? 1 : order.toLowerCase() === 'desc' ? -1 : 1

						// Customize the sorting based on the provided sortBy field
						return sortOrder * a[sortBy].localeCompare(b[sortBy])
					})
				}
			}

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'MENTOR_LIST',
				result: extensionDetails,
			})
		} catch (error) {
			throw error
		}
	}
	/**
	 * @description 							- Filter mentor list based on user's saas policy.
	 * @method
	 * @name filterMentorListBasedOnSaasPolicy
	 * @param {Number} userId 					- User id.
	 * @param {Boolean} isAMentor 				- user mentor or not.
	 * @returns {JSON} 							- List of filtered sessions
	 */
	static async filterMentorListBasedOnSaasPolicy(userId, isAMentor, organization_codes = [], tenantCode, orgCode) {
		try {
			// Always query mentee extension for mentor list filtering policy
			// Even if user is also a mentor/admin, we need their mentee visibility policy
			const userPolicyDetails = await cacheHelper.mentee.get(tenantCode, orgCode, userId)

			// Throw error if mentor/mentee extension not found
			if (!userPolicyDetails || Object.keys(userPolicyDetails).length === 0) {
				return responses.failureResponse({
					statusCode: httpStatusCode.not_found,
					message: isAMentor ? 'MENTORS_NOT_FOUND' : 'MENTEE_EXTENSION_NOT_FOUND',
					responseCode: 'CLIENT_ERROR',
				})
			}

			let filter = ''
			// searching for specific organization
			let additionalFilter = ``
			if (organization_codes.length !== 0) {
				additionalFilter = `AND "organization_code" in (${organization_codes
					.map((code) => `'${code}'`)
					.join(',')}) `
			}

			if (userPolicyDetails.external_mentor_visibility && userPolicyDetails.organization_code) {
				// Filter user data based on policy
				// generate filter based on condition
				if (userPolicyDetails.external_mentor_visibility === common.CURRENT) {
					/**
					 * if user external_mentor_visibility is current. He can only see his/her organizations mentors
					 * so we will check mentor's organization_code and user organization_code are matching
					 */
					filter = `AND "organization_code" = '${userPolicyDetails.organization_code}'`
				} else if (userPolicyDetails.external_mentor_visibility === common.ASSOCIATED) {
					/**
					 * If user external_mentor_visibility is associated
					 * <<point**>> first we need to check if mentor's visible_to_organizations contain the user organization_code and verify mentor's visibility is not current (if it is ALL and ASSOCIATED it is accessible)
					 */

					filter =
						additionalFilter +
						`AND ( ('${userPolicyDetails.organization_code}' = ANY("visible_to_organizations") AND "mentor_visibility" != 'CURRENT')`

					if (additionalFilter.length === 0)
						filter += ` OR organization_code = '${userPolicyDetails.organization_code}' )`
					else filter += `)`
				} else if (userPolicyDetails.external_mentor_visibility === common.ALL) {
					/**
					 * We need to check if mentor's visible_to_organizations contain the user organization_code and verify mentor's visibility is not current (if it is ALL and ASSOCIATED it is accessible)
					 * OR if mentor visibility is ALL that mentor is also accessible
					 */
					filter =
						additionalFilter +
						`AND (('${userPolicyDetails.organization_code}' = ANY("visible_to_organizations") AND "mentor_visibility" != 'CURRENT' ) OR "mentor_visibility" = 'ALL' OR "organization_code" = '${userPolicyDetails.organization_code}')`
				}
			}

			return filter
		} catch (err) {
			return err
		}
	}

	/**
	 * Sessions list
	 * @method
	 * @name list
	 * @param {Object} req -request data.
	 * @param {String} req.decodedToken.id - User Id.
	 * @param {String} req.pageNo - Page No.
	 * @param {String} req.pageSize - Page size limit.
	 * @param {String} req.searchText - Search text.
	 * @returns {JSON} - Session List.
	 */

	static async createdSessions(
		loggedInUserId,
		page,
		limit,
		search,
		status,
		roles,
		organizationId,
		tenantCode,
		startDate,
		endDate
	) {
		try {
			if (!utils.isAMentor(roles)) {
				return responses.failureResponse({
					statusCode: httpStatusCode.bad_request,
					message: 'NOT_A_MENTOR',
					responseCode: 'CLIENT_ERROR',
				})
			}

			const currentDate = Math.floor(moment.utc().valueOf() / 1000)

			let arrayOfStatus = []
			if (status && status != '') {
				arrayOfStatus = status.split(',')
			}

			let filters = {
				mentor_id: loggedInUserId,
			}
			if (arrayOfStatus.length > 0) {
				// if (arrayOfStatus.includes(common.COMPLETED_STATUS) && arrayOfStatus.length == 1) {
				// 	filters['endDateUtc'] = {
				// 		$lt: moment().utc().format(),
				// 	}
				// } else
				if (arrayOfStatus.includes(common.PUBLISHED_STATUS) && arrayOfStatus.includes(common.LIVE_STATUS)) {
					filters['end_date'] = {
						[Op.gte]: currentDate,
					}
				}

				filters['status'] = arrayOfStatus
			}

			// Apply custom startDate and endDate filter only if both are provided
			if (startDate && endDate) {
				filters['start_date'] = { [Op.gte]: startDate }
				filters['end_date'] = { ...(filters['end_date'] || {}), [Op.lte]: endDate }
			}
			// Get sessions without mentor details (simple database query)
			const sessionDetails = await sessionQueries.findAllSessions(page, limit, search, filters, tenantCode)

			if (
				!sessionDetails ||
				sessionDetails.count == 0 ||
				!sessionDetails.rows ||
				sessionDetails.rows.length == 0
			) {
				return responses.successResponse({
					message: 'SESSION_FETCHED_SUCCESSFULLY',
					statusCode: httpStatusCode.ok,
					result: [],
				})
			}

			// Business logic: Enrich sessions with mentor details
			await this._enrichSessionsWithMentorDetails(sessionDetails.rows, tenantCode)

			//remove meeting_info details except value and platform and add is_assigned flag
			sessionDetails.rows.forEach((item) => {
				if (item.meeting_info) {
					item.meeting_info = {
						value: item.meeting_info.value,
						platform: item.meeting_info.platform,
					}
				}
				item.is_assigned = item.mentor_id !== item.created_by
			})

			// Extract organization codes for entity processing
			const uniqueOrgIds = [
				...new Set(sessionDetails.rows.map((obj) => obj.organization?.organization_code).filter(Boolean)),
			]

			sessionDetails.rows = await entityTypeService.processEntityTypesToAddValueLabels(
				sessionDetails.rows,
				uniqueOrgIds,
				common.sessionModelName,
				'mentor_organization_id',
				[],
				[tenantCode]
			)

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'SESSION_FETCHED_SUCCESSFULLY',
				result: { count: sessionDetails.count, data: sessionDetails.rows },
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Private method: Enrich sessions with mentor details and process images
	 * Business logic for adding mentor information to session data
	 * @param {Array} sessions - Array of session objects
	 * @param {String} tenantCode - Tenant code for user service calls
	 */
	static async _enrichSessionsWithMentorDetails(sessions, tenantCode) {
		try {
			if (!sessions || sessions.length === 0) {
				return
			}

			// Get unique mentor IDs
			const userIds = _.uniqBy(sessions, 'mentor_id').map((item) => item.mentor_id)

			// Fetch mentor details from User Service
			let mentorDetails = await userRequests.getUserDetailedList(userIds, tenantCode)
			mentorDetails = mentorDetails.result

			// Enrich sessions with mentor details
			for (let i = 0; i < sessions.length; i++) {
				let mentorIndex = mentorDetails.findIndex((x) => x.user_id === sessions[i].mentor_id)

				if (mentorIndex !== -1) {
					sessions[i].mentor_name = mentorDetails[mentorIndex].name
					sessions[i].organization = mentorDetails[mentorIndex].organization
				}
			}

			// Process session images
			await Promise.all(
				sessions.map(async (session) => {
					if (session.image && session.image.length > 0) {
						session.image = session.image.map(async (imgPath) => {
							if (imgPath && imgPath != '') {
								return await utils.getDownloadableUrl(imgPath)
							}
						})
						session.image = await Promise.all(session.image)
					}
				})
			)
		} catch (error) {
			console.error('Error enriching sessions with mentor details:', error)
			// Don't throw error to avoid breaking the main flow
		}
	}
}
