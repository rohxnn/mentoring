#!/bin/bash

# Exit on error
set -e

# Define the GitHub raw URL for the JSON file
GITHUB_REPO="https://raw.githubusercontent.com/ELEVATE-Project/mentoring-mobile-app/refs/heads/release-3.1.1/forms.json"
JSON_FILE="forms.json"  # The name to save the downloaded file


# set organization_id
organization_id=1


# Check if the output directory is passed as an argument, otherwise use the current directory
if [ -z "$2" ]; then
    OUTPUT_DIR="."
else
    OUTPUT_DIR="$2"
fi

# Ensure the directory exists
if [ ! -d "$OUTPUT_DIR" ]; then
    echo "Error: Directory '$OUTPUT_DIR' does not exist."
    exit 1
fi

# Function to install jq
install_jq() {
    if command -v jq &>/dev/null; then
        echo "jq is already installed."
    else
        echo "Installing jq..."
        if [[ -x "$(command -v apt-get)" ]]; then
            # For Debian/Ubuntu
            sudo apt-get update
            sudo apt-get install -y jq
        elif [[ -x "$(command -v yum)" ]]; then
            # For Red Hat/CentOS
            sudo yum install -y jq
        elif [[ -x "$(command -v brew)" ]]; then
            # For macOS
            brew install jq
        else
            echo "Unsupported OS or package manager. Please install jq manually."
            exit 1
        fi
    fi
}

# Install jq
install_jq

# Output file
DUMP_FILE="$OUTPUT_DIR/forms.sql"

# Clear the output file if it exists
> "$DUMP_FILE"

#set default query to delete existing forms
echo "delete from forms;" > "$DUMP_FILE"

# Fetch the JSON file from the GitHub repository
echo "Fetching JSON file from GitHub..."
curl -o $JSON_FILE $GITHUB_REPO

# Check if the download was successful
if [ $? -ne 0 ]; then
    echo "Failed to download JSON file from GitHub."
    exit 1
fi

# Read the JSON file into a variable
jsonData=$(cat "$JSON_FILE")

# Loop through the JSON array
echo "$jsonData" | jq -c '.[]' | while read -r item; do
    # Extract values using jq
    type_value=$(echo "$item" | jq -r '.type')
    sub_type_value=$(echo "$item" | jq -r '.sub_type')
    data_value=$(echo "$item" | jq -c '.data')
    
    escaped_data_value=$(echo "$data_value" | sed "s/'/''/g")

    # Sample values for ID, version, and organization ID
    version_value=1

    # Construct the SQL query
    query="INSERT INTO forms (type, sub_type, data, version, organization_id, created_at, updated_at) VALUES ('$type_value', '$sub_type_value', '$escaped_data_value', $version_value, '$organization_id', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);"

    # Append the query to the dump file
    echo "$query" >> "$DUMP_FILE"
done


echo "Queries written to: $DUMP_FILE"