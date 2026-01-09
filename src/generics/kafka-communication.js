/**
 * name : generics/kafka-communication
 * author : Aman Gupta
 * Date : 08-Nov-2021
 * Description : Kafka producer methods
 */

const emailEncryption = require('@utils/emailEncryption')

const pushEmailToKafka = async (message) => {
	try {
		if (message.email && message.email.to) {
			const decryptData = await emailEncryption.decryptAndValidate(message.email.to)
			if (decryptData) {
				message.email.to = decryptData
			}
		}
		const payload = { topic: process.env.NOTIFICATION_KAFKA_TOPIC, messages: [{ value: JSON.stringify(message) }] }
		console.log('KAKFA PAYLOAD: ', payload)
		return await pushPayloadToKafka(payload)
	} catch (error) {
		console.log(error)
		throw error
	}
}

const clearInternalCache = async (key) => {
	try {
		const payload = {
			topic: process.env.CLEAR_INTERNAL_CACHE,
			messages: [{ value: JSON.stringify({ value: key, type: 'CLEAR_INTERNAL_CACHE' }) }],
		}

		return await pushPayloadToKafka(payload)
	} catch (error) {
		throw error
	}
}

const pushPayloadToKafka = async (payload) => {
	try {
		console.log('sending kafka message from service ', payload)
		let response = await kafkaProducer.send(payload)
		console.log('kafka response for   ', response)
		return response
	} catch (error) {
		return error
	}
}

const pushUncachedUsersToKafka = async (users) => {
	try {
		if (!users || !Array.isArray(users) || users.length === 0) {
			throw new Error('Invalid users parameter: must be a non-empty array')
		}
		const payload = {
			topic: process.env.EVENTS_TOPIC,
			messages: [{ value: JSON.stringify({ eventType: 'readUser', users }) }],
		}
		const response = await pushPayloadToKafka(payload)
		if (response instanceof Error) {
			throw response
		}
		return response
	} catch (error) {
		console.log(error)
		throw error
	}
}
module.exports = {
	pushEmailToKafka,
	clearInternalCache,
	pushUncachedUsersToKafka,
}
