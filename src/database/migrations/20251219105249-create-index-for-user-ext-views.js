'use strict'

module.exports = {
	async up(queryInterface, Sequelize) {
		await queryInterface.sequelize.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_ext_org_name_partial
      ON m_user_extensions (organization_id, LOWER(name))
      WHERE is_mentor = true;
    `)
	},

	async down(queryInterface, Sequelize) {
		await queryInterface.sequelize.query(`
      DROP INDEX CONCURRENTLY IF EXISTS idx_user_ext_org_name_partial;
    `)
	},
}
