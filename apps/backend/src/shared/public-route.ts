const signedProductImagePath = /^\/media\/products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp)(?:\?.*)?$/i;

export function isPublicRoute(url: string) {
  return url === "/"
    || url === "/login"
    || url === "/register"
    || url.startsWith("/register/")
    || url.startsWith("/password-reset/")
    || url.startsWith("/health")
    || url.startsWith("/admin/")
    || url === "/billing/plans"
    || url === "/billing/campay/callback"
    || url.startsWith("/billing/campay/callback?")
    || signedProductImagePath.test(url);
}