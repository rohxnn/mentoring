module.exports = (sequelize, DataTypes) => {
	const Issue = sequelize.define(
		'Issue',
		{
			id: {
				type: DataTypes.INTEGER,
				allowNull: false,
				primaryKey: true,
				autoIncrement: true,
			},
			user_id: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			description: {
				type: DataTypes.TEXT,
				allowNull: false,
			},
			is_email_triggered: {
				type: DataTypes.BOOLEAN,
				defaultValue: false,
			},
			meta_data: {
				type: DataTypes.JSONB,
			},
			organization_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
		},
		{
			modelName: 'Issue',
			tableName: 'issues',
			timestamps: true,
			freezeTableName: true,
			paranoid: true,
		}
	)

	return Issue
}
