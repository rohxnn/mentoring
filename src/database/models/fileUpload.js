'use strict'
module.exports = (sequelize, DataTypes) => {
	const FileUpload = sequelize.define(
		'FileUpload',
		{
			id: {
				type: DataTypes.INTEGER,
				allowNull: false,
				autoIncrement: true,
			},
			name: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			input_path: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
			status: {
				type: DataTypes.STRING,
				defaultValue: 'UPLOADED',
				allowNull: false,
			},
			type: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			output_path: {
				type: DataTypes.STRING,
				allowNull: true,
			},
			organization_id: {
				type: DataTypes.STRING,
				allowNull: false,
				primaryKey: true,
			},
			created_by: {
				type: DataTypes.STRING,
			},
			updated_by: {
				type: DataTypes.STRING,
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
		{ sequelize, modelName: 'FileUpload', tableName: 'file_uploads', freezeTableName: true, paranoid: true }
	)

	return FileUpload
}
