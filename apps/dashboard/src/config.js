export const APP_CONFIG = {
  defaultApi: "https://brayano-ia-5.onrender.com",
  localStorageKeys: {
    session: "brayano_session",
    organization: "brayano_org",
    apiBase: "brayano_api",
  },
  views: ["overview", "inbox", "agent", "settings", "whatsapp"],
  responseDelayOptions: [3, 5, 7, 60, 120],
  standardQualificationFields: ["name", "city", "need", "budget", "product", "urgency", "quartier"],
  mobileBreakpointPx: 1024,
};

export function getApiBaseUrl() {
  if (window.API_BASE_URL) return window.API_BASE_URL;

  const localHosts = ["localhost", "127.0.0.1"];
  if (localHosts.includes(window.location.hostname)) return "http://127.0.0.1:3000";

  return localStorage.getItem(APP_CONFIG.localStorageKeys.apiBase) || APP_CONFIG.defaultApi;
}
