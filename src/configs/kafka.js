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
	console.log('🚀 [KAFKA] ===== STARTING KAFKA CONFIGURATION =====')
	console.log('🚀 [KAFKA] Environment variables:')
	console.log('🚀 [KAFKA]   KAFKA_URL:', process.env.KAFKA_URL)
	console.log('🚀 [KAFKA]   KAFKA_GROUP_ID:', process.env.KAFKA_GROUP_ID)
	console.log('🚀 [KAFKA]   EVENTS_TOPIC:', process.env.EVENTS_TOPIC)
	console.log('🚀 [KAFKA]   CLEAR_INTERNAL_CACHE:', process.env.CLEAR_INTERNAL_CACHE)

	const kafkaIps = process.env.KAFKA_URL.split(',')
	console.log('🚀 [KAFKA] Kafka brokers:', kafkaIps)

	const KafkaClient = new Kafka({
		clientId: 'mentoring',
		brokers: kafkaIps,
	})

	console.log('🚀 [KAFKA] Creating producer...')
	const producer = KafkaClient.producer()
	await producer.connect()
	console.log('🚀 [KAFKA] Producer connected successfully')

	producer.on('producer.connect', () => {
		logger.info('KafkaProvider: connected')
		console.log('🚀 [KAFKA] Producer event: connected')
	})
	producer.on('producer.disconnect', () => {
		logger.error('KafkaProvider: could not connect', {
			triggerNotification: true,
		})
		console.log('🚀 [KAFKA] Producer event: disconnected')
	})

	global.kafkaProducer = producer
	global.kafkaClient = KafkaClient

	console.log('🚀 [KAFKA] Starting consumer...')
	startConsumer(KafkaClient).catch((err) => {
		console.log('🚀 [KAFKA] ❌ Consumer failed to start:', err?.message || err)
		logger.error('Kafka consumer failed to start', { err: err?.stack || err?.message })
	})
	console.log('🚀 [KAFKA] ===== KAFKA CONFIGURATION COMPLETED =====')
}

async function startConsumer(kafkaClient) {
	console.log('📥 [KAFKA CONSUMER] ===== STARTING CONSUMER =====')
	const consumer = kafkaClient.consumer({ groupId: process.env.KAFKA_GROUP_ID })
	console.log('📥 [KAFKA CONSUMER] Consumer created with group ID:', process.env.KAFKA_GROUP_ID)

	console.log('📥 [KAFKA CONSUMER] Connecting consumer...')
	await consumer.connect()
	console.log('📥 [KAFKA CONSUMER] ✅ Consumer connected successfully')

	const topics = [process.env.EVENTS_TOPIC, process.env.CLEAR_INTERNAL_CACHE].filter(Boolean)
	console.log('📥 [KAFKA CONSUMER] Subscribing to topics:', topics)
	await consumer.subscribe({ topics })
	console.log('📥 [KAFKA CONSUMER] ✅ Subscribed to topics successfully')

	console.log('📥 [KAFKA CONSUMER] Starting consumer run loop...')
	await consumer.run({
		eachMessage: async ({ topic, partition, message }) => {
			console.log('📥 [KAFKA CONSUMER] ===== MESSAGE RECEIVED =====')
			console.log('📥 [KAFKA CONSUMER] Topic:', topic)
			console.log('📥 [KAFKA CONSUMER] Partition:', partition)
			console.log('📥 [KAFKA CONSUMER] Offset:', message.offset)
			console.log('📥 [KAFKA CONSUMER] Message size:', message.value?.length || 0, 'bytes')

			try {
				const rawValue = message.value?.toString()
				const offset = message.offset

				if (!rawValue) {
					console.log('📥 [KAFKA CONSUMER] ⚠️ Empty message, skipping')
					logger.warn(`Empty Kafka message skipped on topic ${topic}`)
					return
				}

				let payload
				try {
					payload = JSON.parse(rawValue)
					console.log('📥 [KAFKA CONSUMER] Parsed payload:')
					console.log('📥 [KAFKA CONSUMER]   Entity:', payload.entity)
					console.log('📥 [KAFKA CONSUMER]   Event Type:', payload.eventType)
					console.log('📥 [KAFKA CONSUMER]   Entity ID:', payload.entityId)
					console.log('📥 [KAFKA CONSUMER]   Tenant Code:', payload.tenant_code)
				} catch (e) {
					console.log('📥 [KAFKA CONSUMER] ❌ Invalid JSON, skipping message')
					logger.warn('Invalid JSON in Kafka message; skipping', {
						topic,
						partition,
						offset,
						err: e?.message,
					})
					return
				}

				let response
				console.log('📥 [KAFKA CONSUMER] Checking message routing...')
				console.log('📥 [KAFKA CONSUMER] Topic matches EVENTS_TOPIC?', topic === process.env.EVENTS_TOPIC)

				if (payload && topic === process.env.EVENTS_TOPIC) {
					console.log('📥 [KAFKA CONSUMER] Processing user/organization event...')

					if (payload.eventType === 'roleChange') {
						console.log('📥 [KAFKA CONSUMER] 🔄 Processing ROLE CHANGE event')
						response = await rolechangeConsumer.messageReceived(payload)
					}
					if (payload.eventType === 'create' || payload.eventType === 'bulk-create') {
						console.log('📥 [KAFKA CONSUMER] 👤 Processing USER CREATE event')
						response = await createuserConsumer.messageReceived(payload)
					}
					if (payload.eventType === 'delete') {
						console.log('📥 [KAFKA CONSUMER] 🗑️ Processing USER DELETE event')
						response = await deleteuserConsumer.messageReceived(payload)
					}
					if (payload.eventType === 'update' || payload.eventType === 'bulk-update') {
						console.log('📥 [KAFKA CONSUMER] ✏️ Processing USER UPDATE event')
						response = await updateuserConsumer.messageReceived(payload)
					}
					// Handle organization events
					if (
						payload.entity === 'organization' &&
						(payload.eventType === 'create' ||
							payload.eventType === 'update' ||
							payload.eventType === 'deactivate')
					) {
						console.log('📥 [KAFKA CONSUMER] 🏢 Processing ORGANIZATION event')
						response = await organizationConsumer.messageReceived(payload)
					}
				}
				if (payload && topic === process.env.CLEAR_INTERNAL_CACHE) {
					console.log('📥 [KAFKA CONSUMER] 🧹 Processing CACHE CLEAR event')
					if (payload.type === 'CLEAR_INTERNAL_CACHE') {
						response = await utils.internalDel(payload.value)
					}
				}

				console.log('📥 [KAFKA CONSUMER] Event processing completed')
				console.log('📥 [KAFKA CONSUMER] Response:', response || 'No response')
				console.log('📥 [KAFKA CONSUMER] ===== MESSAGE PROCESSED =====')

				logger.info(`Kafka event handling response : ${response}`)
			} catch (err) {
				console.log('📥 [KAFKA CONSUMER] ❌ ERROR processing message:', err.message)
				console.log('📥 [KAFKA CONSUMER] ❌ Error stack:', err.stack)
				logger.error(`Error in Kafka message handler for topic ${topic}`, {
					topic,
					partition,
					offset,
					err: err?.stack || err?.message || String(err),
				})
			}
		},
	})
	console.log('📥 [KAFKA CONSUMER] ✅ Consumer is now running and listening for messages')
}
