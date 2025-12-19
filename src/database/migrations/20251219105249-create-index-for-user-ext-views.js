'use strict'

module.exports = {
	async up(queryInterface, Sequelize) {
		return queryInterface.sequelize.transaction(async (transaction) => {
			await queryInterface.sequelize.query(
				`
        CREATE INDEX IF NOT EXISTS idx_user_ext_org_name_partial
        ON m_user_extensions (organization_id, LOWER(name))
        WHERE is_mentor = true;
        `,
				{ transaction }
			)
		})
	},

	async down(queryInterface, Sequelize) {
		return queryInterface.sequelize.transaction(async (transaction) => {
			await queryInterface.sequelize.query(
				`
        DROP INDEX IF EXISTS idx_user_ext_org_name_partial;
        `,
				{ transaction }
			)
		})
	},
}
