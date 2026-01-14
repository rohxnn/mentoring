@echo off
setlocal

:: Get the directory where this batch script is located
set "SCRIPT_DIR=%~dp0"

:: Define the GitHub raw URL for the JSON file
set "GITHUB_REPO=https://raw.githubusercontent.com/ELEVATE-Project/mentoring-mobile-app/refs/heads/release-3.1.1/forms.json"
set "JSON_FILE=%SCRIPT_DIR%forms.json"

:: Set organization_id
set "organization_id=1"

:: Define the output directory relative to the script's directory
set "OUTPUT_DIR=%SCRIPT_DIR%"

:: Ensure the output directory exists
if not exist "%OUTPUT_DIR%" (
    echo Creating directory '%OUTPUT_DIR%'...
    mkdir "%OUTPUT_DIR%"
)

:: Define the output file path for the SQL file
set "SQL_OUTPUT_FILE=%OUTPUT_DIR%forms.sql"

:: Fetch JSON file from GitHub repository
echo Fetching JSON file from GitHub...
curl -o "%JSON_FILE%" "%GITHUB_REPO%"

:: Check if the download was successful
if errorlevel 1 (
    echo Failed to download JSON file from GitHub.
    exit /b 1
)

:: Write initial SQL delete statement to clear existing data in 'forms' table
echo delete from forms; > "%SQL_OUTPUT_FILE%"
echo Generating SQL insert statements...

:: Initialize ID counter
set /a id_counter=1

:: Use PowerShell to parse JSON and generate SQL insert statements
powershell -Command ^
    "$jsonData = Get-Content '%JSON_FILE%' | ConvertFrom-Json; " ^
    "$id_counter = 1; " ^
    "$jsonData | ForEach-Object { " ^
        "$current_timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); " ^
        "$sql = 'INSERT INTO forms (id, type, sub_type, data, version, organization_id, created_at, updated_at) VALUES (' + $id_counter.ToString() + ', ''' + $_.type + ''', ''' + $_.sub_type + ''', ''';" ^
        "$sql += ($_.data | ConvertTo-Json -Compress -Depth 100).Replace(\"'\", \"''\") + ''', 1, %organization_id%, ''' + $current_timestamp + ''', ''' + $current_timestamp + ''');'; " ^
        "Add-Content -Path '%SQL_OUTPUT_FILE%' -Value $sql; " ^
        "$id_counter += 1; " ^
    "}"

:: Append a final statement to the SQL file
echo SELECT NULL; >> "%SQL_OUTPUT_FILE%"

echo SQL file generated: "%SQL_OUTPUT_FILE%"
endlocal