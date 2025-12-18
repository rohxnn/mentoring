module.exports = (sequelize, DataTypes) => {
	const RoleExtension = sequelize.define(
		'RoleExtension',
		{
			id: {
				type: DataTypes.INTEGER,
				allowNull: false,
				autoIncrement: true,
			},
			title: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
			label: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			status: {
				type: DataTypes.STRING,
				allowNull: false,
				defaultValue: 'ACTIVE',
			},
			scope: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			organization_id: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			deleted_at: {
				type: DataTypes.DATE,
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
			sequelize,
			modelName: 'RoleExtension',
			tableName: 'role_extensions',
			freezeTableName: true,
			paranoid: true, // Enables soft deletion
		}
	)

	return RoleExtension
}
