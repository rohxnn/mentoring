# Environment Variable Modification Guide

## Overview

The existing documentation and setup guides include a set of environment files with default environment variables. These serve as an excellent starting point for any deployment and offer a fully operational Mentor application for you to explore. 

However, as expected, certain features may be impaired without replacing the default environment variables with adopter-specific values. For example, variables related to notification email services and cloud file upload.

This document acts as a reference for such functionalities or features and their related environment variables.

## Affected Features

1. **Bulk Upload Sessions**

    The application utilizes file upload functionality to implement several features like profile and session image upload, bulk user creation and in release-3.1.0 bulk session creation is introduced with new envs. Therefore, it is expected that you have a bucket configured with a cloud provider of your choosing (AWS, GCP, AZURE, or OCI). And relevant environment fields are set in the following services.

    ### Mentor and User Services

    **Docker Setup:** `mentoring_env`, `user_env`

    **Manual Setup:** `mentoring/src/.env`, `user/src/.env`

    **Variables:**

    ```
    CLOUD_STORAGE			->Choice of cloud provider (AWS, GCP, AZURE, OCI)

CLOUD_STORAGE_PROVIDER
CLOUD_STORAGE_ACCOUNTNAME
CLOUD_STORAGE_SECRET
CLOUD_STORAGE_PROJECT 
CLOUD_STORAGE_BUCKETNAME
CLOUD_STORAGE_BUCKET_TYPE
PUBLIC_ASSET_BUCKETNAME
    ```

    ### Relevant Resources

    1. [Create AWS S3 Bucket](https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html)
    2. [Create GCP Bucket](https://cloud.google.com/storage/docs/creating-buckets)
    3. [Create Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-portal)
    4. [Create OCI Object Storage Bucket](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/managingbuckets_topic-To_create_a_bucket.htm)


2. **Session Management**

    Since version 3.1.0, the application includes advanced features for user session management, such as inactivity timeouts, session tracking, and remote logout. These features are controlled by the following environment variables:

    ### User Service

    **Docker Setup:** `user_env`

    **Manual Setup:** `user/src/.env`

    **Variables:**

    ```
    ALLOWED_IDLE_TIME
    ALLOWED_ACTIVE_SESSIONS
    ```

    **Explanation**:

    - **ALLOWED_IDLE_TIME**: Specifies the maximum duration (in milliseconds) a user can remain idle before their session expires. If set to 5 minutes, for example, the session will expire after 5 minutes of inactivity. The default setting is zero, which means the session duration solely depends on the user token's expiration time.

    - **ALLOWED_ACTIVE_SESSIONS**: Defines the limit on the number of concurrent sessions a user can have. By default, there is no limit, allowing an unlimited number of active sessions.

3. **Rate Limiting**

    The rate-limiting feature has been introduced in version 3.1.0 to enhance system stability and prevent abuse. This feature regulates the number of requests a user can make to the services within a given timeframe. Rate-limiting is enabled by default.

    ### User Service

    **Docker Setup:** `interface_env`

    **Manual Setup:** `interface-service/src/.env`

    **Variables:**

    ```
    RATE_LIMITER_NUMBER_OF_PROXIES
    RATE_LIMITER_ENABLED
    ```

    Refer to the [Rate-Limiting Guide](./MentorEd-Rate-Limiting-Guide.md) for more information on how to set these variables.

4. **Setting Default Rules**

    In version 3.1.0, Admins can set default rules based on mandatory profile fields (Gender, Location, Language) for mentees and mentors, applying them to searches, sessions, and connections. Mentees can only view and enroll in sessions that match these rules, and mentors can create sessions only if their profile aligns with the mentees. Any changes to mandatory fields trigger notifications and restrict users until profiles are updated.

5. **Search Functionality**

    In version 3.1.0 a mentor or mentee, I should be able to search for mentors and sessions to get relevant results based on my search.
    When I type a keyword in the search bar and press 'Enter,' the results page will show my search term along with categorized results: mentors and sessions. Each section will display 10 results, with options to filter and view more, and pagination for additional results. Default rules and filters will apply, and filters set by the admin cannot be changed. If no results match, a "no results found" page will be shown.

6. **Profile Details Page**

    In release 3.1.0, the "Your Role" field will include the new "Other" option, allowing users to enter a custom role if it's not listed. The multi-select functionality remains, and users selecting "Other" must fill out the new role field, which will be categorized and appear when filtered on the requests page. All fields and values on the profile page are configurable, ensuring flexibility for administrators. This update enhances role customization and improves filtering accuracy for requests.

7. **User Account Displays in Profile and Role**
    
    In release-3.1.0, the user role hierarchy and profiles are enhanced. Mentors automatically have a Mentee Profile, and users assigned roles as Org-admin or Session Managers will see these roles displayed alongside their profiles. The role hierarchy prioritizes (1) Org-admin over (2) Session Manager, ensuring a streamlined user experience based on assigned roles.

8. **SignUp And Mandatory Profile Update**
   
   In release-3.1.0, after OTP validation, users are redirected to the "Profile Details" page to complete their profile setup by filling in mandatory fields. If they log out or close the browser before finishing, they are redirected to the "Setup Profile" pop-up upon re-login until the profile is successfully updated.