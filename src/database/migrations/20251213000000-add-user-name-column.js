'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting user_name column migration...')
			console.log('='.repeat(70))

			console.log('\n📝 PHASE 1: Adding user_name column to user_extensions...')
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
						console.log(`✅ Added user_name column to user_extensions`)
					} else {
						console.log(`✅ user_extensions already has user_name column`)
					}
				} else {
					console.log(`⚠️  Table user_extensions does not exist, skipping`)
				}
			} catch (error) {
				console.log(`❌ Error adding user_name column: ${error.message}`)
				throw error
			}

			console.log('\n📝 PHASE 2: Backfilling user_name with user_id values...')
			console.log('='.repeat(50))

			// Populate user_name with user_id values
			try {
				const [, rowsAffected] = await queryInterface.sequelize.query(
					`UPDATE user_extensions SET user_name = user_id WHERE user_name IS NULL`,
					{ type: Sequelize.QueryTypes.UPDATE, transaction }
				)
				console.log(`✅ Populated user_name with user_id values: ${rowsAffected} rows updated`)
			} catch (error) {
				console.log(`❌ Error backfilling user_name: ${error.message}`)
				throw error
			}

			// Commit the transaction
			await transaction.commit()

			console.log('\n🎯 USER_NAME COLUMN MIGRATION COMPLETED SUCCESSFULLY!')
			console.log('='.repeat(70))
			console.log('✅ user_name column added to user_extensions (nullable)')
			console.log('✅ user_name backfilled with user_id values')
			console.log('✅ Ready for commit')
			console.log('='.repeat(70))
		} catch (error) {
			// Rollback the transaction on any error
			await transaction.rollback()
			console.error('❌ user_name column migration failed, transaction rolled back:', error)
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		try {
			console.log('🔄 Rolling back user_name column migration...')

			// Remove user_name column from user_extensions
			try {
				await queryInterface.removeColumn('user_extensions', 'user_name')
				console.log(`✅ Removed user_name column from user_extensions`)
			} catch (error) {
				console.log(`⚠️  Could not remove user_name from user_extensions: ${error.message}`)
			}

			console.log('✅ user_name column migration rollback completed')
		} catch (error) {
			console.error('❌ user_name column migration rollback failed:', error)
			throw error
		}
	},
}
