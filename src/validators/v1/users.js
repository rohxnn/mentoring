/**
 * name : validators/v1/users.js
 * author : Rakesh Kumar
 * Date : 01-Dec-2021
 * Description : Validations of users controller for internal API calls
 */

module.exports = {
	pendingFeedbacks: (req) => {},

	list: (req) => {
		req.checkQuery('type').notEmpty().withMessage('type can not be null').isString()
	},
}
