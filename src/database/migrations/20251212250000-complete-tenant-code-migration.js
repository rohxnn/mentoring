'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting tenant-code migration with transaction-based approach...')
			console.log('='.repeat(70))

			// Environment variables for default values
			const defaultTenantCode = process.env.DEFAULT_TENANT_CODE
			const defaultOrgCode = process.env.DEFAULT_ORGANISATION_CODE

			console.log(`📋 Environment Variables:`)
			console.log(`   DEFAULT_TENANT_CODE: ${defaultTenantCode || 'NOT SET'}`)
			console.log(`   DEFAULT_ORGANISATION_CODE: ${defaultOrgCode || 'NOT SET'}`)
			console.log('='.repeat(70))

			if (!defaultTenantCode) {
				throw new Error('DEFAULT_TENANT_CODE environment variable is required')
			}
			if (!defaultOrgCode) {
				throw new Error('DEFAULT_ORGANISATION_CODE environment variable is required')
			}

			// Tables that need tenant_code column (all 26 tables from helper.js)
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

			// Tables that need both tenant_code AND organization_code columns
			const tablesNeedingOrgCode = [
				'availabilities',
				'default_rules',
				'entity_types',
				'file_uploads',
				'forms',
				'issues',
				'notification_templates',
				'organization_extension',
				'question_sets',
				'questions',
				'report_queries',
				'report_role_mapping',
				'report_types',
				'reports',
				'role_extensions',
				'user_extensions',
			]

			console.log('\n📝 PHASE 1: Adding tenant_code columns...')
			console.log('='.repeat(50))

			// Add tenant_code column to all tables
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

					// Check if tenant_code column already exists
					const columnExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = :tableName AND column_name = 'tenant_code')`,
						{
							replacements: { tableName },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (!columnExists[0].exists) {
						await queryInterface.addColumn(
							tableName,
							'tenant_code',
							{
								type: Sequelize.STRING(255),
								allowNull: true, // Start as nullable
							},
							{ transaction }
						)
						console.log(`✅ Added tenant_code to ${tableName}`)
					} else {
						console.log(`✅ ${tableName} already has tenant_code column`)
					}
				} catch (error) {
					console.log(`❌ Error processing tenant_code for ${tableName}: ${error.message}`)
					throw error // Fail fast to trigger rollback
				}
			}

			console.log('\n📝 PHASE 2: Adding organization_code columns...')
			console.log('='.repeat(50))

			// Add organization_code column to specific tables
			for (const tableName of tablesNeedingOrgCode) {
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

					// Check if organization_code column already exists
					const columnExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = :tableName AND column_name = 'organization_code')`,
						{
							replacements: { tableName },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (!columnExists[0].exists) {
						await queryInterface.addColumn(
							tableName,
							'organization_code',
							{
								type: Sequelize.STRING(255),
								allowNull: true, // Start as nullable
							},
							{ transaction }
						)
						console.log(`✅ Added organization_code to ${tableName}`)
					} else {
						console.log(`✅ ${tableName} already has organization_code column`)
					}
				} catch (error) {
					console.log(`❌ Error processing organization_code for ${tableName}: ${error.message}`)
					throw error // Fail fast to trigger rollback
				}
			}

			console.log('\n📝 PHASE 3: Adding user_name column to user_extensions...')
			console.log('='.repeat(50))

			// Handle user_extensions table specifically
			try {
				const userExtensionsExists = await queryInterface.sequelize.query(
					`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_extensions')`,
					{ type: Sequelize.QueryTypes.SELECT, transaction }
				)

				if (userExtensionsExists[0].exists) {
					const userNameExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'user_extensions' AND column_name = 'user_name')`,
						{ type: Sequelize.QueryTypes.SELECT, transaction }
					)

					if (!userNameExists[0].exists) {
						await queryInterface.addColumn(
							'user_extensions',
							'user_name',
							{
								type: Sequelize.STRING(255),
								allowNull: true,
							},
							{ transaction }
						)
						console.log(`✅ Added user_name to user_extensions`)

						// Populate user_name with user_id values
						await queryInterface.sequelize.query(
							`UPDATE user_extensions SET user_name = user_id WHERE user_name IS NULL`,
							{ type: Sequelize.QueryTypes.UPDATE, transaction }
						)
						console.log(`✅ Populated user_name with user_id values`)
					} else {
						console.log(`✅ user_extensions already has user_name column`)
						// Ensure user_name is populated
						await queryInterface.sequelize.query(
							`UPDATE user_extensions SET user_name = user_id WHERE user_name IS NULL`,
							{ type: Sequelize.QueryTypes.UPDATE, transaction }
						)
					}
				}
			} catch (error) {
				console.log(`❌ Error handling user_extensions: ${error.message}`)
				throw error
			}

			console.log('\n📝 PHASE 4: Populating default values for tenant_code...')
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

					// Update NULL tenant_code values with default
					const [, rowsAffected] = await queryInterface.sequelize.query(
						`UPDATE ${tableName} SET tenant_code = :defaultTenantCode WHERE tenant_code IS NULL`,
						{
							replacements: { defaultTenantCode },
							type: Sequelize.QueryTypes.UPDATE,
							transaction,
						}
					)

					console.log(`✅ Updated ${tableName}: ${rowsAffected} rows with default tenant_code`)
				} catch (error) {
					console.log(`❌ Error updating tenant_code in ${tableName}: ${error.message}`)
					throw error
				}
			}

			console.log('\n📝 PHASE 5: Populating default values for organization_code...')
			console.log('='.repeat(50))

			for (const tableName of tablesNeedingOrgCode) {
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

					// Update NULL organization_code values with default
					const [, rowsAffected] = await queryInterface.sequelize.query(
						`UPDATE ${tableName} SET organization_code = :defaultOrgCode WHERE organization_code IS NULL`,
						{
							replacements: { defaultOrgCode },
							type: Sequelize.QueryTypes.UPDATE,
							transaction,
						}
					)

					console.log(`✅ Updated ${tableName}: ${rowsAffected} rows with default organization_code`)
				} catch (error) {
					console.log(`❌ Error updating organization_code in ${tableName}: ${error.message}`)
					throw error
				}
			}

			console.log('\n📝 PHASE 6: Making columns non-nullable...')
			console.log('='.repeat(50))

			// Make tenant_code non-nullable for all tables
			for (const tableName of allTables) {
				try {
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

					await queryInterface.changeColumn(
						tableName,
						'tenant_code',
						{
							type: Sequelize.STRING(255),
							allowNull: false, // Now required
						},
						{ transaction }
					)

					console.log(`✅ Made tenant_code non-nullable in ${tableName}`)
				} catch (error) {
					console.log(`❌ Error making tenant_code non-nullable in ${tableName}: ${error.message}`)
					throw error
				}
			}

			// Make organization_code non-nullable for specific tables
			for (const tableName of tablesNeedingOrgCode) {
				try {
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

					await queryInterface.changeColumn(
						tableName,
						'organization_code',
						{
							type: Sequelize.STRING(255),
							allowNull: false, // Now required
						},
						{ transaction }
					)

					console.log(`✅ Made organization_code non-nullable in ${tableName}`)
				} catch (error) {
					console.log(`❌ Error making organization_code non-nullable in ${tableName}: ${error.message}`)
					throw error
				}
			}

			// Commit the transaction
			await transaction.commit()

			console.log('\n🎯 MIGRATION 1 COMPLETED SUCCESSFULLY!')
			console.log('='.repeat(70))
			console.log('✅ All operations completed within single transaction')
			console.log('✅ Columns added, populated, and made non-nullable')
			console.log('📋 Next step: Create Migration 2 for relations and primary keys')
			console.log('='.repeat(70))
		} catch (error) {
			// Rollback the transaction on any error
			await transaction.rollback()
			console.error('❌ Migration failed, transaction rolled back:', error)
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		try {
			console.log('🔄 Rolling back simplified tenant-code migration...')

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

			// Remove tenant_code columns
			for (const tableName of allTables) {
				try {
					await queryInterface.removeColumn(tableName, 'tenant_code')
					console.log(`✅ Removed tenant_code from ${tableName}`)
				} catch (error) {
					console.log(`⚠️  Could not remove tenant_code from ${tableName}: ${error.message}`)
				}
			}

			// Remove organization_code columns
			const tablesWithOrgCode = [
				'availabilities',
				'default_rules',
				'entity_types',
				'file_uploads',
				'forms',
				'issues',
				'notification_templates',
				'organization_extension',
				'question_sets',
				'questions',
				'report_queries',
				'report_role_mapping',
				'report_types',
				'reports',
				'role_extensions',
				'user_extensions',
			]

			for (const tableName of tablesWithOrgCode) {
				try {
					await queryInterface.removeColumn(tableName, 'organization_code')
					console.log(`✅ Removed organization_code from ${tableName}`)
				} catch (error) {
					console.log(`⚠️  Could not remove organization_code from ${tableName}: ${error.message}`)
				}
			}

			// Remove user_name column from user_extensions
			try {
				await queryInterface.removeColumn('user_extensions', 'user_name')
				console.log(`✅ Removed user_name from user_extensions`)
			} catch (error) {
				console.log(`⚠️  Could not remove user_name from user_extensions: ${error.message}`)
			}

			console.log('✅ Rollback completed')
		} catch (error) {
			console.error('❌ Rollback failed:', error)
			throw error
		}
	},
}
