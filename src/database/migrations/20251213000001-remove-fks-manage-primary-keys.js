'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting Migration 1: Remove Foreign Keys and Manage Primary Keys...')
			console.log('='.repeat(70))

			// Primary key configurations with tenant_code - EXACT match from update-tenant-column-script.js
			const primaryKeyConfigs = {
				availabilities: 'tenant_code, id',
				connection_requests: 'tenant_code, id',
				connections: 'tenant_code, id',
				default_rules: 'tenant_code, id',
				entities: 'tenant_code, id, entity_type_id',
				entity_types: 'tenant_code, id',
				feedbacks: 'tenant_code, id',
				file_uploads: 'tenant_code, id',
				forms: 'tenant_code, id, organization_id',
				issues: 'tenant_code, id',
				modules: 'tenant_code, id',
				notification_templates: 'tenant_code, id',
				organization_extension: 'tenant_code, organization_code, organization_id',
				post_session_details: 'tenant_code, session_id',
				user_extensions: 'tenant_code, user_id',
				question_sets: 'id, tenant_code',
				questions: 'id, tenant_code',
				report_queries: 'tenant_code, id, organization_code',
				report_role_mapping: 'tenant_code, id',
				report_types: 'tenant_code, id',
				reports: 'tenant_code, id',
				resources: 'tenant_code, id',
				role_extensions: 'tenant_code, title',
				session_attendees: 'tenant_code, id',
				session_request: 'tenant_code, id',
				sessions: 'tenant_code, id',
			}

			// All tables to process
			const allTables = [
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

			// Validate that all tables have explicit primary key configurations
			console.log('\n🔍 Validating primary key configurations...')
			for (const tableName of allTables) {
				if (!primaryKeyConfigs[tableName]) {
					throw new Error(
						`FATAL: Table '${tableName}' is missing explicit primary key configuration. All tables must be explicitly configured.`
					)
				}
			}
			console.log(`✅ All ${allTables.length} tables have explicit primary key configurations`)

			console.log('\n📝 PHASE 1: Dropping existing foreign key constraints...')
			console.log('='.repeat(50))

			// Get all existing foreign key constraints to drop them
			const existingFKs = await queryInterface.sequelize.query(
				`SELECT DISTINCT
					tc.table_name,
					tc.constraint_name,
					string_agg(DISTINCT kcu.column_name, ', ' ORDER BY kcu.column_name) as columns,
					ccu.table_name AS foreign_table_name,
					string_agg(DISTINCT ccu.column_name, ', ' ORDER BY ccu.column_name) as foreign_columns
				FROM information_schema.table_constraints AS tc 
				JOIN information_schema.key_column_usage AS kcu
					ON tc.constraint_name = kcu.constraint_name
					AND tc.table_schema = kcu.table_schema
				JOIN information_schema.constraint_column_usage AS ccu
					ON ccu.constraint_name = tc.constraint_name
					AND ccu.table_schema = tc.table_schema
				WHERE tc.constraint_type = 'FOREIGN KEY' 
				AND tc.table_schema = 'public'
				AND tc.table_name IN (:tableNames)
				GROUP BY tc.constraint_name, tc.table_name, ccu.table_name
				ORDER BY tc.table_name`,
				{
					replacements: { tableNames: allTables },
					type: Sequelize.QueryTypes.SELECT,
					transaction,
				}
			)

			const droppedForeignKeys = []
			for (const fk of existingFKs) {
				try {
					droppedForeignKeys.push(fk)
					await queryInterface.sequelize.query(
						`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`,
						{ transaction }
					)
					console.log(`✅ Dropped FK constraint: ${fk.constraint_name} from ${fk.table_name}`)
				} catch (error) {
					console.log(`❌ Error dropping FK ${fk.constraint_name}: ${error.message}`)
					throw error
				}
			}

			console.log('\n📝 PHASE 2: Dropping existing primary key constraints...')
			console.log('='.repeat(50))

			// Store dropped constraints for potential rollback
			const droppedPrimaryKeys = []

			for (const tableName of allTables) {
				try {
					// Check if table exists
					const tableExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
						{
							replacements: { tableName },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (!tableExists[0].exists) {
						console.log(`⚠️  Table ${tableName} does not exist, skipping`)
						continue
					}

					// Get current primary key constraint name
					const currentPK = await queryInterface.sequelize.query(
						`SELECT constraint_name 
						 FROM information_schema.table_constraints 
						 WHERE table_name = :tableName 
						 AND constraint_type = 'PRIMARY KEY'`,
						{
							replacements: { tableName },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (currentPK.length > 0) {
						const constraintName = currentPK[0].constraint_name
						droppedPrimaryKeys.push({ table: tableName, constraint: constraintName })

						// Drop existing primary key constraint (CASCADE to handle dependencies)
						await queryInterface.sequelize.query(
							`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${constraintName} CASCADE`,
							{ transaction }
						)

						console.log(`✅ Dropped primary key constraint: ${constraintName} from ${tableName}`)
					} else {
						console.log(`⚠️  No primary key found for ${tableName}`)
					}

					// Also handle special naming conventions for organization_extension
					if (tableName === 'organization_extension') {
						await queryInterface.sequelize.query(
							`ALTER TABLE organization_extension DROP CONSTRAINT IF EXISTS organisation_extension_pkey CASCADE`,
							{ transaction }
						)
					}
				} catch (error) {
					console.log(`❌ Error dropping primary key for ${tableName}: ${error.message}`)
					throw error
				}
			}

			console.log('\n📝 PHASE 3: Creating new composite primary key constraints...')
			console.log('='.repeat(50))

			for (const tableName of allTables) {
				try {
					// Check if table exists
					const tableExists = await queryInterface.sequelize.query(
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

					// Get primary key configuration for this table - must be explicitly configured
					const primaryKeyColumns = primaryKeyConfigs[tableName]
					if (!primaryKeyColumns) {
						throw new Error(
							`Primary key configuration missing for table: ${tableName}. All tables must be explicitly configured.`
						)
					}

					// Verify all columns exist before creating constraint
					const columnList = primaryKeyColumns.split(',').map((col) => col.trim())

					for (const columnName of columnList) {
						const columnExists = await queryInterface.sequelize.query(
							`SELECT EXISTS (
								SELECT FROM information_schema.columns 
								WHERE table_name = :tableName AND column_name = :columnName
							)`,
							{
								replacements: { tableName, columnName },
								type: Sequelize.QueryTypes.SELECT,
								transaction,
							}
						)

						if (!columnExists[0].exists) {
							throw new Error(
								`Column ${columnName} does not exist in table ${tableName}. Cannot create primary key constraint.`
							)
						}
					}

					// Create new composite primary key constraint
					await queryInterface.sequelize.query(
						`ALTER TABLE ${tableName} ADD PRIMARY KEY (${primaryKeyColumns})`,
						{ transaction }
					)

					console.log(`✅ Created composite primary key for ${tableName}: (${primaryKeyColumns})`)
				} catch (error) {
					console.log(`❌ Error creating primary key for ${tableName}: ${error.message}`)
					throw error
				}
			}

			// Commit the transaction
			await transaction.commit()

			console.log('\n🎯 MIGRATION 1 COMPLETED SUCCESSFULLY!')
			console.log('='.repeat(70))
			console.log('✅ All foreign key constraints removed')
			console.log('✅ All composite primary key constraints updated with tenant_code')
			console.log('📋 NOTE: Foreign keys will be added in Migration 2')
			console.log('📋 NOTE: Indexes will be created in Migration 3')
			console.log('='.repeat(70))
		} catch (error) {
			// Rollback the transaction on any error
			await transaction.rollback()
			console.error('❌ Migration 1 failed, transaction rolled back:', error)
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		// Use a transaction for rollback operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🔄 Rolling back Migration 1: Remove FKs and manage primary keys...')

			const allTables = [
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

			// Drop composite primary keys and restore simple id-based primary keys
			console.log('\n📝 Restoring original primary key constraints...')
			const pkRestorationFailures = []

			for (const tableName of allTables) {
				try {
					// Check if table exists
					const tableExists = await queryInterface.sequelize.query(
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

					// Drop current primary key
					await queryInterface.sequelize.query(
						`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${tableName}_pkey CASCADE`,
						{ transaction }
					)

					// Restore original primary key (most tables use just 'id')
					let originalPK = 'id'
					if (tableName === 'user_extensions') {
						originalPK = 'user_id'
					} else if (tableName === 'organization_extension') {
						originalPK = 'organization_id'
					} else if (tableName === 'post_session_details') {
						originalPK = 'session_id'
					} else if (tableName === 'question_sets') {
						originalPK = 'code'
					} else if (tableName === 'role_extensions') {
						originalPK = 'title'
					}

					await queryInterface.sequelize.query(`ALTER TABLE ${tableName} ADD PRIMARY KEY (${originalPK})`, {
						transaction,
					})

					console.log(`✅ Restored original primary key for ${tableName}: (${originalPK})`)
				} catch (error) {
					const failureInfo = { tableName, error: error.message }
					pkRestorationFailures.push(failureInfo)
					console.log(`⚠️  Could not restore primary key for ${tableName}: ${error.message}`)
				}
			}

			// Check if there were any failures and handle them appropriately
			if (pkRestorationFailures.length > 0) {
				console.log(`\n❌ Primary key restoration failed for ${pkRestorationFailures.length} table(s):`)
				pkRestorationFailures.forEach(({ tableName, error }) => {
					console.log(`   - ${tableName}: ${error}`)
				})
				throw new Error(
					`Primary key restoration failed for tables: ${pkRestorationFailures
						.map((f) => f.tableName)
						.join(', ')}`
				)
			}

			await transaction.commit()
			console.log('✅ Migration 1 rollback completed')
		} catch (error) {
			await transaction.rollback()
			console.error('❌ Migration 1 rollback failed:', error)
			throw error
		}
	},
}
