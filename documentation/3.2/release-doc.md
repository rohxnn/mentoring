# New Features

## **Chat Communication**

> \- Mentees can request a chat with mentors.
>
> \- Mentors can accept or decline the chat request.
>
> \- Real-time communication enabled via Rocket.Chat.

## **Session Requests**

> \- Mentees can request sessions with mentors.
>
> \- Mentors can review and accept/decline requests.

## **Private Session Scheduling**

> \- Mentors can schedule private sessions with mentees.
>
> \- Allows personalized 1:1 learning.

## **Account Deletion**

> \- Both mentors and mentees can delete their accounts.
>
> \- Ensures user control over personal data and privacy.

## **Events Introduced**

> -Deprecated few user-related APIs and introduced event-based
> communication between the User Service and Mentoring Service.

## 

# 

# Technical Setup

For setting up the 3.2, we have to setup rocket chat and
chat-communication service

System Requirements for chat communication service

\- OS: Ubuntu 20.04+ (recommended)

\- Node.js: v18+

\- Database: PostgreSQL 13+

\- Chat Service: Rocket.Chat 6.6.1

\- Memory: 4 GB RAM (minimum)\
- Docker: v24+

## 

# Rocket.Chat Setup with Docker Compose

System Requirements for Rocket.chat

\- OS: Ubuntu 20.04+ (recommended)

\- Chat Service: Rocket.Chat 6.6.1

\- Memory: 4 GB RAM (minimum)\
- Docker: v24+

### Step 1: Install Docker and Dependencies

> *sudo apt-get update\
> sudo apt-get install ca-certificates curl\
> sudo install -m 0755 -d /etc/apt/keyrings\
> sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o
> /etc/apt/keyrings/docker.asc\
> sudo chmod a+r /etc/apt/keyrings/docker.asc*

### Step 2: Add Docker Repository

> *echo \"deb \[arch=\$(dpkg \--print-architecture)
> signed-by=/etc/apt/keyrings/docker.asc\]
> https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo
> \"\${UBUNTU_CODENAME:-\$VERSION_CODENAME}\") stable\" \| sudo tee
> /etc/apt/sources.list.d/docker.list \> /dev/null\
> \
> sudo apt-get update*

### Step 3: Install Docker Packages

> *sudo apt-get install docker-ce docker-ce-cli containerd.io
> docker-buildx-plugin docker-compose-plugin*

### 

### Step 4: Create docker-compose.yml

```yaml
name: rocket-chat-docker
volumes:
  mongodb_data: { driver: local }

services:
  rocketchat:
    image: registry.rocket.chat/rocketchat/rocket.chat:6.6.1
    restart: always
    labels:
      traefik.enable: "true"
      traefik.http.routers.rocketchat.rule: Host("${DOMAIN:-}")
      traefik.http.routers.rocketchat.tls: "true"
      traefik.http.routers.rocketchat.entrypoints: https
      traefik.http.routers.rocketchat.tls.certresolver: le
    environment:
      MONGO_URL: "${MONGO_URL:-mongodb://${MONGODB_ADVERTISED_HOSTNAME:-mongodb}:${MONGODB_INITIAL_PRIMARY_PORT_NUMBER:-27017}/${MONGODB_DATABASE:-rocketchat}?replicaSet=${MONGODB_REPLICA_SET_NAME:-rs0}}"
      MONGO_OPLOG_URL: "${MONGO_OPLOG_URL:-mongodb://${MONGODB_ADVERTISED_HOSTNAME:-mongodb}:${MONGODB_INITIAL_PRIMARY_PORT_NUMBER:-27017}/local?replicaSet=${MONGODB_REPLICA_SET_NAME:-rs0}}"
      ROOT_URL: ${ROOT_URL:-http://localhost:${HOST_PORT:-3969}}
      PORT: ${PORT:-3969}
      DEPLOY_METHOD: docker
      DEPLOY_PLATFORM: ${DEPLOY_PLATFORM:-}
      REG_TOKEN: ${REG_TOKEN:-}
      # INITIAL_USER: yes
      #ADMIN_USERNAME: admin
      #ADMIN_NAME: Admin
      #ADMIN_EMAIL: rodriq@localhost.com
      #ADMIN_PASS: supersecret123##
      # OVERWRITE_SETTING_Show_Setup_Wizard: completed
    depends_on:
      - mongodb
    expose:
      - ${PORT:-3969}
    ports:
      - "${BIND_IP:-0.0.0.0}:${HOST_PORT:-3969}:${PORT:-3969}"
    networks:
      - elevate_net

  mongodb:
    image: docker.io/bitnami/mongodb:${MONGODB_VERSION:-5.0} 
    ports:
      - "27017:27017"
    restart: always
    volumes:
      - mongodb_data:/bitnami/mongodb
    environment:
      MONGODB_REPLICA_SET_MODE: primary
      MONGODB_REPLICA_SET_NAME: ${MONGODB_REPLICA_SET_NAME:-rs0}
      MONGODB_PORT_NUMBER: ${MONGODB_PORT_NUMBER:-27017}
      MONGODB_INITIAL_PRIMARY_HOST: ${MONGODB_INITIAL_PRIMARY_HOST:-mongodb}
      MONGODB_INITIAL_PRIMARY_PORT_NUMBER: ${MONGODB_INITIAL_PRIMARY_PORT_NUMBER:-27017}
      MONGODB_ADVERTISED_HOSTNAME: ${MONGODB_ADVERTISED_HOSTNAME:-mongodb}
      MONGODB_ENABLE_JOURNAL: ${MONGODB_ENABLE_JOURNAL:-true}
      ALLOW_EMPTY_PASSWORD: ${ALLOW_EMPTY_PASSWORD:-yes}
    networks:
      - elevate_net

networks:
  elevate_net:
    external: false

```



Note : MongoDb image version can be changed if specific version not
available

### Start Rocket Chat - Docker Compose Usage

#### Start Containers

### **Docker compose up -d**

#### Stop Containers

### **Docker compose down**


### Setup the rocket chat


#### Create Admin Credentials Using Web Application of Rocket Chat

    Keep the credentials once which is required in chat service .env

### Create Access token:

-   login using admin account

-   Access My Account: Click on your profile image in the Rocket.Chat \>
    client and select \"My Account.\"

-   Navigate to Personal Access Tokens: In the \"My Account\" section,
    \> locate and click on the \"Personal Access Tokens\" category.

-   Create a New Token:

-   Enter a descriptive name for your new personal access token in the
    \> provided text field.

-   Click the \"Add\" button.

-   Retrieve Token: A pop-up will appear displaying the generated \>
    personal access token string. Copy this token string and store it \>
    securely, as it will be required for authentication in chat \>
    communication service


**Deployment of Chat - communication Service**

### Step 1 : Add Chat Service .env

>  /src/.env

```env

  "APPLICATION_ENV": "development"
  "APPLICATION_PORT": 3123    // update the port of chat-communication service
  "CHAT_PLATFORM": "rocketchat"  
  "CHAT_PLATFORM_ACCESS_TOKEN": ""  // update newly created access token
  "CHAT_PLATFORM_ADMIN_EMAIL": "" // add rocket-chat admin email address
  "CHAT_PLATFORM_ADMIN_PASSWORD": "" //add rocket-chat admin password
  "CHAT_PLATFORM_ADMIN_USER_ID": "" // add rocket chat admin user id 

  // update the domain of the rocket chat, sample url will be added below.
  "CHAT_PLATFORM_URL": "https://chat-dev-temp.elevate-apis.shikshalokam.org"   

  // update postgres connection url,  refer the sample url
  "DEV_DATABASE_URL": "postgres://shikshalokam:password@localhost:5432/chat_elevate_communications"  "INTERNAL_ACCESS_TOKEN": "FqHQ0gXydRtBCg5l",  // use same  as mentoring service 
 

  // change the password hash salt 
  "PASSWORD_HASH_SALT": "6/tc08GnmO2PUi2xk-cOmbP8m7f!?DrdQgWEY1TC42F/Q/BstPKFeRp9v2Hh9p9c3qjtHP61W?KAc5KYmSp!8NLA8KAStHiOQL4MnaS5SK8YZ_d"
  "PASSWORD_HASH_LENGTH": 10
 

  // change the user name hash salt
  "USERNAME_HASH_SALT": "yKF3d7-q76/d2vwWTj=NoMPDuzuD5ny7xDd/?Wcq8H9?MQRrF2NITA331ALg/OLEsgnKLauU5V4z-ZDSdVuea3NpUAifVF/4T1g_d"
  "USERNAME_HASH_LENGTH": 10

```

### Step 2: Change directory to /src/

### Step 3 : install node modules

```bash
    npm run install
```
### Step 4 : Run migrations

```bash
    npm run db:init
```

### Step 5 : Start Application

```bash
    cd src/
    node app.js
```

To start using pm2

```bash
    pm2 start app.js
```

# 

# **Deployment of Mentoring Service**

### Step 1 : Update .env : 

```env
    COMMUNICATION_SERVICE_BASE_URL=/communications
    COMMUNICATION_SERVICE_HOST=http://localhost:3123
    ENABLE_CHAT = true
    PORTAL_BASE_URL = "https://dev.elevate-mentoring.shikshalokam.org"
    EVENTS_TOPIC = "qa.userCreate" // Make sure topic is same as user service
```

### Step 2: Build Using Jenkins

Build the mentoring job : 
[[http://172.30.149.188:8080/job/Prod/job/elevate-mentoring]{.underline}](http://172.30.149.188:8080/job/Prod/job/elevate-mentoring)
(you can skip step 3 and step 4)

### Step 3: Git Pull & Run Migrations ( only required in manual deployment)

```bash
cd /src/

git pull origin \<branchName\>

npx sequelize-cli db:migrate

```

### Step 4: Restart Mentoring service ( only required in manual deployment)

using pm2 restart elevate-mentoring / node app.js

# 

# **Deployment of Interface Service**

### Step 1: update .env 

```env

    "ROUTE_CONFIG_JSON_URLS_PATHS": "https://raw.githubusercontent.com/ELEVATE-Project/utils/refs/heads/staging/interface-routes/elevate-routes.json"
    // update elevate-mentoring package version
    "REQUIRED_PACKAGES": "elevate-mentoring@1.2.93”
```

### Step 2: Build Using Jenkins

Build the interface job 
http://172.30.149.188:8080/job/elevate-interface/
(you can skip step 3 and step 4)

### Step 3: Restart Interface service ( only required in manual deployment)

using pm2 restart elevate-interface / node app.js


# **Deployment of User Service**

### Step 1: update .env

```env
    "EVENT_USER_KAFKA_TOPIC": "qa.userCreate" // Make sure topic is same as mentoring 
```

### Step 2: Build Using Jenkins

Build the user service job : 
[[http://172.30.149.188:8080/job/Prod/job/elevate-]{.underline}](http://172.30.149.188:8080/job/Prod/job/elevate-mentoring)user
(you can skip step 3 and step 4)

### Step 3: Git Pull & Run Migrations ( only required in manual deployment)

Cd /src/

run

Git pull origin \<branchName\>

Then

Npx sequelize-cli db:migrate

## Step 4: Restart Mentoring service ( only required in manual deployment)

using pm2 restart elevate-mentoring / node app.js

# **Deployment of the Mentoring frontend**

### Step 1: update .env

```env
    "chatBaseUrl": "https://chat-dev-temp.elevate-apis.shikshalokam.org/",
    "chatWebSocketUrl": "wss://chat-dev-temp.elevate-apis.shikshalokam.org/websocket",

```
### Step 2: Run form script

> export AUTH_TOKEN= \< ADMIN_ACCESS_TOKEN \>
>
> export API_URL= \< API_BASE_URL \>
>
> **npm run manage-forms**

### Step 3:** **Restart the pm2

# 

# 

# \*\* \*\*

# **References**

\- Rocket.Chat Docs: https://docs.rocket.chat/

\- Chat Communication Service Repo:
https://github.com/ELEVATE-Project/chat-communications/tree/develop

\- Docker Installation Guide:
https://docs.docker.com/engine/install/ubuntu/

\- Docker Compose Docs: https://docs.docker.com/compose/
