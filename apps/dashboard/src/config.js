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
  mobileBreakpointPx: 868,
};

export function getApiBaseUrl() {
  return window.API_BASE_URL || localStorage.getItem(APP_CONFIG.localStorageKeys.apiBase) || APP_CONFIG.defaultApi;
}
