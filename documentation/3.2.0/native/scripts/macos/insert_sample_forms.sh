#!/bin/bash

# Exit on error
set -e

# Ensure correct number of arguments are provided
if [ $# -lt 2 ]; then
    echo "Error: Folder name and database URL not provided. Usage: $0 <folder_name> <database_url>"
    exit 1
fi

# Use the provided folder name
FOLDER_NAME="sample-data/$1"

# Check if folder exists
if [ ! -d "$FOLDER_NAME" ]; then
    echo "Error: Folder '$FOLDER_NAME' not found."
    exit 1
fi

# Use the provided database URL
DEV_DATABASE_URL="$2"

# Extract database credentials and connection details using awk for portability
DB_USER=$(echo $DEV_DATABASE_URL | awk -F '[:@/]' '{print $4}')
DB_PASSWORD=$(echo $DEV_DATABASE_URL | awk -F '[:@/]' '{print $5}')
DB_HOST=$(echo $DEV_DATABASE_URL | awk -F '[:@/]' '{print $6}')
DB_PORT=$(echo $DEV_DATABASE_URL | awk -F '[:@/]' '{split($7,a,"/"); print a[1]}')
DB_NAME=$(echo $DEV_DATABASE_URL | awk -F '/' '{print $NF}')

# Log database variables
echo "Extracted Database Variables:"
echo "DB_USER: $DB_USER"
echo "DB_PASSWORD: $DB_PASSWORD"
echo "DB_HOST: $DB_HOST"
echo "DB_PORT: $DB_PORT"
echo "DB_NAME: $DB_NAME"

# Wait for PostgreSQL to be ready to accept connections
echo "Waiting for PostgreSQL on '$DB_HOST:$DB_PORT' to accept connections..."
until PGPASSWORD="$DB_PASSWORD" pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER"; do
    echo "Waiting for database to be ready..."
    sleep 1
done
echo "Database is ready."

# Function to check if the database exists
check_database() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -p "$DB_PORT" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"
}

echo "Checking existence of database '$DB_NAME'..."
until check_database; do
    echo "Database '$DB_NAME' does not exist, waiting..."
    sleep 5
done
echo "Database '$DB_NAME' exists, proceeding with script."

# ------------------------------------------------------------
# New code to push `forms.sql` data into the database
# ------------------------------------------------------------

DEFAULT_FORM_FOLDER_LOCATION=$FOLDER_NAME

chmod +x sample-data/mentoring/create_default_form_sql.sh

sample-data/mentoring/create_default_form_sql.sh $FOLDER_NAME

FORMS_SQL_FILE="forms.sql"
if [ ! -f "$FORMS_SQL_FILE" ]; then
    echo "Error: forms.sql not found."
    exit 1
fi

echo "Inserting Forms Data from forms.sql..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -p "$DB_PORT" -f "$FORMS_SQL_FILE"

echo "Forms Data Insertion Completed."