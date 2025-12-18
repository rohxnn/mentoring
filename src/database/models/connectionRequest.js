'use strict'
module.exports = (sequelize, DataTypes) => {
	const ConnectionRequest = sequelize.define(
		'ConnectionRequest',
		{
			id: {
				allowNull: false,
				autoIncrement: true,
				primaryKey: true,
				type: DataTypes.INTEGER,
			},
			user_id: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
			friend_id: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
			status: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			meta: {
				type: DataTypes.JSON,
			},
			created_at: {
				type: DataTypes.DATE,
				defaultValue: DataTypes.NOW,
			},
			updated_at: {
				type: DataTypes.DATE,
				defaultValue: DataTypes.NOW,
			},
			deleted_at: {
				type: DataTypes.DATE,
			},
			updated_by: {
				type: DataTypes.STRING,
			},
			created_by: {
				type: DataTypes.STRING,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
		},
		{
			sequelize,
			modelName: 'ConnectionRequest',
			tableName: 'connection_requests',
			freezeTableName: true,
			paranoid: true,
		}
	)

	return ConnectionRequest
}
