require('dotenv').config({ path: '../../.env' })
const { Sequelize } = require('sequelize')
const fs = require('fs')
const path = require('path')
const csv = require('csv-parser')
const DatabaseConnectionManager = require('./db-connection-utils')

/**
 * CSV Data Filling Script for Tenant Migration
 *
 * This script ONLY handles data filling using CSV lookups.
 * All schema changes (columns, indexes, foreign keys, constraints) are handled in migrations.
 *
 * USAGE:
 *   node fill-tenant-data-from-csv.js
 *
 * REQUIREMENTS:
 *   - DEFAULT_TENANT_CODE environment variable
 *   - DEFAULT_ORGANISATION_CODE environment variable
 *   - data/data_codes.csv file (optional - if present, used for CSV-based overwrites)
 *   - Database must be migrated first (run migrations before this script)
 */

class TenantDataFiller {
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
			startTime: Date.now(),
		}

		// Table configurations for data filling only
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

			withUserIdTenantOnly: [
				{ name: 'sessions', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'feedbacks', columns: ['tenant_code'], userIdColumn: 'user_id' },
				{ name: 'connection_requests', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'connections', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'resources', columns: ['tenant_code'], userIdColumn: 'created_by' },
				{ name: 'session_request', columns: ['tenant_code'], userIdColumn: 'created_by' },
			],

			withUserIdBoth: [
				{ name: 'issues', columns: ['tenant_code', 'organization_code'], userIdColumn: 'user_id' },
				{ name: 'question_sets', columns: ['tenant_code', 'organization_code'], userIdColumn: 'created_by' },
				{ name: 'questions', columns: ['tenant_code', 'organization_code'], userIdColumn: 'created_by' },
			],

			withSessionId: [
				{ name: 'session_attendees', columns: ['tenant_code'], sessionIdColumn: 'session_id' },
				{ name: 'post_session_details', columns: ['tenant_code'], sessionIdColumn: 'session_id' },
			],

			withReportCode: [
				{
					name: 'report_role_mapping',
					columns: ['tenant_code', 'organization_code'],
					reportCodeColumn: 'report_code',
				},
			],

			withReportTypeTitle: [
				{ name: 'report_types', columns: ['tenant_code', 'organization_code'], titleColumn: 'title' },
			],
		}
	}

	async loadLookupData() {
		console.log('🔄 Loading lookup data from CSV file...')

		const csvPath = path.join(__dirname, '../../data/data_codes.csv')
		if (!fs.existsSync(csvPath)) {
			throw new Error('CSV file not found: data_codes.csv is required for data filling')
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
					console.log(`✅ Loaded ${this.orgLookupCache.size} organization mappings from CSV`)
					if (this.orgLookupCache.size === 0) {
						reject(new Error('CSV file is empty or contains no valid data mappings'))
						return
					}
					resolve()
				})
				.on('error', reject)
		})
	}

	async validateDatabaseSchema() {
		console.log('🔍 Validating database schema is ready for data filling...')

		const requiredTables = ['user_extensions', 'sessions', 'entities', 'entity_types', 'organization_extension']

		for (const tableName of requiredTables) {
			// Check table exists
			const tableExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
				{
					replacements: { tableName },
					type: Sequelize.QueryTypes.SELECT,
				}
			)

			if (!tableExists[0].exists) {
				throw new Error(`Required table ${tableName} does not exist. Run migrations first.`)
			}

			// Check tenant_code column exists
			const columnExists = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = :tableName AND column_name = 'tenant_code')`,
				{
					replacements: { tableName },
					type: Sequelize.QueryTypes.SELECT,
				}
			)

			if (!columnExists[0].exists) {
				throw new Error(`tenant_code column missing from ${tableName}. Run migrations first.`)
			}
		}

		console.log('✅ Database schema validation passed')
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
		let unexpectedErrors = 0

		console.log('📍 Using standard PostgreSQL constraint restoration')

		for (const fk of droppedConstraints) {
			try {
				// Restore foreign key constraint
				await this.sequelize.query(
					`ALTER TABLE "${fk.table_name}" 
					 ADD CONSTRAINT "${fk.constraint_name}" 
					 FOREIGN KEY (${fk.columns}) 
					 REFERENCES "${fk.foreign_table_name}"(${fk.foreign_columns})
					 ON DELETE CASCADE 
					 ON UPDATE NO ACTION`,
					{ transaction }
				)
				console.log(`✅ Restored FK: ${fk.constraint_name} on ${fk.table_name}`)
				restoredCount++
			} catch (error) {
				// Log unexpected errors
				console.log(`❌ ERROR restoring FK ${fk.constraint_name}:`)
				console.log(`   Message: ${error.message}`)
				console.log(`   Table: ${fk.table_name}, Constraint: ${fk.constraint_name}`)
				unexpectedErrors++
			}
		}

		this.stats.constraintsRestored = restoredCount
		console.log(`✅ Restored: ${restoredCount} foreign key constraints`)
		if (unexpectedErrors > 0) {
			console.log(`🚨 ERRORS: ${unexpectedErrors} foreign key restoration failures`)
			console.log(`⚠️  Review the errors above for constraint restoration issues`)
			// Consider throwing if there are critical unexpected errors
			throw new Error(`Foreign key restoration failed with ${unexpectedErrors} unexpected errors`)
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

			console.log(`🔄 Processing ${name} with organization_id CSV lookup...`)

			// Get distinct organization_ids present in the table
			const orgList = await this.sequelize.query(
				`SELECT DISTINCT organization_id::text as org_id 
				 FROM "${name}"
				 WHERE organization_id IS NOT NULL`,
				{ type: Sequelize.QueryTypes.SELECT, transaction }
			)

			let totalUpdated = 0

			for (const org of orgList) {
				const orgData = this.orgLookupCache.get(org.org_id)
				// Only update when CSV mapping exists
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
			console.log(`✅ ${name}: ${totalUpdated} rows updated from CSV mappings`)
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
		console.log('✅ user_extensions processing completed')
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

			// Only update where entity_types has a tenant_code (only when lookup exists)
			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET ${setClauses.join(', ')}
				 FROM entity_types et
				 WHERE "${name}"."${entityTypeIdColumn}" = et.id
				 AND et.tenant_code IS NOT NULL`,
				{
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: ${affected} rows updated using entity_types lookup`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processTablesWithUserIdTenantOnly(transaction) {
		console.log('\n🔄 PHASE 4A: Processing tables with user_id (tenant_code only) using user_extensions lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withUserIdTenantOnly) {
			await this.processUserIdTenantOnlyTable(transaction, tableConfig)
		}
	}

	async processUserIdTenantOnlyTable(transaction, tableConfig) {
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

			console.log(`🔄 Processing ${name} with user_id lookup (tenant_code only)...`)

			// Only update tenant_code for tables that only have tenant_code column
			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET tenant_code = ue.tenant_code, updated_at = NOW()
				 FROM user_extensions ue
				 WHERE "${name}"."${userIdColumn}" = ue.user_id
				 AND "${name}"."${userIdColumn}" IS NOT NULL
				 AND ue.tenant_code IS NOT NULL`,
				{
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: ${affected} rows updated using user_extensions lookup (tenant_code only)`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processTablesWithUserIdBoth(transaction) {
		console.log(
			'\n🔄 PHASE 4B: Processing tables with user_id (tenant_code + organization_code) using user_extensions lookup...'
		)
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withUserIdBoth) {
			await this.processUserIdBothTable(transaction, tableConfig)
		}
	}

	async processUserIdBothTable(transaction, tableConfig) {
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

			console.log(`🔄 Processing ${name} with user_id lookup (tenant_code + organization_code)...`)

			// Update both tenant_code and organization_code for tables that have both columns
			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET tenant_code = ue.tenant_code, organization_code = ue.organization_code, updated_at = NOW()
				 FROM user_extensions ue
				 WHERE "${name}"."${userIdColumn}" = ue.user_id
				 AND "${name}"."${userIdColumn}" IS NOT NULL
				 AND ue.tenant_code IS NOT NULL`,
				{
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: ${affected} rows updated using user_extensions lookup (both columns)`)
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
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: ${affected} rows updated using sessions lookup`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processTablesWithReportCode(transaction) {
		console.log('\n🔄 PHASE 6: Processing tables with report_code using reports lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withReportCode) {
			await this.processReportCodeTable(transaction, tableConfig)
		}
	}

	async processReportCodeTable(transaction, tableConfig) {
		const { name, columns, reportCodeColumn } = tableConfig

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

			console.log(`🔄 Processing ${name} with report_code lookup...`)

			const setClauses = []
			if (columns.includes('tenant_code')) {
				setClauses.push('tenant_code = r.tenant_code')
			}
			if (columns.includes('organization_code')) {
				setClauses.push('organization_code = r.organization_code')
			}
			setClauses.push('updated_at = NOW()')

			// Only update where reports has a tenant_code (only when lookup exists)
			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET ${setClauses.join(', ')}
				 FROM reports r
				 WHERE "${name}"."${reportCodeColumn}" = r.code
				 AND r.tenant_code IS NOT NULL`,
				{
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: ${affected} rows updated using reports lookup`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async processTablesWithReportTypeTitle(transaction) {
		console.log('\n🔄 PHASE 7: Processing tables with report_type_title using reports lookup...')
		console.log('='.repeat(70))

		for (const tableConfig of this.tableConfigs.withReportTypeTitle) {
			await this.processReportTypeTitleTable(transaction, tableConfig)
		}
	}

	async processReportTypeTitleTable(transaction, tableConfig) {
		const { name, columns, titleColumn } = tableConfig

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

			console.log(`🔄 Processing ${name} with report_type_title lookup...`)

			const setClauses = []
			if (columns.includes('tenant_code')) {
				setClauses.push('tenant_code = r.tenant_code')
			}
			if (columns.includes('organization_code')) {
				setClauses.push('organization_code = r.organization_code')
			}
			setClauses.push('updated_at = NOW()')

			// Only update where reports has a tenant_code (only when lookup exists)
			const [_, metadata] = await this.sequelize.query(
				`UPDATE "${name}" 
				 SET ${setClauses.join(', ')}
				 FROM reports r
				 WHERE "${name}"."${titleColumn}" = r.report_type_title
				 AND r.tenant_code IS NOT NULL`,
				{
					transaction,
				}
			)

			const affected = metadata?.rowCount || 0
			this.stats.successfulUpdates += affected
			console.log(`✅ ${name}: ${affected} rows updated using reports lookup`)
		} catch (error) {
			console.log(`❌ Error processing ${name}: ${error.message}`)
			this.stats.failedUpdates++
			throw error
		}
	}

	async validateDataIntegrity(transaction) {
		console.log('\n🔍 Validating data integrity after filling...')
		console.log('='.repeat(50))

		const errors = []
		const allTableConfigs = [
			...this.tableConfigs.withOrgId,
			this.tableConfigs.userExtensions,
			...this.tableConfigs.withEntityTypeId,
			...this.tableConfigs.withUserIdTenantOnly,
			...this.tableConfigs.withUserIdBoth,
			...this.tableConfigs.withSessionId,
			...this.tableConfigs.withReportCode,
			...this.tableConfigs.withReportTypeTitle,
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
					console.log(
						`⚠️  ${tableName} has ${nullValues} NULL/empty tenant_code values (may be expected for unmapped data)`
					)
				}

				if (tableConfig.columns && tableConfig.columns.includes('organization_code')) {
					const nullOrgCounts = await this.sequelize.query(
						`SELECT COUNT(*) as count FROM "${tableName}" WHERE organization_code IS NULL OR organization_code = ''`,
						{ transaction, type: Sequelize.QueryTypes.SELECT }
					)
					const nullOrgValues = parseInt(nullOrgCounts[0].count)

					if (nullOrgValues > 0) {
						console.log(
							`⚠️  ${tableName} has ${nullOrgValues} NULL/empty organization_code values (may be expected for unmapped data)`
						)
					}
				}
			} catch (error) {
				errors.push(`Error validating ${tableConfig.name}: ${error.message}`)
			}
		}

		const isValid = errors.length === 0

		if (isValid) {
			console.log('✅ Data integrity validation passed - data filling completed successfully')
		} else {
			console.log(`❌ Data integrity validation issues:`)
			errors.forEach((error) => console.log(`   - ${error}`))
		}

		return {
			valid: isValid,
			errors: errors,
		}
	}

	printStats() {
		const duration = Math.round((Date.now() - this.stats.startTime) / 1000)
		const minutes = Math.floor(duration / 60)
		const seconds = duration % 60

		console.log('\n🎯 CSV DATA FILLING COMPLETED!')
		console.log('='.repeat(50))
		console.log(`⏱️  Duration: ${minutes}m ${seconds}s`)
		console.log(`✅ Successful updates: ${this.stats.successfulUpdates.toLocaleString()}`)
		console.log(`❌ Failed updates: ${this.stats.failedUpdates.toLocaleString()}`)
		console.log(`📊 CSV mappings used: ${this.orgLookupCache.size}`)
		console.log('='.repeat(50))
	}

	async execute() {
		let fillSuccess = false

		try {
			console.log('🚀 Starting CSV-Based Tenant Data Filling...')
			console.log('='.repeat(70))
			console.log(`🔧 Using defaults: tenant_code="${this.defaultTenantCode}", org_code="${this.defaultOrgCode}"`)

			// Validate database connection
			const connectionValidation = await this.dbManager.validateConnection()
			if (!connectionValidation.success) {
				throw new Error(`Database connection validation failed: ${connectionValidation.message}`)
			}
			console.log('✅ Database connection validated')

			// Validate database schema is ready
			await this.validateDatabaseSchema()

			// Load CSV lookup data (will throw error if CSV not found or empty)
			await this.loadLookupData()

			// Start transaction for all data operations
			const transaction = await this.sequelize.transaction()

			try {
				// Drop foreign key constraints
				const droppedConstraints = await this.dropForeignKeyConstraints(transaction)

				// Process data in proper sequence
				await this.processTablesWithOrgId(transaction) // PHASE 1
				await this.processUserExtensions(transaction) // PHASE 2
				await this.processTablesWithEntityTypeId(transaction) // PHASE 3
				await this.processTablesWithUserIdTenantOnly(transaction) // PHASE 4A
				await this.processTablesWithUserIdBoth(transaction) // PHASE 4B
				await this.processTablesWithSessionId(transaction) // PHASE 5
				await this.processTablesWithReportCode(transaction) // PHASE 6
				await this.processTablesWithReportTypeTitle(transaction) // PHASE 7

				// Validate data integrity
				const validationResult = await this.validateDataIntegrity(transaction)

				// Restore foreign key constraints
				await this.restoreForeignKeyConstraints(droppedConstraints, transaction)

				// Commit transaction
				await transaction.commit()
				fillSuccess = true

				console.log('\n🎉 CSV DATA FILLING COMPLETED SUCCESSFULLY!')
				console.log('✅ All tenant_code values filled where CSV mappings exist')
				console.log('✅ Data filling transaction committed')
			} catch (error) {
				await transaction.rollback()
				throw error
			}
		} catch (error) {
			console.error('❌ CSV data filling failed:', error.message)
			fillSuccess = false
		} finally {
			this.printStats()
			await this.dbManager.close()

			if (!fillSuccess) {
				process.exit(1)
			}
		}
	}
}

if (require.main === module) {
	const filler = new TenantDataFiller()
	filler.execute()
}

module.exports = TenantDataFiller
