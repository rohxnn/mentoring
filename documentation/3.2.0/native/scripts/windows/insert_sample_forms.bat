@echo off
setlocal enabledelayedexpansion

:: Exit on error
set "EXIT_CODE=0"

:: Ensure correct number of arguments are provided
if "%~2"=="" (
    echo Error: Folder name and database URL not provided. Usage: %0 ^<folder_name^> ^<database_url^>
    exit /b 1
)

:: Use the provided folder name
set "FOLDER_NAME=sample-data\%1"

:: Check if folder exists
if not exist "%FOLDER_NAME%" (
    echo Error: Folder "%FOLDER_NAME%" not found.
    exit /b 1
)

:: Use the provided database URL
set "DEV_DATABASE_URL=%2"

:: Remove the postgres:// part of the URL
set "URL_PART=%DEV_DATABASE_URL:postgres://=%"

:: Split the URL into username:password, host:port/database
for /f "tokens=1,2 delims=@" %%a in ("%URL_PART%") do (
    set "USER_PASS=%%a"
    set "HOST_PORT_DB=%%b"
)

:: Further split the username and password
for /f "tokens=1,2 delims=:" %%a in ("%USER_PASS%") do (
    set "DB_USER=%%a"
    set "DB_PASSWORD=%%b"
)

:: Split the host:port and database name
for /f "tokens=1,2 delims=/" %%c in ("%HOST_PORT_DB%") do (
    set "HOST_PORT=%%c"
    set "DB_NAME=%%d"
)

:: Further split the host and port
for /f "tokens=1,2 delims=:" %%e in ("%HOST_PORT%") do (
    set "DB_HOST=%%e"
    set "DB_PORT=%%f"
)

:: Log extracted variables
echo Extracted Database Variables:
echo DB_USER: %DB_USER%
echo DB_PASSWORD: %DB_PASSWORD%
echo DB_HOST: %DB_HOST%
echo DB_PORT: %DB_PORT%
echo DB_NAME: %DB_NAME%

:: Wait for PostgreSQL to be ready to accept connections
echo Waiting for PostgreSQL on %DB_HOST%:%DB_PORT% to accept connections...
:WAIT_FOR_DB
set "PGPASSWORD=%DB_PASSWORD%"
psql -h %DB_HOST% -p %DB_PORT% -U %DB_USER% -c "select 1" >nul 2>&1
if errorlevel 1 (
    echo Waiting for database to be ready...
    timeout /t 1 >nul
    goto WAIT_FOR_DB
)
echo Database is ready.

:: Function to check if the database exists
echo Checking existence of database "%DB_NAME%"...
:CHECK_DB
psql -h %DB_HOST% -U %DB_USER% -p %DB_PORT% -lqt | findstr /i "%DB_NAME%" >nul
if errorlevel 1 (
    echo Database "%DB_NAME%" does not exist, waiting...
    timeout /t 5 >nul
    goto CHECK_DB
)
echo Database "%DB_NAME%" exists, proceeding with script.

:: ------------------------------------------------------------
:: Run `forms.sql` data insertion
:: ------------------------------------------------------------

:: Ensure that the `forms.sql` file exists
set "FORMS_SQL_FILE=%FOLDER_NAME%\forms.sql"
if not exist "%FORMS_SQL_FILE%" (
    echo Error: forms.sql not found in "%FOLDER_NAME%" folder.
    exit /b 1
)

:: Run the SQL script to insert the data
echo Inserting Forms Data from forms.sql...
psql -h %DB_HOST% -U %DB_USER% -d %DB_NAME% -p %DB_PORT% -f "%FORMS_SQL_FILE%"

echo Forms Data Insertion Completed.
exit /b %EXIT_CODE%