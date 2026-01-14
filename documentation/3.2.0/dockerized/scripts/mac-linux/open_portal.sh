#!/bin/bash

# URL to check
URL="http://localhost:8100/"

# Interval in seconds between checks
CHECK_INTERVAL=5

# Function to check if the URL is accessible
check_url() {
  curl --silent --head --fail "$URL" > /dev/null 2>&1
  return $?
}

# Function to open URL in the default browser
open_url() {
  case "$(uname)" in
    "Linux") xdg-open "$URL";;
    "Darwin") open "$URL";;
    *) echo "Platform not supported for opening URL"; exit 1;;
  esac
}

# Loop until the URL is accessible
while ! check_url
do
  echo "Waiting for $URL to become available..."
  sleep $CHECK_INTERVAL
done

echo "$URL is available."

# Open the URL in the default browser
open_url
