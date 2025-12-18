'use strict'
module.exports = (sequelize, DataTypes) => {
	const ReportQuery = sequelize.define(
		'ReportQuery',
		{
			id: {
				type: DataTypes.INTEGER,
				allowNull: false,
				autoIncrement: true,
				primaryKey: true,
			},
			report_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			organization_id: {
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
			query: {
				type: DataTypes.TEXT,
			},
			status: {
				type: DataTypes.STRING,
				allowNull: false,
				defaultValue: 'ACTIVE',
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
			sequelize,
			modelName: 'ReportQuery',
			tableName: 'report_queries',
			freezeTableName: true,
			indexes: [
				{
					unique: true,
					fields: ['report_code', 'organization_id'],
					name: 'report_code_organization_unique_queries',
				},
			],
			paranoid: true, // Enables soft delete handling via deleted_at
			timestamps: true, // Automatically manages created_at and updated_at
			createdAt: 'created_at',
			updatedAt: 'updated_at',
			deletedAt: 'deleted_at',
		}
	)

	// Define associations
	ReportQuery.associate = (models) => {
		ReportQuery.belongsTo(models.Report, {
			foreignKey: 'report_code',
			as: 'report',
		})
	}

	return ReportQuery
}
