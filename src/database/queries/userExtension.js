const MenteeExtension = require('@database/models/index').UserExtension
const { QueryTypes } = require('sequelize')
const sequelize = require('sequelize')
const Sequelize = require('@database/models/index').sequelize
const common = require('@constants/common')
const utils = require('@generics/utils')
const _ = require('lodash')
const { Op } = require('sequelize')
const emailEncryption = require('@utils/emailEncryption')

module.exports = class MenteeExtensionQueries {
	static async getColumns() {
		try {
			return await Object.keys(MenteeExtension.rawAttributes)
		} catch (error) {
			throw error
		}
	}

	static async getModelName() {
		try {
			return await MenteeExtension.name
		} catch (error) {
			throw error
		}
	}
	static async createMenteeExtension(data, tenantCode) {
		try {
			data.tenant_code = tenantCode
			return await MenteeExtension.create(data, { returning: true })
		} catch (error) {
			throw error
		}
	}

	static async updateMenteeExtension(userId, data, options = {}, customFilter = {}, tenantCode) {
		try {
			if (data.user_id) {
				delete data['user_id']
			}
			let whereClause
			if (_.isEmpty(customFilter)) {
				whereClause = { user_id: userId, tenant_code: tenantCode }
			} else {
				whereClause = { ...customFilter, tenant_code: tenantCode }
			}

			// If `meta` is included in `data`, use `jsonb_set` to merge changes safely
			if (data.meta) {
				let metaExpr = Sequelize.fn('COALESCE', Sequelize.col('meta'), Sequelize.literal(`'{}'::jsonb`))

				for (const [key, value] of Object.entries(data.meta)) {
					if (!/^[A-Za-z0-9_-]+$/.test(key)) {
						throw new Error(`Invalid meta key: ${key}`)
					}
					metaExpr = Sequelize.fn(
						'jsonb_set',
						metaExpr,
						Sequelize.literal(`'{${key}}'`),
						Sequelize.literal(`${Sequelize.escape(JSON.stringify(value))}::jsonb`),
						true
					)
				}

				data.meta = metaExpr
			} else {
				delete data.meta
			}

			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			return await MenteeExtension.update(data, {
				where: {
					...optionsWhere, // Allow additional where conditions
					...whereClause, // But tenant filtering takes priority
				},
				...otherOptions,
			})
		} catch (error) {
			throw error
		}
	}

	static async addVisibleToOrg(organizationId, newRelatedOrgs, tenantCode, options = {}) {
		// Safe merge: tenant filtering cannot be overridden by options.where
		const { where: optionsWhere, ...otherOptions } = options

		const whereClause1 = {
			organization_id: organizationId,
			[Op.or]: [
				{
					[Op.not]: {
						visible_to_organizations: {
							[Op.contains]: newRelatedOrgs,
						},
					},
				},
				{
					visible_to_organizations: {
						[Op.is]: null,
					},
				},
			],
			tenant_code: tenantCode,
		}

		// Update user extension and concat related org to the org id

		const newRelatedOrgsArray = Array.from(newRelatedOrgs.values())

		const newRelatedOrgsSql = newRelatedOrgsArray.map((e) => `'${e}'`).join(',')

		await MenteeExtension.update(
			{
				visible_to_organizations: sequelize.literal(
					`array_cat(COALESCE("visible_to_organizations", ARRAY[]::varchar[]), ARRAY[${newRelatedOrgsSql}]::varchar[])`
				),
			},
			{
				where: {
					tenant_code: tenantCode,
					organization_id: organizationId,
					[Op.or]: [
						{
							[Op.not]: {
								visible_to_organizations: {
									[Op.contains]: newRelatedOrgsArray,
								},
							},
						},
						{
							visible_to_organizations: {
								[Op.is]: null,
							},
						},
					],
				},
				...otherOptions,
				individualHooks: true,
			}
		)

		return await MenteeExtension.update(
			{
				visible_to_organizations: sequelize.literal(
					`COALESCE("visible_to_organizations", ARRAY[]::varchar[]) || ARRAY[${organizationId}]::varchar[]`
				),
			},
			{
				where: {
					tenant_code: tenantCode,
					organization_id: {
						[Op.in]: newRelatedOrgsArray,
					},
					[Op.or]: [
						{
							[Op.not]: {
								visible_to_organizations: {
									[Op.contains]: [organizationId],
								},
							},
						},
						{
							visible_to_organizations: {
								[Op.is]: null,
							},
						},
					],
				},
				individualHooks: true,
				...otherOptions,
			}
		)
	}

	static async removeVisibleToOrg(orgId, elementsToRemove, tenantCode) {
		const organizationUpdateQuery = `
		  UPDATE "user_extensions"
		  SET "visible_to_organizations" = COALESCE((
			SELECT array_agg(elem)
			FROM unnest("visible_to_organizations") AS elem
			WHERE elem NOT IN (:elementsToRemove)
		  ), '{}')
		  WHERE organization_id = :orgId AND tenant_code = :tenantCode
		`

		await Sequelize.query(organizationUpdateQuery, {
			replacements: { orgId, elementsToRemove, tenantCode },
			type: Sequelize.QueryTypes.UPDATE,
		})
		const relatedOrganizationUpdateQuery = `
		  UPDATE "user_extensions"
		  SET "visible_to_organizations" = COALESCE((
			SELECT array_agg(elem)
			FROM unnest("visible_to_organizations") AS elem
			WHERE elem NOT IN (:orgId)
		  ), '{}')
		  WHERE organization_id IN (:elementsToRemove) AND tenant_code = :tenantCode
		`

		await Sequelize.query(relatedOrganizationUpdateQuery, {
			replacements: { elementsToRemove, orgId, tenantCode },
			type: Sequelize.QueryTypes.UPDATE,
		})
	}
	static async getMenteeExtension(userId, attributes = [], unScoped = false, tenantCode) {
		try {
			const queryOptions = {
				where: {
					user_id: userId,
					tenant_code: tenantCode,
				},
				raw: true,
			}

			// If attributes are passed update query
			if (attributes.length > 0) {
				queryOptions.attributes = attributes
			}

			let mentee
			if (unScoped) {
				mentee = await MenteeExtension.unscoped().findOne(queryOptions)
			} else {
				mentee = await MenteeExtension.findOne(queryOptions)
			}

			if (mentee && mentee.email) {
				mentee.email = await emailEncryption.decrypt(mentee.email.toLowerCase())
			}

			return mentee
		} catch (error) {
			throw error
		}
	}

	static async removeMenteeDetails(userId, tenantCode) {
		try {
			const modelAttributes = MenteeExtension.rawAttributes

			const fieldsToNullify = {}

			for (const [key, attribute] of Object.entries(modelAttributes)) {
				// Skip primary key or explicitly excluded fields
				if (
					attribute.primaryKey ||
					key === 'user_id' ||
					key === 'organization_id' || // required field
					key === 'created_at' ||
					key === 'updated_at' ||
					key === 'is_mentor' // has default value
				) {
					continue
				}

				// Set types accordingly
				if (attribute.type.constructor.name === 'ARRAY') {
					fieldsToNullify[key] = []
				} else if (attribute.type.key === 'JSON' || attribute.type.key === 'JSONB') {
					fieldsToNullify[key] = {} // Or `{}` if you prefer default object
				} else if (key === 'deleted_at') {
					fieldsToNullify[key] = new Date() // Timestamp field
				} else if (key === 'name') {
					fieldsToNullify[key] = common.USER_NOT_FOUND
				} else {
					fieldsToNullify[key] = null
				}
			}

			return await MenteeExtension.update(fieldsToNullify, {
				where: {
					user_id: userId,
					tenant_code: tenantCode,
				},
			})
		} catch (error) {
			throw error
		}
	}

	static async deleteMenteeExtension(userId, tenantCode) {
		try {
			// Completely delete the mentee extension record
			const result = await MenteeExtension.destroy({
				where: {
					user_id: userId,
					tenant_code: tenantCode,
				},
			})

			return result
		} catch (error) {
			throw error
		}
	}

	static async getUsersByUserIds(ids, options = {}, tenantCode, unscoped = false) {
		try {
			// Safe merge: tenant filtering cannot be overridden by options.where
			const { where: optionsWhere, ...otherOptions } = options

			const query = {
				where: {
					...optionsWhere, // Allow additional where conditions
					user_id: ids,
					tenant_code: tenantCode, // Tenant filtering takes priority
				},
				...otherOptions,
				returning: true,
				raw: true,
			}

			let result = unscoped
				? await MenteeExtension.unscoped().findAll(query)
				: await MenteeExtension.findAll(query)

			await Promise.all(
				result.map(async (userInfo) => {
					if (userInfo && userInfo.email) {
						userInfo.email = await emailEncryption.decrypt(userInfo.email.toLowerCase())
					}
				})
			)

			return result
		} catch (error) {
			throw error
		}
	}

	static async getUsersByUserIdsFromView(
		ids,
		page,
		limit,
		filter,
		saasFilter = '',
		additionalProjectionclause = '',
		returnOnlyUserId,
		searchText = ''
	) {
		try {
			let additionalFilter = ''

			if (searchText) {
				additionalFilter = `AND name ILIKE :search`
			}
			if (Array.isArray(searchText)) {
				additionalFilter = `AND email IN ('${searchText.join("','")}')`
			}

			const excludeUserIds = ids.length === 0
			const userFilterClause = excludeUserIds ? '' : `user_id IN (${ids.join(',')})`

			let filterClause = filter?.query.length > 0 ? `${filter.query}` : ''

			let saasFilterClause = saasFilter !== '' ? saasFilter : ''
			if (excludeUserIds && filter.query.length === 0) {
				saasFilterClause = saasFilterClause.replace('AND ', '') // Remove "AND" if excludeUserIds is true and filter is empty
			}

			let projectionClause =
				'user_id,meta,mentee_visibility,organization_id,designation,area_of_expertise,education_qualification'

			if (returnOnlyUserId) {
				projectionClause = 'user_id'
			} else if (additionalProjectionclause !== '') {
				projectionClause += `,${additionalProjectionclause}`
			}

			if (userFilterClause && filter?.query.length > 0) {
				filterClause = filterClause.startsWith('AND') ? filterClause : 'AND' + filterClause
			}

			const viewName = utils.getTenantViewName(tenantCode, MenteeExtension.tableName)
			let query = `
				SELECT ${projectionClause}
				FROM
					${viewName}
				WHERE
					${userFilterClause}
					${filterClause}
					${saasFilterClause}
					${additionalFilter}
			`

			const replacements = {
				...filter.replacements, // Add filter parameters to replacements
				search: `%${searchText}%`,
			}

			if (page !== null && limit !== null) {
				query += `
					OFFSET
						:offset
					LIMIT
						:limit;
				`

				replacements.offset = limit * (page - 1)
				replacements.limit = limit
			}

			const mentees = await Sequelize.query(query, {
				type: QueryTypes.SELECT,
				replacements: replacements,
			})

			const countQuery = `
			SELECT count(*) AS "count"
			FROM
				${viewName}
			WHERE
				${userFilterClause}
				${filterClause}
				${saasFilterClause}
				${additionalFilter}
;
		`
			const count = await Sequelize.query(countQuery, {
				type: QueryTypes.SELECT,
				replacements: replacements,
			})

			return {
				data: mentees,
				count: Number(count[0].count),
			}
		} catch (error) {
			throw error
		}
	}
	static async getMenteeExtensions(userIds, attributes = [], tenantCode) {
		try {
			const queryOptions = { where: { user_id: { [Op.in]: userIds }, tenant_code: tenantCode }, raw: true }
			// If attributes are passed update query
			if (attributes.length > 0) {
				queryOptions.attributes = attributes
			}
			const mentee = await MenteeExtension.findAll(queryOptions)
			return mentee
		} catch (error) {
			throw error
		}
	}
	static async findOneFromView(userId, tenantCode) {
		try {
			const viewName = utils.getTenantViewName(tenantCode, MenteeExtension.tableName)
			let query = `
				SELECT *
				FROM ${viewName}
				WHERE user_id = :userId
				LIMIT 1
			`
			const user = await Sequelize.query(query, {
				replacements: { userId },
				type: QueryTypes.SELECT,
			})

			return user.length > 0 ? user[0] : null
		} catch (error) {
			throw error
		}
	}

	static async getAllUsers(
		ids,
		page,
		limit,
		filter,
		saasFilter = '',
		additionalProjectionClause = '',
		returnOnlyUserId,
		searchText = '',
		defaultFilter = '',
		tenantCode
	) {
		try {
			const excludeUserIds = ids.length === 0
			const userFilterClause = excludeUserIds ? '' : `user_id IN (${ids.map((id) => `'${id}'`).join(',')})`
			let additionalFilter = ''

			if (searchText) {
				additionalFilter = `AND name ILIKE :search`
			}
			if (Array.isArray(searchText)) {
				additionalFilter = `AND email IN ('${searchText.join("','")}')`
			}

			let filterClause = filter?.query.length > 0 ? `${filter.query}` : ''
			let saasFilterClause = saasFilter !== '' ? saasFilter : ''

			if (excludeUserIds && filter.query.length === 0) {
				saasFilterClause = saasFilterClause.replace('AND ', '') // Remove "AND" if excludeUserIds is true and filter is empty
			}

			// Tenant filtering enabled - materialized view now includes tenant_code column
			const tenantFilterClause = tenantCode ? `AND tenant_code = :tenantCode` : ''

			let projectionClause = `
				user_id,
				name,
				email,
				image,
				organization_id,
				designation,
				area_of_expertise,
				education_qualification,
				mentee_visibility,
				custom_entity_text::JSONB AS custom_entity_text,
				meta::JSONB AS meta
			`
			if (returnOnlyUserId) {
				projectionClause = 'user_id'
			} else if (additionalProjectionClause !== '') {
				projectionClause += `, ${additionalProjectionClause}`
			}

			if (userFilterClause && filter?.query.length > 0) {
				filterClause = filterClause.startsWith('AND') ? filterClause : 'AND ' + filterClause
			}

			// Build WHERE clause dynamically to avoid empty conditions
			const whereConditions = [
				userFilterClause,
				filterClause,
				saasFilterClause,
				additionalFilter,
				defaultFilter,
				tenantFilterClause,
			].filter((condition) => condition && condition.trim() !== '')

			let whereClause = ''
			if (whereConditions.length > 0) {
				// Clean up AND prefixes and join conditions
				const cleanedConditions = whereConditions.map((condition, index) => {
					if (index === 0) {
						// First condition shouldn't have AND prefix
						return condition.replace(/^AND\s+/, '')
					}
					// Subsequent conditions should have AND prefix
					return condition.startsWith('AND ') ? condition : `AND ${condition}`
				})
				whereClause = `WHERE ${cleanedConditions.join(' ')}`
			}

			const viewName = utils.getTenantViewName(tenantCode, MenteeExtension.tableName)
			const query = `
				SELECT ${projectionClause}
				FROM ${viewName}
				${whereClause}
				OFFSET :offset
				LIMIT :limit
			`

			const replacements = {
				...filter.replacements, // Add filter parameters to replacements
				search: `%${searchText}%`,
			}

			// Add tenantCode to replacements if it's being used in the query
			if (tenantCode) {
				replacements.tenantCode = tenantCode
			}

			// Always provide offset and limit replacements since they're in the query
			if (page !== null && limit !== null) {
				replacements.offset = limit * (page - 1)
				replacements.limit = limit
			} else {
				// Provide defaults if page/limit not specified
				replacements.offset = 0
				replacements.limit = 5 // Default limit
			}

			let results = await Sequelize.query(query, {
				type: QueryTypes.SELECT,
				replacements: replacements,
			})

			const countQuery = `
				SELECT COUNT(*) AS count
				FROM ${viewName}
				${whereClause}
			`

			const count = await Sequelize.query(countQuery, {
				type: QueryTypes.SELECT,
				replacements: replacements,
			})

			return {
				data: results,
				count: Number(count[0].count),
			}
		} catch (error) {
			throw error
		}
	}
	static async getAllUsersByIds(ids, tenantCode) {
		try {
			const excludeUserIds = ids.length === 0
			const userFilterClause = excludeUserIds ? '' : `user_id IN (${ids.map((id) => `'${id}'`).join(',')})`
			// No longer need tenant filtering since we use tenant-specific views

			// Since we're using tenant-specific views, no tenant filtering needed
			const whereClause = userFilterClause || '1=1' // Default to all records if no user filter

			const viewName = utils.getTenantViewName(tenantCode, MenteeExtension.tableName)
			const query = `
				SELECT *
				FROM ${viewName}
				WHERE
					${whereClause}
				`

			const results = await Sequelize.query(query, {
				type: QueryTypes.SELECT,
			})
			return results
		} catch (error) {
			throw error
		}
	}

	/**
	 * Retrieves users from the database based on the provided email IDs.
	 *
	 * This static method constructs and executes a SQL query to fetch users whose email
	 * addresses are provided in the `emailIds` array. It returns an array of user records
	 * matching the given email IDs.
	 *
	 * @param {Array<string>} emailIds - An array of email IDs to filter the users by.
	 * @returns {Promise<Array<object>>} - A promise that resolves to an array of user objects.
	 *
	 * @example
	 * const emailIds = ['user1@example.com', 'user2@example.com'];
	 * const users = await getUsersByEmailIds(emailIds);

	 */
	static async getUsersByEmailIds(emailIds, tenantCode) {
		try {
			const emailFilterClause =
				emailIds.length === 0 ? '' : `email IN (${emailIds.map((id) => `'${id}'`).join(',')})`

			// Since we're using tenant-specific views, no tenant filtering needed
			const whereClause = emailFilterClause || '1=1' // Default to all records if no email filter

			const viewName = utils.getTenantViewName(tenantCode, MenteeExtension.tableName)
			const query = `
				SELECT *
				FROM ${viewName}
				WHERE
					${whereClause}
				`

			const results = await Sequelize.query(query, {
				type: QueryTypes.SELECT,
			})
			return results
		} catch (error) {
			throw error
		}
	}

	/**
	 * Get distinct tenant codes from UserExtension table
	 * @method
	 * @name getDistinctTenantCodes
	 * @description Fetches all distinct tenant codes from the UserExtension table.
	 * This method replaces external API calls to User Service for getting tenant list.
	 * @returns {Promise<Array>} - Array of objects with 'code' property containing tenant codes
	 *
	 * @example
	 * const tenants = await getDistinctTenantCodes();
	 * // Returns: [{ code: 'tenant1' }, { code: 'tenant2' }]
	 */
	static async getDistinctTenantCodes() {
		try {
			// Validate database connection
			if (!Sequelize) {
				throw new Error('Database connection not available')
			}

			const query = `
				SELECT DISTINCT tenant_code as code 
				FROM ${MenteeExtension.tableName} 
				WHERE tenant_code IS NOT NULL 
				AND tenant_code != '' 
				AND tenant_code != 'undefined'
				ORDER BY tenant_code ASC
			`

			const tenants = await Sequelize.query(query, {
				type: QueryTypes.SELECT,
			})

			// Validate results
			if (!Array.isArray(tenants)) {
				console.warn('getDistinctTenantCodes returned non-array result')
				return []
			}

			return tenants
		} catch (error) {
			console.error('Error fetching distinct tenant codes:', error)
			return []
		}
	}

	static async getAllUsersByOrgId(orgCodes, tenantCode) {
		try {
			if (!Array.isArray(orgCodes) || orgCodes.length === 0) {
				return []
			}
			const query = `
			SELECT user_id
			FROM ${common.materializedViewsPrefix + MenteeExtension.tableName}
			WHERE organization_code IN (:orgCodes) AND tenant_code = :tenantCode
		`
			const results = await Sequelize.query(query, {
				type: QueryTypes.SELECT,
				replacements: { orgCodes, tenantCode },
			})
			return results
		} catch (error) {
			throw error
		}
	}
}
