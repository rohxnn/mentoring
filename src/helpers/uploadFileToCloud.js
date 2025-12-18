const fs = require('fs')
const path = require('path')
const common = require('@constants/common')
const fileService = require('@services/files')
const request = require('request')

module.exports = class uploadFileToCloud {
	static async uploadFileToCloud(fileName, folderPath, userId = '', orgCode, dynamicPath = '', tenantCode = '') {
		try {
			const getSignedUrl = await fileService.getSignedUrl(fileName, userId, dynamicPath, false, tenantCode)
			if (!getSignedUrl.result) {
				throw new Error('FAILED_TO_GENERATE_SIGNED_URL')
			}

			const fileUploadUrl = getSignedUrl.result.signedUrl
			const filePath = `${folderPath}/${fileName}`
			const fileData = fs.readFileSync(filePath, 'utf-8')

			const result = await new Promise((resolve, reject) => {
				try {
					request(
						{
							url: fileUploadUrl,
							method: 'put',
							headers: {
								'x-ms-blob-type': common.azureBlobType,
								'Content-Type': 'multipart/form-data',
							},
							body: fileData,
						},
						(error, response, body) => {
							if (error) reject(error)
							else resolve(response.statusCode)
						}
					)
				} catch (error) {
					reject(error)
				}
			})

			return {
				success: true,
				result: {
					uploadDest: getSignedUrl.result.destFilePath,
				},
			}
		} catch (error) {
			return {
				success: false,
				message: error.message,
			}
		}
	}
}
