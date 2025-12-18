// Dependencies
const _ = require('lodash')
const utils = require('@generics/utils')
const httpStatusCode = require('@generics/http-status')
const fs = require('fs')
const path = require('path')
const csv = require('csvtojson')
const axios = require('axios')
const common = require('@constants/common')
const userRequests = require('@requests/user')
const sessionService = require('@services/sessions')
const ProjectRootDir = path.join(__dirname, '../')
const fileUploadQueries = require('@database/queries/fileUpload')
const kafkaCommunication = require('@generics/kafka-communication')
const { getDefaults } = require('@helpers/getDefaultOrgId')
const sessionQueries = require('@database/queries/sessions')
const entityTypeCache = require('@helpers/entityTypeCache')
const { Op } = require('sequelize')
const moment = require('moment')
const inviteeFileDir = ProjectRootDir + common.tempFolderForBulkUpload
const menteeExtensionQueries = require('@database/queries/userExtension')
const uploadToCloud = require('@helpers/uploadFileToCloud')
const cacheHelper = require('@generics/cacheHelper')

module.exports = class UserInviteHelper {
	static async uploadSession(data) {
		return new Promise(async (resolve, reject) => {
			try {
				const filePath = data.fileDetails.input_path
				const userId = data.user.userId
				const orgId = data.user.organization_id
				const tenant_code = data.user.tenant_code
				const notifyUser = true
				const tenantCode = data.user.tenant_code
				const orgCode = String(data.user.organization_code)
				const defaultOrgCode = data.user.defaultOrganiztionCode
				const defaultTenantCode = data.user.defaultTenantCode

				const mentor = await cacheHelper.mentee.get(tenantCode, orgCode, userId)
				if (!mentor) throw createUnauthorizedResponse('USER_NOT_FOUND')

				const isMentor = mentor.is_mentor

				// download file to local directory
				const response = await this.downloadCSV(filePath)
				if (!response.success) throw new Error('FAILED_TO_DOWNLOAD')

				// extract data from csv
				const parsedFileData = await this.extractDataFromCSV(response.result.downloadPath)
				if (!parsedFileData.success) throw new Error('FAILED_TO_READ_CSV')
				const invitees = parsedFileData.result.data

				// create outPut file and create invites
				const createResponse = await this.processSessionDetails(
					invitees,
					inviteeFileDir,
					userId,
					orgId,
					notifyUser,
					isMentor,
					tenantCode,
					orgCode,
					defaultOrgCode,
					defaultTenantCode
				)
				if (createResponse.success == false) console.log(':::::::::', createResponse.message)
				const outputFilename = path.basename(createResponse.result.outputFilePath)
				// upload output file to cloud
				const uploadRes = await uploadToCloud.uploadFileToCloud(outputFilename, inviteeFileDir, userId, orgId)
				const output_path = uploadRes.result.uploadDest
				const update = {
					output_path,
					updated_by: userId,
					status:
						createResponse.result.isErrorOccured == true ? common.STATUS.FAILED : common.STATUS.PROCESSED,
				}
				//update output path in file uploads
				const rowsAffected = await fileUploadQueries.update(
					{ id: data.fileDetails.id, organization_id: orgId },
					tenantCode,
					update
				)
				if (rowsAffected === 0) {
					throw new Error('FILE_UPLOAD_MODIFY_ERROR')
				}

				// send email to admin
				const templateCode = process.env.SESSION_UPLOAD_EMAIL_TEMPLATE_CODE
				if (templateCode) {
					const defaults = await getDefaults()
					if (!defaults.orgCode)
						return resolve(
							responses.failureResponse({
								message: 'DEFAULT_ORG_CODE_NOT_SET',
								statusCode: httpStatusCode.bad_request,
								responseCode: 'CLIENT_ERROR',
							})
						)
					if (!defaults.tenantCode)
						return resolve(
							responses.failureResponse({
								message: 'DEFAULT_TENANT_CODE_NOT_SET',
								statusCode: httpStatusCode.bad_request,
								responseCode: 'CLIENT_ERROR',
							})
						)

					const orgCodes = [data.user.organization_code, defaults.orgCode]
					const tenantCodes = [tenantCode, defaults.tenantCode]
					// send mail to mentors on session creation if session created by manager
					const templateData = await cacheHelper.notificationTemplates.get(
						tenantCode,
						data.user.organization_code,
						templateCode
					)

					if (templateData) {
						const sessionUploadURL = await utils.getDownloadableUrl(output_path)
						await this.sendSessionManagerEmail(templateData, data.user, sessionUploadURL) //Rename this to function to generic name since this function is used for both Invitee & Org-admin.
					}
				}

				// delete the downloaded file and output file.
				utils.clearFile(response.result.downloadPath)
				utils.clearFile(createResponse.result.outputFilePath)

				return resolve({
					success: true,
					message: 'CSV_UPLOADED_SUCCESSFULLY',
				})
			} catch (error) {
				console.log(error, 'CSV PROCESSING ERROR')
				return reject({
					success: false,
					message: error.message,
				})
			}
		})
	}

	static async downloadCSV(filePath) {
		try {
			const downloadableUrl = await utils.getDownloadableUrl(filePath)
			let fileName = path.basename(downloadableUrl)

			// Find the index of the first occurrence of '?'
			const index = fileName.indexOf('?')
			// Extract the portion of the string before the '?' if it exists, otherwise use the entire string
			fileName = index !== -1 ? fileName.substring(0, index) : fileName
			const downloadPath = path.join(inviteeFileDir, fileName)
			const response = await axios.get(downloadableUrl, {
				responseType: common.responseType,
			})

			const writeStream = fs.createWriteStream(downloadPath)
			response.data.pipe(writeStream)

			await new Promise((resolve, reject) => {
				writeStream.on('finish', resolve)
				writeStream.on('error', (err) => {
					reject(new Error('FAILED_TO_DOWNLOAD_FILE'))
				})
			})

			return {
				success: true,
				result: {
					destPath: inviteeFileDir,
					fileName,
					downloadPath,
				},
			}
		} catch (error) {
			return {
				success: false,
				message: error.message,
			}
		}
	}

	static async appendWithComma(existingMessagePromise, newMessage) {
		const existingMessage = await existingMessagePromise
		if (existingMessage) {
			return `${existingMessage}, ${newMessage}`
		} else {
			return newMessage
		}
	}

	static async extractDataFromCSV(csvFilePath) {
		try {
			const parsedCSVData = []
			let csvToJsonData = await csv().fromFile(csvFilePath)

			// Filter out empty rows
			csvToJsonData = csvToJsonData.filter((row) => Object.values(row).some((value) => value.trim() !== ''))

			for (const row of csvToJsonData) {
				const {
					Action: action,
					id,
					title,
					description,
					type,
					'Mentor(Email)': mentor_id,
					'Mentees(Email)': mentees,
					'Date(DD-MM-YYYY)': date,
					'Time Zone(IST/UTC)': time_zone,
					'Time (24 hrs)': time24hrs,
					'Duration(Min)': duration,
					recommended_for,
					categories,
					medium,
					'Meeting Platform': meetingPlatform,
					'Meeting Link': meetingLinkOrId,
					'Meeting Passcode (if needed)': meetingPasscode,
					...customFields // Capture any additional fields
				} = row

				const menteesList = mentees
					? mentees
							.replace(/"/g, '')
							.split(',')
							.map((item) => item.trim())
					: []
				const recommendedList = recommended_for
					? recommended_for
							.replace(/"/g, '')
							.split(',')
							.map((item) => item.trim())
					: []
				const categoriesList = categories
					? categories
							.replace(/"/g, '')
							.split(',')
							.map((item) => item.trim())
					: []
				const mediumList = medium
					? medium
							.replace(/"/g, '')
							.split(',')
							.map((item) => item.trim())
					: []

				const meetingInfo = {
					platform: meetingPlatform,
					value: '',
					link: meetingLinkOrId || '',
					meta: {
						password: meetingPasscode || '',
					},
				}

				const parsedRow = {
					action,
					id,
					title,
					description,
					type,
					mentor_id,
					mentees: menteesList,
					date,
					time_zone,
					time24hrs,
					duration,
					recommended_for: recommendedList,
					categories: categoriesList,
					medium: mediumList,
					meeting_info: meetingInfo,
				}

				// Transform custom fields into an array format
				const customEntities = utils.transformCustomFields(customFields)
				// Conditionally add custom_entities if there are any custom fields
				if (Object.keys(customEntities).length > 0) {
					parsedRow.custom_entities = customEntities
				}

				parsedCSVData.push(parsedRow)
				parsedCSVData

				if (action.toUpperCase() !== common.DELETE_METHOD) {
					const platformNameRegex = common.PLATFORMS_REGEX
					const zoomMeetingRegex = common.ZOOM_REGEX
					const lastEntry = parsedCSVData[parsedCSVData.length - 1]
					const meetingName = meetingPlatform ? meetingPlatform.toLowerCase().replace(/\s+/g, '') : ''
					const setMeetingInfo = (label, value, meta = {}, link) => {
						lastEntry.meeting_info = { platform: label, value: value, meta: meta, link: meetingLinkOrId }
					}
					const processStatusMessage = async (statusMessage, message) => {
						return statusMessage ? `${statusMessage}, ${message}` : message
					}
					const processInvalidLink = async (statusMessage, message) =>
						await processStatusMessage(statusMessage, message)
					//Zoom Validation
					const validateZoom = async () => {
						const match = meetingLinkOrId.match(zoomMeetingRegex)
						const platformName = match ? match[1] : ''
						const meetingId = match ? match[2] : ''
						if (platformName === common.MEETING_VALUES.ZOOM_VALUE || !meetingLinkOrId) {
							setMeetingInfo(common.MEETING_VALUES.ZOOM_LABEL, common.MEETING_VALUES.ZOOM_LABEL, {
								meetingId: meetingId,
								password: `${meetingPasscode}`,
							})
						} else {
							lastEntry.status = 'Invalid'
							lastEntry.statusMessage = await processInvalidLink(lastEntry.statusMessage, 'Invalid Link')
						}
					}
					//WhatsApp Validation
					const validateWhatsApp = async () => {
						const match = meetingLinkOrId.match(platformNameRegex)
						const platformName = match ? match[1] : ''

						if (platformName === common.MEETING_VALUES.WHATSAPP_VALUE || !meetingLinkOrId) {
							setMeetingInfo(common.MEETING_VALUES.WHATSAPP_LABEL, common.MEETING_VALUES.WHATSAPP_LABEL)
						} else {
							lastEntry.status = 'Invalid'
							lastEntry.statusMessage = await processInvalidLink(lastEntry.statusMessage, 'Invalid Link')
						}
					}
					//GoogleMeet Validation
					const validateGoogleMeet = async () => {
						const match = meetingLinkOrId.match(platformNameRegex)
						const platformName = match ? match[1] : ''

						if (platformName === common.MEETING_VALUES.GOOGLE_PLATFORM || !meetingLinkOrId) {
							setMeetingInfo(common.MEETING_VALUES.GOOGLE_LABEL, common.MEETING_VALUES.GOOGLE_VALUE)
						} else {
							lastEntry.status = 'Invalid'
							lastEntry.statusMessage = await processInvalidLink(lastEntry.statusMessage, 'Invalid Link')
						}
					}
					//BBB Validation
					const validateBBB = async () => {
						if (!meetingLinkOrId) {
							if (process.env.DEFAULT_MEETING_SERVICE === common.BBB_VALUE) {
								setMeetingInfo(common.MEETING_VALUES.BBB_LABEL, common.BBB_VALUE)
							} else {
								setMeetingInfo(process.env.DEFAULT_MEETING_SERVICE, process.env.DEFAULT_MEETING_SERVICE)
								lastEntry.statusMessage = await processInvalidLink(
									lastEntry.statusMessage,
									'Set Meeting Later'
								)
							}
						} else {
							lastEntry.status = 'Invalid'
							lastEntry.statusMessage = await processInvalidLink(
								lastEntry.statusMessage,
								'Link should be empty for Big Blue Button'
							)
						}
					}
					//Default Validation
					const validateDefaultBBB = async () => {
						setMeetingInfo('', '')
						if (process.env.DEFAULT_MEETING_SERVICE !== common.BBB_VALUE) {
							lastEntry.statusMessage = await processInvalidLink(
								lastEntry.statusMessage,
								'Set Meeting Later'
							)
						}
					}
					//Platform Validation
					const validateNoPlatformWithLink = async () => {
						lastEntry.status = 'Invalid'
						lastEntry.statusMessage = await processInvalidLink(
							lastEntry.statusMessage,
							'Platform is not filled'
						)
					}
					//Invalid Platform Validation
					const validateInvalidPlatform = async () => {
						lastEntry.status = 'Invalid'
						lastEntry.statusMessage = await processInvalidLink(
							lastEntry.statusMessage,
							'Invalid Meeting Platform'
						)
					}
					//Validating logic using switch case
					const validateMeetingLink = async () => {
						switch (true) {
							case meetingName.includes(common.MEETING_VALUES.ZOOM_VALUE):
								await validateZoom()
								break
							case meetingName.includes(common.MEETING_VALUES.WHATSAPP_VALUE):
								await validateWhatsApp()
								break
							case common.MEETING_VALUES.GOOGLE_MEET_VALUES.some((value) => meetingName.includes(value)):
								await validateGoogleMeet()
								break
							case common.MEETING_VALUES.BBB_PLATFORM_VALUES.some((value) => meetingName.includes(value)):
								await validateBBB()
								break
							case !meetingLinkOrId && !meetingName:
								validateDefaultBBB()
								break
							case !meetingName && meetingLinkOrId:
								await validateNoPlatformWithLink()
								break
							default:
								await validateInvalidPlatform()
								break
						}
					}
					await validateMeetingLink()
				}
			}
			return {
				success: true,
				result: { data: parsedCSVData },
			}
		} catch (error) {
			return {
				success: false,
				message: error.message,
			}
		}
	}

	static async processCustomEntities(session) {
		let { custom_entities, ...restOfSession } = session
		// Add each key-value pair from custom_entities to the main session object
		if (custom_entities) {
			for (const [key, value] of Object.entries(custom_entities)) {
				restOfSession[key] = value
			}
		}
		return { ...restOfSession, custom_entities }
	}

	static async processSession(session, userId, orgCode, validRowsCount, invalidRowsCount, tenantCode) {
		const requiredFields = [
			'action',
			'title',
			'description',
			'date',
			'type',
			'mentor_id',
			'time_zone',
			'time24hrs',
			'duration',
			'medium',
			'recommended_for',
			'categories',
			'meeting_info',
		]

		const missingFields = requiredFields.filter(
			(field) => !session[field] || (Array.isArray(session[field]) && session[field].length === 0)
		)
		if (missingFields.length > 0) {
			session.status = 'Invalid'
			session.statusMessage = this.appendWithComma(
				session.statusMessage,
				` Mandatory fields ${missingFields.join(', ')} not filled`
			)
			if (session.type.toUpperCase() === common.SESSION_TYPE.PRIVATE && session.mentees.length === 0) {
				session.statusMessage = this.appendWithComma(
					session.statusMessage,
					'Mentees not filled for private session'
				)
			}
			invalidRowsCount++
		} else {
			if (session.status != 'Invalid') {
				validRowsCount++
				session.status = 'Valid'
			}
			const validateField = (field, fieldName) => {
				if (!common.STRING_NUMERIC_REGEX.test(field)) {
					session.status = 'Invalid'
					session.statusMessage = this.appendWithComma(
						session.statusMessage,
						`${fieldName} can only contain alphanumeric characters`
					)
				}
			}
			validateField(session.title, 'title')
			validateField(session.description, 'description')
			validateField(session.recommended_for, 'recommended_for')
			validateField(session.categories, 'categories')
			validateField(session.medium, 'medium')
			validateField(session.time24hrs, 'time24hrs')

			if (session.custom_entities && Object.keys(session.custom_entities).length) {
				session = await this.processCustomEntities(session)
			}

			if (!common.NUMERIC_REGEX.test(session.duration)) {
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(session.statusMessage, 'Invalid Duration')
			}

			if (session.time_zone != common.TIMEZONE && session.time_zone != common.TIMEZONE_UTC) {
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(session.statusMessage, 'Invalid TimeZone')
			}
			const { date, time_zone, time24hrs } = session
			const time = time24hrs.replace(' Hrs', '')
			const dateTimeString = date + ' ' + time
			const timeZone = time_zone == common.TIMEZONE ? common.IST_TIMEZONE : common.UTC_TIMEZONE
			const momentFromJSON = moment.tz(dateTimeString, common.CSV_DATE_FORMAT, timeZone)
			const currentMoment = moment().tz(timeZone)
			const isDateValid = momentFromJSON.isSameOrAfter(currentMoment, 'day')
			if (isDateValid) {
				const differenceTime = momentFromJSON.unix() - currentMoment.unix()
				if (differenceTime >= 0) {
					session.start_date = momentFromJSON.unix()
					const momentEndDateTime = momentFromJSON.add(session.duration, 'minutes')
					session.end_date = momentEndDateTime.unix()
				} else {
					session.status = 'Invalid'
					session.statusMessage = this.appendWithComma(session.statusMessage, ' Invalid Time')
				}
			} else {
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(session.statusMessage, ' Invalid Date')
			}

			if (session.mentees.length != 0 && Array.isArray(session.mentees)) {
				const validEmails = await this.validateAndCategorizeEmails(session)
				if (validEmails.length != 0) {
					const menteeDetails = await userRequests.getListOfUserDetailsByEmail(validEmails, tenantCode)
					session.mentees = menteeDetails.result
				} else if (session.mentees.some((item) => typeof item === 'string')) {
					session.statusMessage = this.appendWithComma(session.statusMessage, ' Mentee Details are incorrect')
				}
			}
			const containsUserId = session.mentees.includes(userId)
			if (!containsUserId && session.mentees.length > process.env.SESSION_MENTEE_LIMIT) {
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(
					session.statusMessage,
					` Only ${process.env.SESSION_MENTEE_LIMIT} mentees are allowed`
				)
			} else if (containsUserId && session.mentees.length > process.env.SEESION_MANAGER_AND_MENTEE_LIMIT) {
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(
					session.statusMessage,
					`Only ${process.env.SESSION_MENTEE_LIMIT} mentees are allowed`
				)
			}
			const emailArray = session.mentor_id.split(',')
			if (session.mentor_id && emailArray.length === 1) {
				const mentorEmail = session.mentor_id.replace(/\s+/g, '').toLowerCase()
				if (!common.EMAIL_REGEX.test(mentorEmail)) {
					session.status = 'Invalid'
					session.statusMessage = this.appendWithComma(session.statusMessage, 'Invalid Mentor Email')
				} else {
					const mentorId = await userRequests.getListOfUserDetailsByEmail([mentorEmail], tenantCode)
					const mentor_Id = mentorId.result[0]

					if (isNaN(mentor_Id)) {
						session.status = 'Invalid'
						session.statusMessage = this.appendWithComma(session.statusMessage, 'Invalid Mentor Email')
						session.mentor_id = mentor_Id
					} else {
						session.mentor_id = mentor_Id
					}
				}
			} else {
				session.status = 'Invalid'
				const message = emailArray.length != 1 ? 'Multiple Mentor Emails Not Allowed' : 'Empty Mentor Email'
				session.statusMessage = this.appendWithComma(session.statusMessage, message)
			}

			if (
				session.type.toUpperCase() === common.SESSION_TYPE.PRIVATE &&
				!session.mentees.some((item) => !isNaN(item))
			) {
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(
					session.statusMessage,
					' At least one valid mentee should be for private session.'
				)
			}

			const sessionModelName = await sessionQueries.getModelName()

			const defaults = await getDefaults()
			if (!defaults.orgCode) {
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			if (!defaults.tenantCode) {
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let entityTypes = await entityTypeCache.getEntityTypesAndEntitiesForModel(
				sessionModelName,
				tenantCode,
				orgCode
			)
			const idAndValues = entityTypes.map((item) => ({
				value: item.value,
				entities: item.entities,
				org_Id: item.organization_id,
			}))
			await this.mapSessionToEntityValues(session, idAndValues)

			if (session.custom_entities) {
				const result = await this.validateCustomEntities(session, idAndValues, userId)
				if (!result.isValid) {
					session.status = 'Invalid'
					session.statusMessage = this.appendWithComma(session.statusMessage, result.message)
				} else {
					const validateContent = await this.validateCustomEntitiesContent(session)

					if (validateContent.emptyEntities.length !== 0) {
						session.status = 'Invalid'
						session.statusMessage = this.appendWithComma(
							session.statusMessage,
							` Mandatory field ${validateContent.emptyEntities} not filled`
						)
					} else if (validateContent.invalidEntities.length !== 0) {
						session.status = 'Invalid'
						session.statusMessage = this.appendWithComma(
							session.statusMessage,
							`${validateContent.invalidEntities} can only contain alphanumeric characters`
						)
					}
				}
			}

			if (session.meeting_info.link === '{}') {
				session.meeting_info.link = ''
			}
		}
		const processedSession = session
		return { validRowsCount, invalidRowsCount, processedSession }
	}

	static async mapSessionToEntityValues(session, entitiesList) {
		entitiesList.forEach((entityType) => {
			const sessionKey = entityType.value
			const sessionValues = session[sessionKey]

			if (Array.isArray(sessionValues)) {
				const entityValues = entityType.entities
				session[sessionKey] = sessionValues.map((sessionValue) => {
					const entity = entityValues.find((e) => e.label.toLowerCase() === sessionValue.toLowerCase())
					return entity ? entity.value : sessionValue
				})
			}
		})

		return session
	}

	static async validateCustomEntitiesContent(session) {
		const alphanumericRegex = common.STRING_NUMERIC_REGEX
		const emptyEntities = []
		const invalidEntities = []

		for (const key in session.custom_entities) {
			const entityArray = session.custom_entities[key]

			// Check if the entity array is empty
			if (entityArray.length === 0) {
				emptyEntities.push(key)
			}

			// Check if the entity array contains only alphanumeric values
			if (!entityArray.every((item) => alphanumericRegex.test(item))) {
				invalidEntities.push(key)
			}
		}

		return { emptyEntities, invalidEntities }
	}

	static async validateCustomEntities(session, idAndValues) {
		const customEntitiesKeys = Object.keys(session.custom_entities)
		const idAndValuesSet = new Set(idAndValues.map((item) => item.value))
		const invalidEntities = []

		for (const key of customEntitiesKeys) {
			if (!idAndValuesSet.has(key)) {
				invalidEntities.push(key)
			}
		}
		if (invalidEntities.length > 0) {
			return {
				isValid: false,
				message: `Not Allowed Custom_Entities: ${invalidEntities.join(', ')}`,
			}
		}
		return { isValid: true, message: 'All custom entities are valid.' }
	}

	static async validateAndCategorizeEmails(session) {
		const validEmails = []
		const invalidEmails = []

		for (const mentee of session.mentees) {
			const lowerCaseEmail = mentee.toLowerCase()
			if (common.EMAIL_REGEX.test(lowerCaseEmail)) {
				validEmails.push(lowerCaseEmail)
			} else {
				invalidEmails.push(mentee)
			}
		}
		session.mentees = invalidEmails
		return validEmails.length === 0 ? [] : validEmails
	}

	static async revertEntityValuesToOriginal(mappedSession, entitiesList) {
		entitiesList.forEach((entityType) => {
			const sessionKey = entityType.value
			const mappedValues = mappedSession[sessionKey]

			if (Array.isArray(mappedValues)) {
				const entityValues = entityType.entities
				mappedSession[sessionKey] = mappedValues.map((mappedValue) => {
					const entity = entityValues.find((e) => e.value === mappedValue)
					return entity ? entity.label : mappedValue
				})
			}
		})

		return mappedSession
	}

	static async processRows(sessionCreationOutput, idAndValues) {
		for (let row of sessionCreationOutput) {
			await this.revertEntityValuesToOriginal(row, idAndValues)
		}
	}

	static async processSessionDetails(
		csvData,
		sessionFileDir,
		userId,
		orgId,
		notifyUser,
		isMentor,
		tenantCode,
		orgCode,
		defaultOrgCode,
		defaultTenantCode
	) {
		try {
			const outputFileName = utils.generateFileName(common.sessionOutputFile, common.csvExtension)
			let rowsWithStatus = []
			let validRowsCount = 0
			let invalidRowsCount = 0
			for (const session of csvData) {
				if (session.action.replace(/\s+/g, '').toLowerCase() === common.ACTIONS.CREATE) {
					if (!session.id) {
						const {
							validRowsCount: valid,
							invalidRowsCount: invalid,
							processedSession,
						} = await this.processSession(
							session,
							userId,
							orgCode,
							validRowsCount,
							invalidRowsCount,
							tenantCode
						)
						validRowsCount = valid
						invalidRowsCount = invalid
						rowsWithStatus.push(processedSession)
					} else {
						session.status = 'Invalid'
						session.statusMessage = this.appendWithComma(session.statusMessage, 'Invalid Row Action')
						rowsWithStatus.push(session)
					}
				} else if (session.action.replace(/\s+/g, '').toLowerCase() === common.ACTIONS.EDIT) {
					if (!session.id) {
						session.statusMessage = this.appendWithComma(
							session.statusMessage,
							' Mandatory fields Session ID not filled'
						)
						session.status = 'Invalid'
						rowsWithStatus.push(session)
					} else {
						const {
							validRowsCount: valid,
							invalidRowsCount: invalid,
							processedSession,
						} = await this.processSession(
							session,
							userId,
							orgCode,
							validRowsCount,
							invalidRowsCount,
							tenantCode
						)
						validRowsCount = valid
						invalidRowsCount = invalid
						session.method = 'POST'
						rowsWithStatus.push(processedSession)
					}
				} else if (session.action.replace(/\s+/g, '').toLowerCase() === common.ACTIONS.DELETE) {
					if (!session.id) {
						session.statusMessage = this.appendWithComma(
							session.statusMessage,
							' Mandatory fields Session ID not filled'
						)
						session.status = 'Invalid'
						rowsWithStatus.push(session)
					} else {
						session.method = 'DELETE'
						rowsWithStatus.push(session)
					}
				} else {
					rowsWithStatus.push(session)
					session.status = 'Invalid'
					session.statusMessage = this.appendWithComma(session.statusMessage, ' Invalid Row Action')
				}

				if (session.statusMessage && typeof session.statusMessage != 'string') {
					session.statusMessage = await session.statusMessage.then((result) => result)
				}
			}

			const SessionBodyData = rowsWithStatus.map((item) => {
				const { custom_entities: customEntities, ...restOfSessionData } = item
				// Add each key-value pair from customEntities to the main session object
				if (customEntities) {
					for (const [entityKey, entityValue] of Object.entries(customEntities)) {
						restOfSessionData[entityKey] = entityValue
					}
				}
				return restOfSessionData
			})

			const sessionCreationOutput = await this.processCreateData(
				SessionBodyData,
				userId,
				orgId,
				isMentor,
				notifyUser,
				tenantCode,
				orgCode
			)

			await this.fetchMentorIds(sessionCreationOutput, tenantCode)

			const sessionModelName = await sessionQueries.getModelName()

			const defaults = await getDefaults()
			if (!defaults.orgCode) {
				return responses.failureResponse({
					message: 'DEFAULT_ORG_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}
			if (!defaults.tenantCode) {
				return responses.failureResponse({
					message: 'DEFAULT_TENANT_CODE_NOT_SET',
					statusCode: httpStatusCode.bad_request,
					responseCode: 'CLIENT_ERROR',
				})
			}

			let entityTypes = await entityTypeCache.getEntityTypesAndEntitiesForModel(
				sessionModelName,
				tenantCode,
				orgCode
			)
			const idAndValues = entityTypes.map((item) => ({
				value: item.value,
				entities: item.entities,
			}))

			await this.processRows(sessionCreationOutput, idAndValues)

			const modifiedCsv = sessionCreationOutput.map(
				({
					start_date,
					end_date,
					image,
					method,
					created_by,
					updated_by,
					mentor_name,
					custom_entity_text,
					mentor_organization_id,
					visibility,
					visible_to_organizations,
					mentee_feedback_question_set,
					mentor_feedback_question_set,
					meta,
					...rest
				}) => rest
			)

			const OutputCSVData = []
			modifiedCsv.forEach((row) => {
				const { meeting_info, status, statusMessage, ...restOfRow } = row // Destructure meeting_info, status, and statusMessage separately
				const mappedRow = {}

				Object.keys(restOfRow).forEach((key) => {
					let mappedKey = key // Default to the original key

					// Custom mapping for specific fields
					switch (key) {
						case 'mentor_id':
							mappedKey = 'Mentor(Email)'
							mappedRow[mappedKey] = restOfRow[key]
							break
						case 'mentees':
							mappedKey = 'Mentees(Email)'
							mappedRow[mappedKey] = restOfRow[key].join(', ')
							break
						case 'date':
							mappedKey = 'Date(DD-MM-YYYY)'
							mappedRow[mappedKey] = restOfRow[key]
							break
						case 'time_zone':
							mappedKey = 'Time Zone(IST/UTC)'
							mappedRow[mappedKey] = restOfRow[key]
							break
						case 'time24hrs':
							mappedKey = 'Time (24 hrs)'
							mappedRow[mappedKey] = restOfRow[key]
							break
						case 'duration':
							mappedKey = 'Duration(Min)'
							mappedRow[mappedKey] = restOfRow[key]
							break
						default:
							mappedRow[key] = restOfRow[key] // Use the original key
					}
				})

				if (meeting_info) {
					const meetingPlatform =
						meeting_info.platform === process.env.DEFAULT_MEETING_SERVICE
							? common.MEETING_VALUES.BBB_LABEL
							: meeting_info.platform
					const meetingLinkOrId = meeting_info.link
					let meetingPasscode = ''

					if (meetingPlatform === common.MEETING_VALUES.ZOOM_LABEL && meetingLinkOrId) {
						meetingPasscode = meeting_info.meta.password || ''
					}

					mappedRow['Meeting Platform'] = meetingPlatform
					mappedRow['Meeting Link'] = meetingLinkOrId
					mappedRow['Meeting Passcode (if needed)'] = meetingPasscode
				}

				// Append Status and Status Message at the end
				mappedRow['Status'] = status
				mappedRow['Status Message'] = statusMessage

				OutputCSVData.push(mappedRow)
			})

			const csvContent = utils.generateCSVContent(OutputCSVData)
			const outputFilePath = path.join(sessionFileDir, outputFileName)
			fs.writeFileSync(outputFilePath, csvContent)

			return {
				success: true,
				result: {
					sessionCreationOutput,
					outputFilePath,
					validRowsCount,
					invalidRowsCount,
				},
			}
		} catch (error) {
			return {
				success: false,
				message: error,
			}
		}
	}

	static async processCreateData(SessionsArray, userId, orgId, isMentor, notifyUser, tenantCode, orgCode) {
		const output = []
		for (const data of SessionsArray) {
			if (data.status != 'Invalid') {
				if (data.action.replace(/\s+/g, '').toLowerCase() === common.ACTIONS.CREATE) {
					data.status = common.PUBLISHED_STATUS
					data.time_zone =
						data.time_zone == common.TIMEZONE
							? (data.time_zone = common.IST_TIMEZONE)
							: (data.time_zone = common.UTC_TIMEZONE)
					const previousMeetingInfo = data.meeting_info
					if (data.meeting_info.platform === '' && data.meeting_info.link === '') {
						delete data.meeting_info
					}
					const { id, ...dataWithoutId } = data
					const sessionCreation = await sessionService.create(
						dataWithoutId,
						userId,
						orgId,
						orgCode,
						isMentor,
						notifyUser,
						tenantCode
					)
					if (sessionCreation.statusCode === httpStatusCode.created) {
						data.statusMessage = this.appendWithComma(data.statusMessage, sessionCreation.message)
						data.id = sessionCreation.result.id
						data.recommended_for = sessionCreation.result.recommended_for.map((item) => item.label)
						data.categories = sessionCreation.result.categories.map((item) => item.label)
						data.medium = sessionCreation.result.medium.map((item) => item.label)
						if (previousMeetingInfo.platform === '' && previousMeetingInfo.link === '') {
							data.meeting_info = previousMeetingInfo
						}
						data.time_zone =
							data.time_zone == common.IST_TIMEZONE
								? (data.time_zone = common.TIMEZONE)
								: (data.time_zone = common.TIMEZONE_UTC)
						output.push(data)
					} else {
						data.status = 'Invalid'
						data.time_zone =
							data.time_zone == common.IST_TIMEZONE
								? (data.time_zone = common.TIMEZONE)
								: (data.time_zone = common.TIMEZONE_UTC)
						data.statusMessage = this.appendWithComma(data.statusMessage, sessionCreation.message)
						output.push(data)
					}
				} else if (data.action.replace(/\s+/g, '').toLowerCase() == common.ACTIONS.EDIT) {
					data.time_zone =
						data.time_zone == common.TIMEZONE
							? (data.time_zone = common.IST_TIMEZONE)
							: (data.time_zone = common.UTC_TIMEZONE)
					const recommends = data.recommended_for
					const categoriess = data.categories
					const mediums = data.medium
					const sessionId = data.id
					data.type = data.type.toUpperCase()
					const { id, ...dataWithoutId } = data
					const sessionUpdateOrDelete = await sessionService.update(
						sessionId,
						dataWithoutId,
						userId,
						data.method,
						orgId,
						orgCode,
						notifyUser,
						tenantCode
					)
					if (sessionUpdateOrDelete.statusCode === httpStatusCode.accepted) {
						data.statusMessage = this.appendWithComma(data.statusMessage, sessionUpdateOrDelete.message)
						data.recommended_for = recommends
						data.categories = categoriess
						data.medium = mediums
						data.time_zone =
							data.time_zone == common.IST_TIMEZONE
								? (data.time_zone = common.TIMEZONE)
								: (data.time_zone = common.TIMEZONE_UTC)
						output.push(data)
					} else {
						data.status = 'Invalid'
						data.time_zone =
							data.time_zone == common.IST_TIMEZONE
								? (data.time_zone = common.TIMEZONE)
								: (data.time_zone = common.TIMEZONE_UTC)
						data.statusMessage = this.appendWithComma(data.statusMessage, sessionUpdateOrDelete.message)
						output.push(data)
					}
				} else if (data.action.replace(/\s+/g, '').toLowerCase() == common.ACTIONS.DELETE) {
					const sessionId = data.id
					const sessionDelete = await sessionService.update(
						sessionId,
						{},
						userId,
						data.method,
						orgId,
						orgCode,
						notifyUser,
						tenantCode
					)
					if (sessionDelete.statusCode === httpStatusCode.accepted) {
						data.statusMessage = this.appendWithComma(data.statusMessage, sessionDelete.message)
						output.push(data)
					} else {
						data.status = 'Invalid'
						data.statusMessage = this.appendWithComma(data.statusMessage, sessionDelete.message)
						output.push(data)
					}
				}
			} else {
				output.push(data)
			}

			if (data.statusMessage && typeof data.statusMessage != 'string') {
				data.statusMessage = await data.statusMessage.then((result) => result)
			}
		}
		return output
	}

	static async fetchMentorIds(sessionCreationOutput, tenantCode) {
		for (const item of sessionCreationOutput) {
			const mentorIdPromise = item.mentor_id
			if (!isNaN(mentorIdPromise) && mentorIdPromise) {
				const mentorId = await menteeExtensionQueries.getMenteeExtension(
					mentorIdPromise,
					['email'],
					false,
					tenantCode
				)
				if (!mentorId) throw createUnauthorizedResponse('USER_NOT_FOUND')
				item.mentor_id = mentorId.email
			} else {
				item.mentor_id = item.mentor_id
			}

			if (Array.isArray(item.mentees)) {
				const menteeEmails = []
				for (let i = 0; i < item.mentees.length; i++) {
					const menteeId = item.mentees[i]
					if (!isNaN(menteeId)) {
						const mentee = await menteeExtensionQueries.getMenteeExtension(
							menteeId,
							['email'],
							false,
							tenantCode
						)
						if (!mentee) throw createUnauthorizedResponse('USER_NOT_FOUND')
						menteeEmails.push(mentee.email)
					} else {
						menteeEmails.push(menteeId)
					}
				}
				item.mentees = menteeEmails
			}
		}
	}

	static async sendSessionManagerEmail(templateData, userData, sessionUploadURL = null, subjectComposeData = {}) {
		try {
			const payload = {
				type: common.notificationEmailType,
				email: {
					to: userData.email,
					subject:
						subjectComposeData && Object.keys(subjectComposeData).length > 0
							? utils.composeEmailBody(templateData.subject, subjectComposeData)
							: templateData.subject,
					body: utils.composeEmailBody(templateData.body, {
						name: userData.name,
						file_link: sessionUploadURL,
					}),
				},
			}

			if (sessionUploadURL != null) {
				const currentDate = new Date().toISOString().split('T')[0].replace(/-/g, '')

				payload.email.attachments = [
					{
						url: sessionUploadURL,
						filename: `session-creation-status_${currentDate}.csv`,
						type: 'text/csv',
					},
				]
			}

			await kafkaCommunication.pushEmailToKafka(payload)
			return {
				success: true,
			}
		} catch (error) {
			console.log(error)
			throw error
		}
	}
}
