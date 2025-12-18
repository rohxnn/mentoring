const orgService = require('@services/organization')
const orgAdminService = require('@services/org-admin')

var messageReceived = function (message) {
	return new Promise(async function (resolve, reject) {
		try {
			const {
				entity,
				eventType,
				entityId,
				tenant_code,
				oldValues,
				newValues,
				code,
				name,
				created_by,
				updated_by,
				description,
				status,
			} = message

			// Only process organization events
			if (entity !== 'organization') {
				console.warn(`Non-organization entity received: ${entity}`)
				return resolve(`Skipped non-organization entity: ${entity}`)
			}

			switch (eventType) {
				case 'create':
					// Use existing createOrgExtension method from organization service
					const createEventBody = {
						entityId: entityId.toString(),
						organization_code: code,
						name: name,
						description: description,
						status: status,
						created_by: created_by || 'system',
					}
					await orgService.createOrgExtension(createEventBody, tenant_code)
					break

				case 'update':
					// Check if it's a related org change
					if (
						oldValues &&
						newValues &&
						(oldValues.related_orgs !== undefined || newValues.related_orgs !== undefined)
					) {
						const oldRelatedOrgs = oldValues.related_orgs || []
						const newRelatedOrgs = newValues.related_orgs || []

						// Find added orgs (in new but not in old)
						const addedOrgs = newRelatedOrgs.filter((id) => !oldRelatedOrgs.includes(id))
						// Find removed orgs (in old but not in new)
						const removedOrgs = oldRelatedOrgs.filter((id) => !newRelatedOrgs.includes(id))

						// Handle added related orgs
						if (addedOrgs.length > 0) {
							const addedOrgIds = addedOrgs.map((id) => id.toString())
							await orgAdminService.updateRelatedOrgs(
								addedOrgIds,
								entityId.toString(),
								'push', // Add action
								tenant_code
							)
						}

						// Handle removed related orgs
						if (removedOrgs.length > 0) {
							const removedOrgIds = removedOrgs.map((id) => id.toString())
							await orgAdminService.updateRelatedOrgs(
								removedOrgIds,
								entityId.toString(),
								'pop', // Remove action
								tenant_code
							)
						}
					}

					// Handle regular organization update (name, description, etc.)
					if (newValues && (newValues.name || newValues.description)) {
						const updateEventBody = {
							entityId: entityId.toString(),
							organization_code: code,
							name: newValues.name || name,
							description: newValues.description || description,
							updated_by: updated_by || created_by || 'system',
						}
						await orgService.createOrgExtension(updateEventBody, tenant_code)
					}
					break

				case 'deactivate':
					// Handle organization deactivation
					console.log(`Organization deactivation event received for org ${entityId}`)
					const deactivateEventBody = {
						entityId: entityId.toString(),
						organization_code: code,
						name: name,
						status: status, // This will be 'INACTIVE' from the event
						is_active: false,
						updated_by: updated_by || 'system',
					}
					await orgService.createOrgExtension(deactivateEventBody, tenant_code)
					break

				default:
					console.warn(`Unknown organization event type: ${eventType}`)
					return resolve(`Unknown event type: ${eventType}`)
			}

			return resolve(`Organization ${eventType} event processed for entity ${entityId}`)
		} catch (error) {
			console.error(`Error processing organization event: ${error.message}`, {
				eventType: message.eventType,
				entityId: message.entityId,
				tenant_code: message.tenant_code,
				error: error.stack,
			})
			return reject(error)
		}
	})
}

var errorTriggered = function (error) {
	return new Promise(function (resolve, reject) {
		try {
			console.error('Organization Kafka consumer error:', error)
			return resolve('Organization Error Processed')
		} catch (error) {
			return reject(error)
		}
	})
}

module.exports = {
	messageReceived: messageReceived,
	errorTriggered: errorTriggered,
}
