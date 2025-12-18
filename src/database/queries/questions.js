const Question = require('../models/index').Question

module.exports = class QuestionsData {
	static async createQuestion(data) {
		try {
			const question = await Question.create(data, { returning: true })
			return question
		} catch (error) {
			throw error
		}
	}

	static async findOneQuestion(filter, projection = {}) {
		try {
			const questionData = await Question.findOne({
				where: filter,
				attributes: projection,
				raw: true,
			})
			return questionData
		} catch (error) {
			throw error
		}
	}

	static async find(filter, projection = {}) {
		try {
			const questionData = await Question.findAll({
				where: filter,
				attributes: projection,
				raw: true,
			})
			return questionData
		} catch (error) {
			throw error
		}
	}

	static async updateOneQuestion(filter, update, options = {}) {
		try {
			// Safe merge: options.where cannot override the main filter
			const { where: optionsWhere, ...otherOptions } = options

			const [rowsAffected] = await Question.update(update, {
				where: {
					...optionsWhere, // Allow additional where conditions
					...filter, // But main filter takes priority
				},
				...otherOptions,
			})

			return rowsAffected > 0 ? 'QUESTION_UPDATED' : 'QUESTION_NOT_FOUND'
		} catch (error) {
			throw error
		}
	}
	//To be updated later when the below function are called
	static async update(filter, update, options = {}) {
		try {
			const res = await Questions.update(filter, update, options)
			if ((res.n === 1 && res.nModified === 1) || (res.matchedCount === 1 && res.modifiedCount === 1)) {
				return 'QUESTION_UPDATED'
			} else if ((res.n === 1 && res.nModified === 0) || (res.matchedCount === 1 && res.modifiedCount === 0)) {
				return 'QUESTION_ALREADY_EXISTS'
			} else {
				return 'QUESTION_NOT_FOUND'
			}
		} catch (error) {
			throw error
		}
	}
	static async updateData(filter, update, options = {}) {
		try {
			const res = await Questions.updateMany(filter, update, options)
			if ((res.n === 1 && res.nModified === 1) || (res.matchedCount === 1 && res.modifiedCount === 1)) {
				return 'QUESTION_UPDATED'
			} else if ((res.n === 1 && res.nModified === 0) || (res.matchedCount === 1 && res.modifiedCount === 0)) {
				return 'QUESTION_ALREADY_EXISTS'
			} else {
				return 'QUESTION_NOT_FOUND'
			}
		} catch (error) {
			throw error
		}
	}
}
