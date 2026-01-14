#!/bin/bash

# Logging function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> setup_log.txt
}

# Step 1: Download Docker Compose file
log "Downloading Docker Compose file..."
curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/docker-compose-mentoring.yml
log "Docker Compose file downloaded."

# Step 2: Download environment files
log "Downloading environment files..."
curl -L \
 -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/interface_env \
 -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/mentoring_env \
 -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/notification_env \
 -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/scheduler_env \
 -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/user_env \
 -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/env.js
 log "Environment files downloaded."

# Step 3: Download replace_volume_path.sh script
log "Downloading replace_volume_path.sh script..."
curl -OJL https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/mac-linux/replace_volume_path.sh
log "replace_volume_path.sh script downloaded."

# Step 4: Make replace_volume_path.sh executable
log "Making replace_volume_path.sh executable..."
chmod +x replace_volume_path.sh
log "Made replace_volume_path.sh executable."

# Step 5: Run replace_volume_path.sh script
log "Running replace_volume_path.sh script..."
./replace_volume_path.sh
log "replace_volume_path.sh script executed."

# Step 6: Download additional scripts
log "Downloading docker-compose scripts..."
curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/mac-linux/docker-compose-up.sh
curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/mac-linux/docker-compose-down.sh
log "docker-compose scripts downloaded."

# Step 7: Make the scripts executable
log "Making docker-compose scripts executable..."
chmod +x docker-compose-up.sh
chmod +x docker-compose-down.sh
log "Made docker-compose scripts executable."

# Step 8: Create user directory and download SQL file
log "Creating user directory and downloading distributionColumns.sql..."
mkdir mentoring && curl -o ./mentoring/distributionColumns.sql -JL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/distribution-columns/mentoring/distributionColumns.sql
mkdir user && curl -o ./user/distributionColumns.sql -JL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/distribution-columns/user/distributionColumns.sql
log "User directory created and distributionColumns.sql downloaded."

# Step 9: Download and make citus_setup.sh executable
log "Downloading citus_setup.sh..."
curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/mac-linux/citus_setup.sh
chmod +x citus_setup.sh
log "Downloading citus_setup script downloaded"

# Step 11: Download and make insert_sample_data.sh executable
log "Downloading insert_sample_data.sh..."
curl -L -o insert_sample_data.sh https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/mac-linux/insert_sample_data.sh && chmod +x insert_sample_data.sh
log "insert_sample_data.sh downloaded and made executable."

# Step 12: Download and make insert_forms_data.sh executable
log "Downloading insert_forms_data.sh..."
mkdir -p sample-data/mentoring && curl -L -o sample-data/mentoring/insert_sample_forms.sh https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/mac-linux/insert_sample_forms.sh && chmod +x sample-data/mentoring/insert_sample_forms.sh && \
curl -L -o sample-data/mentoring/create_default_form_sql.sh https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/mac-linux/create_default_form_sql.sh
log "insert_forms_data.sh downloaded and made executable."

# Step 10: Create sample-data directory and download SQL file
log "Creating sample-data directory and downloading sampleData.sql..."
mkdir -p sample-data/user && \
curl -L https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/sample-data/mac-linux/mentoring/sampleData.sql -o sample-data/mentoring/sampleData.sql && \
curl -L https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/sample-data/mac-linux/user/sampleData.sql -o sample-data/user/sampleData.sql
log "Sample-data directory created and sampleData.sql downloaded."

# Step 13: Run docker-compose-up.sh script
log "Running docker-compose-up.sh script..."
./docker-compose-up.sh
log "docker-compose-up.sh script executed."