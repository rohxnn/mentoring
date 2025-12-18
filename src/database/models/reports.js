'use strict'
module.exports = (sequelize, DataTypes) => {
	const Report = sequelize.define(
		'Report',
		{
			id: {
				type: DataTypes.INTEGER,
				allowNull: false,
				primaryKey: true,
				autoIncrement: true,
			},
			code: {
				type: DataTypes.STRING(255),
				allowNull: false,
			},
			title: {
				type: DataTypes.STRING(255),
				allowNull: false,
			},
			description: {
				type: DataTypes.TEXT,
			},
			report_type_title: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			config: {
				type: DataTypes.JSONB,
			},
			organization_id: {
				type: DataTypes.STRING,
			},
			created_at: {
				type: DataTypes.DATE,
				allowNull: false,
				defaultValue: DataTypes.NOW,
			},
			updated_at: {
				type: DataTypes.DATE,
				allowNull: false,
				defaultValue: DataTypes.NOW,
			},
			deleted_at: {
				type: DataTypes.DATE,
			},
			organization_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
		},
		{
			modelName: 'Report',
			tableName: 'reports',
			freezeTableName: true,
			paranoid: true, // Enables soft delete handling via deleted_at
			indexes: [
				{
					unique: true,
					fields: ['code', 'organization_id'],
					name: 'report_code_organization_unique',
				},
			],
		}
	)

	return Report
}
