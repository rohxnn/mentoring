## Dockerized Services and Dependencies

Expectation: Upon following the prescribed steps, you will achieve a fully operational Mentor application setup, complete with both the portal and backend services.

## Prerequisites

To set up the application, you must install Docker and Docker Compose on your system using any one of the following ways:

- Ubuntu users can refer to [How To Install and Use Docker Compose on Ubuntu](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-compose-on-ubuntu-20-04) for detailed installation instructions.

- Windows and MacOS users can refer to the [Docker Compose Installation Guide](https://docs.docker.com/compose/install/) for the installation instructions.

Once these prerequisites are in place, you're all set to get started with setting up the application.

## Installation

1.  **Create mentoring Directory:** Create a directory named **mentoring**.

    > Example Command: `mkdir mentorEd && cd mentorEd/`

    > **Caution:** Before proceeding, please ensure that the ports given here are available and open. It is essential to verify their availability prior to moving forward. You can run below command in your teminal to check this

    > **Note:** This command works natively on Linux (e.g., Ubuntu) and macOS.

    ```bash
    for port in 2181 9092 6379 3000 3001 3002 4000 3569 5432 5500 8100; do
    nc -z 127.0.0.1 $port >/dev/null 2>&1 &&
    echo -e "\e[31mPort $port is currently in use.\e[0m" ||
    echo -e "\e[32mPort $port is available for use.\e[0m";
    done
    ```

2.  **Download and execute main setup script:** Execute the following command in your terminal from the mentoring directory.

    ```bash
    curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/mac-linux/setup_mentoring.sh && chmod +x setup_mentoring.sh && ./setup_mentoring.sh
    ```

    > Note : The script will download all the essential files and launch the services in Docker. Once all services are successfully up and running, you can proceed to the next steps.

    **General Instructions :**

    1. All containers which are part of the docker-compose can be gracefully stopped by pressing Ctrl + c in the same terminal where the services are running.

    2. All docker containers can be stopped and removed by using below command.
       ```bash
       ./docker-compose-down.sh
       ```
    3. All services and dependencies can be started using below command.
       ```bash
       ./docker-compose-up.sh
       ```

**Once you've completed this step, proceed to the next section: [Add Forms](#add-required-forms)**

**After completing that, continue to the following section: [Enable Citus Extension (Optional)](#enable-citus-extension-optional)**

## Operating Systems: Windows

1.**Download Docker Compose File:** Retrieve the **[docker-compose-mentoring.yml](https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/docker-compose-mentoring.yml)** file from the Mentoring repository and save it to the mentoring directory.

```
    curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/docker-compose-mentoring.yml
```

2.  **Download Environment Files**: Using the OS specific commands given below, download environment files for all the services.

- **Windows**

  ```
      curl -L ^
          -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/interface_env ^
          -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/mentoring_env ^
          -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/notification_env ^
          -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/scheduler_env ^
          -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/user_env ^
          -O https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/envs/env.js
  ```

  > **Note:** Modify the environment files as necessary for your deployment using any text editor, ensuring that the values are appropriate for your environment. The default values provided in the current files are functional and serve as a good starting point. Refer to the sample env files provided at the [Mentoring](https://github.com/ELEVATE-Project/mentoring/blob/master/src/.env.sample), [User](https://github.com/ELEVATE-Project/user/blob/master/src/.env.sample), [Notification](https://github.com/ELEVATE-Project/notification/blob/master/src/.env.sample), [Scheduler](https://github.com/ELEVATE-Project/scheduler/blob/master/src/.env.sample), and [Interface](https://github.com/ELEVATE-Project/interface-service/blob/main/src/.env.sample) repositories for reference.

  > **Caution:** While the default values in the downloaded environment files enable the application to operate, certain features may not function correctly or could be impaired unless the adopter-specific environment variables are properly configured.
  >
  > For detailed instructions on adjusting these values, please consult the **[Environment Variable Modification Guide](https://github.com/ELEVATE-Project/mentoring/blob/master/documentation/3.1.0/MentorEd-Env-Modification-README.md)**.

  > **Important:** As mentioned in the above linked document, the **User SignUp** functionality may be compromised if key environment variables are not set correctly during deployment. If you opt to skip this setup, consider using the sample user account generator detailed in the `Sample User Accounts Generation` section of this document.

3.  **Download `replace_volume_path` Script File**

- **Windows**

  ```
      curl -OJL https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/windows/replace_volume_path.bat
  ```

4.  **Run `replace_volume_path` Script File**

- **Windows**

  Run the script file either by double clicking it or by executing the following command from the terminal.

  ```
  replace_volume_path.bat
  ```

  > **Note**: The provided script file replaces the host path for the **portal** service container volume in the `docker-compose-mentoring.yml` file with your current directory path.
  >
  > volumes:
  >
  > \- ./env.js:/usr/src/app/www/assets/env/env.js

5.  **Download `docker-compose-up` and `docker-compose-down` Script Files**

- **Windows**

  ```
  curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/windows/docker-compose-up.bat
  ```

  ```
  curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/windows/docker-compose-down.bat
  ```

6.  **Run All Services and Dependencies:** All services and dependencies can be started using the `docker-compose-up` script file.

- **Windows**

  ```
  docker-compose-up.bat
  ```

  > Double-click the file or run the above command from the terminal.

  > **Note**: During the first Docker Compose run, the database, migration seeder files, and the script to set the default organization will be executed automatically.

7.  **Access The Application**: Once the services are up and the front-end app bundle is built successfully, navigate to **[localhost:8100](http://localhost:8100/)** to access the application.

8.  **Gracefully Stop All Services and Dependencies:** All containers which are part of the docker-compose can be gracefully stopped by pressing `Ctrl + c` in the same terminal where the services are running.

9.  **Remove All Service and Dependency Containers**: All docker containers can be stopped and removed by using the `docker-compose-down` file.

- **Windows**

  ```
  docker-compose-down.bat
  ```

  > **Caution**: As per the default configuration in the `docker-compose-mentoring.yml` file, using the `down` command will lead to data loss since the database container does not persist data. To persist data across `down` commands and subsequent container removals, refer to the "Persistence of Database Data in Docker Containers" section of this documentation.

## Enable Citus Extension (Optional)

The application relies on PostgreSQL as its core database system. To boost performance and scalability, users can opt to enable the Citus extension. This transforms PostgreSQL into a distributed database, spreading data across multiple nodes to handle large datasets more efficiently as demand grows.

For more information, refer **[Citus Data](https://www.citusdata.com/)**.

To enable the Citus extension for Mentor and User services, follow these steps.

1. Create a sub-directory named `mentoring` and download `distributionColumns.sql` into it.

   ```bash
   mkdir mentoring && curl -o ./mentoring/distributionColumns.sql -JL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/distribution-columns/mentoring/distributionColumns.sql
   ```

2. Create a sub-directory named `user` and download `distributionColumns.sql` into it.

   ```bash
   mkdir user && curl -o ./user/distributionColumns.sql -JL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/distribution-columns/user/distributionColumns.sql
   ```

3. Set up the citus_setup file by following the steps given below.

   - **Ubuntu/Linux/Mac**

     1. Download the `citus_setup.sh` file.

        ```bash
        curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/mac-linux/citus_setup.sh
        ```

     2. Make the setup file executable by running the following command.

        ```bash
        chmod +x citus_setup.sh
        ```

     3. Enable Citus and set distribution columns for `mentoring` database by running the `citus_setup.sh`with the following arguments.

        ```bash
        ./citus_setup.sh mentoring postgres://postgres:postgres@citus_master:5432/mentoring
        ```

     4. Enable Citus and set distribution columns for `user` database by running the `citus_setup.sh`with the following arguments.

        ```bash
        ./citus_setup.sh user postgres://postgres:postgres@citus_master:5432/user
        ```

   - **Windows**

     1. Download the `citus_setup.bat` file.

        ```
         curl -OJL https://github.com/ELEVATE-Project/mentoring/raw/master/documentation/3.1.0/dockerized/scripts/windows/citus_setup.bat
        ```

     2. Enable Citus and set distribution columns for `mentoring` database by running the `citus_setup.bat`with the following arguments.

        ```
        citus_setup.bat mentoring postgres://postgres:postgres@citus_master:5432/mentoring
        ```

     3. Enable Citus and set distribution columns for `user` database by running the `citus_setup.bat`with the following arguments.

        ```
        citus_setup.bat user postgres://postgres:postgres@citus_master:5432/user
        ```

        > **Note:** Since the `citus_setup.bat` file requires arguments, it must be run from a terminal.

## Persistence Of Database Data In Docker Container

To ensure the persistence of database data when running `docker compose down`, it is necessary to modify the `docker-compose-mentoring.yml` file according to the steps given below:

1. **Modification Of The `docker-compose-mentoring.yml` File:**

   Begin by opening the `docker-compose-mentoring.yml` file. Locate the section pertaining to the Citus container and proceed to uncomment the volume specification. This action is demonstrated in the snippet provided below:

   ```yaml
   citus:
     image: citusdata/citus:11.2.0
     container_name: "citus_master"
     ports:
       - 5432:5432
     volumes:
       - citus-data:/var/lib/postgresql/data
   ```

2. **Uncommenting Volume Names Under The Volumes Section:**

   Next, navigate to the volumes section of the file and proceed to uncomment the volume names as illustrated in the subsequent snippet:

   ```yaml
   networks:
     elevate_net:
       external: false

   volumes:
     citus-data:
   ```

By implementing these adjustments, the configuration ensures that when the `docker-compose down` command is executed, the database data is securely stored within the specified volumes. Consequently, this data will be retained and remain accessible, even after the containers are terminated and subsequently reinstated using the `docker-compose up` command.

## Add Required Forms

There are few forms required for mentoring application to run, to add those fallow the below steps

1. **Download The `create_default_form_sql` and `insert_sample_forms.sh` Script File:**

   - **Ubuntu/Linux/Mac**

     The `create_default_form_sql` and `insert_sample_forms.sh` files have already been downloaded. Proceed to the next step.

   - **Windows**

     ```
     mkdir sample-data\mentoring 2>nul & curl -L -o sample-data/mentoring/create_default_form_sql.bat https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/windows/create_default_form_sql.bat

     ```

     ```
     curl -L -o sample-data/mentoring/insert_sample_forms.bat https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/windows/insert_sample_forms.bat
     ```

2. **Run The `insert_sample_forms` Script File:**

   - **Ubuntu/Linux/Mac**

     ```bash
     ./sample-data/mentoring/insert_sample_forms.sh mentoring postgres://postgres:postgres@citus_master:5432/mentoring
     ```

   - **Windows**

     ```
     sample-data\mentoring\insert_sample_forms.bat mentoring postgres://postgres:postgres@citus_master:5432/mentoring
     ```

   After successfully running the script, forms will be added to database.

3. **Access the Portal:**

   Once the above steps are completed, you can access the portal in your browser at:

   [http://localhost:8100/](http://localhost:8100/)

## Sample User Accounts Generation

During the initial setup of Mentor services with the default configuration, you may encounter issues creating new accounts through the regular Sign-up flow on the Mentor portal. This typically occurs because the default SignUp process includes OTP verification to prevent abuse. Until the notification service is configured correctly to send actual emails, you will not be able to create new accounts.

In such cases, you can generate sample user accounts using the steps below. This allows you to explore the services and portal immediately after setup.

> **Warning:** Use this generator only immediately after the initial system setup and before any normal user accounts are created through the portal. It should not be used under any circumstances thereafter.

1. **Download The `sampleData.sql` Files:**

- **Ubuntu/Linux/Mac**

  The `sampleData.sql` file has already been downloaded. Proceed to the next step.

- **Windows**

  ```
   mkdir sample-data\user 2>nul & ^
  curl -L "https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/sample-data/windows/mentoring/sampleData.sql" -o sample-data\mentoring\sampleData.sql & ^
  curl -L "https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/sample-data/windows/user/sampleData.sql" -o sample-data\user\sampleData.sql
  ```

2. **Download The `insert_sample_data.sh` Script File:**

   - **Ubuntu/Linux/Mac**

     The `insert_sample_data.sh` file has already been downloaded. Proceed to the next step.

   - **Windows**

     ```
     curl -L -o insert_sample_data.bat https://raw.githubusercontent.com/ELEVATE-Project/mentoring/master/documentation/3.1.0/dockerized/scripts/windows/insert_sample_data.bat
     ```

3. **Run The `insert_sample_data` Script File:**

   - **Ubuntu/Linux/Mac**

     ```bash
     ./insert_sample_data.sh user postgres://postgres:postgres@citus_master:5432/user && \
     ./insert_sample_data.sh mentoring postgres://postgres:postgres@citus_master:5432/mentoring
     ```

   - **Windows**

     ```
     insert_sample_data.bat user postgres://postgres:postgres@citus_master:5432/user & ^
     insert_sample_data.bat mentoring postgres://postgres:postgres@citus_master:5432/mentoring
     ```

   After successfully running the script mentioned above, the following user accounts will be created and available for login:

   | Email ID                 | Password   | Role                                |
   | ------------------------ | ---------- | ----------------------------------- |
   | aaravpatel@example.com   | Password1@ | Mentee                              |
   | arunimareddy@example.com | Password1@ | Mentor                              |
   | devikasingh@example.com  | Password1@ | Organization Admin, Session Manager |
