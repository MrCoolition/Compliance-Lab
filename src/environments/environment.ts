export const environment = {
  production: false,
  complianceHubApiUrl: '/api',
  auth: {
    clientId: '',
    redirectUri: typeof window !== 'undefined' ? `${window.location.origin}/` : '/',
    oidcIssuer: '',
    logoutUrl: '',
  },
};
