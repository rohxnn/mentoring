'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting Migration 3: Create Performance Indexes...')
			console.log('='.repeat(70))

			console.log('\n📊 Creating performance indexes (no unique constraints)...')
			console.log('='.repeat(50))

			// Performance indexes configuration - EXACT match from update-tenant-column-script.js createPerformanceIndexes
			const performanceIndexConfigs = [
				{
					table: 'availabilities',
					name: 'idx_availabilities_tenant_code',
					columns: 'tenant_code',
					condition: '',
				},
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

			let createdCount = 0
			for (const indexConfig of performanceIndexConfigs) {
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
						console.log(`⚠️  Table ${indexConfig.table} does not exist, skipping performance index`)
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
						console.log(`✅ Performance index ${indexConfig.name} already exists`)
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
								`⚠️  Column ${col} missing in ${indexConfig.table} for performance index ${indexConfig.name}`
							)
							allColumnsExist = false
							break
						}
					}

					if (!allColumnsExist) {
						console.log(`❌ Skipping performance index ${indexConfig.name} due to missing columns`)
						continue
					}

					// Create performance index (regular, not unique)
					await queryInterface.sequelize.query(
						`CREATE INDEX ${indexConfig.name} 
						 ON ${indexConfig.table} (${indexConfig.columns}) 
						 ${indexConfig.condition}`,
						{ transaction }
					)

					console.log(`✅ Created performance index: ${indexConfig.name} on ${indexConfig.table}`)
					createdCount++
				} catch (error) {
					console.log(`❌ Error creating performance index ${indexConfig.name}: ${error.message}`)
					throw error
				}
			}

			// Commit the transaction
			await transaction.commit()

			console.log('\n🎯 MIGRATION 3 COMPLETED SUCCESSFULLY!')
			console.log('='.repeat(70))
			console.log(`✅ ${createdCount} performance indexes created`)
			console.log('✅ No unique constraints (avoids duplicate data issues)')
			console.log('✅ All tenant-aware performance indexes configured')
			console.log('📋 NOTE: All migrations completed - tenant migration ready!')
			console.log('='.repeat(70))
		} catch (error) {
			// Rollback the transaction on any error
			await transaction.rollback()
			console.error('❌ Migration 3 failed, transaction rolled back:', error)
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		// Use a transaction for rollback operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🔄 Rolling back Migration 3: Performance indexes...')

			// All performance indexes to drop
			const performanceIndexesToDrop = [
				'idx_availabilities_tenant_code',
				'idx_connection_requests_friend_user_tenant',
				'idx_connections_friend_user_tenant',
				'idx_entity_types_value_tenant',
				'idx_feedbacks_user_tenant',
				'idx_forms_type_subtype_organization',
				'idx_issues_tenant_code',
				'idx_notification_templates_code_org',
				'idx_organization_extension_org_code',
				'idx_organization_extension_org_tenant_code',
				'idx_post_session_details_tenant_session',
				'idx_question_sets_code_tenant',
				'idx_report_queries_code_tenant_org',
				'idx_report_role_mapping_role_code',
				'idx_report_types_title_tenant',
				'idx_reports_org_tenant_code',
				'idx_resources_session_tenant',
				'idx_role_extensions_title',
				'idx_session_attendees_tenant_code',
				'idx_session_request_tenant_code',
				'idx_user_extensions_user_tenant',
				'idx_user_extensions_email',
				'idx_user_extensions_phone',
				'idx_user_extensions_user_name',
			]

			console.log('\n📝 Dropping performance indexes...')
			for (const indexName of performanceIndexesToDrop) {
				try {
					await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${indexName}`, { transaction })
					console.log(`✅ Dropped performance index: ${indexName}`)
				} catch (error) {
					console.log(`⚠️  Could not drop performance index ${indexName}: ${error.message}`)
				}
			}

			await transaction.commit()
			console.log('✅ Migration 3 rollback completed')
		} catch (error) {
			await transaction.rollback()
			console.error('❌ Migration 3 rollback failed:', error)
			throw error
		}
	},
}
