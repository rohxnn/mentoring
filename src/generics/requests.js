const request = require('request')
const { XMLParser } = require('fast-xml-parser')
const xmlParser = new XMLParser()

var get = function (url, token = '', internal_access_token = false) {
	return new Promise((resolve, reject) => {
		try {
			let headers = {
				'content-type': 'application/json',
			}
			if (internal_access_token) headers['internal_access_token'] = process.env.INTERNAL_ACCESS_TOKEN
			if (token) headers[process.env.AUTH_TOKEN_HEADER_NAME] = token

			const options = {
				headers: headers,
			}

			request.get(url, options, (err, data) => {
				if (err) return resolve({ success: false })

				let result = {
					success: true,
				}
				let response = data.body
				if (data.headers['content-type'].includes('application/json')) {
					response = JSON.parse(response)
				} else if (/text\/xml|application\/xml/.test(data.headers['content-type'])) {
					response = xmlParser.parse(response)
				}

				result.data = response
				return resolve(result)
			})
		} catch (error) {
			console.log(error)
			return resolve({ success: false })
		}
	})
}

var post = function (url, body, token = '', internal_access_token = false) {
	return new Promise((resolve, reject) => {
		try {
			let headers = {
				'content-type': 'application/json',
			}
			if (internal_access_token) {
				headers['internal_access_token'] = process.env.INTERNAL_ACCESS_TOKEN
			}

			if (token) {
				headers[process.env.AUTH_TOKEN_HEADER_NAME] = token
			}

			const options = {
				headers: headers,
				body: JSON.stringify(body),
			}

			request.post(url, options, (err, data) => {
				let result = {
					success: true,
				}

				if (err) {
					result.success = false
				} else {
					let response = data.body
					if (data.headers['content-type'].split(';')[0] !== 'application/json') {
						response = xmlParser.parse(data.body)
					}

					response = JSON.parse(response)
					result.data = response
				}

				return resolve(result)
			})
		} catch (error) {
			return reject(error)
		}
	})
}

module.exports = {
	get: get,
	post: post,
}
