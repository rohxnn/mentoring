#!/bin/bash

# Define the path of your docker-compose file
DOCKER_COMPOSE_FILE="docker-compose-mentoring.yml"

# Check if the Docker Compose file exists
if [ ! -f "$DOCKER_COMPOSE_FILE" ]; then
    echo "Error: Docker Compose file '$DOCKER_COMPOSE_FILE' does not exist."
    exit 1
fi

# Get the current directory path
CURRENT_DIR=$(pwd)

# Escape the current directory path to be used in a sed expression
ESCAPED_CURRENT_DIR=$(printf '%s\n' "$CURRENT_DIR" | sed -e 's/[\/&]/\\&/g')

sed -i -e "s|/[^:]*\(\/env\.js\):/usr/src/app/www/assets/env/env.js|$ESCAPED_CURRENT_DIR\1:/usr/src/app/www/assets/env/env.js|" "$DOCKER_COMPOSE_FILE"
echo "Updated volume path for 'env.js' in $DOCKER_COMPOSE_FILE"
