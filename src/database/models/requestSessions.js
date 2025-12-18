module.exports = (sequelize, DataTypes) => {
	const RequestSession = sequelize.define(
		'RequestSession',
		{
			id: {
				allowNull: false,
				autoIncrement: true,
				primaryKey: true,
				type: DataTypes.INTEGER,
			},
			requestor_id: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			requestee_id: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			status: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			meta: {
				type: DataTypes.JSON,
			},
			title: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			agenda: {
				type: DataTypes.TEXT,
				allowNull: false,
			},
			start_date: {
				type: DataTypes.INTEGER,
			},
			end_date: {
				type: DataTypes.INTEGER,
			},
			session_id: {
				type: DataTypes.STRING,
			},
			reject_reason: {
				type: DataTypes.STRING,
			},
			updated_by: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			created_by: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			created_at: {
				allowNull: false,
				type: DataTypes.DATE,
				defaultValue: DataTypes.NOW,
			},
			updated_at: {
				allowNull: false,
				type: DataTypes.DATE,
				defaultValue: DataTypes.NOW,
			},
			deleted_at: {
				type: DataTypes.DATE,
			},
		},
		{
			sequelize,
			modelName: 'RequestSession',
			tableName: 'session_request',
			freezeTableName: true,
			paranoid: true,
			indexes: [
				{
					fields: ['requestor_id'],
					name: 'index_requestor_id_session_request',
				},
				{
					fields: ['status'],
					name: 'index_status_session_request',
				},
			],
		}
	)

	return RequestSession
}
