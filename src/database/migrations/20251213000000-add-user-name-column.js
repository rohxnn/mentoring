'use strict'

module.exports = {
	up: async (queryInterface, Sequelize) => {
		// Use a transaction to ensure atomic operations
		const transaction = await queryInterface.sequelize.transaction()

		try {
			console.log('🚀 Starting username column migration...')
			console.log('='.repeat(70))

			console.log('\n📝 PHASE 1: Adding username column to user_extensions...')
			console.log('='.repeat(50))

			// Handle user_extensions table specifically
			try {
				const userExtensionsExists = await queryInterface.sequelize.query(
					`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_extensions')`,
					{ type: Sequelize.QueryTypes.SELECT, transaction }
				)

				if (userExtensionsExists[0].exists) {
					const userNameExists = await queryInterface.sequelize.query(
						`SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'user_extensions' AND column_name = 'username')`,
						{ type: Sequelize.QueryTypes.SELECT, transaction }
					)

					if (!userNameExists[0].exists) {
						await queryInterface.addColumn(
							'user_extensions',
							'username',
							{
								type: Sequelize.STRING(255),
								allowNull: true,
							},
							{ transaction }
						)
						console.log(`✅ Added username column to user_extensions`)
					} else {
						console.log(`✅ user_extensions already has username column`)
					}
				} else {
					console.log(`⚠️  Table user_extensions does not exist, skipping`)
					await transaction.commit()
					console.log('\n🎯 USERNAME COLUMN MIGRATION COMPLETED (table does not exist)')
					return
				}
			} catch (error) {
				console.log(`❌ Error adding username column: ${error.message}`)
				throw error
			}

			console.log('\n📝 PHASE 2: Backfilling username with user_id values...')
			console.log('='.repeat(50))

			// Populate username with user_id values
			try {
				const [, rowsAffected] = await queryInterface.sequelize.query(
					`UPDATE user_extensions SET username = user_id WHERE username IS NULL`,
					{ type: Sequelize.QueryTypes.UPDATE, transaction }
				)
				console.log(`✅ Populated username with user_id values: ${rowsAffected} rows updated`)
			} catch (error) {
				console.log(`❌ Error backfilling username: ${error.message}`)
				throw error
			}

			// Commit the transaction
			await transaction.commit()

			console.log('\n🎯 USERNAME COLUMN MIGRATION COMPLETED SUCCESSFULLY!')
			console.log('='.repeat(70))
			console.log('✅ username column added to user_extensions (nullable)')
			console.log('✅ username backfilled with user_id values')
			console.log('✅ Ready for commit')
			console.log('='.repeat(70))
		} catch (error) {
			// Rollback the transaction on any error
			await transaction.rollback()
			console.error('❌ username column migration failed, transaction rolled back:', error)
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		try {
			console.log('🔄 Rolling back username column migration...')

			// Remove username column from user_extensions
			try {
				await queryInterface.removeColumn('user_extensions', 'username')
				console.log(`✅ Removed username column from user_extensions`)
			} catch (error) {
				console.log(`⚠️  Could not remove username from user_extensions: ${error.message}`)
			}

			console.log('✅ username column migration rollback completed')
		} catch (error) {
			console.error('❌ username column migration rollback failed:', error)
			throw error
		}
	},
}
