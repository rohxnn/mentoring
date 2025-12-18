'use strict'
module.exports = (sequelize, DataTypes) => {
	const ReportRoleMapping = sequelize.define(
		'ReportRoleMapping',
		{
			id: {
				type: DataTypes.INTEGER,
				allowNull: false,
				autoIncrement: true,
			},
			report_code: {
				type: DataTypes.STRING(255),
				primaryKey: true,
				allowNull: false,
			},
			role_title: {
				type: DataTypes.STRING,
				primaryKey: true,
				allowNull: false,
			},
			organization_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
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
		},
		{
			modelName: 'ReportRoleMapping',
			tableName: 'report_role_mapping',
			freezeTableName: true,
			paranoid: true, // Enables soft delete handling via deleted_at
		}
	)

	return ReportRoleMapping
}
