export const APP_CONFIG = {
  defaultApi: "https://brayano-ia-5.onrender.com",
  localStorageKeys: {
    session: "brayano_session",
    organization: "brayano_org",
    apiBase: "brayano_api",
  },
  supportWhatsapp: "237683260520",
  views: ["overview", "inbox", "agent", "settings", "whatsapp"],
  responseDelayOptions: [3, 5, 7, 60, 120],
  standardQualificationFields: ["name", "city", "need", "budget", "product", "urgency", "quartier"],
  businessInfoMaxLength: 50_000,
  mobileBreakpointPx: 1024,
};

export function getApiBaseUrl() {
  // Une chaîne uniquement (un élément HTML nommé « API_BASE_URL » ne doit pas pouvoir rediriger les appels).
  if (typeof window.API_BASE_URL === "string" && /^https?:\/\//.test(window.API_BASE_URL)) return window.API_BASE_URL;

  const localHosts = ["localhost", "127.0.0.1"];
  if (localHosts.includes(window.location.hostname)) return "http://127.0.0.1:3000";

  // L'adresse du serveur n'est plus lue dans le stockage du navigateur : le jeton de connexion ne peut pas être détourné vers un autre serveur.
  return APP_CONFIG.defaultApi;
}
