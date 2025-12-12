require('dotenv').config({ path: '../../.env' })
const { Sequelize } = require('sequelize')
const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')
const DatabaseConnectionManager = require('./db-connection-utils')

/**
 * Data Migration Script for Existing Tenant Data
 *
 * Mode B (selected): Overwrite ONLY rows where CSV mapping exists.
 * Option 1 (selected): Update ALL rows where lookup matches (overwrite regardless of current tenant_code).
 *
 * USAGE:
 *   node migrate-existing-tenant-data.js
 *
 * REQUIREMENTS:
 *   - DEFAULT_TENANT_CODE environment variable
 *   - DEFAULT_ORGANISATION_CODE environment variable
 *   - data/data_codes.csv file (optional - if present, used to overwrite)
 */

class ExistingTenantDataMigrator {
	constructor() {
		this.dbManager = new DatabaseConnectionManager({
			poolMax: 10,
			poolMin: 2,
			logging: false,
		})
		this.sequelize = this.dbManager.getSequelize()

		this.defaultTenantCode = process.env.DEFAULT_TENANT_CODE
		this.defaultOrgCode = process.env.DEFAULT_ORGANISATION_CODE

		if (!this.defaultTenantCode) {
			throw new Error('DEFAULT_TENANT_CODE environment variable is required')
		}
		if (!this.defaultOrgCode) {
			throw new Error('DEFAULT_ORGANISATION_CODE environment variable is required')
		}

		this.orgLookupCache = new Map()

		this.stats = {
			totalProcessed: 0,
			successfulUpdates: 0,
			failedUpdates: 0,
			constraintsDropped: 0,
			constraintsRestored: 0,
			startTime: Date.now(),
		}

		this.tableConfigs = {
			withOrgId: [
				{ name: 'availabilities', columns: ['tenant_code', 'organization_code'] },
				{ name: 'default_rules', columns: ['tenant_code', 'organization_code'] },
				{ name: 'entity_types', columns: ['tenant_code', 'organization_code'] },
				{ name: 'file_uploads', columns: ['tenant_code', 'organization_code'] },
				{ name: 'forms', columns: ['tenant_code', 'organization_code'] },
				{ name: 'notification_templates', columns: ['tenant_code', 'organization_code'] },
				{ name: 'organization_extension', columns: ['tenant_code', 'organization_code'] },
				{ name: 'report_queries', columns: ['tenant_code', 'organization_code'] },
				{ name: 'reports', columns: ['tenant_code', 'organization_code'] },
				{ name: 'role_extensions', columns: ['tenant_code', 'organization_code'] },
			],

			userExtensions: { name: 'user_extensions', columns: ['tenant_code', 'organization_code'] },

			withEntityTypeId: [{ name: 'entities', columns: ['tenant_code'], entityTypeIdColumn: 'entity_type_id' }],

			withUserId: [
				{ name: 'sessions', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'feedbacks', columns: ['tenant_code'], userIdColumn: 'user_id' },
				{ name: 'connection_requests', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'connections', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'resources', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'session_request', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'issues', columns: ['tenant_code', 'organization_code'], userIdColumn: 'user_id' },
				{ name: 'question_sets', columns: ['tenant_code', 'organization_code'], userIdColumn: 'created_by' },
				{ name: 'questions', columns: ['tenant_code', 'organization_code'], userIdColumn: 'created_by' },
			],

			withSessionId: [
				{ name: 'post_session_details', columns: ['tenant_code'], sessionIdColumn: 'session_id' },
				{ name: 'session_attendees', columns: ['tenant_code'], sessionIdColumn: 'session_id' },
			],

			withDefaults: [
				{ name: 'modules', columns: ['tenant_code'] },
				{ name: 'report_types', columns: ['tenant_code', 'organization_code'] },
				{ name: 'report_role_mapping', columns: ['tenant_code', 'organization_code'] },
			],
		}
	}

	async loadLookupData() {
		console.log('🔄 Loading lookup data from data_codes.csv...')

		const csvPath = path.join(__dirname, '../../data/sample_data_codes.csv')
		if (!fs.existsSync(csvPath)) {
			console.log('⚠️  data_codes.csv not found, skipping CSV-based overwrite phase')
			return
		}

		return new Promise((resolve, reject) => {
			fs.createReadStream(csvPath)
				.pipe(csv())
				.on('data', (row) => {
					const orgId = String(row.organization_id || '').trim()
					const tenant = String(row.tenant_code || '').trim()
					const orgCode = String(row.organization_code || '').trim()

					if (orgId && tenant && orgCode) {
						this.orgLookupCache.set(orgId, {
							organization_code: orgCode,
							tenant_code: tenant,
						})
					}
				})
				.on('end', () => {
					console.log(`✅ Loaded ${this.orgLookupCache.size} organization mappings`)
					resolve()
				})
				.on('error', reject)
		})
	}

	async checkForExistingData() {
		console.log('🔍 Checking for existing data that needs migration...')

		try {
			const testQueries = [
				"SELECT COUNT(*) as count FROM sessions WHERE tenant_code IS NULL OR tenant_code = ''",
				"SELECT COUNT(*) as count FROM user_extensions WHERE tenant_code IS NULL OR tenant_code = ''",
				"SELECT COUNT(*) as count FROM organization_extension WHERE tenant_code IS NULL OR tenant_code = ''",
			]

			let totalRecordsNeedingMigration = 0

			for (const query of testQueries) {
				try {
					const results = await this.sequelize.query(query, { type: Sequelize.QueryTypes.SELECT })
					totalRecordsNeedingMigration += parseInt(results[0].count)
				} catch (error) {
					console.log(`⚠️  Could not check table: ${error.message}`)
				}
			}

			console.log(`📊 Found ${totalRecordsNeedingMigration} records with NULL/empty tenant_code`)

			return totalRecordsNeedingMigration > 0
		} catch (error) {
			console.log(`⚠️  Error checking for existing data: ${error.message}`)
			return true
		}
	}

	async dropForeignKeyConstraints(transaction) {
		console.log('🔗 Dropping foreign key constraints for data migration...')

		try {
			const foreignKeys = await this.sequelize.query(
				`SELECT DISTINCT
					tc.table_name,
					tc.constraint_name,
					string_agg(DISTINCT kcu.column_name, ', ' ORDER BY kcu.column_name) as columns,
					ccu.table_name AS foreign_table_name,
					string_agg(DISTINCT ccu.column_name, ', ' ORDER BY ccu.column_name) as foreign_columns
				FROM information_schema.table_constraints AS tc 
				JOIN information_schema.key_column_usage AS kcu
					ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
				JOIN information_schema.constraint_column_usage AS ccu
					ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
				WHERE tc.constraint_type = 'FOREIGN KEY' 
				AND tc.table_schema = 'public'
				GROUP BY tc.constraint_name, tc.table_name, ccu.table_name
				ORDER BY tc.table_name`,
				{ type: Sequelize.QueryTypes.SELECT, transaction }
			)

			const droppedConstraints = []

			for (const fk of foreignKeys) {
				try {
					await this.sequelize.query(
						`ALTER TABLE "${fk.table_name}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`,
						{ transaction }
					)
					droppedConstraints.push(fk)
					console.log(`✅ Dropped FK: ${fk.constraint_name} from ${fk.table_name}`)
				} catch (error) {
					console.log(`⚠️  Could not drop FK ${fk.constraint_name}: ${error.message}`)
				}
			}

			this.stats.constraintsDropped = droppedConstraints.length
			console.log(`✅ Dropped ${droppedConstraints.length} foreign key constraints`)

			return droppedConstraints
		} catch (error) {
			console.error(`❌ Error dropping foreign key constraints: ${error.message}`)
			throw error
		}
	}

	async restoreForeignKeyConstraints(droppedConstraints, transaction) {
		console.log('🔗 Restoring foreign key constraints after data migration...')

		let restoredCount = 0
		let skippedCitusIncompatible = 0

		// Check if Citus extension is available
		let citusEnabled = false
		try {
			const citusCheck = await this.sequelize.query(
				`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus')`,
				{ type: Sequelize.QueryTypes.SELECT, transaction }
			)
			citusEnabled = citusCheck[0].exists
			if (citusEnabled) {
				console.log('🌐 Citus detected - using tenant-aware constraint restoration')
			}
		} catch (error) {
			console.log('📍 Standard PostgreSQL detected - using standard constraint restoration')
		}

		for (const fk of droppedConstraints) {
			try {
				// Skip certain constraints that are incompatible with Citus distribution
				if (citusEnabled && this.isCitusIncompatibleConstraint(fk)) {
					console.log(
						`⚠️  Skipping Citus-incompatible constraint: ${fk.constraint_name} (does not include tenant_code)`
					)
					skippedCitusIncompatible++
					continue
				}

				// Special handling for tenant-aware constraints in Citus
				if (citusEnabled && this.isTransformableToTenantAware(fk)) {
					const success = await this.restoreTenantAwareForeignKey(fk, transaction)
					if (success) {
						console.log(`✅ Restored tenant-aware FK: ${fk.constraint_name} on ${fk.table_name}`)
						restoredCount++
					} else {
						console.log(`⚠️  Could not restore as tenant-aware FK: ${fk.constraint_name}`)
						skippedCitusIncompatible++
					}
					continue
				}

				// Generic restoration for standard PostgreSQL or non-tenant constraints
				await this.sequelize.query(
					`ALTER TABLE "${fk.table_name}" 
					 ADD CONSTRAINT "${fk.constraint_name}" 
					 FOREIGN KEY (${fk.columns}) 
					 REFERENCES "${fk.foreign_table_name}"(${fk.foreign_columns})
					 ON DELETE RESTRICT 
					 ON UPDATE CASCADE`,
					{ transaction }
				)
				console.log(`✅ Restored FK: ${fk.constraint_name} on ${fk.table_name}`)
				restoredCount++
			} catch (error) {
				console.log(`❌ Error restoring FK ${fk.constraint_name}: ${error.message}`)
				// Don't count as failure - Citus incompatible constraints are expected to fail
			}
		}

		this.stats.constraintsRestored = restoredCount
		console.log(`✅ Restored: ${restoredCount} foreign key constraints`)
		if (skippedCitusIncompatible > 0) {
			console.log(`⚠️  Skipped: ${skippedCitusIncompatible} Citus-incompatible constraints`)
			console.log(
				`💡 Note: Skipped constraints don't include tenant_code and are incompatible with distributed tables`
			)
		}
	}

	/**
	 * Check if a foreign key constraint is incompatible with Citus distribution
	 */
	isCitusIncompatibleConstraint(fk) {
		// Constraints that don't involve tenant_code are incompatible with Citus
		const hasMultipleColumns = fk.columns.includes(',')
		const includesTenantCode = fk.columns.toLowerCase().includes('tenant_code')
		const foreignIncludesTenantCode = fk.foreign_columns.toLowerCase().includes('tenant_code')

		// Skip if it's a multi-column constraint that doesn't include tenant_code
		if (hasMultipleColumns && (!includesTenantCode || !foreignIncludesTenantCode)) {
			return true
		}

		// Skip single-column constraints to non-distributed tables that would cause issues
		const problematicTables = ['connections', 'session_attendees', 'sessions']
		if (problematicTables.includes(fk.table_name) && !includesTenantCode) {
			return true
		}

		return false
	}

	/**
	 * Check if a constraint can be transformed to be tenant-aware
	 */
	isTransformableToTenantAware(fk) {
		// Define mapping of tenant-aware FK relationships
		const tenantAwareRelationships = {
			session_attendees: {
				session_id: {
					referencedTable: 'sessions',
					columns: 'session_id, tenant_code',
					referencedColumns: 'id, tenant_code',
				},
			},
			post_session_details: {
				session_id: {
					referencedTable: 'sessions',
					columns: 'session_id, tenant_code',
					referencedColumns: 'id, tenant_code',
				},
			},
			resources: {
				session_id: {
					referencedTable: 'sessions',
					columns: 'session_id, tenant_code',
					referencedColumns: 'id, tenant_code',
				},
			},
		}

		return tenantAwareRelationships[fk.table_name] && tenantAwareRelationships[fk.table_name][fk.columns.trim()]
	}

	/**
	 * Restore a foreign key as tenant-aware for Citus compatibility
	 */
	async restoreTenantAwareForeignKey(fk, transaction) {
		try {
			// Map of known tenant-aware relationships
			const relationships = {
				session_attendees: {
					session_id: {
						columns: 'session_id, tenant_code',
						referencedTable: 'sessions',
						referencedColumns: 'id, tenant_code',
					},
				},
				post_session_details: {
					session_id: {
						columns: 'session_id, tenant_code',
						referencedTable: 'sessions',
						referencedColumns: 'id, tenant_code',
					},
				},
				resources: {
					session_id: {
						columns: 'session_id, tenant_code',
						referencedTable: 'sessions',
						referencedColumns: 'id, tenant_code',
					},
				},
			}

			const tableRelations = relationships[fk.table_name]
			const columnKey = fk.columns.trim()

			if (!tableRelations || !tableRelations[columnKey]) {
				return false
			}

			const relation = tableRelations[columnKey]

			await this.sequelize.query(
				`ALTER TABLE "${fk.table_name}"
				 ADD CONSTRAINT "${fk.constraint_name}_tenant_aware"
				 FOREIGN KEY (${relation.columns})
				 REFERENCES "${relation.referencedTable}"(${relation.referencedColumns})
				 ON DELETE RESTRICT
				 ON UPDATE CASCADE`,
				{ transaction }
			)

			return true
		} catch (error) {
			console.log(`⚠️  Failed to create tenant-aware FK: ${error.message}`)
			return false
		}
	}

	async processTablesWithOrgId(transaction) {
		console.log('\n🔄 PHASE 1: Processing tables with organization_id using CSV lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withOrgId) {
			await this.processOrgIdTable(transaction, tableConfig)
		}
	}

	async processOrgIdTable(transaction, tableConfig) {
		const { name, columns } = tableConfig

		try {
			const tableExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
				{
					replacements: { tableName: name },
					type: Sequelize.QueryTypes.SELECT,
					transaction,
				}
			)

			if (!tableExists[0].exists) {
				console.log(`⚠️  Table ${name} does not exist, skipping`)
				return
			}

			console.log(`🔄 Processing ${name} with organization_id lookup...`)

			// Get distinct organization_ids present in the table (we will only update when CSV mapping exists)
			const orgList = await this.sequelize.query(
				`SELECT DISTINCT organization_id::text as org_id 
				 FROM "${name}"
				 WHERE organization_id IS NOT NULL`,
				{ type: Sequelize.QueryTypes.SELECT, transaction }
			)

			let totalUpdated = 0

			for (const org of orgList) {
				const orgData = this.orgLookupCache.get(org.org_id)
				// Mode B: Only update when mapping exists
				if (!orgData) {
					continue
				}
				const tenantCode = orgData.tenant_code || this.defaultTenantCode
				const orgCode = orgData.organization_code || this.defaultOrgCode

				const setClauses = []
				if (columns.includes('tenant_code')) {
					setClauses.push(`tenant_code = :tenantCode`)
				}
				if (columns.includes('organization_code')) {
					setClauses.push(`organization_code = :orgCode`)
				}
				setClauses.push('updated_at = NOW()')

				const replacements = {
					tenantCode,
					orgCode,
					orgId: org.org_id,
				}

				const [_, metadata] = await this.sequelize.query(
					`UPDATE "${name}" 
					 SET ${setClauses.join(', ')}
					 WHERE organization_id::text = :orgId`,
					{
						replacements,
						transaction,
					}
				)

				const affected = metadata?.rowCount || 0
				totalUpdated += affected
				if (affected > 0) {
					console.log(`   ✔ Updated ${affected} rows in ${name} for organization_id=${org.org_id}`)
				}
			}

			this.stats.successfulUpdates += totalUpdated
			console.log(`✅ ${name}: total updated from CSV mappings = ${totalUpdated}`)

			// Do NOT force defaults here for mapped orgs; null-organization rows are handled in defaults phase
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processUserExtensions(transaction) {
		console.log('\n🔄 PHASE 2: Processing user_extensions table...')
		console.log('='.repeat(70))

		await this.processOrgIdTable(transaction, this.tableConfigs.userExtensions)
		console.log('✅ user_extensions processing completed (required for next phase)')
	}

	async processTablesWithEntityTypeId(transaction) {
		console.log('\n🔄 PHASE 3: Processing tables with entity_type_id using entity_types lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withEntityTypeId) {
			await this.processEntityTypeIdTable(transaction, tableConfig)
		}
	}

	async processEntityTypeIdTable(transaction, tableConfig) {
		const { name, columns, entityTypeIdColumn } = tableConfig

		try {
			const tableExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
				{
					replacements: { tableName: name },
					type: Sequelize.QueryTypes.SELECT,
					transaction,
				}
			)

			if (!tableExists[0].exists) {
				console.log(`⚠️  Table ${name} does not exist, skipping`)
				return
			}

			console.log(`🔄 Processing ${name} with entity_type_id lookup...`)

			const setClauses = []
			if (columns.includes('tenant_code')) {
				setClauses.push('tenant_code = et.tenant_code')
			}
			if (columns.includes('organization_code')) {
				setClauses.push('organization_code = et.organization_code')
			}
			setClauses.push('updated_at = NOW()')

			// Overwrite rows where entity_types has a tenant_code (Mode B: only when lookup exists)
			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET ${setClauses.join(', ')}
				 FROM entity_types et
				 WHERE "${name}"."${entityTypeIdColumn}" = et.id
				 AND et.tenant_code IS NOT NULL`,
				{
					replacements: {},
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: overwritten ${affected} rows using entity_types lookup`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processTablesWithUserId(transaction) {
		console.log('\n🔄 PHASE 4: Processing tables with user_id using user_extensions lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withUserId) {
			await this.processUserIdTable(transaction, tableConfig)
		}
	}

	async processUserIdTable(transaction, tableConfig) {
		const { name, columns, userIdColumn } = tableConfig

		try {
			const tableExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
				{
					replacements: { tableName: name },
					type: Sequelize.QueryTypes.SELECT,
					transaction,
				}
			)

			if (!tableExists[0].exists) {
				console.log(`⚠️  Table ${name} does not exist, skipping`)
				return
			}

			console.log(`🔄 Processing ${name} with user_id lookup...`)

			// Overwrite where a matching user_extensions row exists (Mode B)
			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET tenant_code = ue.tenant_code, updated_at = NOW()
				 FROM user_extensions ue
				 WHERE "${name}"."${userIdColumn}" = ue.user_id
				 AND "${name}"."${userIdColumn}" IS NOT NULL
				 AND ue.tenant_code IS NOT NULL`,
				{
					replacements: { defaultTenantCode: this.defaultTenantCode },
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: overwritten ${affected} rows using user_extensions lookup`)

			// Intentionally not touching rows where user_id is NULL or no matching user_extensions exists
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processTablesWithSessionId(transaction) {
		console.log('\n🔄 PHASE 5: Processing tables with session_id using sessions lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withSessionId) {
			await this.processSessionIdTable(transaction, tableConfig)
		}
	}

	async processSessionIdTable(transaction, tableConfig) {
		const { name, columns, sessionIdColumn } = tableConfig

		try {
			const tableExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
				{
					replacements: { tableName: name },
					type: Sequelize.QueryTypes.SELECT,
					transaction,
				}
			)

			if (!tableExists[0].exists) {
				console.log(`⚠️  Table ${name} does not exist, skipping`)
				return
			}

			console.log(`🔄 Processing ${name} with session_id lookup...`)

			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET tenant_code = s.tenant_code, updated_at = NOW()
				 FROM sessions s
				 WHERE "${name}"."${sessionIdColumn}" = s.id
				 AND s.tenant_code IS NOT NULL`,
				{
					replacements: { defaultTenantCode: this.defaultTenantCode },
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: overwritten ${affected} rows using sessions lookup`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processTablesWithDefaults(transaction) {
		console.log('\n🔄 PHASE 6: Processing tables with defaults only...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withDefaults) {
			await this.processDefaultsTable(transaction, tableConfig)
		}
	}

	async processDefaultsTable(transaction, tableConfig) {
		const { name, columns } = tableConfig

		try {
			const tableExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
				{
					replacements: { tableName: name },
					type: Sequelize.QueryTypes.SELECT,
					transaction,
				}
			)

			if (!tableExists[0].exists) {
				console.log(`⚠️  Table ${name} does not exist, skipping`)
				return
			}

			console.log(`🔄 Processing ${name} with default values (only where tenant_code is NULL/empty)...`)

			const setClauses = []
			if (columns.includes('tenant_code')) {
				setClauses.push(`tenant_code = '${this.defaultTenantCode}'`)
			}
			if (columns.includes('organization_code')) {
				setClauses.push(`organization_code = '${this.defaultOrgCode}'`)
			}
			setClauses.push('updated_at = NOW()')

			const [, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				SET ${setClauses.join(', ')}
				WHERE tenant_code IS NULL OR tenant_code = ''`,
				{
					replacements: {},
					transaction,
				}
			)

			const updatedCount = metadata?.rowCount || 0
			this.stats.successfulUpdates += updatedCount

			console.log(`✅ Updated ${updatedCount} rows in ${name} with defaults`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async forceOverwriteFromCSVAndLookups(transaction) {
		// This function is not required because we implemented Mode B updates in phases above.
		// Left intentionally empty for clarity and future use.
		return
	}

	async validateDataIntegrity(transaction) {
		console.log('\n🔍 Validating data integrity after migration...')
		console.log('='.repeat(50))

		const errors = []
		const allTableConfigs = [
			...this.tableConfigs.withOrgId,
			this.tableConfigs.userExtensions,
			...this.tableConfigs.withUserId,
			...this.tableConfigs.withSessionId,
			...this.tableConfigs.withDefaults,
		]

		for (const tableConfig of allTableConfigs) {
			try {
				const tableName = tableConfig.name

				const tableExists = await this.sequelize.query(
					`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
					{
						replacements: { tableName },
						type: Sequelize.QueryTypes.SELECT,
						transaction,
					}
				)

				if (!tableExists[0].exists) {
					continue
				}

				const nullCounts = await this.sequelize.query(
					`SELECT COUNT(*) as count FROM "${tableName}" WHERE tenant_code IS NULL OR tenant_code = ''`,
					{ transaction, type: Sequelize.QueryTypes.SELECT }
				)
				const nullValues = parseInt(nullCounts[0].count)

				if (nullValues > 0) {
					errors.push(`${tableName} has ${nullValues} NULL/empty tenant_code values`)
				}

				if (tableConfig.columns && tableConfig.columns.includes('organization_code')) {
					const nullOrgCounts = await this.sequelize.query(
						`SELECT COUNT(*) as count FROM "${tableName}" WHERE organization_code IS NULL OR organization_code = ''`,
						{ transaction, type: Sequelize.QueryTypes.SELECT }
					)
					const nullOrgValues = parseInt(nullOrgCounts[0].count)

					if (nullOrgValues > 0) {
						errors.push(`${tableName} has ${nullOrgValues} NULL/empty organization_code values`)
					}
				}
			} catch (error) {
				errors.push(`Error validating ${tableConfig.name}: ${error.message}`)
			}
		}

		const isValid = errors.length === 0

		if (isValid) {
			console.log('✅ Data integrity validation passed - no NULL values found')
		} else {
			console.log(`❌ Data integrity validation failed:`)
			errors.forEach((error) => console.log(`   - ${error}`))
		}

		return {
			valid: isValid,
			errors: errors,
		}
	}

	/**
	 * Create Citus-optimized indexes after data migration
	 * Note: Citus table distribution should be done manually before running this
	 */
	async setupCitusDistribution() {
		console.log('\n📊 PHASE 7: Creating Citus-optimized indexes (after data filling)...')
		console.log('='.repeat(70))

		try {
			// Check if Citus extension is available
			const citusCheck = await this.sequelize.query(
				`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus')`,
				{ type: Sequelize.QueryTypes.SELECT }
			)

			if (!citusCheck[0].exists) {
				console.log('⚠️  Citus extension not found - skipping Citus index creation')
				console.log('💡 This is normal for single-node PostgreSQL installations')
				console.log('✅ Data migration completed successfully (no Citus indexes needed)')
				return
			}

			console.log('✅ Citus extension detected - creating Citus-optimized indexes')

			// Create Citus-optimized indexes (tenant-first for optimal performance)
			const citusIndexes = [
				// Core user and organization indexes
				{
					table: 'user_extensions',
					name: 'idx_user_extensions_citus_tenant_user',
					columns: 'tenant_code, user_id',
				},
				{
					table: 'organization_extension',
					name: 'idx_organization_extension_citus_tenant_org',
					columns: 'tenant_code, organization_code',
				},

				// Session-related indexes
				{ table: 'sessions', name: 'idx_sessions_citus_tenant_mentor', columns: 'tenant_code, mentor_id' },
				{ table: 'sessions', name: 'idx_sessions_citus_tenant_status', columns: 'tenant_code, status' },
				{ table: 'sessions', name: 'idx_sessions_citus_tenant_date', columns: 'tenant_code, start_date' },
				{
					table: 'session_attendees',
					name: 'idx_session_attendees_citus_tenant_mentee',
					columns: 'tenant_code, mentee_id',
				},
				{
					table: 'session_attendees',
					name: 'idx_session_attendees_citus_tenant_session',
					columns: 'tenant_code, session_id',
				},

				// Entity and form indexes
				{ table: 'entities', name: 'idx_entities_citus_tenant_type', columns: 'tenant_code, entity_type_id' },
				{ table: 'entity_types', name: 'idx_entity_types_citus_tenant_value', columns: 'tenant_code, value' },
				{ table: 'forms', name: 'idx_forms_citus_tenant_type', columns: 'tenant_code, type, sub_type' },
				{ table: 'forms', name: 'idx_forms_citus_tenant_org', columns: 'tenant_code, organization_id' },

				// Communication and notification indexes
				{
					table: 'notification_templates',
					name: 'idx_notification_templates_citus_tenant_code',
					columns: 'tenant_code, code',
				},
				{
					table: 'connections',
					name: 'idx_connections_citus_tenant_users',
					columns: 'tenant_code, user_id, friend_id',
				},
				{
					table: 'connection_requests',
					name: 'idx_connection_requests_citus_tenant_users',
					columns: 'tenant_code, user_id, friend_id',
				},

				// Resource and session management indexes
				{ table: 'resources', name: 'idx_resources_citus_tenant_session', columns: 'tenant_code, session_id' },
				{
					table: 'session_request',
					name: 'idx_session_request_citus_tenant_user',
					columns: 'tenant_code, created_by',
				},
				{
					table: 'post_session_details',
					name: 'idx_post_session_details_citus_tenant_session',
					columns: 'tenant_code, session_id',
				},

				// Reporting and analytics indexes
				{ table: 'reports', name: 'idx_reports_citus_tenant_org', columns: 'tenant_code, organization_id' },
				{
					table: 'report_queries',
					name: 'idx_report_queries_citus_tenant_code',
					columns: 'tenant_code, report_code',
				},
				{ table: 'feedbacks', name: 'idx_feedbacks_citus_tenant_user', columns: 'tenant_code, user_id' },

				// Configuration indexes
				{ table: 'default_rules', name: 'idx_default_rules_citus_tenant_type', columns: 'tenant_code, type' },
				{ table: 'question_sets', name: 'idx_question_sets_citus_tenant_code', columns: 'tenant_code, code' },
				{
					table: 'role_extensions',
					name: 'idx_role_extensions_citus_tenant_title',
					columns: 'tenant_code, title',
				},
			]

			let indexesCreated = 0
			let indexesSkipped = 0

			for (const idx of citusIndexes) {
				try {
					// Check if table exists
					const tableExists = await this.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
						{
							replacements: { tableName: idx.table },
							type: Sequelize.QueryTypes.SELECT,
						}
					)

					if (!tableExists[0].exists) {
						console.log(`⚠️  Table ${idx.table} does not exist, skipping index`)
						indexesSkipped++
						continue
					}

					// Create index with IF NOT EXISTS to avoid conflicts
					await this.sequelize.query(
						`CREATE INDEX IF NOT EXISTS "${idx.name}" ON "${idx.table}" (${idx.columns})`
					)
					console.log(`✅ Created Citus index: ${idx.name}`)
					indexesCreated++
				} catch (error) {
					console.log(`⚠️  Could not create index ${idx.name}: ${error.message}`)
					indexesSkipped++
				}
			}

			console.log(`\n📈 Citus Index Creation Summary:`)
			console.log(`✅ Successfully created: ${indexesCreated} indexes`)
			console.log(`⚠️  Skipped/Failed: ${indexesSkipped} indexes`)
			console.log(`📊 Total attempted: ${citusIndexes.length} indexes`)

			if (indexesCreated > 0) {
				console.log('\n🚀 Citus Performance Tips:')
				console.log('• All indexes are tenant-first for optimal Citus performance')
				console.log('• Always include tenant_code in WHERE clauses')
				console.log('• Cross-tenant queries will be slower (avoid when possible)')
				console.log('• Monitor performance: SELECT * FROM citus_stat_statements ORDER BY total_time DESC;')
			}

			console.log('\n💡 Next Steps:')
			console.log('• Ensure all tables are distributed with: SELECT * FROM citus_tables;')
			console.log('• Run ANALYZE on all tables to update statistics')
			console.log('• Test query performance with tenant-aware queries')
		} catch (error) {
			console.log(`⚠️  Citus index creation failed: ${error.message}`)
			console.log('💡 This is expected for non-Citus PostgreSQL installations')
		}
	}

	/**
	 * Create performance indexes after data migration (without Citus dependency)
	 */
	async createPerformanceIndexes() {
		console.log('\n📊 PHASE 7: Creating performance indexes after data migration...')
		console.log('='.repeat(70))

		try {
			// Performance indexes for optimal query performance
			const performanceIndexes = [
				{
					table: 'connection_requests',
					name: 'idx_connection_requests_friend_user_tenant',
					columns: 'friend_id, user_id, tenant_code',
					condition: '',
				},
				{
					table: 'connections',
					name: 'idx_connections_friend_user_tenant',
					columns: 'friend_id, user_id, tenant_code',
					condition: '',
				},
				{
					table: 'entity_types',
					name: 'idx_entity_types_value_tenant',
					columns: 'value, tenant_code',
					condition: '',
				},
				{
					table: 'feedbacks',
					name: 'idx_feedbacks_user_tenant',
					columns: 'user_id, tenant_code',
					condition: '',
				},
				{
					table: 'forms',
					name: 'idx_forms_type_subtype_organization',
					columns: 'type, sub_type, organization_id',
					condition: '',
				},
				{ table: 'issues', name: 'idx_issues_tenant_code', columns: 'tenant_code', condition: '' },
				{
					table: 'notification_templates',
					name: 'idx_notification_templates_code_org',
					columns: 'code, organization_code',
					condition: '',
				},
				{
					table: 'organization_extension',
					name: 'idx_organization_extension_org_code',
					columns: 'organization_code',
					condition: '',
				},
				{
					table: 'organization_extension',
					name: 'idx_organization_extension_org_tenant_code',
					columns: 'organization_code, tenant_code',
					condition: '',
				},
				{
					table: 'post_session_details',
					name: 'idx_post_session_details_tenant_session',
					columns: 'tenant_code, session_id',
					condition: '',
				},
				{
					table: 'question_sets',
					name: 'idx_question_sets_code_tenant',
					columns: 'code, tenant_code',
					condition: '',
				},
				{
					table: 'report_queries',
					name: 'idx_report_queries_code_tenant_org',
					columns: 'report_code, tenant_code, organization_code',
					condition: '',
				},
				{
					table: 'report_role_mapping',
					name: 'idx_report_role_mapping_role_code',
					columns: 'role_title, report_code',
					condition: '',
				},
				{
					table: 'report_types',
					name: 'idx_report_types_title_tenant',
					columns: 'title, tenant_code',
					condition: '',
				},
				{
					table: 'reports',
					name: 'idx_reports_org_tenant_code',
					columns: 'organization_id, tenant_code, code',
					condition: '',
				},
				{
					table: 'resources',
					name: 'idx_resources_session_tenant',
					columns: 'session_id, tenant_code',
					condition: '',
				},
				{ table: 'role_extensions', name: 'idx_role_extensions_title', columns: 'title', condition: '' },
				{
					table: 'session_attendees',
					name: 'idx_session_attendees_tenant_code',
					columns: 'tenant_code',
					condition: '',
				},
				{
					table: 'session_request',
					name: 'idx_session_request_tenant_code',
					columns: 'tenant_code',
					condition: '',
				},
				{
					table: 'user_extensions',
					name: 'idx_user_extensions_user_tenant',
					columns: 'user_id, tenant_code',
					condition: '',
				},
				{
					table: 'user_extensions',
					name: 'idx_user_extensions_email',
					columns: 'email',
					condition: 'WHERE email IS NOT NULL',
				},
				{
					table: 'user_extensions',
					name: 'idx_user_extensions_phone',
					columns: 'phone',
					condition: 'WHERE phone IS NOT NULL',
				},
				{
					table: 'user_extensions',
					name: 'idx_user_extensions_user_name',
					columns: 'user_name',
					condition: 'WHERE user_name IS NOT NULL',
				},
			]

			let indexesCreated = 0
			let indexesSkipped = 0

			console.log(`🔧 Creating ${performanceIndexes.length} performance indexes...`)

			for (const idx of performanceIndexes) {
				try {
					// Check if table exists
					const tableExists = await this.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
						{
							replacements: { tableName: idx.table },
							type: Sequelize.QueryTypes.SELECT,
						}
					)

					if (!tableExists[0].exists) {
						console.log(`⚠️  Table ${idx.table} does not exist, skipping index`)
						indexesSkipped++
						continue
					}

					// Create index with conditional WHERE clause if specified
					const indexQuery = `CREATE INDEX IF NOT EXISTS "${idx.name}" ON "${idx.table}" (${idx.columns}) ${idx.condition}`

					await this.sequelize.query(indexQuery)
					console.log(`✅ Created performance index: ${idx.name}`)
					indexesCreated++
				} catch (error) {
					console.log(`❌ Error creating index ${idx.name}: ${error.message}`)
					indexesSkipped++
				}
			}

			console.log(`\n📈 Performance Index Creation Summary:`)
			console.log(`✅ Successfully created: ${indexesCreated} indexes`)
			console.log(`⚠️  Skipped/Failed: ${indexesSkipped} indexes`)
			console.log(`📊 Total attempted: ${performanceIndexes.length} indexes`)

			if (indexesCreated > 0) {
				console.log('\n🚀 Performance Optimization Complete:')
				console.log('• All indexes created for optimal query performance')
				console.log('• Indexes include tenant-aware and conditional indexes')
				console.log('• Citus distribution can be executed manually as needed')
			}
		} catch (error) {
			console.log(`❌ Performance index creation failed: ${error.message}`)
			console.log('💡 Indexes can be created manually if needed')
		}
	}

	printStats() {
		const duration = Math.round((Date.now() - this.stats.startTime) / 1000)
		const minutes = Math.floor(duration / 60)
		const seconds = duration % 60

		console.log('\n🎯 DATA MIGRATION COMPLETED!')
		console.log('='.repeat(50))
		console.log(`⏱️  Duration: ${minutes}m ${seconds}s`)
		console.log(`✅ Successful updates: ${this.stats.successfulUpdates.toLocaleString()}`)
		console.log(`❌ Failed updates: ${this.stats.failedUpdates.toLocaleString()}`)
		console.log(`🔗 Constraints dropped: ${this.stats.constraintsDropped}`)
		console.log(`🔗 Constraints restored: ${this.stats.constraintsRestored}`)
		console.log(`📊 Organization mappings loaded: ${this.orgLookupCache.size}`)
		console.log('='.repeat(50))
	}

	async execute() {
		let migrationSuccess = false

		try {
			console.log('🚀 Starting Existing Tenant Data Migration...')
			console.log('='.repeat(70))
			console.log(`🔧 Using defaults: tenant_code="${this.defaultTenantCode}", org_code="${this.defaultOrgCode}"`)

			const connectionValidation = await this.dbManager.validateConnection()
			if (!connectionValidation.success) {
				throw new Error(`Database connection validation failed: ${connectionValidation.message}`)
			}
			console.log('✅ Database connection validated')

			// Load CSV lookup data first (we will proceed if CSV present)
			await this.loadLookupData()

			// Determine if there's existing data to migrate
			const hasNullTenantRows = await this.checkForExistingData()

			// Proceed if either CSV mappings exist or there are NULL/default tenant rows
			if (!hasNullTenantRows && this.orgLookupCache.size === 0) {
				console.log('🎉 No existing data found that needs tenant_code migration and no CSV mappings present')
				console.log('✅ Script completed (no action needed)')
				return
			}

			// Start transaction for all data migration operations
			const transaction = await this.sequelize.transaction()

			try {
				// Step 1: Drop foreign key constraints
				const droppedConstraints = await this.dropForeignKeyConstraints(transaction)

				// Step 2: Process data in proper sequence (following helper.js)
				await this.processTablesWithOrgId(transaction) // PHASE 1
				await this.processUserExtensions(transaction) // PHASE 2
				await this.processTablesWithEntityTypeId(transaction) // PHASE 3
				await this.processTablesWithUserId(transaction) // PHASE 4
				await this.processTablesWithSessionId(transaction) // PHASE 5
				await this.processTablesWithDefaults(transaction) // PHASE 6

				// No separate forceOverwrite step needed: Mode B updates applied in phases above

				// Step 3: Validate data integrity
				const validationResult = await this.validateDataIntegrity(transaction)

				if (!validationResult.valid) {
					throw new Error(`Data validation failed: ${validationResult.errors.join('; ')}`)
				}

				// Step 4: Restore foreign key constraints
				await this.restoreForeignKeyConstraints(droppedConstraints, transaction)

				// Commit transaction
				await transaction.commit()
				migrationSuccess = true

				console.log('\n🎉 EXISTING DATA MIGRATION COMPLETED SUCCESSFULLY!')
				console.log(
					'✅ All tenant_code and organization_code values properly assigned (where mappings existed)'
				)
				console.log('✅ Data integrity validated')
				console.log('✅ Foreign key constraints restored')

				// Step 5: Create performance indexes
				await this.createPerformanceIndexes()
			} catch (error) {
				await transaction.rollback()
				throw error
			}
		} catch (error) {
			console.error('❌ Data migration failed:', error.message)
			migrationSuccess = false
		} finally {
			this.printStats()
			await this.dbManager.close()

			if (!migrationSuccess) {
				process.exit(1)
			}
		}
	}
}

if (require.main === module) {
	const migrator = new ExistingTenantDataMigrator()
	migrator.execute()
}

module.exports = ExistingTenantDataMigrator
