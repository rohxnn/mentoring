#!/usr/bin/env node

/**
 * Migration Runner for Mentoring Service
 * Handles 30+ lakh records with Citus distribution
 */

require('dotenv').config()
const MentoringDataMigrator = require('./helper')
const readline = require('readline')

console.log('🎯 Mentoring Service Data Migration')
console.log('==============================================')

// Configuration check
console.log('\n📋 Environment Configuration:')
console.log(`   Database URL: ${process.env.DEV_DATABASE_URL ? '✅ Set' : '❌ Missing'}`)
console.log(`   Default Tenant: ${process.env.DEFAULT_TENANT_CODE}`)
console.log(`   Default Org Code: ${process.env.DEFAULT_ORGANISATION_CODE}`)
console.log(`   Default Org ID: ${process.env.DEFAULT_ORG_ID || '1'}`)

// Check CSV files
const fs = require('fs')
const path = require('path')

console.log('\n📁 CSV Files Status:')
const csvFiles = ['sample_data_codes.csv']
let allFilesExist = true

csvFiles.forEach((file) => {
	const filePath = path.join(__dirname, '../../data', file)
	const exists = fs.existsSync(filePath)
	console.log(`   ${file}: ${exists ? '✅ Found' : '❌ Missing'}`)
	if (!exists) allFilesExist = false

	if (exists) {
		const stats = fs.statSync(filePath)
		const sizeKB = Math.round(stats.size / 1024)
		console.log(`     Size: ${sizeKB}KB, Modified: ${stats.mtime.toISOString().split('T')[0]}`)
	}
})

// Migration execution plan
console.log('\n📋 Migration Execution Plan:')
console.log('   Step 1: Load and validate CSV data (organization mapping)')
console.log('   Step 2: Update tables linked by organization_id (10 tables)')
console.log('           → Direct organization lookup from CSV data')
console.log('   Step 3: Update tables linked by user_id (13 tables)')
console.log('           → Join with user_extensions to get organization')
console.log('   Step 4: Handle Citus database distribution (if enabled)')
console.log('           → Redistribute tables with tenant_code as partition key')
console.log('')
console.log('   🔄 Processing Method: Batch updates per organization')
console.log('   ⏱️  Estimated Duration: 30-60 minutes for large datasets')
console.log('   🔒 Data Safety: All operations use database transactions')

console.log('\n⚠️  PREREQUISITES & REQUIREMENTS:')
console.log('   ✓ data_codes.csv must contain: organization_id, organization_code, tenant_code')
console.log('   ✓ All organization_ids in database must exist in CSV file')
console.log('   ✓ Database connection configured via DEV_DATABASE_URL')
console.log('   ✓ Sufficient disk space for Citus redistribution (if enabled)')

console.log('\n📊 What This Migration Does:')
console.log('   → Adds tenant_code and organization_code to all mentoring tables')
console.log('   → Enables multi-tenant data isolation for the platform')
console.log('   → Prepares database for horizontal scaling with Citus')

if (!allFilesExist) {
	console.log('\n❌ MISSING CSV FILES:')
	console.log('   Please export data_codes.csv from user service first:')
	console.log('   1. Create data_codes.csv with columns: organization_id, organization_code, tenant_code')
	console.log('   2. Save file in ../../data/ directory')
	console.log('   3. Re-run this script')
	process.exit(1)
}

// Prompt for confirmation
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

rl.question('\n🤔 Proceed with migration? (y/N): ', async (answer) => {
	if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
		console.log('\n🚀 Starting migration...')
		console.log('   ⏰ Started at:', new Date().toISOString())
		rl.close()

		try {
			const migrator = new MentoringDataMigrator()

			// Migration configuration - can be overridden via environment variables
			migrator.batchSize = parseInt(process.env.BATCH_SIZE) || 5000
			migrator.progressInterval = parseInt(process.env.PROGRESS_INTERVAL) || 10000

			console.log('\n📊 Migration Settings:')
			console.log(`   Batch size: ${migrator.batchSize}`)
			console.log(`   Progress updates: Every ${migrator.progressInterval} records`)

			await migrator.execute()

			console.log('\n🎉 Migration completed successfully!')
			console.log('   ⏰ Finished at:', new Date().toISOString())
			process.exit(0)
		} catch (error) {
			console.error('\n❌ Migration failed:', error)
			console.log('   ⏰ Failed at:', new Date().toISOString())
			console.log('\n🔧 Troubleshooting:')
			console.log('   • Check database connectivity')
			console.log('   • Verify CSV file integrity')
			console.log('   • Check disk space for redistribution')
			console.log('   • Review error logs above')
			process.exit(1)
		}
	} else {
		console.log('\n❌ Migration cancelled by user')
		console.log('   Use update-tenant-column-script.js for testing')
		rl.close()
		process.exit(0)
	}
})
