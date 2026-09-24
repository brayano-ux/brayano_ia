export const APP_CONFIG = {
  defaultApi: "https://brayano-ia-5.onrender.com",
  localStorageKeys: {
    session: "brayano_session",
    organization: "brayano_org",
    apiBase: "brayano_api",
  },
  views: ["inbox", "agent", "settings", "whatsapp"],
};

export function getApiBaseUrl() {
  return window.API_BASE_URL || localStorage.getItem(APP_CONFIG.localStorageKeys.apiBase) || APP_CONFIG.defaultApi;
}
