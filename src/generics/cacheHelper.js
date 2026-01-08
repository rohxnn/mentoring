/* eslint-disable no-console */
const { RedisCache, InternalCache } = require('elevate-node-cache')
const md5 = require('md5')
const common = require('@constants/common')

// Import database queries for fallback
const { Op } = require('sequelize')
const mentorQueries = require('@database/queries/mentorExtension')
const userQueries = require('@database/queries/userExtension')
const organisationExtensionQueries = require('@database/queries/organisationExtension')
const entityTypeQueries = require('@database/queries/entityType')
const notificationTemplateQueries = require('@database/queries/notificationTemplate')
const sessionQueries = require('@database/queries/sessions')
const permissionQueries = require('@database/queries/permissions')
const rolePermissionMappingQueries = require('@database/queries/role-permission-mapping')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const kafkaCommunication = require('@generics/kafka-communication')
// Removed SessionsHelper import to avoid circular dependency
const formQueries = require('@database/queries/form')

/** CONFIG */
const CACHE_CONFIG = (() => {
	try {
		if (process.env.CACHE_CONFIG) return JSON.parse(process.env.CACHE_CONFIG)
		return common.CACHE_CONFIG
	} catch {
		return common.CACHE_CONFIG
	}
})()

const ENABLE_CACHE = pickBool(CACHE_CONFIG.enableCache)
const SHARDS = toInt(CACHE_CONFIG.shards, 32)
const BATCH = toInt(CACHE_CONFIG.scanBatch, 1000)
const SHARD_RETENTION_DAYS = toInt(CACHE_CONFIG.shardRetentionDays, 7)

function toInt(v, d) {
	const n = parseInt(v, 10)
	return Number.isFinite(n) ? n : d
}
function pickBool(v) {
	if (typeof v === 'boolean') return v
	if (typeof v === 'string') {
		return v.toLowerCase() === 'true'
	}
	return false
}
function tenantKey(tenantCode, parts = []) {
	return ['tenant', tenantCode, ...parts].join(':')
}
function orgKey(tenantCode, orgCode, parts = []) {
	return ['tenant', tenantCode, 'org', orgCode, ...parts].join(':')
}
function namespaceEnabled(ns) {
	if (!ns) return true
	const nsCfg = CACHE_CONFIG.namespaces && CACHE_CONFIG.namespaces[ns]
	return !(nsCfg && nsCfg.enabled === false)
}

/**
 * TTL resolution for namespace.
 * callerTtl (explicit) wins.
 * fallback to namespace.defaultTtl.
 * fallback to undefined (no expiry).
 */
function nsTtl(ns, callerTtl) {
	if (callerTtl != null) return Number(parseInt(callerTtl, 10))
	const nsCfg = CACHE_CONFIG.namespaces && CACHE_CONFIG.namespaces[ns]
	const v = nsCfg && nsCfg.defaultTtl
	return v != null ? Number(parseInt(v, 10)) : undefined
}

/**
 * Determine whether to use internal (in-memory) cache for this namespace.
 * callerUseInternal (explicit param) wins.
 * Otherwise check namespace.useInternal, then global CACHE_CONFIG.useInternal, then false.
 */
function nsUseInternal(ns, callerUseInternal) {
	if (callerUseInternal && typeof callerUseInternal === 'boolean') return callerUseInternal
	const nsCfg = CACHE_CONFIG.namespaces && CACHE_CONFIG.namespaces[ns]
	if (nsCfg && typeof nsCfg.useInternal === 'boolean') return nsCfg.useInternal
	if (typeof CACHE_CONFIG.useInternal === 'boolean') return CACHE_CONFIG.useInternal
	return false
}

function namespacedKey({ tenantCode, orgCode, ns, id }) {
	const base = orgCode ? orgKey(tenantCode, orgCode, []) : tenantKey(tenantCode, [])
	return [base, ns, id].filter(Boolean).join(':')
}

/** New simple key builder (no version tokens) */
async function buildKey({ tenantCode, orgCode, ns, id, key }) {
	// If caller provided ns or id, treat as namespaced.
	const isNamespaced = Boolean(ns || id)
	if (isNamespaced) {
		const effNs = ns || 'ns'
		const base = orgCode ? orgKey(tenantCode, orgCode, []) : tenantKey(tenantCode, [])
		const final = [base, effNs, id || key].filter(Boolean).join(':')
		return final
	}
	// tenant-level key
	const base = tenantKey(tenantCode, [])
	const final = [base, key].filter(Boolean).join(':')
	return final
}

function shardOf(key) {
	const h = md5(key)
	const asInt = parseInt(h.slice(0, 8), 16)
	return (asInt >>> 0) % SHARDS
}

/** Low-level redis client (best-effort) */
function getRedisClient() {
	try {
		if (RedisCache && typeof RedisCache.native === 'function') return RedisCache.native()
	} catch (err) {
		console.log(err, 'error in getting native redis client')
	}
}

/** Base ops (Exclusive cache usage based on useInternal flag) */
async function get(key, { useInternal = false } = {}) {
	if (!ENABLE_CACHE) return null

	if (useInternal) {
		// Use ONLY InternalCache when useInternal=true
		console.log(`📋 [CACHE GET] Using ONLY InternalCache for key: ${key}`)
		if (InternalCache && InternalCache.getKey) {
			try {
				return InternalCache.getKey(key)
			} catch (e) {
				console.error('InternalCache get error', e)
			}
		}
		return null
	} else {
		// Use ONLY Redis when useInternal=false
		console.log(`📋 [CACHE GET] Using ONLY Redis for key: ${key}`)
		try {
			const val = await RedisCache.getKey(key)
			if (val !== null && val !== undefined) return val
		} catch (e) {
			console.error('redis get error', e)
		}
		return null
	}
}

async function set(key, value, ttlSeconds, { useInternal = false } = {}) {
	if (!ENABLE_CACHE) return false

	if (useInternal) {
		// Use ONLY InternalCache when useInternal=true
		console.log(`💾 [CACHE SET] Using ONLY InternalCache for key: ${key}`)
		if (InternalCache && InternalCache.setKey) {
			try {
				InternalCache.setKey(key, value)
				return true
			} catch (e) {
				console.error('InternalCache set error', e)
				return false
			}
		}
		return false
	} else {
		// Use ONLY Redis when useInternal=false
		console.log(`💾 [CACHE SET] Using ONLY Redis for key: ${key}`)
		try {
			if (ttlSeconds) await RedisCache.setKey(key, value, ttlSeconds)
			else await RedisCache.setKey(key, value)
			return true
		} catch (e) {
			console.error('redis set error', e)
			return false
		}
	}
}

async function del(key, { useInternal = false } = {}) {
	if (useInternal) {
		// Use ONLY InternalCache when useInternal=true
		console.log(`🗑️ [CACHE DEL] Using ONLY InternalCache for key: ${key}`)
		if (InternalCache && InternalCache.delKey) {
			try {
				InternalCache.delKey(key)
				console.log(`✅ [CACHE DEL] Successfully deleted InternalCache key: ${key}`)
			} catch (e) {
				console.error('❌ [CACHE DEL] InternalCache del error for key:', key, e)
			}
		}
	} else {
		// Use ONLY Redis when useInternal=false
		console.log(`🗑️ [CACHE DEL] Using ONLY Redis for key: ${key}`)
		try {
			await RedisCache.deleteKey(key)
			console.log(`✅ [CACHE DEL] Successfully deleted Redis key: ${key}`)
		} catch (e) {
			console.error('❌ [CACHE DEL] Redis del error for key:', key, e)
		}
	}
}

/**
 * getOrSet
 * - key (fallback id)
 * - tenantCode
 * - ttl (optional): explicit TTL seconds
 * - fetchFn: function that returns value
 * - orgCode, ns, id: for namespaced keys
 * - useInternal: optional boolean override. If omitted, resolved from namespace/config.
 */
async function getOrSet({ key, tenantCode, ttl = undefined, fetchFn, orgCode, ns, id, useInternal = undefined }) {
	if (!namespaceEnabled(ns)) return await fetchFn()

	const resolvedUseInternal = nsUseInternal(ns, useInternal)
	// build simple key (no version token)
	const fullKey =
		ns || id
			? await buildKey({ tenantCode, orgCode, ns: ns || 'ns', id: id || key })
			: await buildKey({ tenantCode, key })

	const cached = await get(fullKey, { useInternal: resolvedUseInternal })
	if (cached !== null && cached !== undefined) return cached

	const value = await fetchFn()
	if (value !== undefined) {
		await set(fullKey, value, nsTtl(ns, ttl), { useInternal: resolvedUseInternal })
	}
	return value
}

/** Scoped set that uses namespace TTL and namespace useInternal setting
 * Returns the key that was written.
 */
async function setScoped({ tenantCode, orgCode = '', ns, id, value, ttl = undefined, useInternal = undefined }) {
	if (!namespaceEnabled(ns)) return null
	const resolvedUseInternal = nsUseInternal(ns, useInternal)
	let fullKey
	if (orgCode) {
		fullKey = await buildKey({ tenantCode, orgCode, ns, id })
	} else {
		fullKey = await buildKey({ tenantCode, ns, id })
	}
	await set(fullKey, value, nsTtl(ns, ttl), { useInternal: resolvedUseInternal })
	return fullKey
}

/** Scoped delete that uses namespace config (TTL/useInternal)
 * Returns the key that was deleted.
 */
async function delScoped({ tenantCode, orgCode, ns, id, useInternal = undefined }) {
	if (!namespaceEnabled(ns)) return null
	const resolvedUseInternal = nsUseInternal(ns, useInternal)
	const fullKey = await buildKey({ tenantCode, orgCode, ns, id })
	await del(fullKey, { useInternal: resolvedUseInternal })
	return fullKey
}

/**
 * Evict all keys for a namespace.
 * If orgCode is provided will target org-level keys, otherwise tenant-level keys.
 * patternSuffix defaults to '*' (delete all keys under the namespace).
 */
async function evictNamespace({ tenantCode, orgCode = null, ns, patternSuffix = '*' } = {}) {
	if (!tenantCode || !ns) return
	if (!namespaceEnabled(ns)) return
	const base = orgCode ? `tenant:${tenantCode}:org:${orgCode}` : `tenant:${tenantCode}`
	const pattern = `${base}:${ns}:${patternSuffix}`
	await scanAndDelete(pattern)
}

/**
 * Eviction helpers using SCAN by pattern.
 * These do not require any tracked sets. Caller should build patterns to match keys to remove.
 *
 * - scanAndDelete(pattern, opts)
 *    pattern: glob-style pattern for SCAN (e.g. "tenant:acme:org:123:*")
 *    opts.batchSize: number of keys to fetch per SCAN iteration (default BATCH)
 *    opts.unlink: if true will attempt UNLINK when available
 */
async function scanAndDelete(pattern, { batchSize = BATCH, unlink = true } = {}) {
	const redis = getRedisClient()
	if (!redis) return
	let cursor = '0'
	do {
		const res = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize)
		cursor = res && res[0] ? res[0] : '0'
		const keys = res && res[1] ? res[1] : []
		if (keys.length) {
			try {
				if (unlink && typeof redis.unlink === 'function') await redis.unlink(...keys)
				else await redis.del(...keys)
			} catch (e) {
				for (const k of keys) {
					try {
						if (unlink && typeof redis.unlink === 'function') await redis.unlink(k)
						else await redis.del(k)
					} catch (__) {}
				}
			}
		}
	} while (cursor !== '0')
}

/** Evict all keys for a tenant + org by pattern */
async function evictOrgByPattern(tenantCode, orgId, { patternSuffix = '*' } = {}) {
	if (!tenantCode || !orgId) return
	const pattern = `tenant:${tenantCode}:org:${orgId}:${patternSuffix}`
	await scanAndDelete(pattern)
}

/** Evict tenant-level keys by pattern */
async function evictTenantByPattern(tenantCode, { patternSuffix = '*' } = {}) {
	if (!tenantCode) return
	const pattern = `tenant:${tenantCode}:${patternSuffix}`
	await scanAndDelete(pattern)
}

// === NAMESPACE-SPECIFIC HELPERS ===

/**
 * Sessions Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:sessions:id
 */
const sessions = {
	async get(tenantCode, sessionId) {
		try {
			const cacheKey = await buildKey({ tenantCode, ns: 'sessions', id: sessionId })
			const useInternal = nsUseInternal('sessions')

			const cachedSession = await get(cacheKey, { useInternal })
			if (cachedSession) {
				console.log(`💾 Session ${sessionId} retrieved from cache: tenant:${tenantCode}`)
				return cachedSession
			}

			// Cache miss - fallback to database query
			console.log(`💾 Session ${sessionId} cache miss, fetching from database: tenant:${tenantCode}`)
			return null
		} catch (error) {
			console.error(`❌ Failed to get session ${sessionId} from cache/database:`, error)
			return null
		}
	},

	async set(tenantCode, sessionId, sessionData, customTtl = null) {
		// Calculate special TTL for sessions based on end_date + 1 day
		let ttl = customTtl
		if (!ttl && sessionData.end_date) {
			const endDate = new Date(parseInt(sessionData.end_date) * 1000)
			const oneDayAfterEnd = new Date(endDate.getTime() + 24 * 60 * 60 * 1000)
			const now = new Date()
			const ttlMs = Math.max(oneDayAfterEnd.getTime() - now.getTime(), 0)
			ttl = Math.floor(ttlMs / 1000) || 86400 // fallback to 1 day
		}

		return setScoped({
			tenantCode,
			ns: 'sessions',
			id: sessionId,
			value: sessionData,
			ttl,
		})
	},

	async delete(tenantCode, sessionId) {
		const useInternal = nsUseInternal('sessions')
		const cacheKey = await buildKey({ tenantCode, ns: 'sessions', id: sessionId })
		return del(cacheKey, { useInternal })
	},

	async reset(tenantCode, sessionId, sessionData, customTtl = null) {
		return this.set(tenantCode, sessionId, sessionData, customTtl)
	},

	/**
	 * Get session from cache only. Returns null if cache miss.
	 * @param {string} tenantCode - Tenant code
	 * @param {string} organizationCode - Organization code
	 * @param {string} sessionId - Session ID
	 * @returns {Promise<Object|null>} Session data from cache or null
	 */
	async getCacheOnly(tenantCode, sessionId) {
		try {
			const cacheKey = await buildKey({ tenantCode, ns: 'sessions', id: sessionId })
			const useInternal = nsUseInternal('sessions')
			return await get(cacheKey, { useInternal })
		} catch (error) {
			console.error(`❌ [sessions.getCacheOnly] Error for session ${sessionId}:`, error)
			return null
		}
	},

	/**
	 * Send missing session IDs to Kafka for background cache warming (fire-and-forget)
	 * @private
	 */
	async _sendToKafkaBackground(sessionIds, tenantCode, organizationCode) {
		if (sessionIds.length === 0) return

		console.log(
			`🚀 [getSessionKafka] Sending batch of ${sessionIds.length} sessions to Kafka for background cache warming`
		)

		// Create session batch array for optimized processing
		const sessionBatch = sessionIds.map((sessionId) => ({
			sessionId: sessionId,
			tenantCode: tenantCode,
			organizationCode: organizationCode,
		}))

		// Send single batch message instead of individual messages
		try {
			const batchMessage = {
				tenantCode: tenantCode,
				organizationCode: organizationCode,
				sessionBatch: sessionBatch,
			}

			await kafkaCommunication.pushToKafka({
				topic: process.env.SESSION_FETCH_TOPIC || 'dev.mentoring.session-fetch',
				message: batchMessage,
			})

			console.log(`✅ [getSessionKafka] Batch message sent: ${sessionBatch.length} sessions`)
		} catch (kafkaError) {
			// Silent fail - background cache warming should not affect main flow
			console.error(`⚠️ [getSessionKafka] Background Kafka batch send failed:`, kafkaError.message)
		}
	},

	/**
	 * Smart cache-first approach with immediate DB fetch + background Kafka cache warming
	 * @param {string} tenantCode - Tenant code for multi-tenancy
	 * @param {string} organizationCode - Organization code
	 * @param {Array|string} sessionIds - Array of session IDs or single session ID
	 * @returns {Promise<Array|Object>} Complete array of session objects or single session object
	 */
	async getSessionKafka(tenantCode, organizationCode, sessionIds) {
		try {
			// Handle single session ID case
			if (typeof sessionIds === 'string') {
				return await this.get(tenantCode, organizationCode, sessionIds)
			}

			// Handle array case - smart caching with immediate DB fetch
			if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
				return []
			}

			const foundSessions = []
			const missingSessionIds = []

			// Step 1: Check cache for each session ID
			console.log(`🔍 [getSessionKafka] Checking cache for ${sessionIds.length} sessions`)
			for (const sessionId of sessionIds) {
				const cachedSession = await this.getCacheOnly(tenantCode, sessionId)
				if (cachedSession) {
					foundSessions.push(cachedSession)
				} else {
					missingSessionIds.push(sessionId)
				}
			}

			// Step 2: If all found in cache, return immediately
			if (missingSessionIds.length === 0) {
				console.log(`💾 [getSessionKafka] All ${sessionIds.length} sessions found in cache`)
				return foundSessions
			}

			console.log(
				`⚡ [getSessionKafka] Cache hits: ${foundSessions.length}/${sessionIds.length}, fetching ${missingSessionIds.length} from DB`
			)

			// Step 3: Send missing session IDs to Kafka for background cache warming (fire-and-forget)
			this._sendToKafkaBackground(missingSessionIds, tenantCode, organizationCode)

			// Step 4: Fetch missing sessions from DB immediately using service method
			const dbFetchedSessions = []
			for (const sessionId of missingSessionIds) {
				try {
					console.log(`🔄 [getSessionKafka] Fetching session ${sessionId} from database`)
					// Direct database query to avoid circular dependency
					const sessionDetails = await sessionQueries.findOne({ id: sessionId }, tenantCode, { raw: true })

					if (sessionDetails) {
						// Cache the session data directly
						await this.set(tenantCode, organizationCode, sessionId, sessionDetails)
						dbFetchedSessions.push(sessionDetails)
						console.log(`✅ [getSessionKafka] Session ${sessionId} fetched and cached`)
					}
				} catch (dbError) {
					console.error(`❌ [getSessionKafka] Failed to fetch session ${sessionId} from DB:`, dbError.message)
					// Continue with other sessions - don't fail entire operation
				}
			}

			// Step 5: Merge cached sessions + DB fetched sessions
			const finalResult = [...foundSessions, ...dbFetchedSessions]

			console.log(
				`📊 [getSessionKafka] Final result: ${finalResult.length}/${sessionIds.length} sessions (${foundSessions.length} cached, ${dbFetchedSessions.length} DB fetched)`
			)

			return finalResult
		} catch (error) {
			console.error(`❌ [getSessionKafka] Error processing session IDs:`, error)
			// Fallback to regular cache method for all session IDs
			const fallbackResults = []
			for (const sessionId of Array.isArray(sessionIds) ? sessionIds : [sessionIds]) {
				try {
					const session = await this.get(tenantCode, organizationCode, sessionId)
					if (session) fallbackResults.push(session)
				} catch (fallbackError) {
					console.error(
						`❌ [getSessionKafka] Fallback failed for session ${sessionId}:`,
						fallbackError.message
					)
				}
			}
			return typeof sessionIds === 'string' ? fallbackResults[0] || null : fallbackResults
		}
	},
}

/**
 * EntityTypes Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:entityTypes:model:${modelName}:${entityValue}
 * Stores individual entity types WITH their entities, TTL: 1 day
 */
const entityTypes = {
	async get(tenantCode, orgCode, modelName, entityValue) {
		try {
			const compositeId = `model:${modelName}:${entityValue}`
			const useInternal = nsUseInternal('entityTypes')

			// Step 1: Check user-specific cache first
			const userKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'entityTypes', id: compositeId })
			const cachedEntityType = await get(userKey, { useInternal })
			if (cachedEntityType) {
				console.log(
					`💾 EntityType ${modelName}:${entityValue} retrieved from user cache: tenant:${tenantCode}:org:${orgCode}`
				)
				return cachedEntityType
			}

			// Step 2: Get defaults internally for database query
			let defaults = null
			try {
				defaults = await getDefaults()
			} catch (error) {
				console.error('Failed to get defaults for entityType cache:', error.message)
				// Fallback defaults from environment variables
				defaults = {
					orgCode: process.env.DEFAULT_ORGANISATION_CODE || 'default_code',
					tenantCode: process.env.DEFAULT_TENANT_CODE || 'default',
				}
			}

			// Step 3: Cache miss - query database with user codes first
			console.log(
				`💾 EntityType ${modelName}:${entityValue} cache miss, querying database with user codes: tenant:${tenantCode}:org:${orgCode}`
			)

			let entityTypeFromDb = []
			try {
				// Step 1: Fetch from user tenant and org codes
				const userFilter = {
					status: 'ACTIVE',
					organization_code: orgCode,
					model_names: { [Op.contains]: [modelName] },
					value: entityValue,
				}
				const userEntityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(userFilter, [tenantCode])
				if (userEntityTypes && userEntityTypes.length > 0) {
					entityTypeFromDb.push(...userEntityTypes)
					console.log(
						`💾 EntityType ${modelName}:${entityValue} found in user tenant/org: ${userEntityTypes.length} results`
					)
				}

				// Step 2: ALSO fetch from default codes (if different from user codes)
				if (
					defaults &&
					defaults.orgCode &&
					defaults.tenantCode &&
					(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
				) {
					console.log(
						`💾 EntityType ${modelName}:${entityValue} also fetching from defaults: tenant:${defaults.tenantCode}:org:${defaults.orgCode}`
					)

					const defaultFilter = {
						status: 'ACTIVE',
						organization_code: defaults.orgCode,
						model_names: { [Op.contains]: [modelName] },
						value: entityValue,
					}
					const defaultEntityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(defaultFilter, [
						defaults.tenantCode,
					])
					if (defaultEntityTypes && defaultEntityTypes.length > 0) {
						// Merge defaults, avoiding duplicates by ID
						const existingIds = new Set(entityTypeFromDb.map((et) => et.id))
						const newEntityTypes = defaultEntityTypes.filter((et) => !existingIds.has(et.id))
						entityTypeFromDb.push(...newEntityTypes)
						console.log(
							`💾 EntityType ${modelName}:${entityValue} found in defaults: ${defaultEntityTypes.length} results, ${newEntityTypes.length} unique added`
						)
					}
				}
			} catch (dbError) {
				console.error(`Failed to fetch entityType ${modelName}:${entityValue} from database:`, dbError.message)
				return null
			}

			// Step 5: Cache result under user tenant/org (regardless of where entityType was found)
			if (entityTypeFromDb && entityTypeFromDb.length > 0) {
				await this.set(tenantCode, orgCode, modelName, entityValue, entityTypeFromDb)
				console.log(
					`💾 EntityType ${modelName}:${entityValue} fetched from database and cached under user context: tenant:${tenantCode}:org:${orgCode}`
				)
				return entityTypeFromDb
			}

			// Step 6: EntityType not found in any location
			console.log(
				`❌ EntityType ${modelName}:${entityValue} not found in database for user: tenant:${tenantCode}:org:${orgCode} or defaults`
			)
			return null
		} catch (error) {
			console.error(`❌ Failed to get entityType ${modelName}:${entityValue} from cache/database:`, error)
			return null
		}
	},

	async set(tenantCode, orgCode, modelName, entityValue, entityTypeData) {
		const compositeId = `model:${modelName}:${entityValue}`
		return setScoped({
			tenantCode,
			orgCode: orgCode,
			ns: 'entityTypes',
			id: compositeId,
			value: entityTypeData,
			ttl: 86400, // 1 day TTL
		})
	},

	async delete(tenantCode, orgCode, modelName, entityValue) {
		const compositeId = `model:${modelName}:${entityValue}`
		const useInternal = nsUseInternal('entityTypes')
		const cacheKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'entityTypes', id: compositeId })
		return del(cacheKey, { useInternal })
	},

	// Clear all entityTypes cache for a tenant/org (useful after cache key format changes)
	async clearAll(tenantCode, orgCode) {
		return await evictNamespace({ tenantCode, orgCode: orgCode, ns: 'entityTypes' })
	},

	/**
	 * Get all entity types for a specific model using direct database query
	 * @param {string} tenantCode - Tenant code
	 * @param {string} orgCode - Organization code
	 * @param {string} modelName - Model name (e.g., 'Session', 'UserExtension')
	 * @returns {Promise<Array>} Array of all entity types for the model
	 */
	async getAllEntityTypesForModel(tenantCode, orgCode, modelName) {
		try {
			// Get defaults internally for database query
			let defaults = null
			try {
				defaults = await getDefaults()
			} catch (error) {
				console.error('Failed to get defaults for getAllEntityTypesForModel:', error.message)
				// Fallback defaults from environment variables
				defaults = {
					orgCode: process.env.DEFAULT_ORGANISATION_CODE || 'default_code',
					tenantCode: process.env.DEFAULT_TENANT_CODE || 'default',
				}
			}

			let entityTypes = []
			try {
				// Step 1: Fetch from user tenant and org codes
				const userFilter = {
					status: 'ACTIVE',
					organization_code: orgCode,
					model_names: { [Op.contains]: [modelName] },
				}
				const userEntityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(userFilter, [tenantCode])
				if (userEntityTypes && userEntityTypes.length > 0) {
					entityTypes.push(...userEntityTypes)
					console.log(
						`💾 Entity types for model ${modelName} found in user tenant/org: ${userEntityTypes.length} results`
					)
				}

				// Step 2: ALSO fetch from default codes (if different from user codes)
				if (
					defaults &&
					defaults.orgCode &&
					defaults.tenantCode &&
					(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
				) {
					console.log(
						`💾 Entity types for model ${modelName} also fetching from defaults: tenant:${defaults.tenantCode}:org:${defaults.orgCode}`
					)

					const defaultFilter = {
						status: 'ACTIVE',
						organization_code: defaults.orgCode,
						model_names: { [Op.contains]: [modelName] },
					}
					const defaultEntityTypes = await entityTypeQueries.findUserEntityTypesAndEntities(defaultFilter, [
						defaults.tenantCode,
					])
					if (defaultEntityTypes && defaultEntityTypes.length > 0) {
						// Merge defaults, avoiding duplicates by ID
						const existingIds = new Set(entityTypes.map((et) => et.id))
						const newEntityTypes = defaultEntityTypes.filter((et) => !existingIds.has(et.id))
						entityTypes.push(...newEntityTypes)
						console.log(
							`💾 Entity types for model ${modelName} found in defaults: ${defaultEntityTypes.length} results, ${newEntityTypes.length} unique added`
						)
					}
				}
			} catch (dbError) {
				console.error(`Failed to fetch entity types for model ${modelName} from database:`, dbError.message)
				return []
			}

			// Cache each entity type individually using standard cache pattern
			if (entityTypes && entityTypes.length > 0) {
				for (const entityType of entityTypes) {
					try {
						await this.set(tenantCode, orgCode, modelName, entityType.value, [entityType])
					} catch (cacheError) {
						// Continue if caching fails for individual entity type
					}
				}
				console.log(
					`💾 Cached ${entityTypes.length} entity types for model ${modelName} under user context: tenant:${tenantCode}:org:${orgCode}`
				)
			}

			return entityTypes || []
		} catch (error) {
			console.error(`❌ Failed to get all entity types for model ${modelName}:`, error)
			return []
		}
	},

	/**
	 * Get entity types for specific model with mentor org code resolution using standard cache
	 * @param {string} tenantCode - Tenant code
	 * @param {string} currentOrgCode - Current organization code
	 * @param {string} mentorOrganizationId - Mentor's organization ID (numeric)
	 * @param {string} modelName - Model name ('Session' or 'UserExtension')
	 * @returns {Promise<Array>} Array of entity types
	 */
	async getEntityTypesWithMentorOrg(tenantCode, currentOrgCode, mentorOrganizationId, modelName) {
		try {
			// Step 1: Get mentor organization code using organization cache
			let mentorOrgCode = null
			if (mentorOrganizationId) {
				try {
					const mentorOrg = await organizations.get(tenantCode, currentOrgCode, mentorOrganizationId)
					mentorOrgCode = mentorOrg?.organization_code
				} catch (orgCacheError) {
					console.warn('Organization cache lookup failed, falling back to database query')
					// Fallback: Direct database query for organization code
					const organisationExtensionQueries = require('@database/queries/organisationExtension')
					const orgData = await organisationExtensionQueries.findOne(
						{ organization_id: mentorOrganizationId },
						tenantCode,
						{ attributes: ['organization_code'], raw: true }
					)
					mentorOrgCode = orgData?.organization_code
				}
			}

			// Step 2: Use mentor org code if available, otherwise current org code
			const effectiveOrgCode = mentorOrgCode || currentOrgCode

			// Step 3: Get entity types for the specific model and org
			return await this.getAllEntityTypesForModel(tenantCode, effectiveOrgCode, modelName)
		} catch (error) {
			console.error('Failed to get entity types with mentor org resolution:', error)
			return []
		}
	},
}

/**
 * Forms Cache Helpers
 * Unified Pattern: tenant:${tenantCode}:org:${orgCode}:forms:${type}:${subtype}
 * Single cache pattern for all form operations
 */
const forms = {
	/**
	 * Get specific form by type and subtype with user-centric caching and defaults fallback
	 */
	async get(tenantCode, orgCode, type, subtype) {
		try {
			const compositeId = `${type}:${subtype}`
			const useInternal = nsUseInternal('forms')

			// Step 1: Check user-specific cache first
			const userCacheKey = await buildKey({
				tenantCode,
				orgCode,
				ns: 'forms',
				id: compositeId,
			})
			const cachedForm = await get(userCacheKey, { useInternal })
			if (cachedForm) {
				console.log(`💾 Form ${type}:${subtype} retrieved from user cache: tenant:${tenantCode}:org:${orgCode}`)
				return cachedForm
			}

			// Step 2: Get defaults internally for database query
			let defaults = null
			try {
				defaults = await getDefaults()
			} catch (error) {
				console.error('Failed to get defaults for form cache:', error.message)
				// Fallback defaults from environment variables
				defaults = {
					orgCode: process.env.DEFAULT_ORGANISATION_CODE || 'default_code',
					tenantCode: process.env.DEFAULT_TENANT_CODE || 'default',
				}
			}

			// Step 3: Cache miss - query database with user codes first
			console.log(
				`💾 Form ${type}:${subtype} cache miss, querying database with user codes: tenant:${tenantCode}:org:${orgCode}`
			)

			let formFromDb = null
			try {
				// First try with user tenant and org codes
				formFromDb = await formQueries.findOne(
					{
						type: type,
						sub_type: subtype,
						organization_code: orgCode,
					},
					tenantCode
				)

				// Step 4: If not found with user codes and defaults exist, try with default codes
				if (
					!formFromDb &&
					defaults &&
					defaults.orgCode &&
					defaults.tenantCode &&
					(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
				) {
					console.log(
						`💾 Form ${type}:${subtype} not found with user codes, trying defaults: tenant:${defaults.tenantCode}:org:${defaults.orgCode}`
					)

					formFromDb = await formQueries.findOne(
						{
							type: type,
							sub_type: subtype,
							organization_code: defaults.orgCode,
						},
						defaults.tenantCode
					)
				}
			} catch (dbError) {
				console.error(`Failed to fetch form ${type}:${subtype} from database:`, dbError.message)
				return null
			}

			// Step 5: Cache result under user tenant/org (regardless of where form was found)
			if (formFromDb) {
				await this.set(tenantCode, orgCode, type, subtype, formFromDb)
				console.log(
					`💾 Form ${type}:${subtype} fetched from database and cached under user context: tenant:${tenantCode}:org:${orgCode}`
				)
				return formFromDb
			}

			// Step 6: Form not found in any location
			console.log(
				`❌ Form ${type}:${subtype} not found in database for user: tenant:${tenantCode}:org:${orgCode} or defaults`
			)
			return null
		} catch (error) {
			console.error(`❌ Failed to get form ${type}:${subtype} from cache/database:`, error)
			return null
		}
	},

	/**
	 * Set specific form with 1-day TTL
	 */
	async set(tenantCode, orgCode, type, subtype, formData) {
		const compositeId = `${type}:${subtype}`
		return setScoped({
			tenantCode,
			orgCode: orgCode,
			ns: 'forms',
			id: compositeId,
			value: formData,
			ttl: 86400, // 1 day TTL
		})
	},

	/**
	 * Delete specific form cache
	 */
	async delete(tenantCode, orgCode, type, subtype) {
		const compositeId = `${type}:${subtype}`
		const useInternal = nsUseInternal('forms')
		const cacheKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'forms', id: compositeId })
		return del(cacheKey, { useInternal })
	},

	/**
	 * Invalidate all form-related cache for a tenant/org
	 */
	async evictAll(tenantCode, orgCode) {
		return await evictNamespace({ tenantCode, orgCode: orgCode, ns: 'forms' })
	},
}

/**
 * Organizations Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:organizations:id
 */
const organizations = {
	async get(tenantCode, orgCode, organizationId) {
		try {
			const cacheKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'organizations', id: organizationId })
			const useInternal = nsUseInternal('organizations')
			const cachedOrg = await get(cacheKey, { useInternal })
			if (cachedOrg) {
				console.log(
					`💾 Organization ${organizationId} retrieved from cache: tenant:${tenantCode}:org:${orgCode}`
				)
				return cachedOrg
			}

			// Cache miss - fallback to database query
			console.log(
				`💾 Organization ${organizationId} cache miss, fetching from database: tenant:${tenantCode}:org:${orgCode}`
			)
			const orgFromDb = await organisationExtensionQueries.getById(orgCode, tenantCode)

			if (orgFromDb) {
				// Cache the fetched data for future requests
				await this.set(tenantCode, orgCode, organizationId, orgFromDb)
				console.log(
					`💾 Organization ${organizationId} fetched from database and cached: tenant:${tenantCode}:org:${orgCode}`
				)
			}

			return orgFromDb
		} catch (error) {
			console.error(`❌ Failed to get organization ${organizationId} from cache/database:`, error)
			return null
		}
	},

	async set(tenantCode, orgCode, organizationId, orgData) {
		return setScoped({
			tenantCode,
			orgCode: orgCode,
			ns: 'organizations',
			id: organizationId,
			value: orgData,
		})
	},

	async delete(tenantCode, orgCode, organizationId) {
		const useInternal = nsUseInternal('organizations')
		const cacheKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'organizations', id: organizationId })
		return del(cacheKey, { useInternal })
	},
}

/**
 * Mentor Profile Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:mentor:${id}
 * TTL: 1 day (86400 seconds)
 */
const mentor = {
	async get(tenantCode, mentorId) {
		try {
			// Cache mode: Check cache first
			const cacheKey = await buildKey({ tenantCode, ns: 'mentor', id: mentorId })
			const useInternal = nsUseInternal('mentor')
			const cachedProfile = await get(cacheKey, { useInternal })
			if (cachedProfile) {
				return cachedProfile
			}

			const rawExtension = await mentorQueries.getMentorExtension(mentorId, [], false, tenantCode)
			return rawExtension
		} catch (error) {
			console.error(`❌ Failed to get mentor profile ${mentorId} from cache/database:`, error)
			return null
		}
	},

	async set(tenantCode, mentorId, profileData) {
		try {
			// Sanitize profile data - remove fields that are cached separately
			const sanitizedData = this._sanitizeProfileData(profileData)

			const cacheKey = await buildKey({ tenantCode, ns: 'mentor', id: mentorId })
			const useInternal = nsUseInternal('mentor')
			await set(cacheKey, sanitizedData, 86400, { useInternal }) // 1 day TTL
		} catch (error) {
			console.error(`❌ Failed to cache mentor profile ${mentorId}:`, error)
		}
	},

	async delete(tenantCode, mentorId) {
		try {
			const cacheKey = await buildKey({ tenantCode, ns: 'mentor', id: mentorId })
			const useInternal = nsUseInternal('mentor')
			await del(cacheKey, { useInternal })
			// Mentor cache deleted
		} catch (error) {
			console.error(`❌ Failed to delete mentor profile ${mentorId} cache:`, error)
		}
	},

	_sanitizeProfileData(profileData) {
		const sanitized = { ...profileData }

		// Cache complete profile data for direct API response
		// Only remove truly sensitive data that should never be cached

		// Remove only downloadable URLs that might expire
		if (sanitized.image && typeof sanitized.image === 'string' && sanitized.image.includes('download')) {
			delete sanitized.image
		}

		// Keep all other fields including:
		// - displayProperties (needed for direct API response)
		// - Permissions (needed for direct API response)
		// - email (needed for complete profile response)
		// - email_verified (needed for complete profile response)
		// - connectedUsers (needed for complete profile response)

		return sanitized
	},

	/**
	 * Get mentor profile from cache only. Returns null if cache miss or no data.
	 * @param {string} tenantCode - Tenant code for multi-tenancy
	 * @param {string} id - Mentor user ID
	 * @returns {Promise<Object|null>} Profile data from cache or null if cache miss
	 */
	async getCacheOnly(tenantCode, id) {
		try {
			// Cache mode: Check cache first
			const cacheKey = await buildKey({ tenantCode, ns: 'mentor', id: id })
			const useInternal = nsUseInternal('mentor')
			const cachedProfile = await get(cacheKey, { useInternal })
			if (cachedProfile) {
				return cachedProfile
			}

			return null
		} catch (error) {
			console.error(`❌ [mentor.getCacheOnly] Error for profile ${id}:`, error)
			return null
		}
	},

	/**
	 * Send missing user IDs to Kafka for background cache warming (fire-and-forget)
	 * @private
	 */
	async _sendToKafkaBackground(userMappingData, tenantCode, organizationCode) {
		if (!userMappingData || Object.keys(userMappingData).length === 0) return

		console.log(
			`🚀 [getMentorKafka] Sending batch of ${
				Object.keys(userMappingData).length
			} users to Kafka for background cache warming`
		)

		// Group users by mentor/mentee status for batch processing
		const userBatches = {
			mentors: [],
			mentees: [],
		}

		Object.entries(userMappingData).forEach(([userId, userData]) => {
			const userInfo = {
				userId: userId,
				organizationCode: userData.organization_code,
				tenantCode: userData.tenant_code,
			}

			if (userData.is_mentor) {
				userBatches.mentors.push(userInfo)
			} else {
				userBatches.mentees.push(userInfo)
			}
		})

		// Send single batch message instead of individual messages
		try {
			const batchMessage = {
				tenantCode: tenantCode,
				organizationCode: organizationCode, // Primary organization code
				userBatches: userBatches,
			}

			await kafkaCommunication.pushToKafka({
				topic: process.env.USER_PROFILE_FETCH_TOPIC || 'dev.mentoring.user-profile-fetch',
				message: batchMessage,
			})

			console.log(
				`✅ [getMentorKafka] Batch message sent: ${userBatches.mentors.length} mentors, ${userBatches.mentees.length} mentees`
			)
		} catch (kafkaError) {
			// Silent fail - background cache warming should not affect main flow
			console.error(`⚠️ [getMentorKafka] Background Kafka batch send failed:`, kafkaError.message)
		}
	},

	/**
	 * Smart cache-first approach with immediate DB fetch + background Kafka cache warming
	 * @param {string} tenantCode - Tenant code for multi-tenancy
	 * @param {string} organizationCode - Organization code
	 * @param {Array|string} userIds - Array of user IDs or single user ID
	 * @returns {Promise<Array|Object>} Complete array of user profiles or single user profile
	 */
	async getMentorKafka(tenantCode, organizationCode, userIds) {
		try {
			// Handle single user ID case
			if (typeof userIds === 'string') {
				return await this.get(tenantCode, organizationCode, userIds)
			}

			// Handle array case - smart caching with immediate DB fetch
			if (!Array.isArray(userIds) || userIds.length === 0) {
				return []
			}

			const foundUsers = []
			const missingUserIds = []

			// Step 1: Check cache for each user ID
			for (const userId of userIds) {
				const cachedUser = await this.getCacheOnly(tenantCode, userId)
				if (cachedUser) {
					foundUsers.push(cachedUser)
				} else {
					missingUserIds.push(userId)
				}
			}

			// Step 2: If all found in cache, return immediately
			if (missingUserIds.length === 0) {
				return foundUsers
			}

			// Step 4: Fetch missing users from DB immediately using getUsersByUserIds
			const dbFetchedUsers = []
			const userMentorEntries = []
			if (missingUserIds.length > 0) {
				try {
					const usersFromDb = await userQueries.getUsersByUserIds(missingUserIds, {}, tenantCode, false)

					if (usersFromDb && usersFromDb.length > 0) {
						// Add fetched users to result
						dbFetchedUsers.push(...usersFromDb)

						// Create user ID to is_mentor mapping using map
						userMentorEntries = usersFromDb.map((user) => [
							user.user_id,
							{
								is_mentor: user.is_mentor || false,
								organization_code: user.organization_code || user.organization_id,
								tenant_code: user.tenant_code || tenantCode,
							},
						])

						console.log(`✅ [getMentorKafka] ${usersFromDb.length} users fetched from DB`)
					}
				} catch (dbError) {
					console.error(`❌ [getMentorKafka] Failed to fetch users from DB:`, dbError.message)
					// Continue with cached results even if DB fetch fails
				}
			}

			// Step 4: Send user mapping entries to Kafka for background cache warming (fire-and-forget)
			const userMappingData = Object.fromEntries(userMentorEntries)
			this._sendToKafkaBackground(userMappingData, tenantCode)

			// Step 5: Merge cached users + DB fetched users
			const finalResult = [...foundUsers, ...dbFetchedUsers]

			return finalResult
		} catch (error) {
			console.error(`❌ [getMenteeKafka] Error processing user IDs:`, error)
			// Fallback to regular cache method for all user IDs
			const fallbackResults = []
			for (const userId of Array.isArray(userIds) ? userIds : [userIds]) {
				try {
					const user = await this.get(tenantCode, organizationCode, userId)
					if (user) fallbackResults.push(user)
				} catch (fallbackError) {
					console.error(`❌ [getMenteeKafka] Fallback failed for user ${userId}:`, fallbackError.message)
				}
			}
			return typeof userIds === 'string' ? fallbackResults[0] || null : fallbackResults
		}
	},
}

/**
 * Mentee Profile Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:mentee:${id}
 * TTL: 1 day (86400 seconds)
 */
const mentee = {
	async get(tenantCode, menteeId) {
		try {
			// Cache mode: Check cache first
			const cacheKey = await buildKey({ tenantCode, ns: 'mentee', id: menteeId })
			const useInternal = nsUseInternal('mentee')
			const cachedProfile = await get(cacheKey, { useInternal })
			if (cachedProfile) {
				return cachedProfile
			}

			const rawExtension = await userQueries.getMenteeExtension(menteeId, [], false, tenantCode)
			return rawExtension
		} catch (error) {
			console.error(`❌ Failed to get mentee profile ${menteeId} from cache/database:`, error)
			return null
		}
	},

	async set(tenantCode, menteeId, profileData) {
		try {
			// Sanitize profile data - remove fields that are cached separately
			const sanitizedData = this._sanitizeProfileData(profileData)

			const cacheKey = await buildKey({ tenantCode, ns: 'mentee', id: menteeId })
			const useInternal = nsUseInternal('mentee')
			await set(cacheKey, sanitizedData, 86400, { useInternal }) // 1 day TTL
			console.log(`💾 Mentee profile ${menteeId} cached: tenant:${tenantCode}`)
		} catch (error) {
			console.error(`❌ Failed to cache mentee profile ${menteeId}:`, error)
		}
	},

	async delete(tenantCode, menteeId) {
		try {
			const cacheKey = await buildKey({ tenantCode, ns: 'mentee', id: menteeId })
			const useInternal = nsUseInternal('mentee')
			await del(cacheKey, { useInternal })
			// Mentee cache deleted
		} catch (error) {
			console.error(`❌ Failed to delete mentee profile ${menteeId} cache:`, error)
		}
	},

	_sanitizeProfileData(profileData) {
		const sanitized = { ...profileData }

		// Cache complete profile data for direct API response
		// Only remove truly sensitive data that should never be cached

		// Remove only downloadable URLs that might expire
		if (sanitized.image && typeof sanitized.image === 'string' && sanitized.image.includes('download')) {
			delete sanitized.image
		}

		// Keep all other fields including:
		// - displayProperties (needed for direct API response)
		// - Permissions (needed for direct API response)
		// - email (needed for complete profile response)
		// - email_verified (needed for complete profile response)
		// - connectedUsers (needed for complete profile response)

		return sanitized
	},

	/**
	 * Get mentee profile from cache only. Returns null if cache miss or no data.
	 * @param {string} tenantCode - Tenant code for multi-tenancy
	 * @param {string} id - Mentee user ID
	 * @returns {Promise<Object|null>} Profile data from cache or null if cache miss
	 */
	async getCacheOnly(tenantCode, id) {
		try {
			// Cache mode: Check cache first
			const cacheKey = await buildKey({ tenantCode, ns: 'mentee', id: id })
			const useInternal = nsUseInternal('mentee')
			const cachedProfile = await get(cacheKey, { useInternal })
			if (cachedProfile) {
				return cachedProfile
			}

			return null
		} catch (error) {
			console.error(`❌ [mentee.getCacheOnly] Error for profile ${id}:`, error)
			return null
		}
	},

	/**
	 * Send missing user IDs to Kafka for background cache warming (fire-and-forget)
	 * @private
	 */
	async _sendToKafkaBackground(userMappingData, tenantCode) {
		if (!userMappingData || Object.keys(userMappingData).length === 0) return

		console.log(
			`🚀 [getMenteeKafka] Sending batch of ${
				Object.keys(userMappingData).length
			} users to Kafka for background cache warming`
		)

		// Group users by mentor/mentee status for batch processing
		const userBatches = {
			mentors: [],
			mentees: [],
		}

		// Get primary organization code from first user for batch message
		let primaryOrgCode = tenantCode // fallback

		Object.entries(userMappingData).forEach(([userId, userData]) => {
			const userInfo = {
				userId: userId,
				organizationCode: userData.organization_code,
				tenantCode: userData.tenant_code,
			}

			// Set primary org code from first user
			if (primaryOrgCode === tenantCode) {
				primaryOrgCode = userData.organization_code
			}

			if (userData.is_mentor) {
				userBatches.mentors.push(userInfo)
			} else {
				userBatches.mentees.push(userInfo)
			}
		})

		// Send single batch message instead of individual messages
		try {
			const batchMessage = {
				tenantCode: tenantCode,
				organizationCode: primaryOrgCode, // Primary organization code
				userBatches: userBatches,
			}

			await kafkaCommunication.pushToKafka({
				topic: process.env.USER_PROFILE_FETCH_TOPIC || 'dev.mentoring.user-profile-fetch',
				message: batchMessage,
			})

			console.log(
				`✅ [getMenteeKafka] Batch message sent: ${userBatches.mentors.length} mentors, ${userBatches.mentees.length} mentees`
			)
		} catch (kafkaError) {
			// Silent fail - background cache warming should not affect main flow
			console.error(`⚠️ [getMenteeKafka] Background Kafka batch send failed:`, kafkaError.message)
		}
	},

	/**
	 * Smart cache-first approach with immediate DB fetch + background Kafka cache warming
	 * @param {string} tenantCode - Tenant code for multi-tenancy
	 * @param {string} organizationCode - Organization code
	 * @param {Array|string} userIds - Array of user IDs or single user ID
	 * @returns {Promise<Array|Object>} Complete array of user profiles or single user profile
	 */
	async getMenteeKafka(tenantCode, organizationCode, userIds) {
		try {
			// Handle single user ID case
			if (typeof userIds === 'string') {
				return await this.get(tenantCode, organizationCode, userIds)
			}

			// Handle array case - smart caching with immediate DB fetch
			if (!Array.isArray(userIds) || userIds.length === 0) {
				return []
			}

			const foundUsers = []
			const missingUserIds = []

			// Step 1: Check cache for each user ID
			for (const userId of userIds) {
				const cachedUser = await this.getCacheOnly(tenantCode, userId)
				if (cachedUser) {
					foundUsers.push(cachedUser)
				} else {
					missingUserIds.push(userId)
				}
			}

			// Step 2: If all found in cache, return immediately
			if (missingUserIds.length === 0) {
				return foundUsers
			}

			// Step 3: Fetch missing users from DB immediately using getUsersByUserIds
			const dbFetchedUsers = []
			let userMentorEntries = []
			if (missingUserIds.length > 0) {
				try {
					console.log(`🔄 [getMenteeKafka] Fetching ${missingUserIds.length} users from database`)
					const usersFromDb = await userQueries.getUsersByUserIds(
						missingUserIds, // ids array
						{}, // options - default attributes
						tenantCode, // tenantCode
						false // unscoped - use scoped query
					)

					if (usersFromDb && usersFromDb.length > 0) {
						// Cache each fetched user individually
						for (const user of usersFromDb) {
							await this.set(tenantCode, organizationCode, user.user_id, user)
						}

						// Add fetched users to result
						dbFetchedUsers.push(...usersFromDb)

						// Create user ID to is_mentor mapping using map
						const userMentorEntries = usersFromDb.map((user) => [user.user_id, user.is_mentor || false])
						Object.assign(userIsMentorMap, Object.fromEntries(userMentorEntries))

						console.log(`✅ [getMenteeKafka] ${usersFromDb.length} users fetched from DB and cached`)
					}
				} catch (dbError) {
					console.error(`❌ [getMenteeKafka] Failed to fetch users from DB:`, dbError.message)
					// Continue with cached results even if DB fetch fails
				}
			}

			// Step 5: Merge cached users + DB fetched users
			const finalResult = [...foundUsers, ...dbFetchedUsers]
			return finalResult
		} catch (error) {
			console.error(`❌ [getMenteeKafka] Error processing user IDs:`, error)
			// Fallback to regular cache method for all user IDs
			const fallbackResults = []
			for (const userId of Array.isArray(userIds) ? userIds : [userIds]) {
				try {
					const user = await this.get(tenantCode, organizationCode, userId)
					if (user) fallbackResults.push(user)
				} catch (fallbackError) {
					console.error(`❌ [getMenteeKafka] Fallback failed for user ${userId}:`, fallbackError.message)
				}
			}
			return typeof userIds === 'string' ? fallbackResults[0] || null : fallbackResults
		}
	},
}

/**
 * Platform Config Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:platformConfig
 */
const platformConfig = {
	async get(tenantCode, orgCode) {
		const useInternal = nsUseInternal('platformConfig')
		return get(await buildKey({ tenantCode, orgCode: orgCode, ns: 'platformConfig', id: '' }), { useInternal })
	},

	async set(tenantCode, orgCode, configData) {
		return setScoped({
			tenantCode,
			orgCode: orgCode,
			ns: 'platformConfig',
			id: '',
			value: configData,
		})
	},

	async delete(tenantCode, orgCode) {
		const useInternal = nsUseInternal('platformConfig')
		const cacheKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'platformConfig', id: '' })
		return del(cacheKey, { useInternal })
	},
}

/**
 * Notification Templates Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:templateCode:code
 */
const notificationTemplates = {
	async get(tenantCode, orgCode, templateCode) {
		try {
			const compositeId = `templateCode:${templateCode}`
			const useInternal = nsUseInternal('notificationTemplates')

			// Step 1: Check user-specific cache first
			const userCacheKey = await buildKey({
				tenantCode,
				orgCode,
				ns: 'notificationTemplates',
				id: compositeId,
			})
			const cachedTemplate = await get(userCacheKey, { useInternal })
			if (cachedTemplate) {
				console.log(
					`💾 NotificationTemplate ${templateCode} retrieved from user cache: tenant:${tenantCode}:org:${orgCode}`
				)
				return cachedTemplate
			}

			// Step 2: Get defaults internally for database query
			let defaults = null
			try {
				defaults = await getDefaults()
			} catch (error) {
				console.error('Failed to get defaults for notification template cache:', error.message)
				// Fallback defaults from environment variables
				defaults = {
					orgCode: process.env.DEFAULT_ORGANISATION_CODE || 'default_code',
					tenantCode: process.env.DEFAULT_TENANT_CODE || 'default',
				}
			}

			// Step 3: Cache miss - query database with prioritized fallback logic

			let templateFromDb = null
			try {
				// Try user tenant/org first
				templateFromDb = await notificationTemplateQueries.findOne(
					{
						code: templateCode,
						organization_code: orgCode,
						type: 'email',
						status: 'active',
					},
					tenantCode
				)

				// If not found and defaults are different, try defaults
				if (
					!templateFromDb &&
					defaults &&
					defaults.orgCode &&
					defaults.tenantCode &&
					(defaults.tenantCode !== tenantCode || defaults.orgCode !== orgCode)
				) {
					templateFromDb = await notificationTemplateQueries.findOne(
						{
							code: templateCode,
							organization_code: defaults.orgCode,
							type: 'email',
							status: 'active',
						},
						defaults.tenantCode
					)
				}

				if (templateFromDb) {
					console.log(
						`💾 NotificationTemplate ${templateCode} found in database: tenant:${templateFromDb.tenant_code}:org:${templateFromDb.organization_code}`
					)
				}
			} catch (dbError) {
				console.error(`Failed to fetch notification template ${templateCode} from database:`, dbError.message)
				return null
			}

			// Step 4: Cache result under user tenant/org (regardless of where template was found)
			if (templateFromDb) {
				await this.set(tenantCode, orgCode, templateCode, templateFromDb)
				console.log(
					`💾 NotificationTemplate ${templateCode} cached under user context: tenant:${tenantCode}:org:${orgCode}`
				)
				return templateFromDb
			}

			// Step 6: Template not found in any location
			console.log(
				`❌ NotificationTemplate ${templateCode} not found in database for user: tenant:${tenantCode}:org:${orgCode} or defaults`
			)
			return null
		} catch (error) {
			console.error(`❌ Failed to get notificationTemplate ${templateCode} from cache/database:`, error)
			return null
		}
	},

	async set(tenantCode, orgCode, templateCode, templateData) {
		const compositeId = `templateCode:${templateCode}`
		return setScoped({
			tenantCode,
			orgCode: orgCode,
			ns: 'notificationTemplates',
			id: compositeId,
			value: templateData,
		})
	},

	async delete(tenantCode, orgCode, templateCode) {
		const compositeId = `templateCode:${templateCode}`
		const useInternal = nsUseInternal('notificationTemplates')
		const cacheKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'notificationTemplates', id: compositeId })
		return del(cacheKey, { useInternal })
	},
}

/**
 * Display Properties Cache Helpers
 * Pattern: tenant:${tenantCode}:org:${orgCode}:displayProperties
 * Fallback Pattern: tenant:${tenantCode}:displayProperties
 */
const displayProperties = {
	async get(tenantCode, orgCode) {
		try {
			const useInternal = nsUseInternal('displayProperties')

			// Try org-specific cache first
			const orgSpecific = await get(
				await buildKey({ tenantCode, orgCode: orgCode, ns: 'displayProperties', id: '' }),
				{ useInternal }
			)
			if (orgSpecific) {
				return orgSpecific
			}

			// Fallback to tenant-only cache
			const tenantOnly = await get(await buildKey({ tenantCode, orgCode: '', ns: 'displayProperties', id: '' }), {
				useInternal,
			})
			if (tenantOnly) {
				return tenantOnly
			}

			// Cache miss - return null and let calling service handle fallback
			return null
		} catch (error) {
			console.error(`❌ Failed to get display properties from cache:`, error)
			return null
		}
	},

	async set(tenantCode, orgCode, propertiesData) {
		// Cache at org-specific level only
		await setScoped({
			tenantCode,
			orgCode: orgCode,
			ns: 'displayProperties',
			id: '',
			value: propertiesData,
		})
	},

	async delete(tenantCode, orgCode) {
		const useInternal = nsUseInternal('displayProperties')

		// Delete both org-specific and tenant-only caches
		const orgKey = await buildKey({ tenantCode, orgCode: orgCode, ns: 'displayProperties', id: '' })
		const tenantKey = await buildKey({ tenantCode, orgCode: '', ns: 'displayProperties', id: '' })

		await del(orgKey, { useInternal })
		await del(tenantKey, { useInternal })
	},
}

/**
 * Permissions Cache Helpers
 * Pattern: permissions:role:${role}
 * Global permissions (no tenant/org context) - Individual role-based caching
 */
const permissions = {
	async get(role) {
		try {
			const key = `permissions:role:${role}`
			const useInternal = nsUseInternal('permissions')
			const cachedPermissions = await get(key, { useInternal })
			if (cachedPermissions) {
				console.log(`💾 Permissions for role ${role} retrieved from cache`)
				return cachedPermissions
			}

			// Cache miss - fallback to database query
			console.log(`💾 Permissions for role ${role} cache miss, fetching from database`)
			const filter = { role_title: [role] }
			const attributes = ['module', 'request_type', 'api_path']
			const rolePermissionsData = await rolePermissionMappingQueries.findAll(filter, attributes)

			// Format to match expected structure with service field
			const permissionsFromDb = rolePermissionsData.map((permission) => ({
				module: permission.module,
				request_type: permission.request_type,
				service: common.MENTORING_SERVICE,
			}))

			if (permissionsFromDb && permissionsFromDb.length > 0) {
				// Cache the fetched data for future requests
				await this.set(role, permissionsFromDb)
				console.log(`💾 Permissions for role ${role} fetched from database and cached`)
			}

			return permissionsFromDb || []
		} catch (error) {
			console.error(`❌ Failed to get permissions for role ${role} from cache/database:`, error)
			return []
		}
	},

	async set(role, permissionsData) {
		const key = `permissions:role:${role}`
		const useInternal = nsUseInternal('permissions')
		return set(key, permissionsData, undefined, { useInternal })
	},

	async delete(role) {
		const key = `permissions:role:${role}`
		const useInternal = nsUseInternal('permissions')
		return del(key, { useInternal })
	},

	/**
	 * Evict all permissions for a specific role
	 */
	async evictRole(role) {
		const pattern = `permissions:role:${role}`
		await scanAndDelete(pattern)
	},

	/**
	 * Evict all permissions cache
	 */
	async evictAll() {
		const pattern = `permissions:*`
		await scanAndDelete(pattern)
	},
}

/**
 * API Permissions Cache Helpers
 * Pattern: apiPermissions:role:${role}:module:${module}:api_path:${api_path}
 * Global permissions (no tenant/org context) - Individual role-based caching
 */
const apiPermissions = {
	/**
	 * Get permissions for a single role-module-path combination
	 */
	async getSingleRole(role, module, apiPath) {
		const key = `apiPermissions:role:${role}:module:${module}:api_path:${apiPath}`
		const useInternal = nsUseInternal('apiPermissions')
		return get(key, { useInternal })
	},

	/**
	 * Set permissions for a single role-module-path combination
	 * Data format: { "request_type": ["GET", "POST", "DELETE", "PUT", "PATCH"] }
	 */
	async setSingleRole(role, module, apiPath, requestTypes) {
		const key = `apiPermissions:role:${role}:module:${module}:api_path:${apiPath}`
		const permissionData = { request_type: requestTypes }
		const useInternal = nsUseInternal('apiPermissions')
		return set(key, permissionData, undefined, { useInternal })
	},

	/**
	 * Delete permissions for a single role-module-path combination
	 */
	async deleteSingleRole(role, module, apiPath) {
		const key = `apiPermissions:role:${role}:module:${module}:api_path:${apiPath}`
		const useInternal = nsUseInternal('apiPermissions')
		return del(key, { useInternal })
	},

	/**
	 * Get permissions for multiple roles and combine them
	 * Returns array of permission objects for backwards compatibility
	 */
	async getMultipleRoles(roles, module, apiPaths) {
		const permissions = []

		for (const role of roles) {
			for (const apiPath of apiPaths) {
				const cachedData = await this.getSingleRole(role, module, apiPath)
				if (cachedData && cachedData.request_type) {
					permissions.push({
						request_type: cachedData.request_type,
						api_path: apiPath,
						module: module,
						role_title: role,
					})
				}
			}
		}

		return permissions
	},

	/**
	 * Set permissions for multiple role-module-path combinations from database results
	 */
	async setFromDatabaseResults(module, apiPaths, dbPermissions) {
		const cachePromises = []

		// Group permissions by role and api_path
		const groupedPermissions = {}
		for (const permission of dbPermissions) {
			const key = `${permission.role_title}:${permission.api_path}`
			if (!groupedPermissions[key]) {
				groupedPermissions[key] = []
			}
			groupedPermissions[key] = permission.request_type
		}

		// Cache each role-api_path combination
		for (const [key, requestTypes] of Object.entries(groupedPermissions)) {
			const [role, apiPath] = key.split(':')
			cachePromises.push(this.setSingleRole(role, module, apiPath, requestTypes))
		}

		await Promise.all(cachePromises)
	},

	/**
	 * Evict all permissions for a specific role across all modules and paths
	 */
	async evictRole(role) {
		const pattern = `apiPermissions:role:${role}:*`
		await scanAndDelete(pattern)
	},

	/**
	 * Evict all permissions for a specific module across all roles and paths
	 */
	async evictModule(module) {
		const pattern = `apiPermissions:*:module:${module}:*`
		await scanAndDelete(pattern)
	},

	/**
	 * Evict all API permissions cache
	 */
	async evictAll() {
		const pattern = `apiPermissions:*`
		await scanAndDelete(pattern)
	},
}

/** Public API */
module.exports = {
	// Base ops
	get,
	set,
	del,
	getOrSet,
	tenantKey,

	// Scoped helpers
	setScoped,
	namespacedKey,
	buildKey,

	// Eviction (pattern based)
	delScoped,
	evictNamespace,
	evictOrgByPattern,
	evictTenantByPattern,
	scanAndDelete,

	// Namespace-specific helpers
	sessions,
	entityTypes,
	forms,
	organizations,
	mentor,
	mentee,
	platformConfig,
	notificationTemplates,
	displayProperties,
	permissions,
	apiPermissions,

	// Introspection
	_internal: {
		getRedisClient,
		SHARDS,
		BATCH,
		ENABLE_CACHE,
		CACHE_CONFIG,
	},
}
