/**
 * name : validators/v1/entity-type.js
 * author : Aman Gupta
 * Date : 04-Nov-2021
 * Description : Validations of user entities controller
 */
const { filterRequestBody } = require('../common')
const { entityType } = require('@constants/blacklistConfig')
const common = require('@constants/common')

const allDataTypes = Object.values(common.ENTITY_TYPE_DATA_TYPES).flat()

module.exports = {
	create: (req) => {
		req.body = filterRequestBody(req.body, entityType.create)

		req.checkBody('value')
			.trim()
			.notEmpty()
			.withMessage('value field is empty')
			.matches(/^[A-Za-z_]+$/)
			.withMessage('value is invalid, must not contain spaces')

		req.checkBody('label')
			.trim()
			.notEmpty()
			.withMessage('label field is empty')
			.matches(/^[A-Za-z0-9 ]+$/)
			.withMessage('label is invalid')

		req.checkBody('data_type')
			.trim()
			.notEmpty()
			.withMessage('data_type field is empty')
			.matches(/^[A-Za-z\[\]]+$/)
			.withMessage('data_type is invalid, must not contain spaces')
			.isIn(allDataTypes)
			.withMessage('data_type should be one of ' + allDataTypes)

		req.checkBody('model_names')
			.isArray()
			.notEmpty()
			.withMessage('model_names must be an array with at least one element')

		req.checkBody('model_names.*')
			.isIn(['Session', 'MentorExtension', 'UserExtension'])
			.withMessage('model_names must be in Session,MentorExtension,UserExtension')

		req.checkBody('has_entities').optional().isBoolean().withMessage('has_entities is invalid, must be boolean')

		req.checkBody('allow_filtering')
			.optional()
			.isBoolean()
			.withMessage('allow_filtering is invalid, must be boolean')

		req.checkBody('required').optional().isBoolean().withMessage('required is invalid, must be boolean')

		req.checkBody('regex')
			.optional()
			.notEmpty()
			.withMessage('regex field is empty')
			.isString()
			.withMessage('regex is invalid,must be string')

		req.checkBody('status')
			.optional()
			.notEmpty()
			.withMessage('status field is empty')
			.isString()
			.withMessage('status is invalid,must be string')

		req.checkBody('parent_id')
			.optional()
			.notEmpty()
			.withMessage('parent_id field is empty')
			.isInt()
			.withMessage('parent_id is invalid,must be integer')

		if (req.body.has_entities == false) {
			req.checkBody('allow_filtering').custom((value) => {
				if (value) {
					throw new Error('The allow_filtering can be true only if has_entities is set to true')
				}
				return true
			})
		}
	},

	update: (req) => {
		req.body = filterRequestBody(req.body, entityType.create)

		req.checkParams('id').notEmpty().withMessage('id param is empty')

		req.checkBody('value')
			.optional()
			.matches(/^[A-Za-z_]+$/)
			.withMessage('value is invalid, must not contain spaces')

		req.checkBody('label')
			.optional()
			.matches(/^[A-Za-z0-9 ]+$/)
			.withMessage('label is invalid')

		req.checkBody('status')
			.optional()
			.matches(/^[A-Z]+$/)
			.withMessage('status is invalid, must be in all caps')

		req.checkBody('deleted').optional().isBoolean().withMessage('deleted is invalid')

		req.checkBody('data_type')
			.trim()
			.optional()
			.notEmpty()
			.withMessage('data_type field is empty')
			.matches(/^[A-Za-z\[\]]+$/)
			.withMessage('data_type is invalid, must not contain spaces')
			.isIn(allDataTypes)
			.withMessage('data_type should be one of ' + allDataTypes)

		req.checkBody('model_names')
			.isArray()
			.notEmpty()
			.withMessage('model_names must be an array with at least one element')

		req.checkBody('model_names.*')
			.isIn(['Session', 'MentorExtension', 'UserExtension'])
			.withMessage('model_names must be in Session,MentorExtension,UserExtension')

		req.checkBody('allow_filtering')
			.optional()
			.isBoolean()
			.withMessage('allow_filtering is invalid, must be boolean')

		req.checkBody('has_entities').optional().isBoolean().withMessage('has_entities is invalid, must be boolean')

		req.checkBody('required').optional().isBoolean().withMessage('required is invalid, must be boolean')

		req.checkBody('regex')
			.optional()
			.notEmpty()
			.withMessage('regex field is empty')
			.isString()
			.withMessage('regex is invalid,must be string')

		req.checkBody('status')
			.optional()
			.notEmpty()
			.withMessage('status field is empty')
			.isString()
			.withMessage('status is invalid,must be string')

		req.checkBody('parent_id')
			.optional()
			.notEmpty()
			.withMessage('parent_id field is empty')
			.isInt()
			.withMessage('parent_id is invalid,must be integer')

		if (req.body.has_entities == false) {
			req.checkBody('allow_filtering').custom((value) => {
				if (value) {
					throw new Error('The allow_filtering can be true only if has_entities is set to true')
				}
				return true
			})
		}
	},

	read: (req) => {
		if (req.query.type) {
			req.checkQuery('type')
				.trim()
				.notEmpty()
				.withMessage('type field is empty')
				.matches(/^[A-Za-z]+$/)
				.withMessage('type is invalid, must not contain spaces')

			req.checkQuery('deleted').optional().isBoolean().withMessage('deleted is invalid')

			req.checkQuery('status')
				.optional()
				.trim()
				.matches(/^[A-Z]+$/)
				.withMessage('status is invalid, must be in all caps')
		}
	},

	delete: (req) => {
		if (req.body.value) {
			req.checkBody('value')
				.isArray()
				.withMessage('value must be an array')
				.custom((array) => {
					// Allow letters and underscores
					for (let str of array) {
						if (typeof str !== 'string' || !/^[A-Za-z_]+$/.test(str)) {
							throw new Error(
								`"${str}" is invalid, each element in value must contain only letters and underscores`
							)
						}
					}
					return true
				})
		} else {
			req.checkParams('id').notEmpty().withMessage('id param is empty')
		}
	},
}
