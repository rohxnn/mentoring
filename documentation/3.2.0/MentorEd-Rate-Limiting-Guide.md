# Developer Guide: Rate-Limiting Overview

## Introduction

Rate-Limiting aims to efficiently manage the flow of requests to our services and prevent misuse. It employs the express-rate-limit middleware and is primarily enforced at the interface service level, serving as the gateway to all our services. This guide provides detailed instructions and necessary configurations for integrating rate limiters in the development environment.

## Rate Limiting Strategy

### Implementation Details

-   **Service Coverage**: The rate limiting is applied at the interface service level, meaning it doesn't directly impact individual services.
-   **Middleware**: We utilize the `express-rate-limit` middleware for implementing rate limiting.
-   **API Grouping**: APIs are organized into tiers, with each tier having specific rate limiting settings.

### API Tiers and Rate Limits

We have established several API tiers, each with unique rate limiting configurations:

-   **Public-low**: Targets unauthenticated public-facing APIs, imposing strict rate limits to prevent abuse.
    -   Limit: 5 requests per 2 minutes
    -   Example Endpoints:
        -   `/interface/v1/account/login`
        -   `/user/v1/account/generateOtp`
        -   `/user/v1/account/registrationOtp`
-   **General**: The default tier for most regular authenticated APIs.
    -   Limit: 50 requests per minute
-   **Internal**: Applies to internally used APIs, where rate limiting only counts failed responses.
    -   Limit: 50 requests per minute
    -   Example Endpoints:
        -   Various user and admin related endpoints like `/user/v1/user/read`, `/mentoring/v1/admin/triggerViewRebuildInternal`, etc.
-   **None**: No rate limiting applied, typically used for internal APIs not exposed externally.
    -   Example Endpoints:
        -   Scheduler service APIs like `/scheduler/jobs/create`, `/scheduler/jobs/list`, etc.

### Configuring Rate Limiters

Rate limiters are configured in the route settings of the interface service. Below is an example configuration for an API endpoint:

```json
{
	"sourceRoute": "/user/v1/account/generateOtp",
	"type": "POST",
	"rateLimit": {
		"type": "public-low"
	}
}
```

## Rate Limiter Configuration Variables

Environment variables control the behavior of the rate limiters, with options for overrides:

-   `RATE_LIMITER_PUBLIC_LOW_WINDOW`
-   `RATE_LIMITER_PUBLIC_LOW_LIMIT`
-   `RATE_LIMITER_GENERAL_WINDOW`
-   `RATE_LIMITER_GENERAL_LIMIT`
-   `RATE_LIMITER_INTERNAL_WINDOW`
-   `RATE_LIMITER_INTERNAL_LIMIT`
-   `RATE_LIMITER_NUMBER_OF_PROXIES` (Critical for accurate IP identification behind proxies)
-   `RATE_LIMITER_ENABLED` (Enables or disables rate limiting globally)

## RATE_LIMITER_NUMBER_OF_PROXIES: Importance and Configuration

### Understanding the Importance

In environments where applications pass through multiple proxies, it's crucial to accurately identify the client's IP to apply rate limits effectively. The `RATE_LIMITER_NUMBER_OF_PROXIES` is essential for determining how many proxy IPs to bypass in the `X-forwarded-for` header to reach the client’s actual IP.

### Configuring the Variable

Developers should set `RATE_LIMITER_NUMBER_OF_PROXIES` based on the number of proxies in their network path. Incorrect configurations can lead to improper rate limiting due to the wrong IP being used for enforcement.

#### Configuration Example:

For a network with three proxies, set `RATE_LIMITER_NUMBER_OF_PROXIES` to `3`:

```json
{
	"RATE_LIMITER_NUMBER_OF_PROXIES": "3"
}
```

### Configuration Tips

-   **Network Mapping**: Accurately map your network to determine the number of proxies between your clients and your server.
-   **Consistency**: Maintain this setting consistently across all deployments for uniform rate limiting.
-   **Validation**: Regularly check that the `RATE_LIMITER_NUMBER_OF_PROXIES` matches any changes in network proxy configuration to maintain effective rate limiting.

Correctly setting `RATE_LIMITER_NUMBER_OF_PROXIES` is vital for ensuring effective and fair rate limiting in environments with multiple proxies. It helps protect the backend from potential abuse while ensuring legitimate users face no undue restrictions.

For further details on troubleshooting and advanced configurations, refer to [GitHub Repository](https://github.com/express-rate-limit/express-rate-limit/wiki/Troubleshooting-Proxy-Issues) and the [Express Behind Proxies Documentation](https://expressjs.com/en/guide/behind-proxies.html).
