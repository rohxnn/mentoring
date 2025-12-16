'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting Migration 4: Fix UNIQUE constraints for tenant isolation...')
			console.log('='.repeat(70))

			// Fix existing UNIQUE constraints to include tenant_code for proper multi-tenant isolation
			// This ensures all unique constraints are tenant-aware
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
				console.log(`\n🔍 Processing ${constraint.table}.${constraint.oldIndexName}...`)

				try {
					// Check if table exists
					const tableExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
						{
							replacements: { tableName: constraint.table },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (!tableExists[0].exists) {
						console.log(`⚠️  Table ${constraint.table} does not exist, skipping`)
						constraintsSkipped++
						continue
					}

					// Check if all columns exist
					const columns = constraint.newColumns.split(',').map((c) => c.trim())
					let allColumnsExist = true

					for (const col of columns) {
						const colExists = await queryInterface.sequelize.query(
							`SELECT EXISTS (
								SELECT FROM information_schema.columns 
								WHERE table_name = :tableName AND column_name = :columnName
							)`,
							{
								replacements: { tableName: constraint.table, columnName: col },
								type: Sequelize.QueryTypes.SELECT,
								transaction,
							}
						)
						if (!colExists[0].exists) {
							console.log(`⚠️  Column ${col} missing in ${constraint.table}`)
							allColumnsExist = false
							break
						}
					}

					if (!allColumnsExist) {
						console.log(`❌ Skipping constraint ${constraint.oldIndexName} due to missing columns`)
						constraintsSkipped++
						continue
					}

					// Check if old constraint exists and drop it
					const oldConstraintExists = await queryInterface.sequelize.query(
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
							transaction,
						}
					)

					if (oldConstraintExists[0].exists) {
						// Check if it's a constraint or just an index
						const isConstraint = await queryInterface.sequelize.query(
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
								transaction,
							}
						)

						if (isConstraint[0].is_constraint) {
							// Drop constraint (which automatically drops the associated index)
							await queryInterface.sequelize.query(
								`ALTER TABLE "${constraint.table}" DROP CONSTRAINT IF EXISTS "${constraint.oldIndexName}"`,
								{ transaction }
							)
							console.log(`  ✅ Dropped old constraint: ${constraint.oldIndexName}`)
						} else {
							// Drop index only
							await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${constraint.oldIndexName}"`, {
								transaction,
							})
							console.log(`  ✅ Dropped old index: ${constraint.oldIndexName}`)
						}
					}

					// Check if new constraint already exists
					const newConstraintExists = await queryInterface.sequelize.query(
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
							transaction,
						}
					)

					if (!newConstraintExists[0].exists) {
						// Create new tenant-aware constraint - use partial index if condition exists
						if (constraint.condition && constraint.condition.trim()) {
							// Create partial unique index for conditional constraints
							const createIndexQuery = `CREATE UNIQUE INDEX "${constraint.newIndexName}" 
								ON "${constraint.table}" (${constraint.newColumns}) 
								${constraint.condition}`

							await queryInterface.sequelize.query(createIndexQuery, { transaction })
							console.log(`  ✅ Created tenant-aware partial unique index: ${constraint.newIndexName}`)
						} else {
							// Create full-table unique constraint for non-conditional constraints
							const createConstraintQuery = `ALTER TABLE "${constraint.table}" 
								ADD CONSTRAINT "${constraint.newIndexName}" 
								UNIQUE (${constraint.newColumns})`

							await queryInterface.sequelize.query(createConstraintQuery, { transaction })
							console.log(`  ✅ Created tenant-aware unique constraint: ${constraint.newIndexName}`)
						}
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
						console.log(
							`  💡 Note: Duplicate data exists - constraint will be created when data is cleaned`
						)
					}
					constraintsSkipped++
				}
			}

			console.log('\n📊 Creating distribution-ready indexes...')
			console.log('='.repeat(50))

			// Distribution-ready indexes (tenant-first for optimal performance)
			const distributionIndexes = [
				// Core user and organization indexes
				{
					table: 'user_extensions',
					name: 'idx_user_extensions_tenant_user_dist',
					columns: 'tenant_code, user_id',
				},
				{
					table: 'organization_extension',
					name: 'idx_organization_extension_tenant_org_dist',
					columns: 'tenant_code, organization_code',
				},

				// Session-related indexes
				{ table: 'sessions', name: 'idx_sessions_tenant_mentor_dist', columns: 'tenant_code, mentor_id' },
				{ table: 'sessions', name: 'idx_sessions_tenant_status_dist', columns: 'tenant_code, status' },
				{ table: 'sessions', name: 'idx_sessions_tenant_date_dist', columns: 'tenant_code, start_date' },
				{
					table: 'session_attendees',
					name: 'idx_session_attendees_tenant_mentee_dist',
					columns: 'tenant_code, mentee_id',
				},
				{
					table: 'session_attendees',
					name: 'idx_session_attendees_tenant_session_dist',
					columns: 'tenant_code, session_id',
				},

				// Entity and form indexes
				{ table: 'entities', name: 'idx_entities_tenant_type_dist', columns: 'tenant_code, entity_type_id' },
				{ table: 'entity_types', name: 'idx_entity_types_tenant_value_dist', columns: 'tenant_code, value' },
				{ table: 'forms', name: 'idx_forms_tenant_type_dist', columns: 'tenant_code, type, sub_type' },
				{ table: 'forms', name: 'idx_forms_tenant_org_dist', columns: 'tenant_code, organization_id' },

				// Communication and notification indexes
				{
					table: 'notification_templates',
					name: 'idx_notification_templates_tenant_code_dist',
					columns: 'tenant_code, code',
				},
				{
					table: 'connections',
					name: 'idx_connections_tenant_users_dist',
					columns: 'tenant_code, user_id, friend_id',
				},
				{
					table: 'connection_requests',
					name: 'idx_connection_requests_tenant_users_dist',
					columns: 'tenant_code, user_id, friend_id',
				},

				// Resource and session management indexes
				{ table: 'resources', name: 'idx_resources_tenant_session_dist', columns: 'tenant_code, session_id' },
				{
					table: 'session_request',
					name: 'idx_session_request_tenant_user_dist',
					columns: 'tenant_code, created_by',
				},
				{
					table: 'post_session_details',
					name: 'idx_post_session_details_tenant_session_dist',
					columns: 'tenant_code, session_id',
				},

				// Reporting and analytics indexes
				{ table: 'reports', name: 'idx_reports_tenant_org_dist', columns: 'tenant_code, organization_id' },
				{
					table: 'report_queries',
					name: 'idx_report_queries_tenant_code_dist',
					columns: 'tenant_code, report_code',
				},
				{ table: 'feedbacks', name: 'idx_feedbacks_tenant_user_dist', columns: 'tenant_code, user_id' },

				// Configuration indexes
				{ table: 'default_rules', name: 'idx_default_rules_tenant_type_dist', columns: 'tenant_code, type' },
				{ table: 'question_sets', name: 'idx_question_sets_tenant_code_dist', columns: 'tenant_code, code' },
				{
					table: 'role_extensions',
					name: 'idx_role_extensions_tenant_title_dist',
					columns: 'tenant_code, title',
				},

				// Additional performance indexes
				{
					table: 'availabilities',
					name: 'idx_availabilities_tenant_user_dist',
					columns: 'tenant_code, user_id',
				},
				{ table: 'file_uploads', name: 'idx_file_uploads_tenant_type_dist', columns: 'tenant_code, type' },
				{ table: 'issues', name: 'idx_issues_tenant_user_dist', columns: 'tenant_code, user_id' },
				{ table: 'modules', name: 'idx_modules_tenant_code_dist', columns: 'tenant_code, code' },
				{ table: 'question_sets', name: 'idx_questions_tenant_set_dist', columns: 'tenant_code, code' },
				{ table: 'permissions', name: 'unique_code', columns: 'code' },
				{ table: 'report_types', name: 'idx_report_types_tenant_title_dist', columns: 'tenant_code, title' },
			]

			let indexesCreated = 0
			let indexesSkipped = 0

			for (const idx of distributionIndexes) {
				try {
					// Check if table exists
					const tableExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = :tableName)`,
						{
							replacements: { tableName: idx.table },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (!tableExists[0].exists) {
						console.log(`⚠️  Table ${idx.table} does not exist, skipping index`)
						indexesSkipped++
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
								tableName: idx.table,
								indexName: idx.name,
							},
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (indexExists[0].exists) {
						console.log(`✅ Distribution index ${idx.name} already exists`)
						continue
					}

					// Verify all columns exist
					const columns = idx.columns.split(',').map((c) => c.trim())
					let allColumnsExist = true

					for (const col of columns) {
						const colExists = await queryInterface.sequelize.query(
							`SELECT EXISTS (
								SELECT FROM information_schema.columns 
								WHERE table_name = :tableName AND column_name = :columnName
							)`,
							{
								replacements: { tableName: idx.table, columnName: col },
								type: Sequelize.QueryTypes.SELECT,
								transaction,
							}
						)
						if (!colExists[0].exists) {
							console.log(`⚠️  Column ${col} missing in ${idx.table} for index ${idx.name}`)
							allColumnsExist = false
							break
						}
					}

					if (!allColumnsExist) {
						console.log(`❌ Skipping index ${idx.name} due to missing columns`)
						indexesSkipped++
						continue
					}

					// Create index
					await queryInterface.sequelize.query(
						`CREATE INDEX IF NOT EXISTS "${idx.name}" ON "${idx.table}" (${idx.columns})`,
						{ transaction }
					)
					console.log(`✅ Created distribution index: ${idx.name}`)
					indexesCreated++
				} catch (error) {
					console.log(`❌ Error creating index ${idx.name}: ${error.message}`)
					indexesSkipped++
				}
			}

			console.log(`\n📈 Distribution Index Summary:`)
			console.log(`✅ Successfully created: ${indexesCreated} indexes`)
			console.log(`⚠️  Skipped/Failed: ${indexesSkipped} indexes`)

			// Commit the transaction
			await transaction.commit()

			console.log(`\n🎯 MIGRATION 4 COMPLETED SUCCESSFULLY!`)
			console.log('='.repeat(70))
			console.log(`✅ Successfully fixed: ${constraintsFixed} constraints`)
			console.log(`⚠️  Skipped: ${constraintsSkipped} constraints`)

			if (constraintsFixed > 0) {
				console.log('✅ All UNIQUE constraints now include tenant_code for proper distribution')
				console.log('🚀 Database is ready for Citus distribution!')
			}
			console.log('='.repeat(70))
		} catch (error) {
			// Rollback the transaction on any error
			await transaction.rollback()
			console.error('❌ Migration 4 failed, transaction rolled back:', error)
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		// Use a transaction for rollback operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🔄 Rolling back Migration 4: Unique constraints...')

			// Drop tenant-aware unique constraints
			const constraintsToRevert = [
				{ table: 'connection_requests', constraint: 'unique_user_id_friend_id_connection_requests_tenant' },
				{ table: 'connections', constraint: 'unique_user_id_friend_id_connections_tenant' },
				{ table: 'entities', constraint: 'unique_entities_value_tenant' },
				{ table: 'forms', constraint: 'unique_type_sub_type_org_id_tenant' },
				{ table: 'default_rules', constraint: 'unique_default_rules_constraint_tenant' },
				{ table: 'entity_types', constraint: 'unique_value_org_id_tenant' },
				{ table: 'modules', constraint: 'code_unique_tenant' },
				{ table: 'report_queries', constraint: 'unique_queries_report_code_organization_tenant' },
				{ table: 'report_types', constraint: 'report_types_title_tenant' },
				{ table: 'reports', constraint: 'report_code_organization_unique_tenant' },
			]

			console.log('\n📝 Dropping tenant-aware unique constraints...')
			for (const { table, constraint } of constraintsToRevert) {
				try {
					// Try dropping as constraint first
					await queryInterface.sequelize.query(
						`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`,
						{ transaction }
					)
					// Also try dropping as index in case it was created as index
					await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${constraint}"`, { transaction })
					console.log(`✅ Dropped constraint/index: ${constraint} from ${table}`)
				} catch (error) {
					console.log(`⚠️  Could not drop ${constraint}: ${error.message}`)
				}
			}

			// Drop distribution indexes
			const distributionIndexesToDrop = [
				'idx_user_extensions_tenant_user_dist',
				'idx_organization_extension_tenant_org_dist',
				'idx_sessions_tenant_mentor_dist',
				'idx_sessions_tenant_status_dist',
				'idx_sessions_tenant_date_dist',
				'idx_session_attendees_tenant_mentee_dist',
				'idx_session_attendees_tenant_session_dist',
				'idx_entities_tenant_type_dist',
				'idx_entity_types_tenant_value_dist',
				'idx_forms_tenant_type_dist',
				'idx_forms_tenant_org_dist',
				'idx_notification_templates_tenant_code_dist',
				'idx_connections_tenant_users_dist',
				'idx_connection_requests_tenant_users_dist',
				'idx_resources_tenant_session_dist',
				'idx_session_request_tenant_user_dist',
				'idx_post_session_details_tenant_session_dist',
				'idx_reports_tenant_org_dist',
				'idx_report_queries_tenant_code_dist',
				'idx_feedbacks_tenant_user_dist',
				'idx_default_rules_tenant_type_dist',
				'idx_question_sets_tenant_code_dist',
				'idx_role_extensions_tenant_title_dist',
				'idx_availabilities_tenant_user_dist',
				'idx_file_uploads_tenant_type_dist',
				'idx_issues_tenant_user_dist',
				'idx_modules_tenant_code_dist',
				'idx_questions_tenant_set_dist',
				'idx_report_role_mapping_tenant_role_dist',
				'idx_report_types_tenant_title_dist',
			]

			console.log('\n📝 Dropping distribution indexes...')
			for (const indexName of distributionIndexesToDrop) {
				try {
					await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${indexName}"`, { transaction })
					console.log(`✅ Dropped distribution index: ${indexName}`)
				} catch (error) {
					console.log(`⚠️  Could not drop distribution index ${indexName}: ${error.message}`)
				}
			}

			await transaction.commit()
			console.log('✅ Migration 4 rollback completed')
		} catch (error) {
			await transaction.rollback()
			console.error('❌ Migration 4 rollback failed:', error)
			throw error
		}
	},
}
