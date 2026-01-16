# Environment Configuration (`env.md`)

This file defines the configuration options used by the Mentoring Application.  
These values help the app connect to APIs, manage authentication, and set up environment-specific behavior.

---

## Environment Variables

| **Key** | **Type / Example** | **Description** |
|----------|--------------------|-----------------|
| `production` | `true` / `false` | Toggle between **production** (`true`) and **development** (`false`) mode. |
| `name` | `"Mentoring App"` | Application name used for identification or branding. |
| `baseUrl` | `"https://api.example.com"` | Base URL for API requests. |
| `chatBaseUrl` | `"https://chat.example.com"` | Base URL for **Rocket.Chat** integration. |
| `chatWebSocketUrl` | `"wss://chat.example.com/websocket"` | WebSocket URL used for real-time communication. |
| `sqliteDBName` | `"mentoring.db"` | Local **SQLite database file name** used for offline storage. |
| `deepLinkUrl` | `"app://deeplink"` | Base URL used for deep linking into the app. |
| `privacyPolicyUrl` | `"https://example.com/privacy-policy"` | URL for your **Privacy Policy** page. |
| `termsOfServiceUrl` | `"https://example.com/terms-of-service"` | URL for your **Terms of Service** page. |
| `supportEmail` | `"support@example.com"` | Support email address for user queries. |
| `recaptchaSiteKey` | `"YOUR_CAPTCHA_KEY"` | Google reCAPTCHA **site key** for CAPTCHA validation. |
| `restictedPages` | `[]` | Array of page IDs to restrict access. (Refer to `src/app/core/constants/page.ids.ts`) |
| `isAuthBypassed` | `true` / `false` | Set to **true** to disable the default user authentication service, allowing bypass of login. |
| `unauthorizedRedirectUrl` | `"/auth/login"` | URL to redirect users to when session expires or is unauthorized. |
| `password.minLength` | `10` | Minimum password length requirement. |
| `password.regexPattern` | `^(?=(?:.*[A-Z]){2})(?=(?:.*[0-9]){2})(?=(?:.*[!@#%$&()\-`.+,]){3}).{11,}$` | Regex pattern to validate password strength (requires uppercase, numbers, and special characters). |
| `password.errorMessage` | `"Password should contain at least one uppercase letter, one number and one special character."` | Error message displayed for invalid passwords. |

---

## Example Configuration

```js
window["env"] = {
  production: false,
  name: "Mentoring App",
  baseUrl: "https://api.example.com",
  chatBaseUrl: "https://chat.example.com",
  chatWebSocketUrl: "wss://chat.example.com/websocket",
  sqliteDBName: "mentoring.db",
  deepLinkUrl: "app://deeplink",
  privacyPolicyUrl: "https://example.com/privacy-policy",
  termsOfServiceUrl: "https://example.com/terms-of-service",
  supportEmail: "support@example.com",
  recaptchaSiteKey: "YOUR_CAPTCHA_KEY",
  restictedPages: [],
  isAuthBypassed: false,
  unauthorizedRedirectUrl: "/auth/login",
  password: {
    minLength: 10,
    regexPattern: "^(?=(?:.*[A-Z]){2})(?=(?:.*[0-9]){2})(?=(?:.*[!@#%$&()\\-`.+,]){3}).{11,}$",
    errorMessage: "Password should contain at least one uppercase letter, one number and one special character."
  }
};