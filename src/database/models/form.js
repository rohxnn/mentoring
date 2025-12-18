'use strict'
module.exports = (sequelize, DataTypes) => {
	const Form = sequelize.define(
		'Form',
		{
			id: {
				type: DataTypes.INTEGER,
				allowNull: false,
				primaryKey: true,
				autoIncrement: true,
			},
			type: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			sub_type: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			data: DataTypes.JSON,
			version: {
				type: DataTypes.INTEGER,
				allowNull: false,
				defaultValue: 0,
			},
			organization_id: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
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
			sequelize,
			modelName: 'Form',
			tableName: 'forms',
			freezeTableName: true,
			paranoid: true,
			indexes: [
				{
					unique: true,
					fields: ['type', 'sub_type', 'tenant_code', 'organization_code'],
				},
			],
		}
	)

	// Pass 'individualHooks: true' option to ensure proper triggering of 'beforeUpdate' hook.
	Form.beforeUpdate(async (form, options) => {
		form.version += 1
	})
	return Form
}
