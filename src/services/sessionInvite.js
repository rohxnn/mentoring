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
const responses = require('@helpers/responses')

module.exports = class UserInviteHelper {
	static async uploadSession(data) {
		return new Promise(async (resolve, reject) => {
			const startTime = Date.now()
			const jobId = `${data.fileDetails.id}_${startTime}`

			console.log(`\n🚀 [STAGE 1 - INIT] Session Upload Started - Job ID: ${jobId}`)
			console.log(`📊 [INIT] Parameters:`, {
				fileId: data.fileDetails.id,
				filePath: data.fileDetails.input_path,
				userId: data.user.userId,
				orgId: data.user.organization_id,
				tenantCode: data.user.tenant_code,
				orgCode: data.user.organization_code,
			})

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

				console.log(`\n👤 [STAGE 2 - USER LOOKUP] Getting user details for ID: ${userId}`)
				console.log(`🔍 [USER LOOKUP] Cache lookup with tenantCode: ${tenantCode}, userId: ${userId}`)

				const mentor = await cacheHelper.mentee.get(tenantCode, userId)
				if (!mentor) {
					console.log(`❌ [STAGE 2 FAILED] User ${userId} not found in cache - tenantCode: ${tenantCode}`)
					console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 2 - USER LOOKUP`)
					throw new Error('USER_NOT_FOUND')
				}
				console.log(`✅ [STAGE 2 SUCCESS] User found: ${mentor.name}, Is Mentor: ${mentor.is_mentor}`)
				console.log(`📧 [USER DATA] Email: ${mentor.email}`)
				console.log(`📋 [USER DATA] Available keys: [${Object.keys(mentor).join(', ')}]`)

				// If email is missing from cache, get fresh user data with email from database
				let userWithEmail = mentor
				if (!mentor.email) {
					console.log(`⚠️ [EMAIL MISSING] Email not in cache, fetching fresh user data from database`)
					const userQueries = require('@database/queries/userExtension')

					// Explicitly request email field and don't use cache
					userWithEmail = await userQueries.getMenteeExtension(
						userId,
						['user_id', 'name', 'email', 'is_mentor', 'organization_code', 'tenant_code'],
						false,
						tenantCode
					)
					console.log(`📧 [FRESH EMAIL CHECK] Fresh user email: ${userWithEmail?.email}`)
					console.log(
						`📋 [FRESH USER KEYS] Fresh user keys: [${Object.keys(userWithEmail || {}).join(', ')}]`
					)

					// If still no email, check email field specifically
					if (!userWithEmail?.email) {
						console.log(`❌ [CRITICAL] User ${userId} has no email field in database!`)
						console.log(`🔍 [DEBUG] This may cause issues with email notifications later in the process`)

						// Try to get email using a direct query
						try {
							const directEmailQuery = await userQueries.getUsersByUserIds(
								[userId],
								{ attributes: ['user_id', 'name', 'email'] },
								tenantCode,
								false
							)
							if (directEmailQuery && directEmailQuery.length > 0 && directEmailQuery[0].email) {
								console.log(`✅ [EMAIL FOUND] Direct query found email: ${directEmailQuery[0].email}`)
								userWithEmail = { ...userWithEmail, email: directEmailQuery[0].email }
							} else {
								console.log(`⚠️ [EMAIL MISSING] Email truly missing from user record`)
							}
						} catch (emailQueryError) {
							console.log(`❌ [EMAIL QUERY ERROR] ${emailQueryError.message}`)
						}
					} else {
						console.log(`✅ [EMAIL FOUND] Successfully retrieved email: ${userWithEmail.email}`)
						// Update the mentor object with email for later use
						mentor.email = userWithEmail.email
					}
				}

				const isMentor = mentor.is_mentor

				console.log(`\n📥 [STAGE 3 - FILE DOWNLOAD] Downloading CSV file from: ${filePath}`)
				console.log(`🔍 [FILE DOWNLOAD] Parameters: filePath=${filePath}`)

				// download file to local directory
				const response = await this.downloadCSV(filePath)
				if (!response.success) {
					console.log(`❌ [STAGE 3 FAILED] File download failed for: ${filePath}`)
					console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 3 - FILE DOWNLOAD`)
					throw new Error('FAILED_TO_DOWNLOAD')
				}
				console.log(`✅ [STAGE 3 SUCCESS] File downloaded to: ${response.result.downloadPath}`)
				console.log(
					`📁 [FILE INFO] Downloaded file size: ${
						fs.existsSync(response.result.downloadPath)
							? fs.statSync(response.result.downloadPath).size
							: 'unknown'
					} bytes`
				)

				console.log(`\n📊 [STAGE 4 - CSV PARSING] Extracting data from CSV: ${response.result.downloadPath}`)

				// extract data from csv
				const parsedFileData = await this.extractDataFromCSV(response.result.downloadPath)
				if (!parsedFileData.success) {
					console.log(`❌ [STAGE 4 FAILED] CSV parsing failed`)
					console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 4 - CSV PARSING`)
					throw new Error('FAILED_TO_READ_CSV')
				}
				const invitees = parsedFileData.result.data
				console.log(`✅ [STAGE 4 SUCCESS] CSV parsed successfully - ${invitees.length} rows extracted`)
				console.log(
					`📋 [CSV DATA] Sample row keys: [${
						invitees.length > 0 ? Object.keys(invitees[0]).join(', ') : 'no data'
					}]`
				)

				console.log(`\n⚙️ [STAGE 5 - SESSION PROCESSING] Processing ${invitees.length} session records`)
				console.log(`🔍 [SESSION PROCESSING] Parameters:`, {
					inviteeCount: invitees.length,
					userId: userId,
					orgId: orgId,
					isMentor: isMentor,
					tenantCode: tenantCode,
					orgCode: orgCode,
					outputDir: inviteeFileDir,
				})

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

				if (createResponse.success == false) {
					console.log(`❌ [STAGE 5 FAILED] Session processing failed: ${createResponse.message}`)
					console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 5 - SESSION PROCESSING`)
				} else {
					console.log(`✅ [STAGE 5 SUCCESS] Session processing completed`)
					console.log(
						`📊 [PROCESSING RESULTS] Valid: ${createResponse.result.validRowsCount}, Invalid: ${createResponse.result.invalidRowsCount}`
					)
				}

				const outputFilename = path.basename(createResponse.result.outputFilePath)
				console.log(`📄 [OUTPUT] Generated file: ${outputFilename}`)
				console.log(`\n☁️ [STAGE 6 - CLOUD UPLOAD] Uploading output file to cloud`)
				console.log(`🔍 [CLOUD UPLOAD] Parameters:`, {
					filename: outputFilename,
					sourceDir: inviteeFileDir,
					userId: userId,
					orgId: orgId,
				})

				// upload output file to cloud
				const uploadRes = await uploadToCloud.uploadFileToCloud(
					outputFilename,
					inviteeFileDir,
					userId,
					orgId,
					tenantCode
				)
				const output_path = uploadRes.result.uploadDest
				console.log(`✅ [STAGE 6 SUCCESS] File uploaded to cloud: ${output_path}`)

				console.log(`\n💾 [STAGE 7 - STATUS UPDATE] Updating file upload status in database`)
				const finalStatus =
					createResponse.result.isErrorOccured == true ? common.STATUS.FAILED : common.STATUS.PROCESSED
				const update = {
					output_path,
					updated_by: userId,
					status: finalStatus,
				}
				console.log(`🔍 [STATUS UPDATE] Parameters:`, {
					fileId: data.fileDetails.id,
					organizationId: orgId,
					tenantCode: tenantCode,
					newStatus: finalStatus,
					outputPath: output_path,
				})

				//update output path in file uploads
				try {
					const rowsAffected = await fileUploadQueries.update(
						{ id: data.fileDetails.id, organization_id: String(orgId) },
						tenantCode,
						update
					)

					if (rowsAffected === 0) {
						console.log(`❌ [STAGE 7 FAILED] Database update failed - no rows affected`)
						console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 7 - STATUS UPDATE`)
						throw new Error('FILE_UPLOAD_MODIFY_ERROR')
					}
					console.log(
						`✅ [STAGE 7 SUCCESS] Database updated - ${rowsAffected} row(s) affected, status: ${finalStatus}`
					)
				} catch (dbError) {
					console.log(`❌ [STAGE 7 CRITICAL] Database update error:`, dbError.message || dbError)
					console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 7 - DATABASE ERROR`)
					console.log(`🔍 [DEBUG] Update parameters:`, {
						filter: { id: data.fileDetails.id, organization_id: String(orgId) },
						tenantCode,
						update,
					})
					throw new Error('DATABASE_UPDATE_ERROR: ' + (dbError.message || dbError))
				}

				console.log(`\n📧 [STAGE 8 - EMAIL NOTIFICATION] Sending completion notification`)

				// send email to admin
				const templateCode = process.env.SESSION_UPLOAD_EMAIL_TEMPLATE_CODE
				if (templateCode) {
					console.log(`🔍 [EMAIL] Template code: ${templateCode}`)

					let defaults = null
					try {
						defaults = await getDefaults()
					} catch (defaultsError) {
						console.log(`⚠️ [EMAIL] Failed to get defaults: ${defaultsError.message}`)
						// Use environment variable defaults as fallback
						defaults = {
							orgCode: process.env.DEFAULT_ORGANISATION_CODE || 'default_code',
							tenantCode: process.env.DEFAULT_TENANT_CODE || 'default',
						}
						console.log(
							`🔄 [EMAIL] Using fallback defaults: orgCode=${defaults.orgCode}, tenantCode=${defaults.tenantCode}`
						)
					}

					if (!defaults || !defaults.orgCode) {
						console.log(`❌ [STAGE 8 FAILED] Default org code not set and no fallback available`)
						console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 8 - EMAIL NOTIFICATION (defaults)`)
						throw new Error('DEFAULT_ORG_CODE_NOT_SET')
					}
					if (!defaults.tenantCode) {
						console.log(`❌ [STAGE 8 FAILED] Default tenant code not set and no fallback available`)
						console.log(`💥 [ERROR] Job ${jobId} failed at STAGE 8 - EMAIL NOTIFICATION (defaults)`)
						throw new Error('DEFAULT_TENANT_CODE_NOT_SET')
					}

					console.log(
						`🔍 [EMAIL] Getting template for tenantCode: ${tenantCode}, orgCode: ${data.user.organization_code}`
					)

					// send mail to mentors on session creation if session created by manager
					const templateData = await cacheHelper.notificationTemplates.get(
						tenantCode,
						data.user.organization_code,
						templateCode
					)

					if (templateData) {
						// Use the email we retrieved earlier, fallback to data.user.email
						const emailToUse = userWithEmail?.email || mentor?.email || data.user.email
						console.log(`📧 [EMAIL] Template found, sending notification to: ${emailToUse}`)

						// Prepare user data with correct email
						const userDataForEmail = {
							...data.user,
							email: emailToUse,
							name: userWithEmail?.name || mentor?.name || data.user.name,
						}

						const sessionUploadURL = await utils.getDownloadableUrl(output_path)
						await this.sendSessionManagerEmail(templateData, userDataForEmail, sessionUploadURL) //Rename this to function to generic name since this function is used for both Invitee & Org-admin.
						console.log(`✅ [STAGE 8 SUCCESS] Email notification sent successfully`)
					} else {
						console.log(`⚠️ [EMAIL] No template found for code: ${templateCode}`)
						console.log(`✅ [STAGE 8 SKIPPED] Email notification skipped - no template`)
					}
				} else {
					console.log(`✅ [STAGE 8 SKIPPED] Email notification skipped - no template code configured`)
				}

				console.log(`\n🧹 [STAGE 9 - CLEANUP] Cleaning up temporary files`)
				console.log(`🗑️ [CLEANUP] Removing: ${response.result.downloadPath}`)
				console.log(`🗑️ [CLEANUP] Removing: ${createResponse.result.outputFilePath}`)

				// delete the downloaded file and output file.
				utils.clearFile(response.result.downloadPath)
				utils.clearFile(createResponse.result.outputFilePath)

				const totalTime = Date.now() - startTime
				console.log(`\n🎉 [SUCCESS] Job ${jobId} completed successfully in ${totalTime}ms`)
				console.log(`✅ [FINAL STATUS] Upload processed successfully - status updated to ${finalStatus}`)

				return resolve({
					success: true,
					message: 'CSV_UPLOADED_SUCCESSFULLY',
				})
			} catch (error) {
				const totalTime = Date.now() - startTime
				console.log(`\n💥 [CRITICAL ERROR] Job ${jobId} failed after ${totalTime}ms`)
				console.log(`❌ [ERROR TYPE] ${error.constructor.name}`)
				console.log(`❌ [ERROR MESSAGE] ${error.message}`)
				console.log(`📊 [ERROR STACK] ${error.stack}`)
				console.log(`🔍 [DEBUG] This error prevented the upload status from being updated`)

				return reject({
					success: false,
					message: error.message,
				})
			}
		})
	}

	static async downloadCSV(filePath) {
		try {
			console.log(`📥 [DOWNLOAD] Getting downloadable URL for: ${filePath}`)
			const downloadableUrl = await utils.getDownloadableUrl(filePath)
			console.log(`🔗 [DOWNLOAD] Generated URL: ${downloadableUrl}`)

			let fileName = path.basename(downloadableUrl)

			// Find the index of the first occurrence of '?'
			const index = fileName.indexOf('?')
			// Extract the portion of the string before the '?' if it exists, otherwise use the entire string
			fileName = index !== -1 ? fileName.substring(0, index) : fileName
			const downloadPath = path.join(inviteeFileDir, fileName)
			console.log(`📁 [DOWNLOAD] Target download path: ${downloadPath}`)

			console.log(`🌐 [DOWNLOAD] Making HTTP request to download file...`)
			const response = await axios.get(downloadableUrl, {
				responseType: common.responseType,
			})

			const writeStream = fs.createWriteStream(downloadPath)
			response.data.pipe(writeStream)

			console.log(`💾 [DOWNLOAD] Writing file to disk...`)
			await new Promise((resolve, reject) => {
				writeStream.on('finish', () => {
					console.log(`✅ [DOWNLOAD] File write completed`)
					resolve()
				})
				writeStream.on('error', (err) => {
					console.log(`❌ [DOWNLOAD] File write failed: ${err.message}`)
					reject(new Error('FAILED_TO_DOWNLOAD_FILE'))
				})
			})

			const stats = fs.statSync(downloadPath)
			console.log(`📊 [DOWNLOAD] Downloaded file size: ${stats.size} bytes`)

			return {
				success: true,
				result: {
					destPath: inviteeFileDir,
					fileName,
					downloadPath,
				},
			}
		} catch (error) {
			console.log(`❌ [DOWNLOAD ERROR] ${error.message}`)
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
			console.log(`📊 [CSV PARSE] Starting CSV parsing for: ${csvFilePath}`)
			const parsedCSVData = []

			console.log(`📄 [CSV PARSE] Reading CSV file with csvtojson...`)
			let csvToJsonData = await csv().fromFile(csvFilePath)
			console.log(`📊 [CSV PARSE] Raw CSV data parsed - ${csvToJsonData.length} rows found`)

			// Filter out empty rows
			const beforeFilterCount = csvToJsonData.length
			csvToJsonData = csvToJsonData.filter((row) => Object.values(row).some((value) => value.trim() !== ''))
			console.log(
				`🔍 [CSV PARSE] After filtering empty rows: ${csvToJsonData.length}/${beforeFilterCount} rows remaining`
			)

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

			console.log(`✅ [CSV PARSE] CSV parsing completed successfully`)
			console.log(`📊 [CSV PARSE] Final result: ${parsedCSVData.length} rows processed`)
			if (parsedCSVData.length > 0) {
				console.log(`📋 [CSV PARSE] Sample parsed row keys: [${Object.keys(parsedCSVData[0]).join(', ')}]`)
			}

			return {
				success: true,
				result: { data: parsedCSVData },
			}
		} catch (error) {
			console.log(`❌ [CSV PARSE ERROR] ${error.message}`)
			console.log(`📊 [CSV PARSE ERROR] Stack: ${error.stack}`)
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
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(session.statusMessage, 'DEFAULT_ORG_CODE_NOT_SET')
			}
			if (!defaults.tenantCode) {
				session.status = 'Invalid'
				session.statusMessage = this.appendWithComma(session.statusMessage, 'DEFAULT_TENANT_CODE_NOT_SET')
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
				if (!mentorId) throw new Error('USER_NOT_FOUND')
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
						if (!mentee) throw new Error('USER_NOT_FOUND')
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
