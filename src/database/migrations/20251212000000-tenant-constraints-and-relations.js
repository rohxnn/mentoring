'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting Migration 2: Tenant-aware constraints and relations...')
			console.log('='.repeat(70))

			// Primary key configurations with tenant_code as first column
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
				// Default for any table not explicitly configured
				default: 'tenant_code, id',
			}

			// Foreign key configurations with tenant-aware relationships
			const foreignKeyConfigs = [
				{
					table: 'session_attendees',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
					name: 'fk_session_attendees_session_id',
				},
				{
					table: 'resources',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
					name: 'fk_resources_session_id',
				},
				{
					table: 'post_session_details',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
					name: 'fk_post_session_details_session_id',
				},
				{
					table: 'entities',
					columns: 'entity_type_id, tenant_code',
					refTable: 'entity_types',
					refColumns: 'id, tenant_code',
					name: 'fk_entities_entity_type_id',
				},
			]

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

			console.log('\n📝 PHASE 1: Dropping existing primary key constraints...')
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

					// Also handle special naming conventions
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

			console.log('\n📝 PHASE 2: Dropping existing foreign key constraints...')
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
				AND tc.table_name = ANY(ARRAY[:tableNames])
				GROUP BY tc.constraint_name, tc.table_name, ccu.table_name
				ORDER BY tc.table_name`,
				{
					replacements: { tableNames: allTables.join("','") },
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

					// Get primary key configuration for this table
					const primaryKeyColumns = primaryKeyConfigs[tableName] || primaryKeyConfigs['default']

					// Verify all columns exist before creating constraint
					const columnList = primaryKeyColumns.split(',').map((col) => col.trim())
					let allColumnsExist = true

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
							console.log(
								`⚠️  Column ${columnName} does not exist in ${tableName}, using default: tenant_code, id`
							)
							allColumnsExist = false
							break
						}
					}

					// Use default if any column is missing
					const finalPKColumns = allColumnsExist ? primaryKeyColumns : 'tenant_code, id'

					// Create new composite primary key constraint
					await queryInterface.sequelize.query(
						`ALTER TABLE ${tableName} ADD PRIMARY KEY (${finalPKColumns})`,
						{ transaction }
					)

					console.log(`✅ Created composite primary key for ${tableName}: (${finalPKColumns})`)
				} catch (error) {
					console.log(`❌ Error creating primary key for ${tableName}: ${error.message}`)
					throw error
				}
			}

			console.log('\n📝 PHASE 4: Creating tenant-aware foreign key constraints...')
			console.log('='.repeat(50))

			for (const fkConfig of foreignKeyConfigs) {
				try {
					// Check if both tables exist
					const tablesExist = await queryInterface.sequelize.query(
						`SELECT 
							EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = :tableName) as table_exists,
							EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = :refTableName) as ref_table_exists`,
						{
							replacements: {
								tableName: fkConfig.table,
								refTableName: fkConfig.refTable,
							},
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (!tablesExist[0].table_exists || !tablesExist[0].ref_table_exists) {
						console.log(`⚠️  Missing table for FK ${fkConfig.name}, skipping`)
						continue
					}

					// Verify all columns exist
					const sourceColumns = fkConfig.columns.split(',').map((c) => c.trim())
					const refColumns = fkConfig.refColumns.split(',').map((c) => c.trim())

					let allColumnsExist = true

					// Check source columns
					for (const col of sourceColumns) {
						const colExists = await queryInterface.sequelize.query(
							`SELECT EXISTS (
								SELECT FROM information_schema.columns 
								WHERE table_name = :tableName AND column_name = :columnName
							)`,
							{
								replacements: { tableName: fkConfig.table, columnName: col },
								type: Sequelize.QueryTypes.SELECT,
								transaction,
							}
						)
						if (!colExists[0].exists) {
							console.log(`⚠️  Source column ${col} missing in ${fkConfig.table} for FK ${fkConfig.name}`)
							allColumnsExist = false
							break
						}
					}

					// Check reference columns
					if (allColumnsExist) {
						for (const col of refColumns) {
							const colExists = await queryInterface.sequelize.query(
								`SELECT EXISTS (
									SELECT FROM information_schema.columns 
									WHERE table_name = :tableName AND column_name = :columnName
								)`,
								{
									replacements: { tableName: fkConfig.refTable, columnName: col },
									type: Sequelize.QueryTypes.SELECT,
									transaction,
								}
							)
							if (!colExists[0].exists) {
								console.log(
									`⚠️  Reference column ${col} missing in ${fkConfig.refTable} for FK ${fkConfig.name}`
								)
								allColumnsExist = false
								break
							}
						}
					}

					if (!allColumnsExist) {
						console.log(`❌ Skipping FK ${fkConfig.name} due to missing columns`)
						continue
					}

					// Create tenant-aware foreign key constraint
					await queryInterface.sequelize.query(
						`ALTER TABLE ${fkConfig.table} 
						 ADD CONSTRAINT ${fkConfig.name} 
						 FOREIGN KEY (${fkConfig.columns}) 
						 REFERENCES ${fkConfig.refTable}(${fkConfig.refColumns}) 
						 ON DELETE RESTRICT 
						 ON UPDATE CASCADE`,
						{ transaction }
					)

					console.log(
						`✅ Created tenant-aware FK: ${fkConfig.name} (${fkConfig.table}.${fkConfig.columns} → ${fkConfig.refTable}.${fkConfig.refColumns})`
					)
				} catch (error) {
					console.log(`❌ Error creating FK ${fkConfig.name}: ${error.message}`)
					// Don't throw here - continue with other constraints
				}
			}

			console.log('\n📝 PHASE 5: Creating essential performance indexes...')
			console.log('='.repeat(50))

			// Essential indexes for tenant-aware queries (subset of performance indexes)
			const essentialIndexes = [
				{ table: 'sessions', name: 'idx_sessions_tenant_code', columns: 'tenant_code' },
				{ table: 'user_extensions', name: 'idx_user_extensions_tenant_user', columns: 'tenant_code, user_id' },
				{
					table: 'organization_extension',
					name: 'idx_organization_extension_tenant_org',
					columns: 'tenant_code, organization_code',
				},
				{ table: 'entity_types', name: 'idx_entity_types_tenant_value', columns: 'tenant_code, value' },
				{
					table: 'session_attendees',
					name: 'idx_session_attendees_tenant_session',
					columns: 'tenant_code, session_id',
				},
				{ table: 'resources', name: 'idx_resources_tenant_session', columns: 'tenant_code, session_id' },
				{
					table: 'post_session_details',
					name: 'idx_post_session_details_tenant_session',
					columns: 'tenant_code, session_id',
				},
				{
					table: 'connections',
					name: 'idx_connections_tenant_users',
					columns: 'tenant_code, user_id, friend_id',
				},
				{ table: 'feedbacks', name: 'idx_feedbacks_tenant_user', columns: 'tenant_code, user_id' },
			]

			for (const indexConfig of essentialIndexes) {
				try {
					// Check if table exists
					const tableExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
						{
							replacements: { tableName: indexConfig.table },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (!tableExists[0].exists) {
						console.log(`⚠️  Table ${indexConfig.table} does not exist, skipping index`)
						continue
					}

					// Check if index already exists
					const indexExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (
							SELECT FROM pg_indexes 
							WHERE tablename = :tableName AND indexname = :indexName
						)`,
						{
							replacements: {
								tableName: indexConfig.table,
								indexName: indexConfig.name,
							},
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (indexExists[0].exists) {
						console.log(`✅ Index ${indexConfig.name} already exists`)
						continue
					}

					// Verify all columns exist
					const columns = indexConfig.columns.split(',').map((c) => c.trim())
					let allColumnsExist = true

					for (const col of columns) {
						const colExists = await queryInterface.sequelize.query(
							`SELECT EXISTS (
								SELECT FROM information_schema.columns 
								WHERE table_name = :tableName AND column_name = :columnName
							)`,
							{
								replacements: { tableName: indexConfig.table, columnName: col },
								type: Sequelize.QueryTypes.SELECT,
								transaction,
							}
						)
						if (!colExists[0].exists) {
							console.log(
								`⚠️  Column ${col} missing in ${indexConfig.table} for index ${indexConfig.name}`
							)
							allColumnsExist = false
							break
						}
					}

					if (!allColumnsExist) {
						console.log(`❌ Skipping index ${indexConfig.name} due to missing columns`)
						continue
					}

					// Create index
					await queryInterface.sequelize.query(
						`CREATE INDEX ${indexConfig.name} ON ${indexConfig.table} (${indexConfig.columns})`,
						{ transaction }
					)

					console.log(
						`✅ Created essential index: ${indexConfig.name} on ${indexConfig.table}(${indexConfig.columns})`
					)
				} catch (error) {
					console.log(`❌ Error creating index ${indexConfig.name}: ${error.message}`)
					// Don't throw here - continue with other indexes
				}
			}

			// Commit the transaction
			await transaction.commit()

			console.log('\n🎯 MIGRATION 2 COMPLETED SUCCESSFULLY!')
			console.log('='.repeat(70))
			console.log('✅ All composite primary key constraints updated with tenant_code')
			console.log('✅ Tenant-aware foreign key constraints created')
			console.log('✅ Essential performance indexes created')
			console.log('📋 NOTE: Citus distribution excluded (handle manually)')
			console.log('📋 Next step: Run data migration scripts if needed')
			console.log('='.repeat(70))
		} catch (error) {
			// Rollback the transaction on any error
			await transaction.rollback()
			console.error('❌ Migration 2 failed, transaction rolled back:', error)
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		// Use a transaction for rollback operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🔄 Rolling back Migration 2: Tenant constraints and relations...')

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

			// Drop tenant-aware foreign key constraints
			const tenantFKs = [
				'fk_session_attendees_session_id',
				'fk_resources_session_id',
				'fk_post_session_details_session_id',
				'fk_entities_entity_type_id',
			]

			console.log('\n📝 Dropping tenant-aware foreign key constraints...')
			for (const fkName of tenantFKs) {
				try {
					await queryInterface.sequelize.query(
						`ALTER TABLE ${fkName.split('_')[1]} DROP CONSTRAINT IF EXISTS ${fkName}`,
						{ transaction }
					)
					console.log(`✅ Dropped FK constraint: ${fkName}`)
				} catch (error) {
					console.log(`⚠️  Could not drop FK ${fkName}: ${error.message}`)
				}
			}

			// Drop essential indexes
			const essentialIndexes = [
				'idx_sessions_tenant_code',
				'idx_user_extensions_tenant_user',
				'idx_organization_extension_tenant_org',
				'idx_entity_types_tenant_value',
				'idx_session_attendees_tenant_session',
				'idx_resources_tenant_session',
				'idx_post_session_details_tenant_session',
				'idx_connections_tenant_users',
				'idx_feedbacks_tenant_user',
			]

			console.log('\n📝 Dropping essential indexes...')
			for (const indexName of essentialIndexes) {
				try {
					await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${indexName}`, { transaction })
					console.log(`✅ Dropped index: ${indexName}`)
				} catch (error) {
					console.log(`⚠️  Could not drop index ${indexName}: ${error.message}`)
				}
			}

			// Drop composite primary keys and restore simple id-based primary keys
			console.log('\n📝 Restoring original primary key constraints...')
			for (const tableName of allTables) {
				try {
					// Check if table exists
					const tableExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${tableName}')`,
						{ type: Sequelize.QueryTypes.SELECT, transaction }
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
					}

					await queryInterface.sequelize.query(`ALTER TABLE ${tableName} ADD PRIMARY KEY (${originalPK})`, {
						transaction,
					})

					console.log(`✅ Restored original primary key for ${tableName}: (${originalPK})`)
				} catch (error) {
					console.log(`⚠️  Could not restore primary key for ${tableName}: ${error.message}`)
				}
			}

			await transaction.commit()
			console.log('✅ Migration 2 rollback completed')
		} catch (error) {
			await transaction.rollback()
			console.error('❌ Migration 2 rollback failed:', error)
			throw error
		}
	},
}
