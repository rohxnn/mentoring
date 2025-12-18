const httpStatusCode = require('@generics/http-status')
const availabilityQueries = require('@database/queries/availability')
const sessionQueries = require('@database/queries/sessions')
const responses = require('@helpers/responses')
const { Op } = require('sequelize')
const moment = require('moment')
const { performance, PerformanceObserver } = require('perf_hooks')
const { getAvailabilitiesByDay, buildUserAvailabilities } = require('@dtos/availability')
const userRequests = require('@requests/user')
const _ = require('lodash')
const menteeQueries = require('@database/queries/userExtension')

module.exports = class availabilityHelper {
	/**
	 * Create availability.
	 * @method
	 * @name create
	 * @param {Object} bodyData - The data for creating the availability.
	 * @param {Object} decodedToken - The decoded token object.
	 * @returns {Promise<Object>} - The response object.
	 */
	static async create(bodyData, decodedToken) {
		try {
			bodyData['created_by'] = decodedToken.id
			bodyData['updated_by'] = decodedToken.id
			bodyData['user_id'] = decodedToken.id
			bodyData['tenant_code'] = decodedToken.tenant_code

			const minimumDurationForAvailability = parseInt(process.env.MINIMUM_DURATION_FOR_AVAILABILITY, 10)
			if (minimumDurationForAvailability !== 0) {
				const availabilityStart = moment(bodyData.start_time * 1000)
				const availabilityEnd = moment(bodyData.end_time * 1000)
				const diffInMinutes = Math.abs(availabilityStart.diff(availabilityEnd, 'minutes'))
				if (minimumDurationForAvailability >= diffInMinutes) {
					return responses.successResponse({
						statusCode: httpStatusCode.created,
						message: 'MIN_DURATION',
					})
				}
			}

			let availability = await availabilityQueries.createAvailability(bodyData, decodedToken.tenant_code)
			return responses.successResponse({
				statusCode: httpStatusCode.created,
				message: 'AVAILABILITY_CREATED_SUCCESSFULLY',
				result: availability,
			})
		} catch (error) {
			throw error
		}
	}
	/**
	 * Update availability.
	 * @method
	 * @name update
	 * @param {number} id - The ID of the availability to be updated.
	 * @param {Object} bodyData - The data for updating the availability.
	 * @param {Object} decodedToken - The decoded token object.
	 * @returns {Promise<Object>} - The response object.
	 */
	static async update(id, bodyData, decodedToken) {
		try {
			const filter = { id, created_by: decodedToken.id, tenant_code: decodedToken.tenant_code }
			const [rowsAffected] = await availabilityQueries.updateAvailability(
				filter,
				bodyData,
				decodedToken.tenant_code
			)

			if (rowsAffected === 0) {
				return responses.failureResponse({
					message: 'AVAILABILITY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'AVAILABILITY_UPDATED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}
	/**
	 * delete availability.
	 * @method
	 * @name delete
	 * @param {number} id - The ID of the availability to be updated.
	 * @param {Object} decodedToken - The decoded token object.
	 * @returns {Promise<Object>} - The response object.
	 */
	static async delete(id, decodedToken) {
		try {
			const filter = { id, created_by: decodedToken.id, tenant_code: decodedToken.tenant_code }
			const rowsAffected = await availabilityQueries.deleteAvailability(filter, decodedToken.tenant_code)
			if (rowsAffected === 0) {
				return responses.failureResponse({
					message: 'AVAILABILITY_NOT_FOUND',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			return responses.successResponse({
				statusCode: httpStatusCode.accepted,
				message: 'AVAILABILITY_DELETED_SUCCESSFULLY',
			})
		} catch (error) {
			throw error
		}
	}
	/**
	 * Update availabilities based on sessions.
	 * @method
	 * @name updateAvailabilities
	 * @param {Object[]} sessions - The sessions data.
	 * @param {Object[]} availabilities - The availabilities data.
	 * @returns {Object[]} - The updated availabilities data.
	 */
	static updateAvailabilities(sessions, availabilities) {
		//Return the availabilities as it is if sessions is empty
		if (sessions.length === 0 || Object.keys(sessions[0]).length === 0) {
			return availabilities
		}

		let updatedAvailabilities = [...availabilities]

		sessions.forEach((session) => {
			const sessionStart = moment(session.start_date * 1000)
			const sessionEnd = moment(session.end_date * 1000)

			updatedAvailabilities.forEach((availability, index) => {
				const availabilityStart = moment(availability.start_time * 1000)
				const availabilityEnd = moment(availability.end_time * 1000)

				const isSessionWithinAvailability =
					sessionStart.isBetween(availabilityStart, availabilityEnd) &&
					sessionEnd.isBetween(availabilityStart, availabilityEnd)
				const isAvailabilityWithinSession =
					sessionStart.isSameOrBefore(availabilityStart) && sessionEnd.isSameOrAfter(availabilityEnd)
				const isSessionOverlapStart =
					sessionStart.isSameOrBefore(availabilityStart) &&
					sessionEnd.isAfter(availabilityStart) &&
					sessionEnd.isBefore(availabilityEnd)
				const isSessionOverlapEnd =
					sessionStart.isAfter(availabilityStart) &&
					sessionStart.isBefore(availabilityEnd) &&
					sessionEnd.isSameOrAfter(availabilityEnd)

				switch (true) {
					case isSessionWithinAvailability:
						// Session is within the availability, split the availability
						const newAvailability1 = {
							...availability,
							end_time: sessionStart.unix(),
							event_name: 'First Split',
						}
						const newAvailability2 = {
							...availability,
							start_time: sessionEnd.unix(),
							event_name: 'Second Split',
						}
						// Remove the original availability and insert the split ones

						updatedAvailabilities.splice(index, 1, newAvailability1, newAvailability2)

						break
					case isAvailabilityWithinSession:
						// Availability is within the session, remove the availability
						updatedAvailabilities.splice(index, 1)
						break
					case isSessionOverlapStart:
						// Session overlaps the beginning of availability, adjust the start time
						availability.start_time = sessionEnd.unix()
						updatedAvailabilities[index] = availability
						break
					case isSessionOverlapEnd:
						//Session overlaps the end of availability, adjust the end time
						availability.end_time = sessionStart.unix()
						updatedAvailabilities[index] = availability
						break
					default:
						break
				}
			})
		})

		return updatedAvailabilities
	}
	/**
	 * Filter availabilities based on minimum duration.
	 * @method
	 * @name filterAvailabilitiesByMinimumDuration
	 * @param {Object[]} availabilities - The availabilities data.
	 * @returns {Object[]} - The filtered availabilities data.
	 */
	static filterAvailabilitiesByMinimumDuration(availabilities) {
		const minimumDurationForAvailability = parseInt(process.env.MINIMUM_DURATION_FOR_AVAILABILITY, 10)
		// Return the availabilities as it is based on env config
		if (minimumDurationForAvailability === 0) {
			return availabilities
		}

		return availabilities.filter((availability) => {
			const availabilityStart = moment(availability.start_time * 1000)
			const availabilityEnd = moment(availability.end_time * 1000)
			const diffInMinutes = Math.abs(availabilityStart.diff(availabilityEnd, 'minutes'))
			return diffInMinutes >= minimumDurationForAvailability
		})
	}
	static mergeMentoringSessionsWithAvailability(availability, mentoringData) {
		const mergedData = new Map()
		// Transform original data into desired structure with "availability" and "sessions" keys
		Object.entries(availability).forEach(([key, value]) => {
			mergedData.set(key, { availability: value, sessions: [] })
		})

		// Merge mentoring sessions into transformed data under "sessions" key
		mentoringData.forEach((mentoringSession) => {
			const startDate = moment(mentoringSession.start_date * 1000)
				.startOf('day')
				.unix()
			if (mergedData.has(startDate.toString())) {
				mergedData.get(startDate.toString()).sessions.push(mentoringSession)
			}
		})

		// Convert mergedData back to object before returning (if necessary)
		return Object.fromEntries(mergedData)
	}

	/**
	 * Read availabilities.
	 * @method
	 * @name read
	 * @param {Object} query - The query parameters.
	 * @param {number} userId - The user ID.
	 * @returns {Promise<Object>} - The response object.
	 */
	static async read(query, userId, tenantCode) {
		try {
			const filter = {
				[Op.or]: [
					{
						start_time: {
							[Op.between]: [query.startEpoch, query.endEpoch],
						},
						repeat_unit: null, // Include one-time events
					},
					{
						repeat_unit: {
							[Op.not]: null, // Include recurring events
						},
					},
				],
				user_id: userId,
				tenant_code: tenantCode,
			}
			let userAvailabilities = await availabilityQueries.findAvailability(filter)

			const sessionOptions = {
				attributes: ['id', 'title', 'description', 'start_date', 'end_date', 'mentor_id', 'created_by'],
			}
			const sessions = await sessionQueries.findAll(
				{
					start_date: {
						[Op.between]: [query.startEpoch, query.endEpoch],
					},
					mentor_id: userId,
				},
				sessionOptions
			)

			if (userAvailabilities.length === 0 && sessions.length === 0) {
				const availabilitiesByDay = getAvailabilitiesByDay({
					startEpoch: query.startEpoch,
					endEpoch: query.endEpoch,
					availabilities: [{}],
				})
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'AVAILABILITIES_FETCHED',
					result: availabilitiesByDay,
				})
			}

			// Filter out recurring events and generate instances within the date range
			const start = performance.now()
			userAvailabilities = buildUserAvailabilities({
				startEpoch: query.startEpoch,
				endEpoch: query.endEpoch,
				userAvailabilities: userAvailabilities,
			})

			const end = performance.now()

			let updatedAvailabilities = userAvailabilities

			if (sessions && process.env.MULTIPLE_BOOKING === 'false') {
				updatedAvailabilities = this.updateAvailabilities(sessions, userAvailabilities)
				updatedAvailabilities = this.filterAvailabilitiesByMinimumDuration(updatedAvailabilities)
			}

			const availabilitiesByDay = getAvailabilitiesByDay({
				startEpoch: query.startEpoch,
				endEpoch: query.endEpoch,
				availabilities: updatedAvailabilities,
			})
			if (!availabilitiesByDay) {
				return responses.successResponse({
					statusCode: httpStatusCode.internal_server_error,
				})
			}
			const mergedDataWithSessions = this.mergeMentoringSessionsWithAvailability(availabilitiesByDay, sessions)

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'Events fetched',
				result: mergedDataWithSessions,
			})
		} catch (error) {
			throw error
		}
	}
	/**
	 * Check availability.
	 * @method
	 * @name isAvailable
	 * @param {Object} query - The query parameters.
	 * @param {number} userId - The user ID.
	 * @returns {Promise<Object>} - The response object.
	 */
	static async isAvailable(query, userId, tenantCode) {
		try {
			const filter = {
				[Op.or]: [
					{
						start_time: {
							[Op.between]: [query.startEpoch, query.endEpoch],
						},
						repeat_unit: null, // Include one-time events
					},
					{
						repeat_unit: {
							[Op.not]: null, // Include recurring events
						},
					},
				],
				user_id: userId,
				tenant_code: tenantCode,
			}
			let userAvailabilities = await availabilityQueries.findAvailability(filter)
			const sessions = await sessionQueries.findAll(
				{
					start_date: {
						[Op.between]: [query.startEpoch, query.endEpoch],
					},
				},
				{}
			)
			if (userAvailabilities.length === 0) {
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'AVAILABILITIES_FETCHED',
					result: {
						is_available: false,
					},
				})
			}

			// Filter out recurring events and generate instances within the date range
			userAvailabilities = buildUserAvailabilities({
				startEpoch: query.startEpoch,
				endEpoch: query.endEpoch,
				userAvailabilities: userAvailabilities,
			})

			let updatedAvailabilities = userAvailabilities

			if (sessions && process.env.MULTIPLE_BOOKING === 'false') {
				updatedAvailabilities = this.updateAvailabilities(sessions, userAvailabilities)
				updatedAvailabilities = this.filterAvailabilitiesByMinimumDuration(updatedAvailabilities)
			}

			const isInAnyAvailability = updatedAvailabilities
				.map((availability) => {
					return query.startEpoch >= availability.start_time && query.endEpoch <= availability.end_time
				})
				.includes(true)
			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'AVAILABILITIES_FETCHED',
				result: {
					is_available: isInAnyAvailability,
				},
			})
		} catch (error) {
			throw error
		}
	}
	/**
	 * Get available users.
	 * @method
	 * @name availableUsers
	 * @param {Object} query - The query parameters.
	 * @returns {Promise<Object>} - The response object.
	 */
	static async users(query, userId, tenantCode) {
		try {
			const filter = {
				[Op.or]: [
					{
						start_time: {
							[Op.between]: [query.startEpoch, query.endEpoch],
						},
						repeat_unit: null, // Include one-time events
					},
					{
						repeat_unit: {
							[Op.not]: null, // Include recurring events
						},
					},
				],
				tenant_code: tenantCode,
			}
			let userAvailabilities = await availabilityQueries.findAvailability(filter)
			const sessions = await sessionQueries.findAll(
				{
					start_date: {
						[Op.between]: [query.startEpoch, query.endEpoch],
					},
				},
				{}
			)
			if (userAvailabilities.length === 0) {
				return responses.successResponse({
					statusCode: httpStatusCode.ok,
					message: 'AVAILABILITIES_FETCHED',
					result: {
						is_available: false,
					},
				})
			}

			// Filter out recurring events and generate instances within the date range
			const start = performance.now()
			userAvailabilities = buildUserAvailabilities({
				startEpoch: query.startEpoch,
				endEpoch: query.endEpoch,
				userAvailabilities: userAvailabilities,
			})

			const end = performance.now()

			let updatedAvailabilities = userAvailabilities
			if (sessions && process.env.MULTIPLE_BOOKING === 'false') {
				updatedAvailabilities = this.updateAvailabilities(sessions, userAvailabilities)
				updatedAvailabilities = this.filterAvailabilitiesByMinimumDuration(updatedAvailabilities)
			}

			const available_users = updatedAvailabilities.map(({ user_id }) => user_id)

			const userDetails = await menteeQueries.getUsersByUserIds(
				available_users,
				{
					attributes: ['user_id', 'name', 'email'],
				},
				tenantCode,
				true
			)

			return responses.successResponse({
				statusCode: httpStatusCode.ok,
				message: 'AVAILABILITIES_FETCHED',
				result: userDetails,
			})
		} catch (error) {
			throw error
		}
	}
}
