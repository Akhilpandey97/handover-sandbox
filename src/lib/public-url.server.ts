/**
 * The address to put in a link someone will click.
 *
 * `new URL(req.url).origin` is the address the server was reached on, which behind a
 * proxy (Railway, and any load balancer) is an internal `http://…` host. That is fine for
 * the server calling itself, and wrong in a password-reset email or an API response.
 *
 * Order: the configured public address, then what the proxy says the client asked for,
 * then the request's own origin as a last resort.
 */
export function publicAppUrl(req: Request): string {
  const configured = process.env["APP_BASE_URL"] || process.env["APP_URL"];
  if (configured) return configured.replace(/\/$/, "");

  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (forwardedHost) {
    const proto = req.headers.get("x-forwarded-proto") || (forwardedHost.startsWith("localhost") ? "http" : "https");
    return `${proto}://${forwardedHost}`;
  }

  return new URL(req.url).origin;
}
