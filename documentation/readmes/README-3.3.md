# MentorEd Mentoring Service - Tenant & Cache Guide

<div align="center">

<a href="https://shikshalokam.org/elevate/">
<img
    src="https://shikshalokam.org/wp-content/uploads/2021/06/elevate-logo.png"
    height="140"
    width="300"
  />
</a>

</br>

**Mentoring Service - Tenant Architecture & Cache Management**

</div>

---

# Database Upgrade Scripts - Mentoring Service

## Prerequisites Setup

```bash
# Install required tools
npm install -g sequelize-cli

# Backup existing database (recommended)
pg_dump -h localhost -U postgres mentoring > mentoring_backup_$(date +%Y%m%d_%H%M%S).sql

# Set required environment variables
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres
export DEV_DATABASE_URL=postgres://postgres:password@localhost:5432/mentoring
export DEFAULT_TENANT_CODE=default_tenant
export DEFAULT_ORGANISATION_CODE=default_org
export DEFAULT_ORG_ID=1
```

## Tenant Data Migration Scripts - Step-by-Step

### Step 1: Run Pre-Migration Integrity Check
```bash
# Navigate to tenant migration scripts
cd mentoring/src/scripts/tenantDataMigrations

# Run integrity check (REQUIRED before migration)
node pre-migration-integrity-check.js
```

### Step 2: Run Main Data Migration Script
```bash
# Run the main tenant data migration
node script.js

# This script will:
# - Load CSV data for organization mapping
# - Update 10 tables linked by organization_id
# - Update 13 tables linked by user_id
# - Add tenant_code and organization_code columns
# - Handle Citus database distribution (if enabled)
```

### Step 3: Run Tenant Column Update Script  
```bash
# Update tenant columns and finalize structure
node update-tenant-column-script.js

# This script will:
# - Set columns to NOT NULL
# - Update primary keys to include tenant_code
# - Configure Citus distribution (if enabled)
# - Add foreign key constraints
# - Create performance indexes
```

### Step 4: Install/Update Dependencies
```bash
cd mentoring/src
npm install
```

### Step 5: Run Database Setup Scripts
```bash
# Setup database functions
cd mentoring/src/scripts
node psqlFunction.js

# Setup database views
node viewsScript.js
```

### Step 6: Run New Migrations
```bash
cd mentoring/src
npx sequelize-cli db:migrate
```

### Step 7: Update Seed Data (If Needed)
```bash
cd mentoring/src
npm run db:seed:all
```

## Verification Commands

### Check Migration Status
```bash
cd mentoring/src
npx sequelize-cli db:migrate:status
```

### Verify Tenant Data Migration
```bash
# Check if tenant_code columns are populated
psql -h localhost -U postgres -d mentoring -c "SELECT COUNT(*) FROM sessions WHERE tenant_code IS NULL;"

# Check organization_code columns
psql -h localhost -U postgres -d mentoring -c "SELECT COUNT(*) FROM organization_extension WHERE organization_code IS NULL;"
```

### Verify Updated Tables
```bash
psql -h localhost -U postgres -d mentoring -c "\dt"
```

### Test Database Connectivity
```bash
psql -h localhost -U postgres -d mentoring -c "SELECT version();"
```

## Rollback Commands (If Issues Occur)

### Undo Last Migration
```bash
cd mentoring/src
npx sequelize-cli db:migrate:undo
```

### Restore from Backup (Emergency)
```bash
# Drop existing database (CAUTION)
dropdb mentoring
createdb mentoring

# Restore from backup
psql -h localhost -U postgres mentoring < mentoring_backup_YYYYMMDD_HHMMSS.sql
```

---

# Quick Commands Reference

## Complete Mentoring Service Upgrade with Tenant Migration
```bash
# Full upgrade sequence for existing database
cd mentoring/src/scripts/tenantDataMigrations
node pre-migration-integrity-check.js
node script.js
node update-tenant-column-script.js
cd ../..
npm install
cd scripts && node psqlFunction.js && node viewsScript.js && cd ..
npx sequelize-cli db:migrate
npm run db:seed:all
```

# R 3.3 Tenant Migration Checklists

## 1. Migrations for Tenant (New Schema) ✅

### Schema Changes Checklist

#### Database Schema Modifications
- [ ] **Add tenant_code column** to all mentoring tables (23+ tables)
- [ ] **Add organization_code column** to all mentoring tables  
- [ ] **Update primary keys** to include tenant_code for multi-tenant isolation
- [ ] **Create tenant-aware foreign key constraints** 
- [ ] **Add performance indexes** on tenant_code and organization_code columns
- [ ] **Configure Citus distribution** (if horizontal scaling enabled)

#### Table Schema Updates Required
```sql
-- Core mentoring tables requiring tenant columns:
sessions, session_attendees, user_extensions, organization_extension,
entities, entity_types, forms, feedbacks, connections, connection_requests,
availabilities, default_rules, file_uploads, notification_templates,
report_queries, reports, role_extensions, issues, resources,
session_request, question_sets, questions, post_session_details
```

#### Schema Migration Scripts
- [ ] **Pre-migration integrity check** - `pre-migration-integrity-check.js` ✅
- [ ] **Column addition migrations** - `script.js` ✅ 
- [ ] **Constraint and index updates** - `update-tenant-column-script.js` ✅
- [ ] **Sequelize model updates** - Manual code changes required
- [ ] **Database function updates** - `psqlFunction.js` ✅
- [ ] **View updates** - `viewsScript.js` ✅

#### Verification Commands
```bash
# Verify all tables have tenant columns
psql -d mentoring -c "SELECT table_name FROM information_schema.columns WHERE column_name = 'tenant_code';"

# Check primary key updates
psql -d mentoring -c "SELECT conname, conkey FROM pg_constraint WHERE contype = 'p' AND conname LIKE '%pkey%';"

# Verify indexes on tenant columns
psql -d mentoring -c "SELECT indexname FROM pg_indexes WHERE indexdef LIKE '%tenant_code%';"
```

---

## 2. Data Migration for Tenant ✅

### Data Population Checklist

#### CSV Data Requirements
- [ ] **data_codes.csv file** with organization mappings ✅
  ```csv
  organization_id,organization_code,tenant_code
  1,default_org,default_tenant
  2,shikshalokam,shikshalokam_tenant
  ```
- [ ] **Validate CSV data completeness** - All organization_ids in database must exist in CSV
- [ ] **Backup existing database** before migration ✅

#### Data Migration Process
- [ ] **Organization-based table updates** (10 tables) - Direct organization_id lookup ✅
- [ ] **User-based table updates** (13 tables) - Via user_extensions.organization_id lookup ✅
- [ ] **Null value validation** - No NULL tenant_code/organization_code after migration
- [ ] **Data integrity verification** - All foreign key relationships maintained
- [ ] **Performance optimization** - Batch processing for large datasets (30+ lakh records)

#### Tables Updated by Organization ID
```
availabilities, default_rules, entity_types, file_uploads, forms,
notification_templates, organization_extension, report_queries, 
reports, role_extensions
```

#### Tables Updated by User ID Lookup
```
user_extensions, sessions, session_attendees, feedbacks, 
connection_requests, connections, entities, issues, resources,
session_request, question_sets, questions, post_session_details
```

#### Data Validation Commands
```bash
# Check all records have tenant_code populated
psql -d mentoring -c "SELECT 
  'sessions' as table_name, 
  COUNT(*) as total, 
  COUNT(tenant_code) as with_tenant_code,
  COUNT(*) - COUNT(tenant_code) as missing_tenant_code
FROM sessions;"

# Verify organization mapping completeness
psql -d mentoring -c "SELECT DISTINCT organization_code, tenant_code FROM organization_extension ORDER BY organization_code;"
```

---

## 3. Code Changes for Tenant ✅

### Application Code Updates Checklist

#### Model Updates (Sequelize)
- [ ] **Update all Sequelize models** to include tenant_code and organization_code fields
- [ ] **Add tenant-aware default scopes** to automatically filter by organization
- [ ] **Update primary key definitions** in models to include tenant_code
- [ ] **Add tenant validation** in model hooks and validations
- [ ] **Update associations** to be tenant-aware

#### Service Layer Changes
- [ ] **Extract organization context** from request headers/tokens in all services
- [ ] **Add tenant filtering** to all database queries automatically
- [ ] **Update cache key patterns** to include organization_code
- [ ] **Modify bulk operations** to respect tenant boundaries
- [ ] **Add tenant validation middleware** for API endpoints

#### Controller Updates
- [ ] **Organization context extraction** in all controller methods
- [ ] **Tenant-aware pagination** and filtering
- [ ] **Update error handling** to include tenant context
- [ ] **Modify export/import functions** to respect tenant boundaries

#### Helper and Utility Updates
- [ ] **Update search helpers** to include tenant filtering
- [ ] **Modify report generation** to be tenant-specific
- [ ] **Update notification systems** to respect tenant boundaries
- [ ] **Cache helper updates** for organization-based keys

#### Configuration Changes
- [ ] **Environment variables** for default tenant/organization codes ✅
- [ ] **Database connection** updates for tenant-aware queries
- [ ] **Redis configuration** for tenant-based cache keys ✅
- [ ] **Citus configuration** for distributed tenant data (if enabled)

#### Code Verification
```bash
# Search for hardcoded queries that need tenant filtering
grep -r "SELECT.*FROM" src/services/ | grep -v "tenant_code\|organization_code"

# Check model files for tenant_code inclusion
grep -r "tenant_code" src/database/models/

# Verify cache key patterns include organization
grep -r "redis\|cache" src/helpers/ | grep -v "org:\|organization"
```

---

## 4. Test Data Creation for Migration Validation ✅

### Test Environment Setup

#### Pre-Migration Test Data Requirements

**Organizations**
```sql
-- Create test organizations
INSERT INTO organization_extension (id, organization_id, code, name, status) VALUES
(1, 1, 'test_org_1', 'Test Organization 1', 'ACTIVE'),
(2, 2, 'test_org_2', 'Test Organization 2', 'ACTIVE'),
(3, 3, 'disabled_org', 'Disabled Organization', 'INACTIVE');
```

**Users** 
```sql
-- Create test users in different organizations
INSERT INTO user_extensions (user_id, organization_id, designation, about, location) VALUES
(101, 1, 'Senior Mentor', 'Test mentor for org 1', 'Location 1'),
(102, 1, 'Junior Mentee', 'Test mentee for org 1', 'Location 1'),
(201, 2, 'Senior Mentor', 'Test mentor for org 2', 'Location 2'),
(202, 2, 'Junior Mentee', 'Test mentee for org 2', 'Location 2'),
(301, 3, 'Disabled User', 'User in disabled org', 'Location 3');
```

**Sessions**
```sql
-- Create test sessions across organizations
INSERT INTO sessions (title, description, created_by, status, organization_id) VALUES
('Org 1 Session 1', 'Test session for org 1', 101, 'PUBLISHED', 1),
('Org 1 Session 2', 'Another session for org 1', 101, 'DRAFT', 1),
('Org 2 Session 1', 'Test session for org 2', 201, 'PUBLISHED', 2),
('Disabled Org Session', 'Session in disabled org', 301, 'DRAFT', 3);
```

**Relationships & Dependencies**
```sql
-- Session attendees
INSERT INTO session_attendees (session_id, mentee_id, status) VALUES
(1, 102, 'ENROLLED'),
(3, 202, 'ENROLLED');

-- Connections between users
INSERT INTO connections (mentor_id, mentee_id, created_by, status, organization_id) VALUES
(101, 102, 101, 'ACTIVE', 1),
(201, 202, 201, 'ACTIVE', 2);
```

#### CSV Test Data (data_codes.csv)
```csv
organization_id,organization_code,tenant_code
1,test_org_1,test_tenant_1
2,test_org_2,test_tenant_2
3,disabled_org,disabled_tenant
```

#### Post-Migration Validation Tests

**Data Isolation Verification**
```sql
-- Test 1: Verify all records have tenant_code
SELECT 
  'sessions' as table_name,
  COUNT(*) as total_records,
  COUNT(tenant_code) as records_with_tenant,
  COUNT(*) - COUNT(tenant_code) as missing_tenant_code
FROM sessions
UNION ALL
SELECT 
  'user_extensions' as table_name,
  COUNT(*) as total_records, 
  COUNT(tenant_code) as records_with_tenant,
  COUNT(*) - COUNT(tenant_code) as missing_tenant_code
FROM user_extensions;
```

**Tenant Isolation Test**
```sql
-- Test 2: Verify tenant isolation works
SELECT tenant_code, COUNT(*) as session_count 
FROM sessions 
GROUP BY tenant_code;

-- Should show sessions grouped by tenant with no cross-tenant data
```

**Performance Test Data**
```sql
-- Generate larger test dataset for performance validation
DO $$
DECLARE
  i INTEGER;
BEGIN
  FOR i IN 1..1000 LOOP
    INSERT INTO sessions (title, description, created_by, status, organization_id)
    VALUES (
      'Performance Test Session ' || i,
      'Generated session for performance testing',
      101,
      'PUBLISHED',
      1
    );
  END LOOP;
END $$;
```

**Cache Validation Test**
```bash
# Test cache key patterns work correctly
redis-cli SET "org:test_org_1:sessions" "test_data"
redis-cli GET "org:test_org_1:sessions"

# Test cache isolation
redis-cli KEYS "org:test_org_*"
```

#### Migration Validation Script
```bash
#!/bin/bash
# validation-test.sh

echo "🧪 Running post-migration validation tests..."

# Test 1: Check all tables have tenant columns
echo "📋 Checking tenant column existence..."
psql -d mentoring -c "
SELECT table_name, 
       (SELECT count(*) FROM information_schema.columns 
        WHERE table_name = t.table_name AND column_name = 'tenant_code') as has_tenant_code,
       (SELECT count(*) FROM information_schema.columns 
        WHERE table_name = t.table_name AND column_name = 'organization_code') as has_org_code
FROM information_schema.tables t 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'SequelizeMeta%';"

# Test 2: Validate data completeness  
echo "📊 Checking data completeness..."
psql -d mentoring -c "
SELECT 'sessions' as table_name, 
       COUNT(*) as total, 
       COUNT(tenant_code) as with_tenant 
FROM sessions
UNION ALL
SELECT 'user_extensions', COUNT(*), COUNT(tenant_code) FROM user_extensions;"

# Test 3: Test tenant isolation
echo "🔒 Testing tenant data isolation..."
psql -d mentoring -c "
SELECT tenant_code, COUNT(*) as record_count 
FROM sessions 
WHERE tenant_code IS NOT NULL
GROUP BY tenant_code;"

echo "✅ Validation tests completed!"
```

---

# Tenant & Organization Architecture

## Overview

The Mentoring Service implements **multi-tenant architecture** where each organization operates as an isolated tenant. All mentoring data (sessions, mentors, mentees) is completely separated by organization, ensuring security and privacy.

## How Multi-Tenancy Works

### Data Isolation Flow
```
Request → Extract Organization → Apply Filter → Mentoring Data Query
```

**Step-by-Step Process:**
1. **Request Arrives**: API receives request with organization context
2. **Organization Identification**: Middleware extracts organization identifier
3. **Data Filtering**: All mentoring queries include organization filter
4. **Response**: Only organization-specific mentoring data returned

### Organization Structure
Each organization has isolated:
- **Sessions**: Mentoring sessions and schedules
- **User Profiles**: Mentor and mentee profiles
- **Configurations**: Session types, forms, settings
- **Cache Data**: Organization-specific cached information

## Tenant Migration Process

### What the Migration Does
The tenant migration scripts add multi-tenancy support by:
1. **Adding Tenant Columns**: `tenant_code` and `organization_code` to all tables
2. **Data Population**: Populates tenant data from CSV mapping files
3. **Primary Key Updates**: Updates primary keys to include `tenant_code`
4. **Constraint Updates**: Adds tenant-aware foreign keys and indexes
5. **Citus Distribution**: Prepares for horizontal scaling (if enabled)

### Adding New Organization to Existing System
When a new organization is added:
1. **Database Record**: Insert organization details into existing tables
2. **Default Configuration**: Create default session types and forms
3. **Permissions Setup**: Configure organization-specific permissions
4. **Cache Initialization**: Set up organization-specific cache keys

### Organization Dependencies
Organization affects:
- **Session Management**: Session configurations and types
- **User Profiles**: Mentor/mentee form structures  
- **Cache Layer**: Organization-specific cache keys
- **Permissions**: Role-based access controls

---

# Cache Architecture (Redis)

## How Caching Works

The Mentoring Service uses **Redis** for high-performance caching with **organization-based isolation**. Cache improves response times by storing frequently accessed mentoring data in memory.

## Cache Key Structure

### Organization-Based Keys
```
org:{org_code}:{data_type}
```

**Examples:**
- `org:example_org:details` - Organization information
- `org:example_org:config` - Organization configuration
- `org:example_org:permissions` - Permission settings

### Mentoring Data Keys
```
{data_type}:{org_code}:{identifier}
```

**Examples:**
- `sessions:example_org:upcoming` - Upcoming sessions
- `mentors:example_org:active` - Active mentors list
- `forms:example_org:session_type` - Session form configurations

## Cache Management for Upgrades

### Pre-Upgrade Cache Clear
```bash
# Clear all cached data before upgrade
redis-cli FLUSHDB

# Or clear specific organization data
redis-cli --scan --pattern "org:*" | xargs redis-cli DEL
```

### Post-Upgrade Cache Warming
```bash
# Monitor cache population after upgrade
redis-cli MONITOR

# Check cache usage
redis-cli INFO memory
```

### TTL (Time-To-Live) Strategy
- **Organization Data**: 24 hours (rarely changes)
- **Session Data**: 2 hours (frequent updates)
- **User Profiles**: 6 hours (moderate changes)
- **Form Configuration**: 4 hours (occasional updates)

### Cache Invalidation
**Automatic Triggers:**
- Organization update → Clear `org:{code}:*`
- Session modification → Clear `sessions:{org}:*`
- Profile changes → Clear `mentors:{org}:*` or `mentees:{org}:*`

**Manual Commands:**
```bash
# Clear organization cache
redis-cli DEL org:example_org:*

# Clear session cache for organization
redis-cli --scan --pattern "sessions:example_org:*" | xargs redis-cli DEL

# View cache usage
redis-cli INFO memory
```

---

# Cache Operations & Health Checks

## Cache Operations
```bash
# View all organization cache
redis-cli KEYS "org:*"

# Clear specific organization cache
redis-cli --scan --pattern "org:example_org:*" | xargs redis-cli DEL

# Monitor cache activity
redis-cli MONITOR
```

## Health Checks After Upgrade
```bash
# Database connectivity
pg_isready -h localhost -p 5432 -U postgres

# Redis connectivity
redis-cli ping

# View mentoring tables
psql -h localhost -U postgres -d mentoring -c "\dt"

# Check tenant columns are populated
psql -h localhost -U postgres -d mentoring -c "SELECT COUNT(*) as total_sessions, COUNT(tenant_code) as with_tenant FROM sessions;"
```

---

# Troubleshooting Upgrade Issues

## Common Upgrade Issues

### Tenant Migration Errors
```bash
# Check data integrity before migration
cd mentoring/src/scripts/tenantDataMigrations
node pre-migration-integrity-check.js

# Check for missing CSV files
ls -la ../../data/data_codes.csv

# Verify organization mappings
head -5 ../../data/data_codes.csv
```

### Migration Script Errors
```bash
# Check current migration status
npx sequelize-cli db:migrate:status

# Check which migrations failed
npx sequelize-cli db:migrate:status | grep -E "(down|pending)"

# Rollback problematic migration
npx sequelize-cli db:migrate:undo

# Retry migration
npx sequelize-cli db:migrate
```

### Cache Issues After Upgrade
```bash
# Clear all organization cache if issues persist
redis-cli FLUSHDB

# Restart Redis if needed
sudo service redis-server restart

# Verify cache is working
redis-cli SET test_key "test_value"
redis-cli GET test_key
redis-cli DEL test_key
```

### Database Connection Issues
```bash
# Test PostgreSQL connection
psql -h localhost -U postgres -c "SELECT version();"

# Check database exists
psql -h localhost -U postgres -l | grep mentoring

# Verify tables exist
psql -h localhost -U postgres -d mentoring -c "\dt"
```

### Rollback Strategy
```bash
# If upgrade fails completely
cd mentoring/src

# Rollback all new migrations
npx sequelize-cli db:migrate:undo:all --to YYYYMMDDHHMMSS-last-good-migration.js

# Restore from backup if needed
psql -h localhost -U postgres mentoring < mentoring_backup_YYYYMMDD_HHMMSS.sql
```

## CSV Data File Requirements

The tenant migration requires a CSV file with organization mappings:

### Required CSV Format (data_codes.csv)
```csv
organization_id,organization_code,tenant_code
1,default_org,default_tenant
2,shikshalokam,shikshalokam_tenant
3,elevate,elevate_tenant
```

### CSV File Location
```bash
# Place CSV file in correct location
cp data_codes.csv mentoring/src/data/data_codes.csv

# Verify file exists
ls -la mentoring/src/data/data_codes.csv
```