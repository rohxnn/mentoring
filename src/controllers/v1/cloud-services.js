/**
 * name : cloud-services.js
 * author : Aman Gupta
 * created-date : 09-Nov-2021
 * Description : Cloud services controllers.
 */
const filesService = require('@services/files')

module.exports = class CloudServices {
	/**
	 * Get Signed Url
	 * @method
	 * @name getSignedUrl
	 * @param {JSON} req  request body.
	 * @returns {JSON} Response with status message and result.
	 */
	async getSignedUrl(req) {
		try {
			const signedUrlResponse = await filesService.getSignedUrl(
				req.query.fileName,
				req.decodedToken.id,
				req.query.dynamicPath ? req.query.dynamicPath : '',
				req.query.public && req.query.public == 'true' ? true : false,
				req.decodedToken.tenant_code
			)
			return signedUrlResponse
		} catch (error) {
			return error
		}
	}

	/**
	 * Get downlodable Url
	 * @method
	 * @name getDownloadableUrl
	 * @param {JSON} req  request body.
	 * @returns {JSON} Response with status message and result.
	 */
	async getDownloadableUrl(req) {
		try {
			return await filesService.getDownloadableUrl(
				req.query.filePath,
				req.query.public && req.query.public == 'true' ? true : false,
				req.decodedToken.tenant_code
			)
		} catch (error) {
			return error
		}
	}
}
