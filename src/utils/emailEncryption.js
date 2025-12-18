'use strict'
const crypto = require('crypto')

const secretKey = Buffer.from(process.env.EMAIL_ID_ENCRYPTION_KEY, 'hex')
const fixedIV = Buffer.from(process.env.EMAIL_ID_ENCRYPTION_IV, 'hex')
const algorithm = process.env.EMAIL_ID_ENCRYPTION_ALGORITHM

const encrypt = (plainTextEmail) => {
	try {
		const cipher = crypto.createCipheriv(algorithm, secretKey, fixedIV)
		return cipher.update(plainTextEmail, 'utf-8', 'hex') + cipher.final('hex')
	} catch (err) {
		console.log(err)
		throw err
	}
}

const decrypt = async (encryptedEmail) => {
	try {
		const decipher = crypto.createDecipheriv(algorithm, secretKey, fixedIV)
		return decipher.update(encryptedEmail, 'hex', 'utf-8') + decipher.final('utf-8')
	} catch (err) {
		console.log(err)
		throw err
	}
}

/**
 * Decrypts the given encrypted data and validates the integrity of the data.
 *
 * This function attempts to decrypt the provided data using the specified algorithm,
 * secret key, and initialization vector (IV). If successful, it returns the decrypted
 * string. If any error occurs during decryption, it returns `false` to indicate failure.
 *
 * @param {string} data - The encrypted data to be decrypted (in hexadecimal format).
 * @returns {string|boolean} - The decrypted string if successful, or `false` if decryption fails.
 *
 * @example
 * const encryptedData = '5d41402abc4b2a76b9719d911017c592';
 * const decryptedData = await decryptAndValidate(encryptedData);

 */
async function decryptAndValidate(data) {
	try {
		const decipher = crypto.createDecipheriv(algorithm, secretKey, fixedIV)
		return decipher.update(data, 'hex', 'utf-8') + decipher.final('utf-8')
	} catch (err) {
		return false
	}
}

const emailEncryption = { encrypt, decrypt, decryptAndValidate }

module.exports = emailEncryption
