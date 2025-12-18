module.exports = (sequelize, DataTypes) => {
	const Availability = sequelize.define(
		'Availability',
		{
			id: {
				allowNull: false,
				autoIncrement: true,
				primaryKey: true,
				type: DataTypes.INTEGER,
			},
			user_id: {
				allowNull: false,
				type: DataTypes.STRING,
			},
			event_name: { type: DataTypes.STRING, allowNull: false },
			start_time: { type: DataTypes.BIGINT, allowNull: false },
			end_time: { type: DataTypes.BIGINT, allowNull: false },
			expiration_date: { type: DataTypes.BIGINT, allowNull: true },
			repeat_on: {
				type: DataTypes.ARRAY(
					DataTypes.ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
				),
				allowNull: true,
				defaultValue: null,
			},
			repeat_unit: {
				type: DataTypes.ENUM('DAY', 'WEEK', 'MONTH', 'YEAR'),
				allowNull: true,
				defaultValue: null,
			},
			exceptions: {
				type: DataTypes.JSONB,
				allowNull: true,
				defaultValue: null,
			},
			occurrence_in_month: { type: DataTypes.INTEGER, allowNull: true },
			repeat_increment: { type: DataTypes.INTEGER, allowNull: true },
			session_id: { type: DataTypes.INTEGER, allowNull: true },
			updated_by: { type: DataTypes.STRING, allowNull: true },
			created_by: { type: DataTypes.STRING, allowNull: true },
			organization_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 0, primaryKey: true },
			organization_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			tenant_code: {
				type: DataTypes.STRING,
				allowNull: false,
			},
		},
		{ sequelize, modelName: 'Availability', tableName: 'availabilities', freezeTableName: true, paranoid: true }
	)

	return Availability
}
