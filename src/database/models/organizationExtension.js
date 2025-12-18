'use strict'
const { Model } = require('sequelize')
module.exports = (sequelize, DataTypes) => {
	const OrganizationExtension = sequelize.define(
		'OrganizationExtension',
		{
			organization_id: {
				allowNull: false,
				primaryKey: true,
				type: DataTypes.STRING,
			},
			organization_code: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
			session_visibility_policy: { type: DataTypes.STRING },
			mentor_visibility_policy: { type: DataTypes.STRING },
			external_session_visibility_policy: { type: DataTypes.STRING },
			external_mentor_visibility_policy: { type: DataTypes.STRING },
			approval_required_for: { type: DataTypes.ARRAY(DataTypes.STRING) },
			allow_mentor_override: DataTypes.BOOLEAN,
			created_by: {
				allowNull: true,
				type: DataTypes.STRING,
			},
			updated_by: {
				allowNull: true,
				type: DataTypes.STRING,
			},
			mentee_feedback_question_set: {
				allowNull: true,
				type: DataTypes.STRING,
				defaultValue: 'MENTEE_QS1',
			},
			mentor_feedback_question_set: {
				allowNull: true,
				type: DataTypes.STRING,
				defaultValue: 'MENTOR_QS2',
			},
			uploads: {
				allowNull: true,
				type: DataTypes.JSONB,
			},
			mentee_visibility_policy: { type: DataTypes.STRING },
			external_mentee_visibility_policy: { type: DataTypes.STRING },
			name: { type: DataTypes.STRING },
			theme: {
				allowNull: true,
				type: DataTypes.JSONB,
			},
		},
		{
			sequelize,
			modelName: 'OrganizationExtension',
			tableName: 'organization_extension',
			freezeTableName: true,
			paranoid: true,
		}
	)

	return OrganizationExtension
}
