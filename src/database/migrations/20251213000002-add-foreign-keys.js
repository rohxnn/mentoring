'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting Migration 2: Add Foreign Key Constraints...')
			console.log('='.repeat(70))

			// Note: Always using composite foreign keys to match composite primary keys from Migration 1
			console.log('📋 Using composite foreign keys to match Migration 1 primary key structure')

			// Complete foreign key configurations with CASCADE constraints for data flexibility
			const foreignKeyConfigs = [
				{
					table: 'entities',
					constraint: 'fk_entities_entity_type_id',
					columns: 'entity_type_id, tenant_code',
					refTable: 'entity_types',
					refColumns: 'id, tenant_code',
					description: 'entities(entity_type_id, tenant_code) -> entity_types(id, tenant_code)',
				},
				{
					table: 'post_session_details',
					constraint: 'fk_post_session_details_session_id',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
					description: 'post_session_details(session_id, tenant_code) -> sessions(id, tenant_code)',
				},
				{
					table: 'session_attendees',
					constraint: 'fk_session_attendees_session_id',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
					description: 'session_attendees(session_id, tenant_code) -> sessions(id, tenant_code)',
				},
				{
					table: 'resources',
					constraint: 'fk_resources_session_id',
					columns: 'session_id, tenant_code',
					refTable: 'sessions',
					refColumns: 'id, tenant_code',
					description: 'resources(session_id, tenant_code) -> sessions(id, tenant_code)',
				},
				{
					table: 'role_permission_mapping',
					constraint: 'fk_role_permission_mapping_permission_id',
					columns: 'permission_id',
					refTable: 'permissions',
					refColumns: 'id',
					description: 'role_permission_mapping(permission_id) -> permissions(id)',
				},
			]

			console.log(`\n🔍 Processing ${foreignKeyConfigs.length} foreign key configurations...`)

			for (const fkConfig of foreignKeyConfigs) {
				console.log(`\n🔄 Processing FK: ${fkConfig.constraint} (${fkConfig.table} -> ${fkConfig.refTable})`)
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
						console.log(`⚠️  Missing table for FK ${fkConfig.constraint}, skipping`)
						console.log(
							`   ${fkConfig.table}: ${tablesExist[0].table_exists}, ${fkConfig.refTable}: ${tablesExist[0].ref_table_exists}`
						)
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
							console.log(
								`⚠️  Source column ${col} missing in ${fkConfig.table} for FK ${fkConfig.constraint}`
							)
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
									`⚠️  Reference column ${col} missing in ${fkConfig.refTable} for FK ${fkConfig.constraint}`
								)
								allColumnsExist = false
								break
							}
						}
					}

					if (!allColumnsExist) {
						console.log(`❌ Skipping FK ${fkConfig.constraint} due to missing columns`)
						continue
					}

					// DEBUG: Check what constraints exist on referenced table
					console.log(`🔍 DEBUG: Checking constraints for ${fkConfig.refTable}...`)
					const existingConstraints = await queryInterface.sequelize.query(
						`SELECT constraint_name, constraint_type FROM information_schema.table_constraints 
						 WHERE table_name = :tableName AND constraint_type IN ('PRIMARY KEY', 'UNIQUE')
						 ORDER BY constraint_type`,
						{
							replacements: { tableName: fkConfig.refTable },
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)
					console.log(
						`   Available constraints: ${existingConstraints
							.map((c) => c.constraint_name + '(' + c.constraint_type + ')')
							.join(', ')}`
					)
					console.log(`   FK trying to reference: ${fkConfig.refTable}(${fkConfig.refColumns})`)

					// Check if constraint already exists
					const constraintExists = await queryInterface.sequelize.query(
						`SELECT EXISTS(
							SELECT 1 FROM information_schema.table_constraints 
							WHERE constraint_name = :constraintName AND table_name = :tableName
						) as exists`,
						{
							replacements: {
								constraintName: fkConfig.constraint,
								tableName: fkConfig.table,
							},
							type: Sequelize.QueryTypes.SELECT,
							transaction,
						}
					)

					if (constraintExists[0].exists) {
						console.log(`⚠️  FK ${fkConfig.constraint} already exists, skipping`)
						continue
					}

					// Create tenant-aware foreign key constraint
					await queryInterface.sequelize.query(
						`ALTER TABLE ${fkConfig.table} 
						 ADD CONSTRAINT ${fkConfig.constraint} 
						 FOREIGN KEY (${fkConfig.columns}) 
						 REFERENCES ${fkConfig.refTable}(${fkConfig.refColumns}) 
						 ON DELETE CASCADE 
						 ON UPDATE NO ACTION`,
						{ transaction }
					)

					console.log(
						`✅ Created tenant-aware FK: ${fkConfig.constraint} (${fkConfig.table}.${fkConfig.columns} → ${fkConfig.refTable}.${fkConfig.refColumns})`
					)
				} catch (error) {
					console.log(`❌ Error creating FK ${fkConfig.constraint}: ${error.message}`)
					console.log(`   Table: ${fkConfig.table}, RefTable: ${fkConfig.refTable}`)
					console.log(`   Columns: ${fkConfig.columns}, RefColumns: ${fkConfig.refColumns}`)

					// Additional debugging for constraint issues
					if (error.message.includes('distribution')) {
						console.log(`   🔍 Debug: This may be a distribution column mismatch`)
					}

					// Fail fast - trigger transaction rollback
					throw error
				}
			}

			// Commit the transaction
			await transaction.commit()

			console.log('\n🎯 MIGRATION 2 COMPLETED SUCCESSFULLY!')
			console.log('='.repeat(70))
			console.log('✅ Tenant-aware foreign key constraints created')
			console.log('📋 NOTE: Indexes will be created in Migration 3')
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
			console.log('🔄 Rolling back Migration 2: Foreign key constraints...')

			// Foreign key constraints to remove (same list as created in up)
			const foreignKeyConstraints = [
				'fk_entities_entity_type_id',
				'fk_post_session_details_session_id',
				'fk_session_attendees_session_id',
				'fk_resources_session_id',
				'fk_role_permission_mapping_permission_id',
			]

			console.log('\n📝 Dropping foreign key constraints...')
			for (const constraintName of foreignKeyConstraints) {
				try {
					// Determine table name from constraint name
					const tableName =
						constraintName.split('_')[1] +
						(constraintName.includes('post_session')
							? '_session_details'
							: constraintName.includes('session_attendees')
							? '_attendees'
							: constraintName.includes('resources')
							? ''
							: 's')

					// Map constraint names to actual table names
					let actualTableName = ''
					if (constraintName === 'fk_entities_entity_type_id') actualTableName = 'entities'
					else if (constraintName === 'fk_post_session_details_session_id')
						actualTableName = 'post_session_details'
					else if (constraintName === 'fk_session_attendees_session_id') actualTableName = 'session_attendees'
					else if (constraintName === 'fk_resources_session_id') actualTableName = 'resources'
					else if (constraintName === 'fk_role_permission_mapping_permission_id')
						actualTableName = 'role_permission_mapping'

					if (actualTableName) {
						await queryInterface.sequelize.query(
							`ALTER TABLE ${actualTableName} DROP CONSTRAINT IF EXISTS ${constraintName}`,
							{ transaction }
						)
						console.log(`✅ Dropped FK constraint: ${constraintName} from ${actualTableName}`)
					}
				} catch (error) {
					console.log(`⚠️  Could not drop FK ${constraintName}: ${error.message}`)
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
