#!/usr/bin/env node
/**
 * One-off: authorise a Google account and print a refresh token.
 *
 * Lovable's connector held these tokens for us. Off Lovable the app refreshes its own,
 * so each workspace stores one refresh token per Google service in Settings → Integrations.
 *
 *   node scripts/google-refresh-token.mjs <client-id> <client-secret> [scope-set]
 *
 * scope-set: gmail (default) | meet | calendar
 *
 * The client must list http://localhost:53682/callback as an authorised redirect URI
 * (Google Cloud Console → Credentials → your OAuth client). That entry is only needed
 * while running this script and can be removed afterwards.
 */
import http from "node:http";
import { URL } from "node:url";

const [clientId, clientSecret, scopeSet = "gmail"] = process.argv.slice(2);

if (!clientId || !clientSecret) {
  console.error("Usage: node scripts/google-refresh-token.mjs <client-id> <client-secret> [gmail|meet|calendar]");
  process.exit(1);
}

const SCOPES = {
  // readonly to poll, send so the pollers can reply on handover threads
  gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
  meet: ["https://www.googleapis.com/auth/meetings.space.readonly"],
  calendar: ["https://www.googleapis.com/auth/calendar.events"],
};

const scopes = SCOPES[scopeSet];
if (!scopes) {
  console.error(`Unknown scope set "${scopeSet}". Use one of: ${Object.keys(SCOPES).join(", ")}`);
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:53682/callback";

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scopes.join(" "));
authUrl.searchParams.set("access_type", "offline");
// Without this, Google only returns a refresh token the very first time an account
// authorises the client — re-running the script would print nothing useful.
authUrl.searchParams.set("prompt", "consent");

console.log(`\nSign in as the mailbox you want polled, then approve:\n\n${authUrl}\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:53682");
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`Authorisation failed: ${error || "no code"}`);
    console.error(`\nAuthorisation failed: ${error || "no code returned"}`);
    server.close();
    process.exit(1);
  }

  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  }).then((r) => r.json());

  if (!token.refresh_token) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("No refresh token returned — see the terminal.");
    console.error("\nNo refresh token in the response:", JSON.stringify(token, null, 2));
    console.error("\nIf this says invalid_grant, the redirect URI above is probably not on the client.");
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { "Content-Type": "text/plain" }).end("Done — the refresh token is in your terminal. You can close this tab.");

  console.log(`\nRefresh token for ${scopeSet}:\n\n${token.refresh_token}\n`);
  console.log(`Scopes granted: ${token.scope}`);
  console.log(`\nPaste it into Settings → Integrations (${scopeSet === "gmail" ? "Gmail Polling → Gmail Refresh Token" : `Meetings → Google ${scopeSet} Refresh Token`}).`);

  server.close();
  process.exit(0);
});

server.listen(53682, () => console.log("Waiting for the redirect on http://localhost:53682/callback ..."));
