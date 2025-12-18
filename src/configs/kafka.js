/**
 * name : configs/kafka
 * author : Aman Gupta
 * Date : 07-Dec-2021
 * Description : Kafka connection configurations
 */

const utils = require('@generics/utils')
const { elevateLog } = require('elevate-logger')
const logger = elevateLog.init()
const { Kafka } = require('kafkajs')
const deleteuserConsumer = require('@generics/kafka/consumers/deleteuser')
const rolechangeConsumer = require('@generics/kafka/consumers/rolechange')
const createuserConsumer = require('@generics/kafka/consumers/createuser')
const updateuserConsumer = require('@generics/kafka/consumers/updateuser')
const organizationConsumer = require('@generics/kafka/consumers/organization')

module.exports = async () => {
	const kafkaIps = process.env.KAFKA_URL.split(',')
	const KafkaClient = new Kafka({
		clientId: 'mentoring',
		brokers: kafkaIps,
	})

	const producer = KafkaClient.producer()
	await producer.connect()

	producer.on('producer.connect', () => {
		logger.info('KafkaProvider: connected')
	})
	producer.on('producer.disconnect', () => {
		logger.error('KafkaProvider: could not connect', {
			triggerNotification: true,
		})
	})

	global.kafkaProducer = producer
	global.kafkaClient = KafkaClient

	startConsumer(KafkaClient).catch((err) =>
		logger.error('Kafka consumer failed to start', { err: err?.stack || err?.message })
	)
}

async function startConsumer(kafkaClient) {
	const consumer = kafkaClient.consumer({ groupId: process.env.KAFKA_GROUP_ID })

	await consumer.connect()
	await consumer.subscribe({ topics: [process.env.EVENTS_TOPIC, process.env.CLEAR_INTERNAL_CACHE] })

	await consumer.run({
		eachMessage: async ({ topic, partition, message }) => {
			try {
				const rawValue = message.value?.toString()
				const offset = message.offset
				if (!rawValue) {
					logger.warn(`Empty Kafka message skipped on topic ${topic}`)
					return
				}

				let payload
				try {
					payload = JSON.parse(rawValue)
				} catch (e) {
					logger.warn('Invalid JSON in Kafka message; skipping', {
						topic,
						partition,
						offset,
						err: e?.message,
					})
					return
				}

				let response
				if (payload && topic === process.env.EVENTS_TOPIC) {
					if (payload.eventType === 'roleChange') {
						response = await rolechangeConsumer.messageReceived(payload)
					}
					if (payload.eventType === 'create' || payload.eventType === 'bulk-create') {
						response = await createuserConsumer.messageReceived(payload)
					}
					if (payload.eventType === 'delete') {
						response = await deleteuserConsumer.messageReceived(payload)
					}
					if (payload.eventType === 'update' || payload.eventType === 'bulk-update') {
						response = await updateuserConsumer.messageReceived(payload)
					}
					// Handle organization events
					if (
						payload.entity === 'organization' &&
						(payload.eventType === 'create' ||
							payload.eventType === 'update' ||
							payload.eventType === 'deactivate')
					) {
						response = await organizationConsumer.messageReceived(payload)
					}
				}
				if (payload && topic === process.env.CLEAR_INTERNAL_CACHE) {
					if (payload.type === 'CLEAR_INTERNAL_CACHE') {
						response = await utils.internalDel(payload.value)
					}
				}
				logger.info(`Kafk event handling response : ${response}`)
			} catch (err) {
				logger.error(`Error in Kafka message handler for topic ${topic}`, {
					topic,
					partition,
					offset,
					err: err?.stack || err?.message || String(err),
				})
			}
		},
	})
}
