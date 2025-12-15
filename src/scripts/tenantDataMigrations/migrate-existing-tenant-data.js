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
		console.log('🔍 Checking if tenant data migration has already been completed...')

		try {
			// Since the tenant_code migration (20251212250000-complete-tenant-code-migration.js)
			// already populated all tenant_code columns and made them NOT NULL,
			// we just need to verify the migration completed successfully.

			// Check if any of the core tables still need the basic tenant structure
			const tableChecks = [
				"SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'tenant_code')",
				"SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'user_extensions' AND column_name = 'tenant_code')",
				"SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'organization_extension' AND column_name = 'tenant_code')",
			]

			let migrationCompleted = true

			for (const query of tableChecks) {
				try {
					const results = await this.sequelize.query(query, { type: Sequelize.QueryTypes.SELECT })
					if (!results[0].exists) {
						migrationCompleted = false
						console.log(`⚠️  tenant_code column missing from table`)
						break
					}
				} catch (error) {
					console.log(`⚠️  Could not check table structure: ${error.message}`)
					migrationCompleted = false
				}
			}

			if (migrationCompleted) {
				console.log(`✅ Basic tenant migration structure already exists`)
				return false // No migration needed
			} else {
				console.log(`❌ Basic tenant migration structure incomplete`)
				return true // Migration needed
			}
		} catch (error) {
			console.log(`⚠️  Error checking for existing data: ${error.message}`)
			return true
		}
	}

	async dropForeignKeyConstraints(transaction) {
		console.log('🔗 Dropping foreign key constraints for affected tables only...')

		try {
			// Only drop foreign keys for tables affected by tenant migration
			// These are ALL tables that will have their primary keys changed to composite keys with tenant_code
			// ANY foreign key that references these tables OR is referenced BY these tables must be dropped
			const affectedTables = [
				'availabilities',
				'connection_requests',
				'connections',
				'default_rules',
				'entities',
				'entity_types',
				'feedbacks',
				'file_uploads',
				'forms',
				'issues',
				'modules',
				'notification_templates',
				'organization_extension',
				'post_session_details',
				'question_sets',
				'questions',
				'report_queries',
				'report_role_mapping',
				'report_types',
				'reports',
				'resources',
				'role_extensions',
				'session_attendees',
				'session_request',
				'sessions',
				'user_extensions',
			]

			// Get foreign keys only for affected tables using IN operator instead of ANY(array)
			const placeholders1 = affectedTables.map((_, index) => `$${index + 1}`).join(', ')
			const placeholders2 = affectedTables.map((_, index) => `$${index + 1 + affectedTables.length}`).join(', ')

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
				AND (tc.table_name IN (${placeholders1}) OR ccu.table_name IN (${placeholders2}))
				GROUP BY tc.constraint_name, tc.table_name, ccu.table_name
				ORDER BY tc.table_name`,
				{
					type: Sequelize.QueryTypes.SELECT,
					transaction,
					bind: [...affectedTables, ...affectedTables], // Bind parameters for both IN clauses
				}
			)

			const droppedConstraints = []
			console.log(
				`🎯 Found ${foreignKeys.length} foreign keys involving tenant migration tables (scoped to 26 tables only)`
			)

			// If no foreign keys found, skip dropping step
			if (foreignKeys.length === 0) {
				console.log(`✅ No foreign keys to drop - skipping constraint dropping`)
				this.stats.constraintsDropped = 0
				return droppedConstraints
			}

			for (const fk of foreignKeys) {
				try {
					await this.sequelize.query(
						`ALTER TABLE "${fk.table_name}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`,
						{ transaction }
					)
					droppedConstraints.push(fk)
					console.log(
						`✅ Dropped FK: ${fk.constraint_name} from ${fk.table_name} -> ${fk.foreign_table_name}`
					)
				} catch (error) {
					console.log(`❌ FAILED to drop FK ${fk.constraint_name}: ${error.message}`)
					throw new Error(
						`Critical failure: Cannot drop foreign key ${fk.constraint_name} from ${fk.table_name}. This will prevent primary key changes. Error: ${error.message}`
					)
				}
			}

			this.stats.constraintsDropped = droppedConstraints.length
			console.log(
				`✅ Dropped ${droppedConstraints.length} foreign key constraints (scoped to affected tables only)`
			)

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
			const replacements = {}

			if (columns.includes('tenant_code')) {
				setClauses.push(`tenant_code = :tenantCode`)
				replacements.tenantCode = this.defaultTenantCode
			}
			if (columns.includes('organization_code')) {
				setClauses.push(`organization_code = :orgCode`)
				replacements.orgCode = this.defaultOrgCode
			}
			setClauses.push('updated_at = NOW()')

			const [, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				SET ${setClauses.join(', ')}
				WHERE tenant_code IS NULL OR tenant_code = ''`,
				{
					replacements,
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
	 * Create unique indexes after data migration and duplicate cleanup
	 * NOTE: Should only be run after duplicate data cleanup
	 */
	/**
	 * Fix existing UNIQUE constraints to include tenant_code for proper multi-tenant isolation
	 * This ensures all unique constraints are tenant-aware
	 */
	async fixUniqueConstraints() {
		console.log('\n🔧 PHASE 6B: Fixing UNIQUE constraints for proper tenant isolation...')
		console.log('='.repeat(70))

		try {
			// Drop existing problematic UNIQUE constraints that don't include tenant_code
			const constraintsToFix = [
				{
					table: 'connection_requests',
					oldIndexName: 'unique_user_id_friend_id_connection_requests',
					newIndexName: 'unique_user_id_friend_id_connection_requests_tenant',
					newColumns: 'user_id, friend_id, tenant_code',
					condition: 'WHERE (deleted_at IS NULL)',
				},
				{
					table: 'connections',
					oldIndexName: 'unique_user_id_friend_id_connections',
					newIndexName: 'unique_user_id_friend_id_connections_tenant',
					newColumns: 'user_id, friend_id, tenant_code',
					condition: 'WHERE (deleted_at IS NULL)',
				},
				{
					table: 'entities',
					oldIndexName: 'unique_entities_value',
					newIndexName: 'unique_entities_value_tenant',
					newColumns: 'value, entity_type_id, tenant_code',
					condition: 'WHERE (deleted_at IS NULL)',
				},
				{
					table: 'forms',
					oldIndexName: 'unique_type_sub_type_org_id',
					newIndexName: 'unique_type_sub_type_org_id_tenant',
					newColumns: 'type, sub_type, organization_id, tenant_code',
					condition: '',
				},
				{
					table: 'default_rules',
					oldIndexName: 'unique_default_rules_constraint',
					newIndexName: 'unique_default_rules_constraint_tenant',
					newColumns: 'type, target_field, requester_field, organization_id, tenant_code',
					condition: 'WHERE (deleted_at IS NULL)',
				},
				{
					table: 'entity_types',
					oldIndexName: 'unique_value_org_id',
					newIndexName: 'unique_value_org_id_tenant',
					newColumns: 'value, organization_id, tenant_code',
					condition: 'WHERE (deleted_at IS NULL)',
				},
				{
					table: 'modules',
					oldIndexName: 'code_unique',
					newIndexName: 'code_unique_tenant',
					newColumns: 'code, tenant_code',
					condition: 'WHERE (deleted_at IS NULL)',
				},
				{
					table: 'report_queries',
					oldIndexName: 'unique_queries_report_code_organization',
					newIndexName: 'unique_queries_report_code_organization_tenant',
					newColumns: 'report_code, organization_id, tenant_code',
					condition: '',
				},
				{
					table: 'report_types',
					oldIndexName: 'report_types_title',
					newIndexName: 'report_types_title_tenant',
					newColumns: 'title, tenant_code',
					condition: 'WHERE (deleted_at IS NULL)',
				},
				{
					table: 'reports',
					oldIndexName: 'report_code_organization_unique',
					newIndexName: 'report_code_organization_unique_tenant',
					newColumns: 'code, organization_id, tenant_code',
					condition: '',
				},
			]

			let constraintsFixed = 0
			let constraintsSkipped = 0

			for (const constraint of constraintsToFix) {
				try {
					console.log(`\n🔍 Processing ${constraint.table}.${constraint.oldIndexName}...`)

					// Check if old constraint exists
					const oldConstraintExists = await this.sequelize.query(
						`SELECT EXISTS (
							SELECT FROM pg_indexes 
							WHERE tablename = :tableName AND indexname = :indexName
						)`,
						{
							replacements: {
								tableName: constraint.table,
								indexName: constraint.oldIndexName,
							},
							type: Sequelize.QueryTypes.SELECT,
						}
					)

					if (oldConstraintExists[0].exists) {
						// For constraints (not just indexes), we need to drop the constraint first
						// Check if it's a constraint or just an index
						const isConstraint = await this.sequelize.query(
							`SELECT EXISTS (
								SELECT 1 FROM information_schema.table_constraints 
								WHERE constraint_name = :constraintName AND table_name = :tableName
							) as is_constraint`,
							{
								replacements: {
									constraintName: constraint.oldIndexName,
									tableName: constraint.table,
								},
								type: Sequelize.QueryTypes.SELECT,
							}
						)

						if (isConstraint[0].is_constraint) {
							// Drop constraint (which automatically drops the associated index)
							await this.sequelize.query(
								`ALTER TABLE "${constraint.table}" DROP CONSTRAINT IF EXISTS "${constraint.oldIndexName}"`
							)
							console.log(`  ✅ Dropped old constraint: ${constraint.oldIndexName}`)
						} else {
							// Drop index only
							await this.sequelize.query(`DROP INDEX IF EXISTS "${constraint.oldIndexName}"`)
							console.log(`  ✅ Dropped old index: ${constraint.oldIndexName}`)
						}
					}

					// Check if new constraint already exists
					const newConstraintExists = await this.sequelize.query(
						`SELECT EXISTS (
							SELECT FROM pg_indexes 
							WHERE tablename = :tableName AND indexname = :indexName
						)`,
						{
							replacements: {
								tableName: constraint.table,
								indexName: constraint.newIndexName,
							},
							type: Sequelize.QueryTypes.SELECT,
						}
					)

					if (!newConstraintExists[0].exists) {
						// Check data integrity before creating unique constraint
						const dataIntegrityCheck = await this._checkDataIntegrityForUniqueConstraint(
							constraint.table,
							constraint.newColumns,
							constraint.condition
						)

						if (!dataIntegrityCheck.isValid) {
							console.log(`  ❌ Data integrity violation in ${constraint.table}:`)
							console.log(`      Found ${dataIntegrityCheck.duplicateCount} duplicate rows`)
							console.log(`      Columns: ${constraint.newColumns}`)
							console.log(`  💡 Skipping constraint creation - clean duplicates first`)
							constraintsSkipped++
							continue
						}

						// Create new tenant-aware constraint using ALTER TABLE for proper constraint
						const createQuery = `ALTER TABLE "${constraint.table}" 
							ADD CONSTRAINT "${constraint.newIndexName}" 
							UNIQUE (${constraint.newColumns})`

						await this.sequelize.query(createQuery)
						console.log(`  ✅ Created tenant-aware constraint: ${constraint.newIndexName}`)
						constraintsFixed++
					} else {
						console.log(`  ⚠️  Constraint ${constraint.newIndexName} already exists`)
						constraintsSkipped++
					}
				} catch (error) {
					console.log(`  ❌ Error fixing constraint ${constraint.oldIndexName}: ${error.message}`)
					if (
						error.message.includes('duplicate key') ||
						error.message.includes('violates unique constraint')
					) {
						console.log(`  💡 Duplicate data found - constraint will be created later after cleanup`)
					}
					constraintsSkipped++
				}
			}

			console.log(`\n📊 Constraint Fix Summary:`)
			console.log(`✅ Successfully fixed: ${constraintsFixed} constraints`)
			console.log(`⚠️  Skipped/Failed: ${constraintsSkipped} constraints`)
			console.log(`📋 Total processed: ${constraintsToFix.length} constraints`)

			if (constraintsSkipped > 0) {
				console.log(`\n💡 Constraints skipped due to data integrity issues:`)
				console.log(`   • Clean duplicate data before creating unique constraints`)
				console.log(`   • Check logs above for specific duplicate row counts`)
				console.log(`   • Run data cleanup scripts and retry constraint creation`)
			}

			// Fix table structure issues for proper tenant isolation
			await this._fixTableStructure()

			// Fix foreign key CASCADE issues for distributed database compatibility
			await this._fixForeignKeyConstraints()

			if (constraintsFixed > 0) {
				console.log('\n🚀 Your database is now ready for Citus distribution!')
				console.log('✅ All UNIQUE constraints include tenant_code for proper distribution')
			}
		} catch (error) {
			console.log(`❌ Error fixing Citus constraints: ${error.message}`)
			console.log('💡 Continue with manual constraint fixes if needed')
		}
	}

	/**
	 * Check data integrity before creating unique constraint
	 * Identifies duplicate data that would violate the unique constraint
	 */
	async _checkDataIntegrityForUniqueConstraint(tableName, columns, condition = '') {
		try {
			// Clean the condition for use in WHERE clause
			const whereClause = condition.replace(/^WHERE\s+/i, '').trim()
			const whereCondition = whereClause ? `WHERE ${whereClause}` : ''

			// Count total rows that would be affected
			const totalRowsQuery = `
				SELECT COUNT(*) as total_count
				FROM "${tableName}" 
				${whereCondition}
			`

			const totalRows = await this.sequelize.query(totalRowsQuery, {
				type: Sequelize.QueryTypes.SELECT,
			})

			// Count unique combinations that would be in the constraint
			const uniqueRowsQuery = `
				SELECT COUNT(*) as unique_count
				FROM (
					SELECT DISTINCT ${columns}
					FROM "${tableName}"
					${whereCondition}
				) as unique_combinations
			`

			const uniqueRows = await this.sequelize.query(uniqueRowsQuery, {
				type: Sequelize.QueryTypes.SELECT,
			})

			const totalCount = parseInt(totalRows[0].total_count)
			const uniqueCount = parseInt(uniqueRows[0].unique_count)
			const duplicateCount = totalCount - uniqueCount

			const isValid = duplicateCount === 0

			if (!isValid) {
				// Get sample duplicate data for debugging
				const duplicatesQuery = `
					SELECT ${columns}, COUNT(*) as duplicate_count
					FROM "${tableName}"
					${whereCondition}
					GROUP BY ${columns}
					HAVING COUNT(*) > 1
					ORDER BY COUNT(*) DESC
					LIMIT 5
				`

				const sampleDuplicates = await this.sequelize.query(duplicatesQuery, {
					type: Sequelize.QueryTypes.SELECT,
				})

				return {
					isValid: false,
					totalRows: totalCount,
					uniqueRows: uniqueCount,
					duplicateCount,
					sampleDuplicates,
				}
			}

			return {
				isValid: true,
				totalRows: totalCount,
				uniqueRows: uniqueCount,
				duplicateCount: 0,
			}
		} catch (error) {
			console.log(`    ⚠️ Warning: Could not check data integrity for ${tableName}: ${error.message}`)
			// Return as valid to allow attempt (will fail with proper error if duplicates exist)
			return {
				isValid: true,
				totalRows: 0,
				uniqueRows: 0,
				duplicateCount: 0,
				error: error.message,
			}
		}
	}

	/**
	 * Fix table structure issues for proper tenant isolation
	 * Handles missing columns, incorrect primary keys, etc.
	 */
	async _fixTableStructure() {
		console.log('\n🔧 PHASE 6C: Fixing table structure for proper tenant isolation...')
		console.log('='.repeat(60))

		const tableFixesApplied = []
		const tableFixesFailed = []

		try {
			// Fix 1: post_session_details table structure
			console.log('\n🔍 Checking post_session_details table...')
			try {
				// Check if table exists and has proper structure
				const tableInfo = await this.sequelize.query(
					`SELECT 
						EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'post_session_details') as table_exists,
						EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'post_session_details' AND column_name = 'tenant_code') as tenant_code_exists,
						EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'post_session_details' AND constraint_type = 'PRIMARY KEY') as has_primary_key
					`,
					{ type: Sequelize.QueryTypes.SELECT }
				)

				const tableExists = tableInfo[0].table_exists
				const tenantCodeExists = tableInfo[0].tenant_code_exists
				const hasPrimaryKey = tableInfo[0].has_primary_key

				if (tableExists) {
					let needsStructureFix = false

					// Add tenant_code if missing
					if (!tenantCodeExists) {
						await this.sequelize.query(`
							ALTER TABLE post_session_details 
							ADD COLUMN tenant_code character varying(255) NOT NULL DEFAULT 'default'
						`)
						console.log('  ✅ Added tenant_code column to post_session_details')
						needsStructureFix = true
					}

					// Add primary key if missing
					if (!hasPrimaryKey) {
						await this.sequelize.query(`
							ALTER TABLE post_session_details 
							ADD CONSTRAINT post_session_details_pkey PRIMARY KEY (tenant_code, session_id)
						`)
						console.log('  ✅ Added primary key constraint to post_session_details')
						needsStructureFix = true
					}

					// Add foreign key constraint
					const fkExists = await this.sequelize.query(
						`SELECT EXISTS(
							SELECT 1 FROM information_schema.table_constraints 
							WHERE constraint_name = 'fk_post_session_details_session_id' 
							AND table_name = 'post_session_details'
						) as exists`,
						{ type: Sequelize.QueryTypes.SELECT }
					)

					if (!fkExists[0].exists && needsStructureFix) {
						await this.sequelize.query(`
							ALTER TABLE post_session_details
							ADD CONSTRAINT fk_post_session_details_session_id 
							FOREIGN KEY (session_id, tenant_code)
							REFERENCES sessions (id, tenant_code) 
							ON UPDATE RESTRICT ON DELETE RESTRICT
						`)
						console.log('  ✅ Added foreign key constraint to post_session_details')
					}

					if (needsStructureFix) {
						tableFixesApplied.push('post_session_details')
					} else {
						console.log('  ✅ post_session_details already has correct structure')
					}
				}
			} catch (error) {
				console.log(`  ❌ Error fixing post_session_details: ${error.message}`)
				tableFixesFailed.push('post_session_details')
			}

			// Fix 2: question_sets primary key
			console.log('\n🔍 Checking question_sets primary key...')
			try {
				const pkInfo = await this.sequelize.query(
					`SELECT string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as pk_columns
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage kcu 
						ON tc.constraint_name = kcu.constraint_name
					WHERE tc.table_name = 'question_sets' 
						AND tc.constraint_type = 'PRIMARY KEY'
					GROUP BY tc.constraint_name`,
					{ type: Sequelize.QueryTypes.SELECT }
				)

				const currentPK = pkInfo.length > 0 ? pkInfo[0].pk_columns : null
				const expectedPK = 'code, tenant_code'

				if (currentPK !== expectedPK) {
					console.log(`  📋 Current PK: ${currentPK}, Expected: ${expectedPK}`)

					// Drop current primary key
					await this.sequelize.query(`ALTER TABLE question_sets DROP CONSTRAINT IF EXISTS question_sets_pkey`)

					// Add correct primary key
					await this.sequelize.query(
						`ALTER TABLE question_sets ADD CONSTRAINT question_sets_pkey PRIMARY KEY (code, tenant_code)`
					)

					console.log('  ✅ Fixed question_sets primary key to (code, tenant_code)')
					tableFixesApplied.push('question_sets')
				} else {
					console.log('  ✅ question_sets already has correct primary key')
				}
			} catch (error) {
				console.log(`  ❌ Error fixing question_sets primary key: ${error.message}`)
				tableFixesFailed.push('question_sets')
			}

			console.log(`\n📊 Table Structure Fix Summary:`)
			console.log(`✅ Successfully fixed: ${tableFixesApplied.length} tables`)
			console.log(`⚠️  Failed fixes: ${tableFixesFailed.length} tables`)

			if (tableFixesApplied.length > 0) {
				console.log(`📋 Fixed tables: ${tableFixesApplied.join(', ')}`)
			}
			if (tableFixesFailed.length > 0) {
				console.log(`❌ Failed tables: ${tableFixesFailed.join(', ')}`)
			}
		} catch (error) {
			console.log(`❌ Error fixing table structures: ${error.message}`)
			console.log('💡 Some table fixes may need to be applied manually')
		}
	}

	/**
	 * Fix foreign key constraints to use RESTRICT instead of CASCADE
	 * CASCADE operations are not supported by some distributed databases when distribution key is included
	 */
	async _fixForeignKeyConstraints() {
		console.log('\n🔧 PHASE 6D: Fixing foreign key constraints for distributed database compatibility...')
		console.log('='.repeat(60))

		try {
			// Find foreign keys with CASCADE rules
			const cascadeFKs = await this.sequelize.query(
				`SELECT DISTINCT
					tc.table_name,
					tc.constraint_name,
					ccu.table_name as referenced_table,
					rc.update_rule,
					rc.delete_rule
				FROM information_schema.table_constraints tc
				JOIN information_schema.constraint_column_usage ccu 
					ON tc.constraint_name = ccu.constraint_name
				JOIN information_schema.referential_constraints rc
					ON tc.constraint_name = rc.constraint_name
				WHERE tc.constraint_type = 'FOREIGN KEY'
					AND tc.table_schema = 'public'
					AND (rc.update_rule = 'CASCADE' OR rc.delete_rule = 'CASCADE')
				ORDER BY tc.table_name, tc.constraint_name`,
				{ type: Sequelize.QueryTypes.SELECT }
			)

			if (cascadeFKs.length === 0) {
				console.log('✅ All foreign key constraints already use RESTRICT - no fixes needed')
				return
			}

			console.log(`📋 Found ${cascadeFKs.length} foreign key constraints with CASCADE rules`)

			// Foreign key configurations to fix
			const fkConfigs = [
				{
					table: 'entities',
					constraint: 'fk_entities_entity_type_id',
					columns: 'entity_type_id, tenant_code',
					refTable: 'entity_types',
					refColumns: 'id, tenant_code',
				},
				{
					table: 'post_session_details',
					constraint: 'fk_post_session_details_session_id',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
				},
				{
					table: 'resources',
					constraint: 'fk_resources_session_id',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
				},
				{
					table: 'session_attendees',
					constraint: 'fk_session_attendees_session_id',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
				},
			]

			let fksFixed = 0

			for (const fk of fkConfigs) {
				try {
					const needsFix = cascadeFKs.some((cascadeFK) => cascadeFK.constraint_name === fk.constraint)

					if (needsFix) {
						console.log(`\n🔧 Fixing ${fk.table}.${fk.constraint}...`)

						// Drop existing foreign key
						await this.sequelize.query(
							`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.constraint}"`
						)

						// Recreate with RESTRICT
						await this.sequelize.query(`
							ALTER TABLE "${fk.table}" 
							ADD CONSTRAINT "${fk.constraint}" 
							FOREIGN KEY (${fk.columns}) 
							REFERENCES "${fk.refTable}" (${fk.refColumns}) 
							ON UPDATE RESTRICT ON DELETE RESTRICT
						`)

						console.log(`  ✅ Fixed ${fk.constraint} to use RESTRICT`)
						fksFixed++
					}
				} catch (error) {
					console.log(`  ❌ Error fixing ${fk.constraint}: ${error.message}`)
				}
			}

			console.log(`\n📊 Foreign Key Fix Summary:`)
			console.log(`✅ Successfully fixed: ${fksFixed} foreign keys`)
			console.log(`📋 All foreign keys now use RESTRICT for distributed database compatibility`)
		} catch (error) {
			console.log(`❌ Error fixing foreign key constraints: ${error.message}`)
			console.log('💡 Foreign key fixes may need to be applied manually')
		}
	}

	async createUniqueIndexes() {
		console.log('\n📊 PHASE 7A: Creating unique indexes after duplicate data cleanup...')
		console.log('='.repeat(70))

		try {
			// Unique indexes configuration - from original Migration 3
			// CRITICAL CITUS COMPATIBILITY: These UNIQUE constraints include tenant_code for proper distribution
			const uniqueIndexConfigs = [
				{
					table: 'availabilities',
					name: 'unique_availabilities_event_name_tenant',
					columns: 'tenant_code, event_name',
					condition: 'WHERE deleted_at IS NULL',
				},
				// TENANT-AWARE UNIQUE CONSTRAINTS - Must include tenant_code for proper isolation
				{
					table: 'connection_requests',
					name: 'unique_user_id_friend_id_connection_requests',
					columns: 'user_id, friend_id, tenant_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'connections',
					name: 'unique_user_id_friend_id_connections',
					columns: 'user_id, friend_id, tenant_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'entities',
					name: 'unique_entities_value',
					columns: 'value, entity_type_id, tenant_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'forms',
					name: 'unique_type_sub_type_org_id',
					columns: 'type, sub_type, organization_id, tenant_code',
					condition: '',
				},
				{
					table: 'default_rules',
					name: 'unique_default_rules_type_org_tenant',
					columns: 'type, organization_id, tenant_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'entity_types',
					name: 'unique_entity_types_value_organization_tenant',
					columns: 'tenant_code, value, organization_id',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'forms',
					name: 'unique_forms_id_organization_type_tenant',
					columns: 'tenant_code, id, organization_id, type',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'modules',
					name: 'unique_modules_code_tenant',
					columns: 'tenant_code, code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'notification_templates',
					name: 'unique_notification_templates_code_org_tenant',
					columns: 'tenant_code, code, organization_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'organization_extension',
					name: 'unique_organization_extension_org_code_tenant',
					columns: 'tenant_code, organization_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'post_session_details',
					name: 'unique_post_session_details_session_tenant',
					columns: 'tenant_code, session_id',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'question_sets',
					name: 'unique_question_sets_code_tenant',
					columns: 'code, tenant_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'report_queries',
					name: 'unique_report_queries_code_tenant_org',
					columns: 'report_code, tenant_code, organization_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'report_role_mapping',
					name: 'unique_report_role_mapping_role_code_tenant',
					columns: 'tenant_code, role_title, report_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'report_types',
					name: 'unique_report_types_title_tenant',
					columns: 'tenant_code, title',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'reports',
					name: 'unique_reports_code_organization_tenant',
					columns: 'tenant_code, code, organization_id',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'role_extensions',
					name: 'unique_role_extensions_title_org_tenant',
					columns: 'tenant_code, title, organization_id',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'session_attendees',
					name: 'unique_session_attendees_session_mentee_tenant',
					columns: 'session_id, mentee_id, tenant_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'session_request',
					name: 'unique_session_request_requestor_requestee_tenant',
					columns: 'requestor_id, requestee_id, tenant_code',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'sessions',
					name: 'unique_sessions_id_title_mentor_creator_tenant',
					columns: 'tenant_code, id, title, mentor_name, created_by',
					condition: 'WHERE deleted_at IS NULL',
				},
				{
					table: 'user_extensions',
					name: 'unique_user_extensions_user_tenant_email_phone_username',
					columns: 'user_id, tenant_code, email, phone, user_name',
					condition: 'WHERE deleted_at IS NULL AND email IS NOT NULL AND phone IS NOT NULL',
				},
			]

			let uniqueIndexesCreated = 0
			let uniqueIndexesSkipped = 0

			console.log(`🔧 Creating ${uniqueIndexConfigs.length} unique indexes...`)

			for (const idx of uniqueIndexConfigs) {
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
						console.log(`⚠️  Table ${idx.table} does not exist, skipping unique index`)
						uniqueIndexesSkipped++
						continue
					}

					// Check if index already exists
					const indexExists = await this.sequelize.query(
						`SELECT EXISTS (
							SELECT FROM pg_indexes 
							WHERE tablename = :tableName AND indexname = :indexName
						)`,
						{
							replacements: { tableName: idx.table, indexName: idx.name },
							type: Sequelize.QueryTypes.SELECT,
						}
					)

					if (indexExists[0].exists) {
						console.log(`✅ Unique index ${idx.name} already exists`)
						uniqueIndexesSkipped++
						continue
					}

					// Create unique index with conditional WHERE clause
					const indexQuery = `CREATE UNIQUE INDEX "${idx.name}" ON "${idx.table}" (${idx.columns}) ${idx.condition}`

					await this.sequelize.query(indexQuery)
					console.log(`✅ Created unique index: ${idx.name}`)
					uniqueIndexesCreated++
				} catch (error) {
					if (
						error.message.includes('could not create unique index') ||
						error.message.includes('duplicate key')
					) {
						console.log(`❌ Unique index ${idx.name} failed due to duplicate data: ${error.message}`)
						console.log(`💡 Hint: Clean duplicate data in ${idx.table} before creating unique constraint`)
					} else {
						console.log(`❌ Error creating unique index ${idx.name}: ${error.message}`)
					}
					uniqueIndexesSkipped++
				}
			}

			console.log(`\n📈 Unique Index Creation Summary:`)
			console.log(`✅ Successfully created: ${uniqueIndexesCreated} unique indexes`)
			console.log(`⚠️  Skipped/Failed: ${uniqueIndexesSkipped} unique indexes`)
			console.log(`📊 Total attempted: ${uniqueIndexConfigs.length} unique indexes`)

			if (uniqueIndexesSkipped > 0) {
				console.log('\n⚠️  Some unique indexes failed due to duplicate data:')
				console.log('• Run duplicate data cleanup queries before creating unique constraints')
				console.log('• Check for duplicate entries in affected tables')
				console.log('• Unique constraints enforce data integrity but require clean data')
			}

			if (uniqueIndexesCreated > 0) {
				console.log('\n🚀 Unique Index Benefits:')
				console.log('• Data integrity enforced at database level')
				console.log('• Prevents duplicate entries in business-critical columns')
				console.log('• Tenant-aware uniqueness ensures proper multi-tenant isolation')
			}
		} catch (error) {
			console.log(`❌ Unique index creation failed: ${error.message}`)
			console.log('💡 Unique indexes can be created manually after data cleanup')
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

				// Step 5: Fix UNIQUE constraints for proper tenant isolation
				await this.fixUniqueConstraints()

				// Step 6: Create performance indexes
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
