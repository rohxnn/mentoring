// Dependencies
const entityTypeService = require('@services/entity-type')

module.exports = class Entity {
	/**
	 * create entity
	 * @method
	 * @name create
	 * @param {Object} req - request data.
	 * @returns {JSON} - entities creation object.
	 */

	async create(req) {
		try {
			return await entityTypeService.create(
				req.body,
				req.decodedToken.id,
				req.decodedToken.organization_id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code,
				req.decodedToken.roles
			)
		} catch (error) {
			return error
		}
	}

	/**
	 * updates entity
	 * @method
	 * @name update
	 * @param {Object} req - request data.
	 * @returns {JSON} - entities updating response.
	 */

	async update(req) {
		try {
			return await entityTypeService.update(
				req.body,
				req.params.id,
				req.decodedToken.id,
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code,
				req.decodedToken.roles
			)
		} catch (error) {
			return error
		}
	}

	/**
	 * reads entities
	 * @method
	 * @name read
	 * @param {Object} req - request data.
	 * @returns {JSON} - entities.
	 */

	async read(req) {
		try {
			if (req.body.value) {
				return await entityTypeService.readUserEntityTypes(
					req.body,
					req.decodedToken.organization_code,
					req.decodedToken.tenant_code
				)
			}
			return await entityTypeService.readAllSystemEntityTypes(
				req.decodedToken.organization_code,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			return error
		}
	}

	/**
	 * deletes entity and entity related enities
	 * @method
	 * @name delete
	 * @param {Object} req - request data.
	 * @returns {JSON} - entities deletion response.
	 */

	async delete(req) {
		try {
			if (req.body.value) {
				return await entityTypeService.deleteEntityTypesAndEntities(
					req.body.value,
					req.decodedToken.tenant_code
				)
			} else {
				return await entityTypeService.delete(
					req.params.id,
					req.decodedToken.organization_code,
					req.decodedToken.tenant_code
				)
			}
		} catch (error) {
			return error
		}
	}
}
