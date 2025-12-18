'use strict'
module.exports = (sequelize, DataTypes) => {
	const Connection = sequelize.define(
		'Connection',
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
			modelName: 'Connection',
			tableName: 'connections',
			freezeTableName: true,
			paranoid: true,
		}
	)

	return Connection
}
