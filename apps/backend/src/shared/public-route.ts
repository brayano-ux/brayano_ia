const signedProductImagePath = /^\/media\/products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp)(?:\?.*)?$/i;

const signedClientMediaPath = /^\/media\/client\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}(?:\?.*)?$/i;

export function isPublicRoute(url: string) {
  return url === "/"
    || url === "/login"
    || url === "/logout"
    || url === "/register"
    || url.startsWith("/register/")
    || url.startsWith("/password-reset/")
    || url.startsWith("/health")
    || url.startsWith("/admin/")
    || url === "/billing/plans"
    || url === "/billing/campay/callback"
    || url.startsWith("/billing/campay/callback?")
    || signedProductImagePath.test(url)
    || signedClientMediaPath.test(url);
}