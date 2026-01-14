export const environment = {
	production: true,
	name: 'prod environment',
	staging: false,
	dev: false,
	baseUrl: 'http://localhost:3569',
	sqliteDBName: 'mentoring.db',
	deepLinkUrl: 'https://mentored.shikshalokam.org',
	privacyPolicyUrl: 'https://shikshalokam.org/mentoring/privacy-policy',
	termsOfServiceUrl: 'https://shikshalokam.org/mentoring/term-of-use',
        recaptchaSiteKey: "",
        recaptchaSiteKeyold:"6LfWEKYpAAAAACxKbR7H42o3BwbJkJA06vIM_6Ea",
	restictedPages: [],
	unauthorizedRedirectUrl:"/auth/login",
        isAuthBypassed: false,
	supportEmail: 'example@org.com',
	"password": {
    "errorMessage": "Password should contain at least two uppercase letter, two number and three special character.",
    "minLength": 11,
    "regexPattern": "^(?=(?:.*[A-Z]){2})(?=(?:.*[0-9]){2})(?=(?:.*[!@#%$&()\\-`.+,]){3}).{11,}$",
    "regexPatternOld": "^(?=(?:.*[A-Z]){2})(?=(?:.*\\d){2})(?=.{11,})(?=(?:.*[\\W_]){3}).*$"
  },
}
  
 
 