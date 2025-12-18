module.exports = (sequelize, DataTypes) => {
	const RolePermission = sequelize.define(
		'RolePermission',
		{
			role_title: {
				type: DataTypes.STRING,
				primaryKey: true,
				allowNull: false,
			},
			permission_id: {
				type: DataTypes.INTEGER,
				primaryKey: true,
				allowNull: false,
			},
			module: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			request_type: {
				allowNull: false,
				type: DataTypes.ARRAY(DataTypes.STRING),
			},
			api_path: {
				allowNull: false,
				type: DataTypes.STRING,
			},
			created_by: {
				type: DataTypes.STRING,
				allowNull: false,
			},
		},
		{
			modelName: 'RolePermission',
			tableName: 'role_permission_mapping',
			freezeTableName: true,
			paranoid: false,
		}
	)

	RolePermission.associate = (models) => {
		// RolePermission belongs to Permission
		RolePermission.belongsTo(models.Permission, {
			foreignKey: 'permission_id',
			as: 'permission',
		})
	}

	return RolePermission
}
