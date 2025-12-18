#!/usr/bin/env node
'use strict'

const { QueryTypes } = require('sequelize')
const fs = require('fs')
const path = require('path')
const DatabaseConnectionManager = require('./db-connection-utils')

class DatabaseIntegrityChecker {
	constructor() {
		// Initialize database connection manager with migration-specific settings
		this.dbManager = new DatabaseConnectionManager({
			poolMax: 5,
			poolMin: 0,
			logging: false,
		})
		this.sequelize = this.dbManager.getSequelize()

		this.issues = []
		this.warnings = []
		this.passed = []
		this.tables = []
		this.tableInfo = {}
		this.detailedIssues = []
		this.logFilePath = path.join(__dirname, 'data-integrity-issues.log')

		// Reference column configurations from helper.js - these are the reference columns that MUST NOT be NULL
		this.tablesWithOrgId = [
			{ name: 'availabilities', referenceColumn: 'organization_id' },
			{ name: 'default_rules', referenceColumn: 'organization_id' },
			{ name: 'entity_types', referenceColumn: 'organization_id' },
			{ name: 'file_uploads', referenceColumn: 'organization_id' },
			{ name: 'forms', referenceColumn: 'organization_id' },
			{ name: 'notification_templates', referenceColumn: 'organization_id' },
			{ name: 'organization_extension', referenceColumn: 'organization_id' },
			{ name: 'report_queries', referenceColumn: 'organization_id' },
			{ name: 'reports', referenceColumn: 'organization_id' },
			{ name: 'role_extensions', referenceColumn: 'organization_id' },
		]

		this.tablesWithUserId = [
			{ name: 'user_extensions', referenceColumn: 'user_id' },
			{ name: 'sessions', referenceColumn: 'created_by' },
			{ name: 'session_attendees', referenceColumn: 'mentee_id' },
			{ name: 'feedbacks', referenceColumn: 'user_id' },
			{ name: 'connection_requests', referenceColumn: 'created_by' },
			{ name: 'connections', referenceColumn: 'created_by' },
			{ name: 'entities', referenceColumn: 'created_by' },
			{ name: 'issues', referenceColumn: 'user_id' },
			{ name: 'resources', referenceColumn: 'created_by' },
			{ name: 'session_request', referenceColumn: 'created_by' },
			{ name: 'question_sets', referenceColumn: 'created_by' },
			{ name: 'questions', referenceColumn: 'created_by' },
			{ name: 'post_session_details', referenceColumn: 'session_id', specialCase: 'session_lookup' },
		]
	}

	async checkConnection() {
		try {
			const connectionResult = await this.dbManager.checkConnection()

			if (connectionResult.success) {
				console.log(`Connected to: ${connectionResult.details.database}`)
				console.log(`Connection time: ${connectionResult.details.connectionTime}ms`)
				return true
			} else {
				this.issues.push(`Connection failed: ${connectionResult.message}`)
				return false
			}
		} catch (error) {
			this.issues.push(`Connection error: ${error.message}`)
			return false
		}
	}

	/**
	 * Check if table exists
	 */
	async tableExists(tableName) {
		try {
			const result = await this.sequelize.query(
				`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${tableName}')`,
				{ type: QueryTypes.SELECT }
			)
			return result[0].exists
		} catch (error) {
			return false
		}
	}

	/**
	 * Check if column exists in table
	 */
	async columnExists(tableName, columnName) {
		try {
			const result = await this.sequelize.query(
				`SELECT EXISTS (
					SELECT FROM information_schema.columns 
					WHERE table_name = '${tableName}' 
					AND column_name = '${columnName}'
					AND table_schema = 'public'
				)`,
				{ type: QueryTypes.SELECT }
			)
			return result[0].exists
		} catch (error) {
			return false
		}
	}

	/**
	 * Check organization_id reference columns (used for CSV lookup by helper.js)
	 */
	async checkOrganizationIdReferences() {
		console.log('\n🔍 Checking organization_id reference columns for tenant migration...')
		console.log('These tables use organization_id to lookup tenant_code/organization_code from CSV data')

		for (const tableConfig of this.tablesWithOrgId) {
			const { name: tableName, referenceColumn } = tableConfig
			console.log(`\n📋 Checking ${tableName}.${referenceColumn}:`)

			try {
				// Check if table exists
				if (!(await this.tableExists(tableName))) {
					this.warnings.push(`Table ${tableName} does not exist`)
					console.log(`⚠️  Table ${tableName} does not exist - skipping`)
					continue
				}

				// Check if reference column exists
				if (!(await this.columnExists(tableName, referenceColumn))) {
					this.issues.push(`Table ${tableName} missing reference column ${referenceColumn}`)
					console.log(`❌ Column ${referenceColumn} does not exist in ${tableName}`)
					continue
				}

				// Count total records
				const totalCount = await this.sequelize.query(`SELECT COUNT(*) as count FROM ${tableName}`, {
					type: QueryTypes.SELECT,
				})

				// Count NULL reference column records
				const nullCount = await this.sequelize.query(
					`SELECT COUNT(*) as count FROM ${tableName} WHERE ${referenceColumn} IS NULL`,
					{ type: QueryTypes.SELECT }
				)

				// Safely parse results with error handling
				const totalRecords = parseInt((totalCount && totalCount[0] && totalCount[0].count) || 0)
				const nullRecords = parseInt((nullCount && nullCount[0] && nullCount[0].count) || 0)

				if (nullRecords > 0) {
					this.issues.push(
						`${tableName}.${referenceColumn}: ${nullRecords} NULL values out of ${totalRecords} total records`
					)
					console.log(
						`❌ Found ${nullRecords} NULL ${referenceColumn} values out of ${totalRecords} total records`
					)

					// Get sample NULL records for debugging
					const sampleNulls = await this.sequelize.query(
						`SELECT id FROM ${tableName} WHERE ${referenceColumn} IS NULL LIMIT 5`,
						{ type: QueryTypes.SELECT }
					)
					console.log(`   Sample NULL record IDs: ${sampleNulls.map((r) => r.id).join(', ')}`)
				} else {
					this.passed.push(
						`${tableName}.${referenceColumn}: All ${totalRecords} records have valid references`
					)
					console.log(`✅ All ${totalRecords} records have valid ${referenceColumn} values`)
				}
			} catch (error) {
				this.issues.push(`${tableName}.${referenceColumn}: Error - ${error.message}`)
				console.log(`❌ Error checking ${tableName}.${referenceColumn}: ${error.message}`)
			}
		}
	}

	/**
	 * Check user_id/created_by reference columns (used for user_extensions lookup by helper.js)
	 */
	async checkUserIdReferences() {
		console.log('\n🔍 Checking user_id/created_by reference columns for tenant migration...')
		console.log('These tables use user_id/created_by to lookup via user_extensions -> organization_id')

		for (const tableConfig of this.tablesWithUserId) {
			const { name: tableName, referenceColumn, specialCase } = tableConfig
			console.log(`\n📋 Checking ${tableName}.${referenceColumn}:`)

			try {
				// Check if table exists
				if (!(await this.tableExists(tableName))) {
					this.warnings.push(`Table ${tableName} does not exist`)
					console.log(`⚠️  Table ${tableName} does not exist - skipping`)
					continue
				}

				// Special case for post_session_details (uses session_id -> sessions.created_by)
				if (specialCase === 'session_lookup') {
					await this.checkSessionLookupReference(tableName, referenceColumn)
					continue
				}

				// Check if reference column exists
				if (!(await this.columnExists(tableName, referenceColumn))) {
					this.issues.push(`Table ${tableName} missing reference column ${referenceColumn}`)
					console.log(`❌ Column ${referenceColumn} does not exist in ${tableName}`)
					continue
				}

				// Count total records
				const totalCount = await this.sequelize.query(`SELECT COUNT(*) as count FROM ${tableName}`, {
					type: QueryTypes.SELECT,
				})

				// Count NULL reference column records
				const nullCount = await this.sequelize.query(
					`SELECT COUNT(*) as count FROM ${tableName} WHERE ${referenceColumn} IS NULL`,
					{ type: QueryTypes.SELECT }
				)

				// Count records where reference doesn't exist in user_extensions (orphaned references)
				// Exclude '0' values as these are system records and are valid
				let orphanedCount = [{ count: 0 }]
				if (tableName !== 'user_extensions') {
					orphanedCount = await this.sequelize.query(
						`SELECT COUNT(*) as count 
						 FROM ${tableName} t 
						 LEFT JOIN user_extensions ue ON t.${referenceColumn} = ue.user_id 
						 WHERE t.${referenceColumn} IS NOT NULL 
						 AND t.${referenceColumn}::text != '0'
						 AND ue.user_id IS NULL`,
						{ type: QueryTypes.SELECT }
					)
				}

				// Safely parse results with error handling
				const totalRecords = parseInt((totalCount && totalCount[0] && totalCount[0].count) || 0)
				const nullRecords = parseInt((nullCount && nullCount[0] && nullCount[0].count) || 0)
				const orphanedRecords = parseInt((orphanedCount && orphanedCount[0] && orphanedCount[0].count) || 0)

				// Report NULL values
				if (nullRecords > 0) {
					this.issues.push(
						`${tableName}.${referenceColumn}: ${nullRecords} NULL values out of ${totalRecords} total records`
					)
					console.log(
						`❌ Found ${nullRecords} NULL ${referenceColumn} values out of ${totalRecords} total records`
					)

					// Get sample NULL records
					const sampleNulls = await this.sequelize.query(
						`SELECT id FROM ${tableName} WHERE ${referenceColumn} IS NULL LIMIT 5`,
						{ type: QueryTypes.SELECT }
					)
					console.log(`   Sample NULL record IDs: ${sampleNulls.map((r) => r.id).join(', ')}`)
				} else {
					console.log(`✅ No NULL ${referenceColumn} values found`)
				}

				// Report orphaned references (user_id not in user_extensions, excluding system records '0')
				if (orphanedRecords > 0) {
					this.issues.push(
						`${tableName}.${referenceColumn}: ${orphanedRecords} orphaned references (user not in user_extensions, excluding system records)`
					)
					console.log(
						`❌ Found ${orphanedRecords} orphaned ${referenceColumn} references (user not in user_extensions, excluding system records '0')`
					)

					// Get sample orphaned records (exclude '0' system records)
					const sampleOrphans = await this.sequelize.query(
						`SELECT t.id, t.${referenceColumn}
						 FROM ${tableName} t 
						 LEFT JOIN user_extensions ue ON t.${referenceColumn} = ue.user_id 
						 WHERE t.${referenceColumn} IS NOT NULL 
						 AND t.${referenceColumn}::text != '0'
						 AND ue.user_id IS NULL 
						 LIMIT 5`,
						{ type: QueryTypes.SELECT }
					)
					console.log(
						`   Sample orphaned records: ${sampleOrphans
							.map((r) => `id:${r.id}(user:${r[referenceColumn]})`)
							.join(', ')}`
					)
				} else if (tableName !== 'user_extensions') {
					console.log(`✅ No orphaned ${referenceColumn} references found (system records '0' are valid)`)
				}

				// Overall assessment
				if (nullRecords === 0 && orphanedRecords === 0) {
					this.passed.push(
						`${tableName}.${referenceColumn}: All ${totalRecords} records have valid references`
					)
					console.log(`✅ All ${totalRecords} records have valid ${referenceColumn} values`)
				}
			} catch (error) {
				this.issues.push(`${tableName}.${referenceColumn}: Error - ${error.message}`)
				console.log(`❌ Error checking ${tableName}.${referenceColumn}: ${error.message}`)
			}
		}
	}

	/**
	 * Special check for post_session_details (session_id -> sessions.created_by)
	 */
	async checkSessionLookupReference(tableName, referenceColumn) {
		try {
			// Check if reference column exists
			if (!(await this.columnExists(tableName, referenceColumn))) {
				this.issues.push(`Table ${tableName} missing reference column ${referenceColumn}`)
				console.log(`❌ Column ${referenceColumn} does not exist in ${tableName}`)
				return
			}

			// Count total records
			const totalCount = await this.sequelize.query(`SELECT COUNT(*) as count FROM ${tableName}`, {
				type: QueryTypes.SELECT,
			})

			// Count NULL session_id records
			const nullSessionCount = await this.sequelize.query(
				`SELECT COUNT(*) as count FROM ${tableName} WHERE ${referenceColumn} IS NULL`,
				{ type: QueryTypes.SELECT }
			)

			// Count records where session_id doesn't exist in sessions table
			const orphanedSessionCount = await this.sequelize.query(
				`SELECT COUNT(*) as count 
				 FROM ${tableName} psd 
				 LEFT JOIN sessions s ON psd.${referenceColumn} = s.id 
				 WHERE psd.${referenceColumn} IS NOT NULL 
				 AND s.id IS NULL`,
				{ type: QueryTypes.SELECT }
			)

			// Count records where session exists but session.created_by is NULL
			const sessionWithNullCreatedByCount = await this.sequelize.query(
				`SELECT COUNT(*) as count 
				 FROM ${tableName} psd 
				 INNER JOIN sessions s ON psd.${referenceColumn} = s.id 
				 WHERE s.created_by IS NULL`,
				{ type: QueryTypes.SELECT }
			)

			// Safely parse results with error handling
			const totalRecords = parseInt((totalCount && totalCount[0] && totalCount[0].count) || 0)
			const nullSessions = parseInt((nullSessionCount && nullSessionCount[0] && nullSessionCount[0].count) || 0)
			const orphanedSessions = parseInt(
				(orphanedSessionCount && orphanedSessionCount[0] && orphanedSessionCount[0].count) || 0
			)
			const sessionsWithNullCreatedBy = parseInt(
				(sessionWithNullCreatedByCount &&
					sessionWithNullCreatedByCount[0] &&
					sessionWithNullCreatedByCount[0].count) ||
					0
			)

			// Report issues
			if (nullSessions > 0) {
				this.issues.push(`${tableName}.${referenceColumn}: ${nullSessions} NULL session_id values`)
				console.log(`❌ Found ${nullSessions} NULL ${referenceColumn} values`)
			}

			if (orphanedSessions > 0) {
				this.issues.push(`${tableName}.${referenceColumn}: ${orphanedSessions} orphaned session references`)
				console.log(`❌ Found ${orphanedSessions} orphaned session references (session not found)`)
			}

			if (sessionsWithNullCreatedBy > 0) {
				this.issues.push(
					`${tableName} -> sessions.created_by: ${sessionsWithNullCreatedBy} sessions with NULL created_by`
				)
				console.log(
					`❌ Found ${sessionsWithNullCreatedBy} sessions with NULL created_by (cannot determine tenant)`
				)
			}

			if (nullSessions === 0 && orphanedSessions === 0 && sessionsWithNullCreatedBy === 0) {
				this.passed.push(
					`${tableName}.${referenceColumn}: All ${totalRecords} records have valid session references`
				)
				console.log(`✅ All ${totalRecords} records have valid session references with created_by`)
			}
		} catch (error) {
			this.issues.push(`${tableName}.${referenceColumn}: Error - ${error.message}`)
			console.log(`❌ Error checking ${tableName}.${referenceColumn}: ${error.message}`)
		}
	}

	/**
	 * Check user_extensions.organization_id (critical for tenant lookup)
	 */
	async checkUserExtensionsIntegrity() {
		console.log('\n🔍 Checking user_extensions.organization_id integrity...')
		console.log(
			'This is CRITICAL - user_extensions.organization_id is used to lookup tenant data for all user-based tables'
		)

		try {
			if (!(await this.tableExists('user_extensions'))) {
				this.issues.push('CRITICAL: user_extensions table does not exist')
				console.log('❌ CRITICAL: user_extensions table does not exist')
				return
			}

			// Count total user_extensions records
			const totalUsers = await this.sequelize.query(`SELECT COUNT(*) as count FROM user_extensions`, {
				type: QueryTypes.SELECT,
			})

			// Count users with NULL organization_id
			const nullOrgUsers = await this.sequelize.query(
				`SELECT COUNT(*) as count FROM user_extensions WHERE organization_id IS NULL`,
				{ type: QueryTypes.SELECT }
			)

			// Safely parse results with error handling
			const totalUserCount = parseInt((totalUsers && totalUsers[0] && totalUsers[0].count) || 0)
			const nullOrgCount = parseInt((nullOrgUsers && nullOrgUsers[0] && nullOrgUsers[0].count) || 0)

			console.log(`📊 Total users in user_extensions: ${totalUserCount}`)

			if (nullOrgCount > 0) {
				this.issues.push(
					`CRITICAL: user_extensions.organization_id: ${nullOrgCount} users with NULL organization_id`
				)
				console.log(`❌ CRITICAL: ${nullOrgCount} users have NULL organization_id`)
				console.log(`   This means ${nullOrgCount} users cannot be assigned tenant_code/organization_code`)

				// Get sample users with NULL organization_id
				const sampleUsers = await this.sequelize.query(
					`SELECT user_id FROM user_extensions WHERE organization_id IS NULL LIMIT 5`,
					{ type: QueryTypes.SELECT }
				)
				console.log(
					`   Sample user_ids with NULL organization_id: ${sampleUsers.map((u) => u.user_id).join(', ')}`
				)
			} else {
				this.passed.push(
					`user_extensions.organization_id: All ${totalUserCount} users have valid organization_id`
				)
				console.log(`✅ All ${totalUserCount} users have valid organization_id values`)
			}
		} catch (error) {
			this.issues.push(`user_extensions integrity check failed: ${error.message}`)
			console.log(`❌ Error checking user_extensions: ${error.message}`)
		}
	}

	async checkOrphanedRecords() {
		const relationships = [
			{ table: 'entities', column: 'entity_type_id', refTable: 'entity_types', refColumn: 'id' },
			{ table: 'role_permission_mapping', column: 'permission_id', refTable: 'permissions', refColumn: 'id' },
			{ table: 'post_session_details', column: 'session_id', refTable: 'sessions', refColumn: 'id' },
			{ table: 'resources', column: 'session_id', refTable: 'sessions', refColumn: 'id' },
			{ table: 'session_attendees', column: 'session_id', refTable: 'sessions', refColumn: 'id' },
			{ table: 'question_sets', column: 'questions', refTable: 'questions', refColumn: 'id' },
		]

		console.log(`🔍 Checking ${relationships.length} foreign key relationships...`)

		for (const rel of relationships) {
			// Check if both tables exist before processing
			try {
				await this.sequelize.query(`SELECT 1 FROM ${rel.table} LIMIT 1`, { type: QueryTypes.SELECT })
				await this.sequelize.query(`SELECT 1 FROM ${rel.refTable} LIMIT 1`, { type: QueryTypes.SELECT })
			} catch (error) {
				this.warnings.push(
					`Skipping ${rel.table}.${rel.column} → ${rel.refTable}.${rel.refColumn}: Table not found`
				)
				continue
			}

			try {
				// Special handling for question_sets.questions array column
				if (rel.table === 'question_sets' && rel.column === 'questions') {
					await this.checkQuestionSetsArrayIntegrity(rel)
					continue
				}

				// For mapping tables like role_permission_mapping, we need to identify rows differently
				let identifierColumn = 'id'
				const idColumnCheck = await this.sequelize.query(
					`SELECT column_name FROM information_schema.columns 
					 WHERE table_name = '${rel.table}' AND column_name = 'id'`,
					{ type: QueryTypes.SELECT }
				)

				if (idColumnCheck.length === 0) {
					// For mapping tables, try to find a suitable identifier column
					if (rel.table === 'role_permission_mapping') {
						// Use a combination of role_title and permission_id as identifier
						identifierColumn = 'role_title, permission_id'
					} else {
						this.warnings.push(`Table ${rel.table} does not have an 'id' column`)
						continue
					}
				}

				// Check if the column exists in the table before trying to query it
				const columnCheck = await this.sequelize.query(
					`SELECT column_name FROM information_schema.columns 
					 WHERE table_name = '${rel.table}' AND column_name = '${rel.column}'`,
					{ type: QueryTypes.SELECT }
				)

				if (columnCheck.length === 0) {
					this.warnings.push(`Column ${rel.table}.${rel.column} does not exist`)
					continue
				}

				let whereClause = `t.${rel.column} IS NOT NULL AND r.${rel.refColumn} IS NULL`

				// Check if the reference column exists in the reference table
				const refColumnCheck = await this.sequelize.query(
					`SELECT column_name FROM information_schema.columns 
					 WHERE table_name = '${rel.refTable}' AND column_name = '${rel.refColumn}'`,
					{ type: QueryTypes.SELECT }
				)

				if (refColumnCheck.length === 0) {
					this.warnings.push(`Reference column ${rel.refTable}.${rel.refColumn} does not exist`)
					continue
				}

				const orphans = await this.sequelize.query(
					`
					SELECT t.${identifierColumn}${identifierColumn !== 'id' ? '' : ' as id'}, t.${rel.column} as invalid_reference
					FROM ${rel.table} t
					LEFT JOIN ${rel.refTable} r ON t.${rel.column}::text = r.${rel.refColumn}::text
					WHERE ${whereClause}
				`,
					{ type: QueryTypes.SELECT }
				)

				if (orphans.length > 0) {
					const totalCount = orphans.length
					const allIds = orphans
						.map((row) => {
							const identifier =
								identifierColumn === 'id'
									? row.id
									: `${row.role_title || 'N/A'},${row.permission_id || 'N/A'}`
							return `id:${identifier}(${rel.column}:${row.invalid_reference})`
						})
						.join(', ')

					// Add to main issues array for console output
					this.issues.push(
						`${totalCount} orphaned records in ${rel.table}.${rel.column} → ${rel.refTable}.${rel.refColumn}. All records: ${allIds}`
					)

					// Add detailed records to log file data
					this.detailedIssues.push({
						type: 'ORPHANED_RECORDS',
						table: rel.table,
						column: rel.column,
						refTable: rel.refTable,
						refColumn: rel.refColumn,
						totalCount: totalCount,
						timestamp: new Date().toISOString(),
						records: orphans.map((row) => ({
							id:
								identifierColumn === 'id'
									? row.id
									: `${row.role_title || 'N/A'},${row.permission_id || 'N/A'}`,
							invalidReference: row.invalid_reference,
						})),
					})
				} else {
					this.passed.push(`No orphaned records in ${rel.table}.${rel.column}`)
				}
			} catch (error) {
				this.warnings.push(`Could not check ${rel.table}.${rel.column}: ${error.message}`)
			}
		}
	}

	async checkQuestionSetsArrayIntegrity(rel) {
		try {
			// Proper integrity check for question_sets array column
			const orphans = await this.sequelize.query(
				`
				SELECT DISTINCT qs.id, array_agg(missing_q.question_id) as missing_questions
				FROM question_sets qs,
				LATERAL (
					SELECT unnest(qs.questions)::int as question_id
				) as all_questions
				LEFT JOIN questions q ON all_questions.question_id = q.id
				LEFT JOIN LATERAL (
					SELECT all_questions.question_id
					WHERE q.id IS NULL
				) as missing_q ON true
				WHERE qs.questions IS NOT NULL 
				AND missing_q.question_id IS NOT NULL
				GROUP BY qs.id
			`,
				{ type: QueryTypes.SELECT }
			)

			if (orphans.length > 0) {
				const totalCount = orphans.reduce((sum, row) => sum + row.missing_questions.length, 0)
				const allIds = orphans
					.map((row) => `id:${row.id}(questions:${row.missing_questions.join(',')})`)
					.join(', ')

				// Add to main issues array for console output
				this.issues.push(
					`${totalCount} orphaned records in ${rel.table}.${rel.column} → ${rel.refTable}.${rel.refColumn}. All records: ${allIds}`
				)

				// Add detailed records to log file data
				this.detailedIssues.push({
					type: 'ORPHANED_RECORDS',
					table: rel.table,
					column: rel.column,
					refTable: rel.refTable,
					refColumn: rel.refColumn,
					totalCount: totalCount,
					timestamp: new Date().toISOString(),
					records: orphans.map((row) => ({
						id: row.id,
						invalidReference: row.missing_questions,
					})),
				})
			} else {
				this.passed.push(`No orphaned records in ${rel.table}.${rel.column}`)
			}
		} catch (error) {
			this.warnings.push(`Could not check ${rel.table}.${rel.column} with array logic: ${error.message}`)
		}
	}

	writeLogFile() {
		if (this.detailedIssues.length === 0) {
			console.log('📝 No integrity issues to log')
			return
		}

		const logContent = {
			checkTimestamp: new Date().toISOString(),
			database: this.dbManager.connectionInfo?.database || 'unknown',
			summary: {
				totalIssues: this.detailedIssues.length,
				totalOrphanedRecords: this.detailedIssues.reduce((sum, issue) => sum + issue.totalCount, 0),
			},
			issues: this.detailedIssues,
		}

		try {
			fs.writeFileSync(this.logFilePath, JSON.stringify(logContent, null, 2))
			console.log(`📝 Detailed issues logged to: ${this.logFilePath}`)
		} catch (error) {
			console.error(`❌ Failed to write log file: ${error.message}`)
		}
	}

	generateReport() {
		console.log('\n📊 INTEGRITY CHECK RESULTS')
		console.log('='.repeat(50))
		console.log(
			`✅ Passed: ${this.passed.length} | ⚠️ Warnings: ${this.warnings.length} | ❌ Issues: ${this.issues.length}`
		)

		if (this.issues.length > 0) {
			console.log('\n❌ CRITICAL ISSUES:')
			this.issues.forEach((issue, i) => console.log(`${i + 1}. ${issue}`))
		}

		if (this.warnings.length > 0) {
			console.log('\n⚠️ WARNINGS:')
			this.warnings.forEach((warning, i) => console.log(`${i + 1}. ${warning}`))
		}

		// Write detailed log file
		this.writeLogFile()

		console.log('\n' + '='.repeat(50))
		console.log(this.issues.length === 0 ? '🎉 DATABASE READY FOR MIGRATION!' : '⛔ FIX ISSUES BEFORE MIGRATION')
		console.log('='.repeat(50))

		return this.issues.length === 0
	}

	async run() {
		console.log('🔍 PRE-MIGRATION INTEGRITY CHECK')
		console.log('='.repeat(70))
		console.log('Comprehensive database validation before tenant data migration')

		try {
			if (!(await this.checkConnection())) {
				throw new Error('Database connection failed')
			}

			// NEW: Check reference columns used by helper.js for tenant assignment
			console.log('\n🎯 REFERENCE COLUMN VALIDATION FOR TENANT MIGRATION')
			console.log('='.repeat(70))
			await this.checkOrganizationIdReferences()
			await this.checkUserIdReferences()
			await this.checkUserExtensionsIntegrity()

			// Existing orphaned records check
			console.log('\n🎯 ORPHANED RECORDS VALIDATION')
			console.log('='.repeat(70))
			await this.checkOrphanedRecords()

			const isReady = this.generateReport()
			process.exit(isReady ? 0 : 1)
		} catch (error) {
			console.error(`❌ Check failed: ${error.message}`)
			process.exit(1)
		} finally {
			await this.dbManager.close()
		}
	}
}

if (require.main === module) {
	const checker = new DatabaseIntegrityChecker()
	checker.run()
}

module.exports = DatabaseIntegrityChecker
