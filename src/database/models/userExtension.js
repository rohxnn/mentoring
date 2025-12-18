const Sequelize = require('sequelize')
const Op = Sequelize.Op
const defaultChatEnabled = process.env.ENABLE_CHAT === 'true'

module.exports = (sequelize, DataTypes) => {
	const UserExtension = sequelize.define(
		'UserExtension',
		{
			user_id: {
				allowNull: false,
				primaryKey: true,
				type: DataTypes.STRING,
			},
			designation: {
				type: DataTypes.ARRAY(DataTypes.STRING),
			},
			area_of_expertise: {
				type: DataTypes.ARRAY(DataTypes.STRING),
			},
			education_qualification: {
				type: DataTypes.STRING,
			},
			rating: {
				type: DataTypes.JSON,
			},
			meta: {
				type: DataTypes.JSONB,
			},
			stats: {
				type: DataTypes.JSONB,
			},
			tags: {
				type: DataTypes.ARRAY(DataTypes.STRING),
			},
			configs: {
				type: DataTypes.JSON,
			},
			visible_to_organizations: {
				type: DataTypes.ARRAY(DataTypes.STRING),
			},
			external_session_visibility: {
				type: DataTypes.STRING,
			},
			custom_entity_text: {
				type: DataTypes.JSON,
			},
			experience: {
				type: DataTypes.STRING,
			},
			organization_id: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			external_mentee_visibility: {
				type: DataTypes.STRING,
				defaultValue: 'CURRENT',
			},
			mentee_visibility: {
				type: DataTypes.STRING,
				defaultValue: 'CURRENT',
			},
			external_mentor_visibility: {
				type: DataTypes.STRING,
				defaultValue: 'CURRENT',
			},
			mentor_visibility: {
				type: DataTypes.STRING,
				defaultValue: 'CURRENT',
			},
			name: {
				type: DataTypes.STRING,
			},
			email: {
				type: DataTypes.STRING,
			},
			phone: {
				type: DataTypes.STRING,
			},
			is_mentor: {
				type: DataTypes.BOOLEAN,
				allowNull: false,
				defaultValue: false,
			},
			settings: {
				type: DataTypes.JSONB,
				allowNull: false,
				defaultValue: { chat_enabled: defaultChatEnabled },
			},
			image: {
				type: DataTypes.STRING,
			},
			gender: {
				type: DataTypes.STRING,
			},
			status: {
				type: DataTypes.STRING,
				defaultValue: 'ACTIVE',
			},
			organization_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			username: {
				type: DataTypes.STRING(255),
				allowNull: true,
			},
		},
		{
			sequelize,
			modelName: 'UserExtension',
			tableName: 'user_extensions',
			freezeTableName: true,
			paranoid: true,
			defaultScope: {
				attributes: { exclude: ['email'] },
			},
			scopes: {
				mentors: {
					where: {
						is_mentor: true,
					},
					attributes: { exclude: ['email'] },
				},
			},
		}
	)
	return UserExtension
}
