const { Sequelize } = require('sequelize')
const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')
require('dotenv').config()
const DatabaseConnectionManager = require('./db-connection-utils')

/**
 * Simplified Data Migration Script for Mentoring Service
 * - Uses CSV lookup data directly (no temp tables)
 * - Consolidated batch processing
 * - Removes unnecessary code
 */

class MentoringDataMigrator {
	constructor() {
		// Initialize database connection manager
		this.dbManager = new DatabaseConnectionManager({
			poolMax: 10,
			poolMin: 2,
			logging: false,
		})
		this.sequelize = this.dbManager.getSequelize()

		// Centralized batch processing configuration
		this.BATCH_SIZE = 5000

		// Data cache for CSV lookup
		this.orgLookupCache = new Map()

		// Processing statistics
		this.stats = {
			totalProcessed: 0,
			successfulUpdates: 0,
			failedUpdates: 0,
			tablesUndistributed: 0,
			tablesRedistributed: 0,
			startTime: Date.now(),
			// Enhanced error tracking
			missingOrgIdRecords: [],
			systemRecordsFixed: [], // created_by = 0
			nullUserIdErrors: [], // created_by = NULL - DATA INTEGRITY ERROR
			orphanedUserIdRecordsFixed: [], // created_by not found in user_extensions
			systemRecordsFixedWithDefaults: [],
			validationErrors: [],
		}

		// Default values for fallback
		this.defaultTenantCode = process.env.DEFAULT_TENANT_CODE || 'default'
		this.defaultOrgCode = process.env.DEFAULT_ORGANIZATION_CODE || 'default_code'

		// Table-specific default values configuration
		this.tableSpecificDefaults = {
			report_types: { tenant_code: this.defaultTenantCode, organization_code: this.defaultOrgCode },
			report_role_mapping: { tenant_code: this.defaultTenantCode, organization_code: this.defaultOrgCode },
			modules: { tenant_code: this.defaultTenantCode, organization_code: this.defaultOrgCode },
		}

		// Tables with organization_id - process using CSV lookup
		this.tablesWithOrgId = [
			{
				name: 'availabilities',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'default_rules',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'entity_types',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'file_uploads',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'forms',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'notification_templates',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'organization_extension',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'report_queries',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'reports',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'role_extensions',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
		]

		// Tables without organization_id or user_id - process using table-specific defaults only
		this.tablesWithDefaults = [
			{
				name: 'modules',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'report_types',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'report_role_mapping',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
		]

		// Tables with user_id - process using user_extensions with inner joins
		this.tablesWithUserId = [
			{
				name: 'user_extensions',
				userIdColumn: 'user_id',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'sessions',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'session_attendees',
				userIdColumn: 'mentee_id',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'feedbacks',
				userIdColumn: 'user_id',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'connection_requests',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'connections',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'entities',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'issues',
				userIdColumn: 'user_id',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'resources',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'session_request',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
			},
			{
				name: 'question_sets',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'questions',
				userIdColumn: 'created_by',
				updateColumns: ['tenant_code', 'organization_code'],
				hasPartitionKey: true,
			},
			{
				name: 'post_session_details',
				sessionIdColumn: 'session_id',
				updateColumns: ['tenant_code'],
				hasPartitionKey: true,
				useSessionLookup: true,
			},
		]
	}

	/**
	 * Get default values for a specific table
	 * @param {string} tableName - Name of the table
	 * @returns {object} Object with tenant_code and organization_code defaults
	 */
	getTableDefaults(tableName) {
		const tableSpecific = this.tableSpecificDefaults[tableName]
		return {
			tenant_code: tableSpecific?.tenant_code || this.defaultTenantCode,
			organization_code: tableSpecific?.organization_code || this.defaultOrgCode,
		}
	}

	/**
	 * Load lookup data from CSV file
	 */
	async loadLookupData() {
		console.log('🔄 Loading lookup data from data_codes.csv...')

		try {
			await this.loadTenantAndOrgCsv()

			console.log(`✅ Loaded lookup data:`)
			console.log(`   - Organization codes: ${this.orgLookupCache.size}`)

			if (this.orgLookupCache.size === 0) {
				console.log('⚠️  No CSV data loaded, using defaults')
			}
		} catch (error) {
			console.error('❌ Failed to load lookup data:', error)
			throw error
		}
	}

	/**
	 * Validate that all organization_ids from organization_extension table exist in the CSV file
	 * Fails the migration if any organization_extension organization_ids are missing from CSV
	 */
	async validateDatabaseOrgsCoveredByCSV() {
		console.log('\n🔍 Validating organization_extension organization_ids coverage in CSV...')

		const missingOrgs = new Set()
		const csvOrgIds = new Set(this.orgLookupCache.keys())

		// Only get organization_ids from organization_extension table (source of truth)
		try {
			// Check if organization_extension table exists first
			const tableExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organization_extension')`,
				{ type: Sequelize.QueryTypes.SELECT }
			)

			if (!tableExists[0].exists) {
				throw new Error('organization_extension table does not exist')
			}

			// Get distinct organization_ids from organization_extension table only
			const orgResults = await this.sequelize.query(
				`SELECT DISTINCT organization_id::text as org_id
				 FROM organization_extension
				 WHERE organization_id IS NOT NULL`,
				{ type: Sequelize.QueryTypes.SELECT }
			)

			// Check each organization_id against CSV data
			for (const row of orgResults) {
				const orgId = row.org_id
				if (!csvOrgIds.has(orgId)) {
					missingOrgs.add(orgId)
				}
			}

			console.log(`✅ Checked organization_extension: ${orgResults.length} distinct organization_ids`)
		} catch (error) {
			console.error(`❌ Failed to check organization_extension: ${error.message}`)
			throw error
		}

		// Report results
		if (missingOrgs.size > 0) {
			const missingOrgsList = Array.from(missingOrgs).sort()
			console.error('\n❌ VALIDATION FAILED: Missing organization_ids in CSV')
			console.error('='.repeat(60))
			console.error(
				`Found ${missingOrgs.size} organization_ids from organization_extension table that are missing from CSV:`
			)
			missingOrgsList.forEach((orgId) => {
				console.error(`   - organization_id: ${orgId}`)
			})
			console.error('\n📝 Required action:')
			console.error(
				'   - Add missing organization_ids to data_codes.csv with proper tenant_code and organization_code'
			)
			console.error(
				'   - Or verify if these organization_ids should be removed from organization_extension table'
			)

			throw new Error(
				`Migration cannot proceed: ${missingOrgs.size} organization_ids from organization_extension missing from CSV. See details above.`
			)
		}

		console.log('✅ Validation passed: All organization_extension organization_ids are covered in CSV')
	}

	async loadTenantAndOrgCsv() {
		const csvPath = path.join(__dirname, '../../data/sample_data_codes.csv')
		if (!fs.existsSync(csvPath)) {
			console.log('⚠️  data_codes.csv not found, using defaults')
			return
		}

		// Get organization_ids only from organization_extension table (source of truth)
		console.log('🔍 Getting organization_ids from organization_extension table...')
		const orgExtensionIds = await this.sequelize.query(
			`SELECT DISTINCT organization_id::text as org_id FROM organization_extension WHERE organization_id IS NOT NULL`,
			{ type: Sequelize.QueryTypes.SELECT }
		)

		const validOrgIds = new Set(orgExtensionIds.map((row) => row.org_id))
		console.log(`📊 Found ${validOrgIds.size} organization_ids in organization_extension table`)

		const requiredHeaders = ['tenant_code', 'organization_code', 'organization_id']
		let isHeaderValidated = false
		const skippedOrgIds = new Set()

		return new Promise((resolve, reject) => {
			fs.createReadStream(csvPath)
				.pipe(csv())
				.on('headers', (headers) => {
					console.log('📋 CSV Headers found:', headers)

					const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header))
					if (missingHeaders.length > 0) {
						reject(
							new Error(
								`❌ Missing required CSV headers: ${missingHeaders.join(
									', '
								)}. Required headers: ${requiredHeaders.join(', ')}`
							)
						)
						return
					}

					console.log('✅ CSV headers validation passed')
					isHeaderValidated = true
				})
				.on('data', (row) => {
					if (!isHeaderValidated) return

					// Only load CSV data for organization_ids that exist in organization_extension table
					if (
						row.organization_id &&
						row.organization_code &&
						row.tenant_code &&
						validOrgIds.has(row.organization_id)
					) {
						this.orgLookupCache.set(row.organization_id, {
							organization_code: row.organization_code,
							tenant_code: row.tenant_code,
						})
					} else if (row.organization_id && !validOrgIds.has(row.organization_id)) {
						skippedOrgIds.add(row.organization_id)
					} else {
						console.warn('⚠️  Skipping invalid CSV row:', row)
					}
				})
				.on('end', () => {
					if (!isHeaderValidated) {
						reject(new Error('❌ CSV headers could not be validated'))
						return
					}
					if (skippedOrgIds.size > 0) {
						console.log(
							`ℹ️  Skipped ${
								skippedOrgIds.size
							} CSV rows for organization_ids not found in organization_extension table: [${Array.from(
								skippedOrgIds
							).join(', ')}]`
						)
					}
					console.log(
						`✅ Loaded ${this.orgLookupCache.size} organization codes (filtered by organization_extension table)`
					)
					resolve()
				})
				.on('error', reject)
		})
	}

	/**
	 * Check if Citus is enabled
	 */
	async isCitusEnabled() {
		try {
			const [result] = await this.sequelize.query(`
				SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'citus') as enabled
			`)
			return result[0].enabled
		} catch (error) {
			return false
		}
	}

	/**
	 * Check if table is distributed
	 */
	async isTableDistributed(tableName) {
		try {
			const [result] = await this.sequelize.query(`
				SELECT COUNT(*) as count 
				FROM pg_dist_partition 
				WHERE logicalrelid = '${tableName}'::regclass
			`)
			return parseInt(result[0].count) > 0
		} catch (error) {
			return false
		}
	}

	/**
	 * Get foreign key constraints referencing a table
	 */
	async getForeignKeyConstraints(tableName) {
		try {
			const result = await this.sequelize.query(
				`
				SELECT 
					tc.table_name,
					tc.constraint_name,
					kcu.column_name,
					ccu.table_name AS foreign_table_name,
					ccu.column_name AS foreign_column_name
				FROM information_schema.table_constraints AS tc 
				JOIN information_schema.key_column_usage AS kcu
					ON tc.constraint_name = kcu.constraint_name
				JOIN information_schema.constraint_column_usage AS ccu
					ON ccu.constraint_name = tc.constraint_name
				WHERE tc.constraint_type = 'FOREIGN KEY' 
					AND ccu.table_name = '${tableName}'
			`,
				{ type: this.sequelize.QueryTypes.SELECT }
			)

			return result
		} catch (error) {
			console.log(`⚠️  Error getting foreign keys for ${tableName}: ${error.message}`)
			return []
		}
	}

	/**
	 * Drop foreign key constraints temporarily
	 */
	async dropForeignKeyConstraints(tableName) {
		const constraints = await this.getForeignKeyConstraints(tableName)
		const droppedConstraints = []

		for (const constraint of constraints) {
			try {
				await this.sequelize.query(`
					ALTER TABLE ${constraint.table_name} 
					DROP CONSTRAINT ${constraint.constraint_name}
				`)
				droppedConstraints.push(constraint)
				console.log(`🔑 Dropped FK constraint: ${constraint.table_name}.${constraint.constraint_name}`)
			} catch (error) {
				console.log(`⚠️  Could not drop FK constraint ${constraint.constraint_name}: ${error.message}`)
			}
		}

		return droppedConstraints
	}

	/**
	 * Recreate foreign key constraints
	 */
	async recreateForeignKeyConstraints(droppedConstraints) {
		for (const constraint of droppedConstraints) {
			try {
				await this.sequelize.query(`
					ALTER TABLE ${constraint.table_name} 
					ADD CONSTRAINT ${constraint.constraint_name} 
					FOREIGN KEY (${constraint.column_name}) 
					REFERENCES ${constraint.foreign_table_name}(${constraint.foreign_column_name})
				`)
				console.log(`🔑 Recreated FK constraint: ${constraint.table_name}.${constraint.constraint_name}`)
			} catch (error) {
				console.log(`⚠️  Could not recreate FK constraint ${constraint.constraint_name}: ${error.message}`)
			}
		}
	}

	/**
	 * Undistribute a table temporarily for updates with foreign key handling
	 */
	async undistributeTable(tableName) {
		try {
			const citusEnabled = await this.isCitusEnabled()
			const isDistributed = await this.isTableDistributed(tableName)

			if (!citusEnabled || !isDistributed) {
				return false
			}

			// Tables that require special FK handling when Citus is enabled
			const tablesWithForeignKeys = [
				'entity_types', // Referenced by: entities.entity_type_id, entity_types.parent_id
				'sessions', // Referenced by: post_session_details.session_id, session_attendees.session_id, resources.session_id
				'permissions', // Referenced by: role_permission_mapping.permission_id
			]

			let droppedConstraints = []
			if (tablesWithForeignKeys.includes(tableName)) {
				console.log(`🔑 Handling foreign key constraints for ${tableName}...`)
				droppedConstraints = await this.dropForeignKeyConstraints(tableName)
			}

			try {
				await this.sequelize.query(`SELECT undistribute_table('${tableName}')`)
				console.log(`✅ Undistributed table: ${tableName}`)
				this.stats.tablesUndistributed++

				// Store dropped constraints for later recreation
				if (droppedConstraints.length > 0) {
					this.droppedConstraints = this.droppedConstraints || {}
					this.droppedConstraints[tableName] = droppedConstraints
				}

				return true
			} catch (undistributeError) {
				// If undistribute fails, recreate the dropped constraints
				if (droppedConstraints.length > 0) {
					await this.recreateForeignKeyConstraints(droppedConstraints)
				}
				throw undistributeError
			}
		} catch (error) {
			console.log(`⚠️  Could not undistribute ${tableName}: ${error.message}`)
			return false
		}
	}

	/**
	 * Redistribute table after updates with foreign key constraint restoration
	 */
	async redistributeTable(tableName) {
		try {
			const citusEnabled = await this.isCitusEnabled()

			if (!citusEnabled) {
				console.log(`✅ Skipping distribution for ${tableName} - Citus not enabled`)
				return false
			}

			await this.sequelize.query(`SELECT create_distributed_table('${tableName}', 'tenant_code')`)
			console.log(`✅ Redistributed table: ${tableName}`)
			this.stats.tablesRedistributed++

			// Recreate foreign key constraints if they were dropped (only for Citus)
			if (this.droppedConstraints && this.droppedConstraints[tableName]) {
				console.log(`🔑 Recreating foreign key constraints for ${tableName}...`)
				await this.recreateForeignKeyConstraints(this.droppedConstraints[tableName])
				delete this.droppedConstraints[tableName]
			}

			return true
		} catch (error) {
			console.log(`⚠️  Could not redistribute ${tableName}: ${error.message}`)
			return false
		}
	}

	/**
	 * Helper method to undistribute table if needed
	 */
	async undistributeTableIfNeeded(tableName) {
		const isDistributed = await this.isTableDistributed(tableName)
		if (isDistributed) {
			console.log(`✅ Undistributed table: ${tableName}`)
			await this.sequelize.query(`SELECT undistribute_table('${tableName}')`)
			this.stats.tablesUndistributed++
			return true
		}
		return false
	}

	/**
	 * Helper method to redistribute table if needed (only if Citus is enabled)
	 */
	async redistributeTableIfNeeded(tableName, partitionKey = 'tenant_code', shouldDistribute = true) {
		const citusEnabled = await this.isCitusEnabled()

		if (!citusEnabled) {
			console.log(`✅ Skipping distribution for ${tableName} - Citus not enabled`)
			return false
		}

		if (shouldDistribute) {
			const isDistributed = await this.isTableDistributed(tableName)
			if (!isDistributed) {
				console.log(`✅ Redistributed table: ${tableName} with ${partitionKey}`)
				await this.sequelize.query(`SELECT create_distributed_table('${tableName}', '${partitionKey}')`)
				this.stats.tablesRedistributed++
				return true
			}
		}
		return false
	}

	/**
	 * Process tables with organization_id using CSV lookup
	 */
	async processTablesWithOrgId() {
		console.log('\n🔄 PHASE 1: Processing tables with organization_id using CSV lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tablesWithOrgId) {
			await this.processTableWithOrgId(tableConfig)
		}
	}

	/**
	 * Process a single table with organization_id using CSV lookup
	 */
	async processTableWithOrgId(tableConfig) {
		const { name, updateColumns, hasPartitionKey } = tableConfig
		console.log(`\n🔄 Processing table with organization_id: ${name}`)

		try {
			// Check if table exists and has target columns
			const existingColumns = await this.checkTableColumns(name)
			const availableUpdateColumns = updateColumns.filter((col) => existingColumns.includes(col))

			if (availableUpdateColumns.length === 0) {
				console.log(`⚠️  Table ${name} has no target columns, skipping`)
				return
			}

			console.log(`📋 Available columns for update: ${availableUpdateColumns.join(', ')}`)

			// Check if we need to update tenant_code (partition key)
			const needsTenantCodeUpdate = availableUpdateColumns.includes('tenant_code')
			const citusEnabled = await this.isCitusEnabled()

			// Undistribute table if needed
			let wasDistributed = false
			if (citusEnabled && hasPartitionKey && needsTenantCodeUpdate) {
				wasDistributed = await this.undistributeTable(name)
			}

			try {
				// Process using CSV lookup data
				await this.processOrgIdTableWithCSV(name, availableUpdateColumns)

				// Redistribute if needed
				if (citusEnabled && wasDistributed && needsTenantCodeUpdate) {
					await this.redistributeTable(name)
				}
			} catch (error) {
				console.error(`❌ Error updating table ${name}:`, error)
				if (citusEnabled && wasDistributed && needsTenantCodeUpdate) {
					await this.redistributeTable(name)
				}
				throw error
			}

			console.log(`✅ Completed ${name}`)
		} catch (error) {
			console.error(`❌ Error processing table ${name}:`, error)
			throw error
		}
	}

	/**
	 * Process organization_id table using individual organization updates
	 */
	async processOrgIdTableWithCSV(tableName, availableUpdateColumns) {
		console.log(`📊 Processing ${tableName} using individual organization updates...`)

		let totalUpdated = 0
		try {
			totalUpdated = await this.processOrgIdTable(tableName, availableUpdateColumns)
			console.log(`✅ Updated ${totalUpdated} rows in ${tableName} using individual updates`)
		} catch (error) {
			console.error(`❌ Failed to process ${tableName}:`, error.message)
			this.stats.failedUpdates++
			throw error
		}

		this.stats.successfulUpdates += totalUpdated
	}

	/**
	 * Process table with organization_id using individual organization updates
	 */
	async processOrgIdTable(tableName, availableUpdateColumns) {
		console.log(`🔄 Processing ${tableName} with individual organization updates...`)

		// Get distinct organization_ids from table
		const [orgList] = await this.sequelize.query(`
			SELECT DISTINCT organization_id::text as organization_id 
			FROM ${tableName} 
			WHERE organization_id IS NOT NULL 
			ORDER BY organization_id
		`)

		console.log(`🔄 Processing ${tableName} with ${orgList.length} organizations individually`)
		let totalUpdated = 0

		const transaction = await this.sequelize.transaction()

		try {
			// Process organizations in batches
			for (let i = 0; i < orgList.length; i += this.BATCH_SIZE) {
				const orgBatch = orgList.slice(i, i + this.BATCH_SIZE)

				// Process each organization using CSV data
				for (const org of orgBatch) {
					const orgData = this.orgLookupCache.get(org.organization_id)
					if (!orgData) {
						// Count records that will be left without tenant_code
						const [countResult] = await this.sequelize.query(
							`SELECT COUNT(*) as count FROM ${tableName} WHERE organization_id::text = '${org.organization_id}'`,
							{ transaction }
						)

						this.stats.missingOrgIdRecords.push({
							table: tableName,
							orgId: org.organization_id,
							count: parseInt(countResult[0].count),
						})

						console.warn(
							`⚠️  No CSV data for organization_id: ${org.organization_id} in ${tableName} (${countResult[0].count} records affected)`
						)
						continue
					}

					// Build SET clause with CSV data
					const setClauses = []
					if (availableUpdateColumns.includes('tenant_code')) {
						setClauses.push(`tenant_code = '${orgData.tenant_code}'`)
					}
					if (availableUpdateColumns.includes('organization_code')) {
						setClauses.push(`organization_code = '${orgData.organization_code}'`)
					}
					setClauses.push('updated_at = NOW()')

					const [, metadata] = await this.sequelize.query(
						`
						UPDATE ${tableName} 
						SET ${setClauses.join(', ')}
						WHERE organization_id::text = '${org.organization_id}'
					`,
						{ transaction }
					)

					totalUpdated += metadata.rowCount || 0
				}
			}

			// Handle records with NULL organization_id using table-specific defaults
			if (availableUpdateColumns.includes('tenant_code')) {
				const tableDefaults = this.getTableDefaults(tableName)
				const setClauses = []
				setClauses.push(`tenant_code = '${tableDefaults.tenant_code}'`)
				if (availableUpdateColumns.includes('organization_code')) {
					setClauses.push(`organization_code = '${tableDefaults.organization_code}'`)
				}
				setClauses.push('updated_at = NOW()')

				const [, nullOrgMetadata] = await this.sequelize.query(
					`
					UPDATE ${tableName} 
					SET ${setClauses.join(', ')}
					WHERE organization_id IS NULL AND tenant_code IS NULL
				`,
					{ transaction }
				)

				if (nullOrgMetadata.rowCount > 0) {
					console.log(
						`✅ Applied table-specific defaults to ${nullOrgMetadata.rowCount} records with NULL organization_id in ${tableName}`
					)
					console.log(
						`   Defaults used: tenant_code='${tableDefaults.tenant_code}', organization_code='${tableDefaults.organization_code}'`
					)
					totalUpdated += nullOrgMetadata.rowCount
				}
			}

			await transaction.commit()
			return totalUpdated
		} catch (error) {
			await transaction.rollback()
			throw error
		}
	}

	/**
	 * Process tables that only need default values (no organization_id or user_id relationships)
	 */
	async processTablesWithDefaults() {
		console.log('\n🔄 PHASE 2: Processing tables using table-specific defaults...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tablesWithDefaults) {
			await this.processTableWithDefaults(tableConfig)
		}
	}

	/**
	 * Process a single table using only default values
	 */
	async processTableWithDefaults(tableConfig) {
		const { name, updateColumns, hasPartitionKey } = tableConfig
		console.log(`\n🔄 Processing table with defaults: ${name}`)

		try {
			// Check if table exists and has target columns
			const existingColumns = await this.checkTableColumns(name)
			const availableUpdateColumns = updateColumns.filter((col) => existingColumns.includes(col))

			if (availableUpdateColumns.length === 0) {
				console.log(`⚠️  Table ${name} has no target columns, skipping`)
				return
			}

			console.log(`📋 Available columns for update: ${availableUpdateColumns.join(', ')}`)

			// Check if we need to update tenant_code (partition key)
			const needsTenantCodeUpdate = availableUpdateColumns.includes('tenant_code')
			const citusEnabled = await this.isCitusEnabled()

			// Undistribute table if needed
			let wasDistributed = false
			if (citusEnabled && hasPartitionKey && needsTenantCodeUpdate) {
				wasDistributed = await this.undistributeTable(name)
			}

			try {
				// Process using table-specific defaults
				await this.processTableWithDefaultValues(name, availableUpdateColumns)

				// Redistribute if needed
				if (citusEnabled && wasDistributed && needsTenantCodeUpdate) {
					await this.redistributeTable(name)
				}
			} catch (error) {
				console.error(`❌ Error updating table ${name}:`, error)
				if (citusEnabled && wasDistributed && needsTenantCodeUpdate) {
					await this.redistributeTable(name)
				}
				throw error
			}

			console.log(`✅ Completed ${name}`)
		} catch (error) {
			console.error(`❌ Error processing table ${name}:`, error)
			throw error
		}
	}

	/**
	 * Process table using only default values
	 */
	async processTableWithDefaultValues(tableName, availableUpdateColumns) {
		console.log(`📊 Processing ${tableName} using table-specific defaults...`)

		const tableDefaults = this.getTableDefaults(tableName)
		console.log(
			`🔧 Using defaults: tenant_code='${tableDefaults.tenant_code}', organization_code='${tableDefaults.organization_code}'`
		)

		let totalUpdated = 0
		const transaction = await this.sequelize.transaction()

		try {
			// Build SET clause with defaults
			const setClauses = []
			if (availableUpdateColumns.includes('tenant_code')) {
				setClauses.push(`tenant_code = '${tableDefaults.tenant_code}'`)
			}
			if (availableUpdateColumns.includes('organization_code')) {
				setClauses.push(`organization_code = '${tableDefaults.organization_code}'`)
			}
			setClauses.push('updated_at = NOW()')

			// Update all NULL records with defaults
			const [, metadata] = await this.sequelize.query(
				`
				UPDATE ${tableName} 
				SET ${setClauses.join(', ')}
				WHERE tenant_code IS NULL
			`,
				{ transaction }
			)

			totalUpdated = metadata.rowCount || 0
			console.log(`✅ Updated ${totalUpdated} rows in ${tableName} with default values`)

			await transaction.commit()
			this.stats.successfulUpdates += totalUpdated
			return totalUpdated
		} catch (error) {
			await transaction.rollback()
			console.error(`❌ Failed to process ${tableName}:`, error.message)
			this.stats.failedUpdates++
			throw error
		}
	}

	/**
	 * Process tables with user_id using inner joins
	 */
	async processTablesWithUserId() {
		console.log('\n🔄 PHASE 3: Processing tables with user_id using inner joins...')
		console.log('='.repeat(70))

		// First process user_extensions
		const userExtConfig = this.tablesWithUserId.find((t) => t.name === 'user_extensions')
		if (userExtConfig) {
			await this.processUserExtensions(userExtConfig)
		}

		// Then process other tables
		for (const tableConfig of this.tablesWithUserId) {
			if (tableConfig.name !== 'user_extensions') {
				await this.processTableWithUserId(tableConfig)
			}
		}
	}

	/**
	 * Process user_extensions using individual organization updates
	 */
	async processUserExtensions(tableConfig) {
		console.log(`\n🔄 Processing user_extensions using individual organization updates...`)

		// Undistribute table first if it's distributed
		await this.undistributeTableIfNeeded('user_extensions')

		let totalUpdated = 0
		try {
			totalUpdated = await this.processUserExtensionsIndividually()
			console.log(`✅ Updated ${totalUpdated} user_extensions using individual updates`)
		} catch (error) {
			console.error(`❌ Failed to process user_extensions:`, error.message)
			this.stats.failedUpdates++
			throw error
		}

		// Redistribute table with tenant_code as partition key
		await this.redistributeTableIfNeeded('user_extensions', 'tenant_code', tableConfig.hasPartitionKey)

		this.stats.successfulUpdates += totalUpdated
	}

	/**
	 * Individual processing for user_extensions (fallback)
	 */
	async processUserExtensionsIndividually() {
		console.log(`🔄 Processing user_extensions individually...`)

		// Get distinct organization_ids from user_extensions
		const [orgResults] = await this.sequelize.query(`
			SELECT DISTINCT organization_id::text as org_id
			FROM user_extensions
			WHERE organization_id IS NOT NULL
			ORDER BY org_id
		`)

		console.log(`🔄 Processing user_extensions with ${orgResults.length} organizations individually`)

		if (orgResults.length === 0) {
			console.log(`⚠️  No organizations found in user_extensions`)
			return 0
		}

		const transaction = await this.sequelize.transaction()
		let totalUpdated = 0

		try {
			// Process organizations in batches
			for (let i = 0; i < orgResults.length; i += this.BATCH_SIZE) {
				const orgBatch = orgResults.slice(i, i + this.BATCH_SIZE)

				for (const org of orgBatch) {
					const orgData = this.orgLookupCache.get(org.org_id)
					if (!orgData) {
						console.warn(`⚠️  No CSV data for organization_id: ${org.org_id}`)
						continue
					}

					const [, metadata] = await this.sequelize.query(
						`
						UPDATE user_extensions 
						SET 
							tenant_code = '${orgData.tenant_code}',
							organization_code = '${orgData.organization_code}',
							updated_at = NOW()
						WHERE organization_id::text = '${org.org_id}'
					`,
						{ transaction }
					)

					totalUpdated += metadata.rowCount || 0
				}
			}

			await transaction.commit()
			return totalUpdated
		} catch (error) {
			await transaction.rollback()
			throw error
		}
	}

	/**
	 * Process table with user_id using inner joins and CSV lookup
	 */
	async processTableWithUserId(tableConfig) {
		const { name, updateColumns, hasPartitionKey, useSessionLookup } = tableConfig
		console.log(`\n🔄 Processing table with user_id: ${name}`)

		try {
			// Check if table exists and has target columns
			const existingColumns = await this.checkTableColumns(name)
			const availableUpdateColumns = updateColumns.filter((col) => existingColumns.includes(col))

			if (availableUpdateColumns.length === 0) {
				console.log(`⚠️  Table ${name} has no target columns, skipping`)
				return
			}

			// Handle Citus undistribution
			const citusEnabled = await this.isCitusEnabled()
			let wasDistributed = false
			if (citusEnabled && hasPartitionKey && availableUpdateColumns.includes('tenant_code')) {
				wasDistributed = await this.undistributeTable(name)
			}

			try {
				if (useSessionLookup) {
					await this.processSessionLookupTable(name, tableConfig)
				} else {
					await this.processUserIdTable(name, tableConfig)
				}

				// Redistribute if needed
				if (citusEnabled && wasDistributed) {
					await this.redistributeTable(name)
				}
			} catch (error) {
				console.error(`❌ Error during updates for ${name}:`, error.message)
				throw error
			}

			console.log(`✅ Completed ${name}`)
		} catch (error) {
			console.error(`❌ Error processing table ${name}:`, error)
			throw error
		}
	}

	/**
	 * Process table that needs session lookup (post_session_details)
	 * Uses individual organization updates
	 */
	async processSessionLookupTable(tableName, tableConfig) {
		const sessionIdColumn = tableConfig.sessionIdColumn
		console.log(`🔄 Processing ${tableName} using individual organization updates...`)

		let totalUpdated = 0
		try {
			totalUpdated = await this.processSessionLookupIndividually(tableName, tableConfig)
			console.log(`✅ Updated ${totalUpdated} rows in ${tableName} using individual updates`)
		} catch (error) {
			console.error(`❌ Failed to process ${tableName}:`, error.message)
			this.stats.failedUpdates++
			throw error
		}

		this.stats.successfulUpdates += totalUpdated
	}

	/**
	 * Individual processing for session lookup tables (Citus-compatible)
	 */
	async processSessionLookupIndividually(tableName, tableConfig) {
		const sessionIdColumn = tableConfig.sessionIdColumn

		// For Citus distributed tables, we need to avoid complex joins
		// Instead, we'll use a simpler approach: get all sessions first, then match
		console.log(`🔄 Processing ${tableName} with Citus-compatible approach...`)

		// Step 1: Check what columns exist in the table first
		const tableColumns = await this.checkTableColumns(tableName)
		const hasOrgCode = tableColumns.includes('organization_code')

		// Build WHERE clause based on available columns
		let whereClause = 'tenant_code IS NULL'
		if (hasOrgCode) {
			whereClause += ' OR organization_code IS NULL'
		}

		const [sessionIds] = await this.sequelize.query(`
			SELECT DISTINCT ${sessionIdColumn} as session_id
			FROM ${tableName}
			WHERE ${whereClause}
		`)

		if (sessionIds.length === 0) {
			console.log(`✅ No rows to update in ${tableName}`)
			return 0
		}

		// Step 2: Use a simple UPDATE with correlated subquery to avoid complex joins
		const transaction = await this.sequelize.transaction()
		let totalUpdated = 0

		try {
			// Build SET clause - only update columns that exist in the table
			const setClauses = []

			if (tableConfig.updateColumns.includes('tenant_code') && tableColumns.includes('tenant_code')) {
				setClauses.push(`tenant_code = s.tenant_code`)
			}

			if (tableConfig.updateColumns.includes('organization_code') && tableColumns.includes('organization_code')) {
				setClauses.push(`organization_code = COALESCE(s.organization_code, '${this.defaults.orgCode}')`)
			}

			setClauses.push('updated_at = NOW()')

			// Build WHERE clause for UPDATE (only check columns that exist)
			let updateWhereClause = `${tableName}.tenant_code IS NULL`
			if (hasOrgCode) {
				updateWhereClause += ` OR ${tableName}.organization_code IS NULL`
			}

			// Use UPDATE with FROM clause (PostgreSQL syntax)
			const [, metadata] = await this.sequelize.query(
				`
				UPDATE ${tableName} 
				SET ${setClauses.join(', ')}
				FROM sessions s 
				WHERE ${tableName}.${sessionIdColumn} = s.id
				AND s.tenant_code IS NOT NULL
				AND (${updateWhereClause})
			`,
				{ transaction }
			)

			totalUpdated = metadata.rowCount || 0
			await transaction.commit()
		} catch (error) {
			await transaction.rollback()
			throw error
		}

		console.log(`✅ Updated ${totalUpdated} rows in ${tableName} using correlated update`)
		return totalUpdated
	}

	/**
	 * Process table with user_id using individual organization updates
	 */
	async processUserIdTable(tableName, tableConfig) {
		const userIdColumn = tableConfig.userIdColumn
		console.log(`🔄 Processing ${tableName} using individual organization updates...`)

		let totalUpdated = 0
		try {
			totalUpdated = await this.processUserIdTableIndividually(tableName, tableConfig)
			console.log(`✅ Updated ${totalUpdated} rows in ${tableName} using individual updates`)
		} catch (error) {
			console.error(`❌ Failed to process ${tableName}:`, error.message)
			this.stats.failedUpdates++
			throw error
		}

		this.stats.successfulUpdates += totalUpdated
	}

	/**
	 * Individual processing for user_id tables (fallback)
	 */
	async processUserIdTableIndividually(tableName, tableConfig) {
		const userIdColumn = tableConfig.userIdColumn

		// Inner join with user_extensions, group by organization_id
		const [userExtByOrg] = await this.sequelize.query(`
			SELECT DISTINCT ue.organization_id::text as org_id
			FROM user_extensions ue
			INNER JOIN ${tableName} t ON t.${userIdColumn} = ue.user_id
			WHERE ue.organization_id IS NOT NULL
			ORDER BY org_id
		`)

		console.log(`🔄 Processing ${tableName} with ${userExtByOrg.length} organizations individually`)

		if (userExtByOrg.length === 0) {
			console.log(`⚠️  No organizations found for ${tableName}`)
			return 0
		}

		const transaction = await this.sequelize.transaction()
		let totalUpdated = 0

		try {
			// Process each organization in batches
			for (let i = 0; i < userExtByOrg.length; i += this.BATCH_SIZE) {
				const orgBatch = userExtByOrg.slice(i, i + this.BATCH_SIZE)

				for (const org of orgBatch) {
					const orgData = this.orgLookupCache.get(org.org_id)
					if (!orgData) {
						// Count records that will be left without tenant_code
						const [countResult] = await this.sequelize.query(
							`SELECT COUNT(*) as count 
							 FROM ${tableName} t 
							 INNER JOIN user_extensions ue ON t.${userIdColumn} = ue.user_id 
							 WHERE ue.organization_id::text = '${org.org_id}'`,
							{ transaction }
						)

						this.stats.missingOrgIdRecords.push({
							table: tableName,
							orgId: org.org_id,
							count: parseInt(countResult[0].count),
						})

						console.warn(
							`⚠️  No CSV data for organization_id: ${org.org_id} in ${tableName} (${countResult[0].count} records affected)`
						)
						continue
					}

					// Build SET clause using CSV lookup data
					const setClauses = []
					if (tableConfig.updateColumns.includes('tenant_code')) {
						setClauses.push(`tenant_code = '${orgData.tenant_code}'`)
					}
					if (tableConfig.updateColumns.includes('organization_code')) {
						setClauses.push(`organization_code = '${orgData.organization_code}'`)
					}
					setClauses.push('updated_at = NOW()')

					const [, metadata] = await this.sequelize.query(
						`
						UPDATE ${tableName} 
						SET ${setClauses.join(', ')}
						FROM user_extensions ue
						WHERE ${tableName}.${userIdColumn} = ue.user_id
						AND ue.organization_id::text = '${org.org_id}'
					`,
						{ transaction }
					)

					totalUpdated += metadata.rowCount || 0
				}
			}

			// Handle records with created_by = '0' (system records) using defaults
			if (tableConfig.updateColumns.includes('tenant_code')) {
				const [systemRecordsCount] = await this.sequelize.query(
					`SELECT COUNT(*) as count FROM ${tableName} WHERE ${userIdColumn}::text = '0' AND tenant_code IS NULL`,
					{ transaction }
				)

				if (parseInt(systemRecordsCount[0].count) > 0) {
					const tableDefaults = this.getTableDefaults(tableName)
					const setClauses = []
					setClauses.push(`tenant_code = '${tableDefaults.tenant_code}'`)
					if (tableConfig.updateColumns.includes('organization_code')) {
						setClauses.push(`organization_code = '${tableDefaults.organization_code}'`)
					}
					setClauses.push('updated_at = NOW()')

					const [, systemMetadata] = await this.sequelize.query(
						`
						UPDATE ${tableName} 
						SET ${setClauses.join(', ')}
						WHERE ${userIdColumn}::text = '0' AND tenant_code IS NULL
					`,
						{ transaction }
					)

					if (systemMetadata.rowCount > 0) {
						console.log(
							`✅ Applied table-specific defaults to ${systemMetadata.rowCount} system records (${userIdColumn} = '0') in ${tableName}`
						)
						console.log(
							`   Defaults used: tenant_code='${tableDefaults.tenant_code}', organization_code='${tableDefaults.organization_code}'`
						)
						totalUpdated += systemMetadata.rowCount

						this.stats.systemRecordsFixed.push({
							table: tableName,
							count: systemMetadata.rowCount,
							reason: `${userIdColumn} = '0'`,
						})
					}
				}

				// Handle records with created_by = NULL - THROW ERROR (don't fix)
				const [nullUserRecordsCount] = await this.sequelize.query(
					`SELECT COUNT(*) as count FROM ${tableName} WHERE ${userIdColumn} IS NULL AND tenant_code IS NULL`,
					{ transaction }
				)

				if (parseInt(nullUserRecordsCount[0].count) > 0) {
					const nullRecordCount = parseInt(nullUserRecordsCount[0].count)
					console.log(`❌ ERROR: Found ${nullRecordCount} records with NULL ${userIdColumn} in ${tableName}`)

					this.stats.nullUserIdErrors.push({
						table: tableName,
						count: nullRecordCount,
						reason: `${userIdColumn} IS NULL - DATA INTEGRITY ERROR`,
					})

					// This is a data integrity error - should cause migration to fail
					throw new Error(
						`Data integrity error: ${nullRecordCount} records in ${tableName} have NULL ${userIdColumn} - cannot determine tenant_code`
					)
				}

				// Handle records with created_by that don't exist in user_extensions
				const [orphanedUserRecords] = await this.sequelize.query(
					`SELECT COUNT(*) as count 
					 FROM ${tableName} t 
					 LEFT JOIN user_extensions ue ON t.${userIdColumn} = ue.user_id 
					 WHERE t.tenant_code IS NULL 
					 AND t.${userIdColumn} IS NOT NULL 
					 AND t.${userIdColumn}::text != '0' 
					 AND ue.user_id IS NULL`,
					{ transaction }
				)

				if (parseInt(orphanedUserRecords[0].count) > 0) {
					const tableDefaults = this.getTableDefaults(tableName)
					const setClauses = []
					setClauses.push(`tenant_code = '${tableDefaults.tenant_code}'`)
					if (tableConfig.updateColumns.includes('organization_code')) {
						setClauses.push(`organization_code = '${tableDefaults.organization_code}'`)
					}
					setClauses.push('updated_at = NOW()')

					const [, orphanedUserMetadata] = await this.sequelize.query(
						`
						UPDATE ${tableName} 
						SET ${setClauses.join(', ')}
						FROM (
							SELECT t.id 
							FROM ${tableName} t 
							LEFT JOIN user_extensions ue ON t.${userIdColumn} = ue.user_id 
							WHERE t.tenant_code IS NULL 
							AND t.${userIdColumn} IS NOT NULL 
							AND t.${userIdColumn}::text != '0' 
							AND ue.user_id IS NULL
						) as orphaned_records
						WHERE ${tableName}.id = orphaned_records.id
					`,
						{ transaction }
					)

					if (orphanedUserMetadata.rowCount > 0) {
						console.log(
							`✅ Applied table-specific defaults to ${orphanedUserMetadata.rowCount} records with orphaned ${userIdColumn} in ${tableName}`
						)
						console.log(
							`   Defaults used: tenant_code='${tableDefaults.tenant_code}', organization_code='${tableDefaults.organization_code}'`
						)
						totalUpdated += orphanedUserMetadata.rowCount

						this.stats.orphanedUserIdRecordsFixed.push({
							table: tableName,
							count: orphanedUserMetadata.rowCount,
							reason: `${userIdColumn} not found in user_extensions`,
						})
					}
				}
			}

			await transaction.commit()
			return totalUpdated
		} catch (error) {
			await transaction.rollback()
			throw error
		}
	}

	/**
	 * Check table columns
	 */
	async checkTableColumns(tableName) {
		try {
			const [columns] = await this.sequelize.query(`
				SELECT column_name 
				FROM information_schema.columns 
				WHERE table_name = '${tableName}' 
				AND table_schema = 'public'
			`)
			return columns.map((col) => col.column_name)
		} catch (error) {
			return []
		}
	}

	/**
	 * Handle Citus distribution
	 */
	async handleCitusDistribution() {
		console.log('\n🔄 PHASE 4: Handling Citus distribution...')
		console.log('='.repeat(70))

		const allTables = [...this.tablesWithOrgId, ...this.tablesWithDefaults, ...this.tablesWithUserId]
		let distributedCount = 0

		for (const tableConfig of allTables) {
			const { name, hasPartitionKey } = tableConfig

			if (hasPartitionKey) {
				try {
					const isDistributed = await this.isTableDistributed(name)

					if (!isDistributed) {
						await this.redistributeTable(name)
						distributedCount++
					} else {
						console.log(`✅ Table ${name} already distributed`)
					}
				} catch (error) {
					console.log(`⚠️  Could not distribute ${name}: ${error.message}`)
				}
			}
		}

		console.log(`✅ Distribution complete: ${distributedCount} tables redistributed`)
	}

	/**
	 * Comprehensive validation to ensure no NULL values remain in ALL critical columns
	 * Checks both tenant_code AND organization_code where applicable
	 */
	async validateNoNullCriticalColumns() {
		console.log('\n🔍 COMPREHENSIVE VALIDATION: Checking for NULL values in ALL critical columns...')
		console.log('='.repeat(80))

		const allTables = [...this.tablesWithOrgId, ...this.tablesWithDefaults, ...this.tablesWithUserId]
		let totalNullFound = 0
		const failedTables = []
		const detailedErrors = []

		for (const tableConfig of allTables) {
			const tableName = tableConfig.name
			console.log(`\n🔍 Validating table: ${tableName}`)

			try {
				// Check if table exists first
				const tableExists = await this.sequelize.query(
					`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${tableName}')`,
					{ type: Sequelize.QueryTypes.SELECT }
				)

				if (!tableExists[0].exists) {
					console.log(`⚠️  Table ${tableName} does not exist, skipping`)
					continue
				}

				// Get available columns for this table
				const existingColumns = await this.checkTableColumns(tableName)
				const criticalColumns = []

				// Determine which columns should be validated based on table configuration
				if (tableConfig.updateColumns.includes('tenant_code') && existingColumns.includes('tenant_code')) {
					criticalColumns.push('tenant_code')
				}
				if (
					tableConfig.updateColumns.includes('organization_code') &&
					existingColumns.includes('organization_code')
				) {
					criticalColumns.push('organization_code')
				}

				if (criticalColumns.length === 0) {
					console.log(`⚠️  No critical columns to validate for ${tableName}`)
					continue
				}

				console.log(`📋 Validating columns: ${criticalColumns.join(', ')}`)

				// Check each critical column for NULL values
				for (const columnName of criticalColumns) {
					const nullCount = await this.sequelize.query(
						`SELECT COUNT(*) as count FROM ${tableName} WHERE ${columnName} IS NULL`,
						{ type: Sequelize.QueryTypes.SELECT }
					)

					const nullValues = parseInt(nullCount[0].count)
					totalNullFound += nullValues

					const status = nullValues === 0 ? '✅' : '❌'
					console.log(`  ${status} ${columnName}: ${nullValues} NULL values`)

					if (nullValues > 0) {
						if (!failedTables.includes(tableName)) {
							failedTables.push(tableName)
						}

						// Get sample records for debugging
						const sampleRecords = await this.sequelize.query(
							`SELECT id, ${tableConfig.userIdColumn || 'organization_id'} as ref_id 
							 FROM ${tableName} 
							 WHERE ${columnName} IS NULL 
							 LIMIT 3`,
							{ type: Sequelize.QueryTypes.SELECT }
						)

						detailedErrors.push({
							table: tableName,
							column: columnName,
							nullCount: nullValues,
							sampleRecords,
						})

						console.log(
							`    Sample NULL records:`,
							sampleRecords.map((r) => `id:${r.id}(ref:${r.ref_id})`).join(', ')
						)
					}
				}

				// Additional validation: Check for records that have tenant_code but missing organization_code
				// (for tables that should have both columns)
				if (criticalColumns.includes('tenant_code') && criticalColumns.includes('organization_code')) {
					const inconsistentCount = await this.sequelize.query(
						`SELECT COUNT(*) as count FROM ${tableName} 
						 WHERE tenant_code IS NOT NULL AND organization_code IS NULL`,
						{ type: Sequelize.QueryTypes.SELECT }
					)

					const inconsistentValues = parseInt(inconsistentCount[0].count)
					if (inconsistentValues > 0) {
						totalNullFound += inconsistentValues
						if (!failedTables.includes(tableName)) {
							failedTables.push(tableName)
						}

						console.log(
							`  ❌ INCONSISTENT DATA: ${inconsistentValues} records with tenant_code but NULL organization_code`
						)

						detailedErrors.push({
							table: tableName,
							column: 'organization_code',
							nullCount: inconsistentValues,
							issue: 'Has tenant_code but missing organization_code',
						})
					}
				}
			} catch (error) {
				console.error(`❌ Error validating ${tableName}: ${error.message}`)
				detailedErrors.push({
					table: tableName,
					error: error.message,
				})
			}
		}

		console.log('\n' + '='.repeat(80))
		if (totalNullFound === 0) {
			console.log('🎉 COMPREHENSIVE VALIDATION PASSED: No NULL values found in critical columns!')
			return true
		} else {
			console.log(
				`❌ COMPREHENSIVE VALIDATION FAILED: ${totalNullFound} NULL values found in ${failedTables.length} tables`
			)
			console.log(`Failed tables: ${failedTables.join(', ')}`)

			// Detailed error report
			console.log('\n📋 DETAILED ERROR REPORT:')
			console.log('-'.repeat(60))
			detailedErrors.forEach((error) => {
				if (error.nullCount) {
					console.log(`❌ Table: ${error.table}`)
					console.log(`   Column: ${error.column}`)
					console.log(`   NULL count: ${error.nullCount}`)
					if (error.issue) {
						console.log(`   Issue: ${error.issue}`)
					}
					if (error.sampleRecords) {
						console.log(`   Sample records: ${error.sampleRecords.map((r) => `id:${r.id}`).join(', ')}`)
					}
				} else {
					console.log(`❌ Table: ${error.table}, Error: ${error.error}`)
				}
			})

			// Store detailed errors in stats for later reporting
			this.stats.validationErrors = detailedErrors

			return false
		}
	}

	/**
	 * Print comprehensive statistics including error details
	 */
	printStats() {
		const duration = Math.round((Date.now() - this.stats.startTime) / 1000)
		const minutes = Math.floor(duration / 60)
		const seconds = duration % 60

		console.log('\n🎯 MIGRATION COMPLETED!')
		console.log('='.repeat(50))
		console.log(`⏱️  Duration: ${minutes}m ${seconds}s`)
		console.log(`✅ Successful updates: ${this.stats.successfulUpdates.toLocaleString()}`)
		console.log(`❌ Failed updates: ${this.stats.failedUpdates.toLocaleString()}`)
		console.log(`🔄 Tables undistributed: ${this.stats.tablesUndistributed}`)
		console.log(`🔄 Tables redistributed: ${this.stats.tablesRedistributed}`)

		// Enhanced error reporting
		if (this.stats.missingOrgIdRecords.length > 0) {
			console.log(`\n⚠️  Missing organization_id in CSV:`)
			this.stats.missingOrgIdRecords.forEach((record) => {
				console.log(`   - Table: ${record.table}, org_id: ${record.orgId}, records affected: ${record.count}`)
			})
		}

		if (this.stats.systemRecordsFixed.length > 0) {
			console.log(`\n✅ System records fixed (created_by = 0):`)
			this.stats.systemRecordsFixed.forEach((record) => {
				console.log(`   - Table: ${record.table}, records fixed: ${record.count}, reason: ${record.reason}`)
			})
		}

		if (this.stats.nullUserIdErrors.length > 0) {
			console.log(`\n❌ NULL user_id errors (data integrity issues):`)
			this.stats.nullUserIdErrors.forEach((record) => {
				console.log(`   - Table: ${record.table}, error count: ${record.count}, reason: ${record.reason}`)
			})
		}

		if (this.stats.orphanedUserIdRecordsFixed.length > 0) {
			console.log(`\n✅ Orphaned user_id records fixed:`)
			this.stats.orphanedUserIdRecordsFixed.forEach((record) => {
				console.log(`   - Table: ${record.table}, records fixed: ${record.count}, reason: ${record.reason}`)
			})
		}

		if (this.stats.validationErrors.length > 0) {
			console.log(`\n❌ Validation errors found:`)
			this.stats.validationErrors.forEach((error) => {
				if (error.nullCount) {
					console.log(`   - Table: ${error.table}, NULL values: ${error.nullCount}`)
				} else {
					console.log(`   - Table: ${error.table}, Error: ${error.error}`)
				}
			})
		}
	}

	/**
	 * Create database snapshot before migration
	 */
	async createSnapshot() {
		console.log('\n📸 Creating database snapshot for rollback capability...')

		const allTables = [...this.tablesWithOrgId, ...this.tablesWithDefaults, ...this.tablesWithUserId]
		const snapshotData = {}

		try {
			for (const tableConfig of allTables) {
				const tableName = tableConfig.name

				try {
					// Check if table exists first
					await this.sequelize.query(`SELECT 1 FROM ${tableName} LIMIT 1`, {
						type: Sequelize.QueryTypes.SELECT,
					})

					// Store original tenant_code and organization_code values
					const originalData = await this.sequelize.query(
						`SELECT id, tenant_code, organization_code FROM ${tableName} WHERE tenant_code IS NULL OR organization_code IS NULL`,
						{ type: Sequelize.QueryTypes.SELECT }
					)

					if (originalData.length > 0) {
						snapshotData[tableName] = originalData
						console.log(`📋 Snapshot created for ${tableName}: ${originalData.length} records`)
					}
				} catch (error) {
					// Table doesn't exist or columns missing - skip snapshot for this table
					console.log(
						`⚠️  Skipping snapshot for ${tableName}: ${
							error.message.includes('does not exist') ? 'table not found' : 'column missing'
						}`
					)
					continue
				}
			}

			this.snapshot = snapshotData
			console.log(`✅ Snapshot completed for ${Object.keys(snapshotData).length} tables`)
			return true
		} catch (error) {
			console.error(`❌ Failed to create snapshot: ${error.message}`)
			return false
		}
	}

	/**
	 * Revert all backfilled data using snapshot
	 */
	async revertBackfilledData() {
		console.log('\n🔄 REVERTING BACKFILLED DATA...')
		console.log('='.repeat(50))

		if (!this.snapshot || Object.keys(this.snapshot).length === 0) {
			console.log('⚠️  No snapshot found - cannot revert changes')
			return false
		}

		let totalReverted = 0

		try {
			// Start global transaction for rollback
			const transaction = await this.sequelize.transaction()

			try {
				for (const [tableName, originalRecords] of Object.entries(this.snapshot)) {
					console.log(`🔄 Reverting ${tableName}...`)

					for (const record of originalRecords) {
						const setClauses = []

						// Revert tenant_code to original state (NULL)
						if (record.tenant_code === null) {
							setClauses.push(`tenant_code = NULL`)
						}

						// Revert organization_code to original state (NULL)
						if (record.organization_code === null) {
							setClauses.push(`organization_code = NULL`)
						}

						if (setClauses.length > 0) {
							setClauses.push(`updated_at = NOW()`)

							const [, metadata] = await this.sequelize.query(
								`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ${record.id}`,
								{ transaction }
							)

							totalReverted += metadata.rowCount || 0
						}
					}

					console.log(`✅ Reverted ${originalRecords.length} records in ${tableName}`)
				}

				await transaction.commit()
				console.log(`\n✅ ROLLBACK COMPLETED: ${totalReverted} records reverted to original state`)
				console.log('🔄 Database restored to pre-migration state')
				return true
			} catch (error) {
				await transaction.rollback()
				throw error
			}
		} catch (error) {
			console.error(`❌ Rollback failed: ${error.message}`)
			return false
		}
	}

	/**
	 * Main execution method with rollback capability
	 */
	async execute() {
		let migrationSuccess = false

		try {
			console.log('🚀 Starting Enhanced Data Migration with Rollback Support...')
			console.log('='.repeat(70))
			console.log(
				`🔧 Using global defaults: tenant_code="${this.defaultTenantCode}", org_code="${this.defaultOrgCode}"`
			)

			const tableSpecificCount = Object.keys(this.tableSpecificDefaults).length
			if (tableSpecificCount > 0) {
				console.log(`🔧 Table-specific defaults configured for ${tableSpecificCount} tables:`)
				Object.entries(this.tableSpecificDefaults).forEach(([table, defaults]) => {
					console.log(
						`   - ${table}: tenant_code="${defaults.tenant_code}", org_code="${defaults.organization_code}"`
					)
				})
			} else {
				console.log('🔧 No table-specific defaults configured (using global defaults for all tables)')
			}

			await this.sequelize.authenticate()
			console.log('✅ Database connection established')

			// Check if Citus is enabled
			const citusEnabled = await this.isCitusEnabled()
			console.log(`🔧 Citus enabled: ${citusEnabled ? 'Yes' : 'No'}`)

			await this.loadLookupData()

			// Validate CSV data coverage before proceeding
			await this.validateDatabaseOrgsCoveredByCSV()

			// Create snapshot before starting migration
			const snapshotCreated = await this.createSnapshot()
			if (!snapshotCreated) {
				throw new Error('Failed to create database snapshot - aborting migration')
			}

			// PHASE 1: Process tables with organization_id using CSV lookup
			await this.processTablesWithOrgId()

			// PHASE 2: Process tables using table-specific defaults
			await this.processTablesWithDefaults()

			// PHASE 3: Process tables with user_id using inner joins and CSV lookup
			await this.processTablesWithUserId()

			// PHASE 4: Handle Citus distribution if enabled
			if (citusEnabled) {
				await this.handleCitusDistribution()
			} else {
				console.log('\n⚠️  Citus not enabled, skipping distribution logic')
			}

			// PHASE 5: Comprehensive validation
			const validationPassed = await this.validateNoNullCriticalColumns()

			this.printStats()

			if (!validationPassed) {
				console.log('\n❌ MIGRATION VALIDATION FAILED: NULL tenant_code values still exist')
				console.log('📋 Check the detailed error report above for specific issues')

				// Trigger rollback
				const rollbackSuccess = await this.revertBackfilledData()
				if (rollbackSuccess) {
					console.log('\n🔄 All changes have been reverted due to validation failure')
					console.log('✅ Database restored to original state')
				} else {
					console.log('\n❌ CRITICAL: Rollback failed - database may be in inconsistent state')
				}

				throw new Error('Migration validation failed - NULL values remain')
			}

			migrationSuccess = true
			console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!')
			console.log('✅ All tenant_code values properly assigned')
			console.log('✅ Database ready for constraint application')
		} catch (error) {
			console.error('❌ Migration failed:', error.message)

			// If migration hadn't succeeded and we have a snapshot, attempt rollback
			if (!migrationSuccess && this.snapshot) {
				console.log('\n🔄 Attempting automatic rollback...')
				const rollbackSuccess = await this.revertBackfilledData()
				if (!rollbackSuccess) {
					console.log('❌ CRITICAL: Automatic rollback failed - manual intervention required')
				}
			}

			this.printStats()
			process.exit(1)
		} finally {
			await this.dbManager.close()
		}
	}
}

// Execute migration if run directly
if (require.main === module) {
	const migrator = new MentoringDataMigrator()
	migrator.execute()
}

module.exports = MentoringDataMigrator
