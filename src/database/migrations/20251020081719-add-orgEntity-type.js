module.exports = {
	up: async (queryInterface, Sequelize) => {
		const transaction = await queryInterface.sequelize.transaction()
		try {
			const defaultOrgId = queryInterface.sequelize.options.defaultOrgId
			if (!defaultOrgId) {
				throw new Error('Default org ID is undefined. Please make sure it is set in sequelize options.')
			}

			// Get partition column values from environment
			const defaultOrgCode = process.env.DEFAULT_ORGANISATION_CODE || 'default_code'
			const defaultTenantCode = process.env.DEFAULT_TENANT_CODE || 'default'
			const entitiesArray = {
				about: {
					sequence: 2,
				},
			}

			const entityTypeFinalArray = Object.keys(entitiesArray).map((key) => {
				const entityTypeRow = {
					value: key,
					label: convertToWords(key),
					data_type: 'STRING',
					status: 'ACTIVE',
					updated_at: new Date(),
					created_at: new Date(),
					created_by: 0,
					updated_by: 0,
					allow_filtering: false,
					organization_id: defaultOrgId,
					organization_code: defaultOrgCode,
					tenant_code: defaultTenantCode,
					has_entities: false,
					meta: JSON.stringify({
						label: convertToWords(key),
						visible: true,
						visibility: 'main',
						sequence: entitiesArray[key].sequence,
					}),
				}

				entityTypeRow.model_names = ['UserExtension']
				return entityTypeRow
			})

			await queryInterface.bulkInsert('entity_types', entityTypeFinalArray, { transaction })
			await transaction.commit()
		} catch (error) {
			await transaction.rollback()
			throw error
		}
	},

	down: async (queryInterface, Sequelize) => {
		const transaction = await queryInterface.sequelize.transaction()
		try {
			await queryInterface.bulkDelete('entity_types', { value: ['about'] }, { transaction })
			await transaction.commit()
		} catch (error) {
			await transaction.rollback()
			throw error
		}
	},
}

function convertToWords(inputString) {
	const words = inputString.replace(/_/g, ' ').split(' ')

	const capitalizedWords = words.map((word) => {
		return word.charAt(0).toUpperCase() + word.slice(1)
	})

	const result = capitalizedWords.join(' ')

	return result
}
