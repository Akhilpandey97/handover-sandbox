# Handover CRM Integration API

**Version:** v1
**Purpose:** automatically create a project in Handover when a deal is won in your CRM.

This is the customer-facing specification. It describes exactly what the live API does;
`handover-crm-api.md` in this repo covers the internal design behind it.

---

## 1. Overview

Handover provides a REST API that lets your CRM create a project the moment a deal is
marked as Won. Your CRM sends the deal and merchant information in an authenticated
HTTPS request.

On receiving it, Handover will:

1. Validate the request.
2. Create the project.
3. Generate a MID if one is not provided.
4. Seed the project's default checklist.
5. Store the CRM deal ID against the project.
6. Record the integration activity.

Project assignment stays inside Handover. The CRM does not have to provide or manage the
Handover project owner, though it may name one (see `owner_email`).

---

## 2. Integration flow

```
CRM
 │
 │ Deal marked as Won
 ▼
Handover API
 │
 ├── Validate request
 ├── Create project
 ├── Seed checklist
 └── Record integration activity
         │
         ▼
   Project appears in Handover
         │
         └── Handover team assigns it
```

No native CRM connector is required. Your CRM only needs to make an HTTPS POST request.

---

## 3. Authentication

Handover uses an API key. Send it as a bearer token on every request:

```
Authorization: Bearer hk_live_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

The key is specific to your Handover workspace and everything it creates belongs to that
workspace. Treat it as a confidential credential: never expose it in client-side code or
commit it to a repository.

Keys are created and revoked in Handover under **Settings → API Keys**. Revoking takes
effect immediately.

---

## 4. Endpoint

### Create or update a project

```
POST https://handover-sandbox-production.up.railway.app/api/public/v1/projects
```

A sandbox base URL and key are provided for testing; only the host differs.

---

## 5. Request

```json
{
  "merchant_name": "BrewCraft",
  "external_id": "SF-0061234",
  "mid": "BREW-001",
  "contact_email": "ops@brewcraft.com",
  "brand_url": "https://brewcraft.com",
  "platform": "Shopify",
  "category": "F&B",
  "arr": 4700000,
  "aov": 1450,
  "txns_per_day": 320,
  "kick_off_date": "2026-09-05",
  "expected_go_live_date": "2026-10-15",
  "sales_spoc": "priya@customer.com",
  "integration_type": "Standard",
  "project_notes": "Won from Q3 pipeline",
  "custom_fields": { "region": "West" }
}
```

---

## 6. Request fields

| Field | Type | Required | Description |
|---|---|---|---|
| `merchant_name` | string (1–200) | Yes | Merchant / customer / account name |
| `external_id` | string (1–120) | Recommended | Unique deal ID from your CRM. Without it, retries create duplicate projects |
| `mid` | string (1–80) | No | Merchant ID. Generated if omitted |
| `contact_email` | string | No | Primary merchant contact. Must be a valid email address |
| `brand_url` | string (≤400) | No | Merchant website |
| `platform` | string (≤80) | No | Platform the merchant sells on |
| `category` | string (≤80) | No | Merchant category |
| `arr` | number ≥ 0 | No | Annual value in INR |
| `aov` | number ≥ 0 | No | Average order value |
| `txns_per_day` | integer ≥ 0 | No | Average transactions per day |
| `kick_off_date` | date `YYYY-MM-DD` | No | Kick-off date. Defaults to the date the request is received |
| `expected_go_live_date` | date `YYYY-MM-DD` | No | Expected go-live date. If omitted, Handover derives one from the seeded checklist's due dates and keeps it up to date as the checklist moves; sending a value pins it until someone changes it in Handover |
| `sales_spoc` | string (≤160) | No | Sales SPOC / contact |
| `owner_email` | string | No | Hands the project to this Handover user. Ignored unless the address belongs to a user in your workspace |
| `integration_type` | string (≤80) | No | Integration type |
| `project_notes` | string (≤5000) | No | Additional project information |
| `custom_fields` | object | No | Values for custom fields configured in Handover. Values must be strings, numbers or booleans |
| `allow_duplicate` | boolean | No | Set `true` to create a project even when one already exists with the same merchant name (see §9) |

Fields not listed here are ignored rather than rejected, so check spelling carefully — a
mistyped field name is dropped silently.

### About `external_id`

Put the unique deal or opportunity ID from your CRM here:

| CRM | Example |
|---|---|
| Salesforce | `SF-0061234` |
| HubSpot | `12345678` |
| Zoho | `DEAL-98765` |
| Pipedrive | `45678` |

This is what lets Handover recognise the deal on a later request.

---

## 7. Responses

### New project — `201 Created`

```json
{
  "id": "5b1c...",
  "merchant_name": "BrewCraft",
  "mid": "BREW-001",
  "external_id": "SF-0061234",
  "project_url": "https://handover-sandbox-production.up.railway.app/projects/5b1c...",
  "checklist_items_created": 8,
  "created": true
}
```

`checklist_items_created` reflects the checklist templates configured in your workspace,
so the number varies.

### Existing project — `200 OK`

Sending the same `external_id` again updates the existing project rather than creating a
second one:

```json
{
  "id": "5b1c...",
  "merchant_name": "BrewCraft",
  "external_id": "SF-0061234",
  "project_url": "https://handover-sandbox-production.up.railway.app/projects/5b1c...",
  "created": false
}
```

The update response carries no `mid` or `checklist_items_created`: the MID is unchanged
and no new checklist is seeded.

Because of this, the integration is safe to retry whenever your CRM does not receive a
response.

---

## 8. Reading projects back

```
GET https://handover-sandbox-production.up.railway.app/api/public/v1/projects?updated_since=2026-10-01T00:00:00Z&limit=100
```

Returns projects in your workspace, newest change first:

```json
{
  "projects": [
    {
      "id": "5b1c...",
      "merchant_name": "BrewCraft",
      "mid": "BREW-001",
      "external_id": "SF-0061234",
      "project_state": "in_progress",
      "go_live_percent": 40,
      "arr": 4700000,
      "kick_off_date": "2026-09-05",
      "expected_go_live_date": "2026-10-15",
      "go_live_date": null,
      "updated_at": "2026-10-02T09:14:00Z"
    }
  ]
}
```

`limit` defaults to 100 and caps at 500. `updated_since` takes an ISO 8601 timestamp and
is the basis for polling: ask for what changed since your last successful poll.

---

## 9. Duplicate handling

Two different protections:

**Same deal sent twice** — matched on `external_id` within your workspace. The existing
project is updated and the response says `"created": false`. This is the retry-safe path.

**A different deal for a merchant that already exists** — if no `external_id` matches but
a project already carries the same `merchant_name` (case-insensitive), the request is
refused with `409` and the existing project's id. Either send the deal with
`"allow_duplicate": true` to create a second project, or reconcile in the CRM.

If one merchant legitimately has several deals, give each its own `external_id`.

---

## 10. Errors

### `400` — invalid request

```json
{
  "error": "Validation failed",
  "fields": [
    { "path": "merchant_name", "message": "Required" }
  ]
}
```

`fields` lists every problem in the request, each naming the offending field.

### `401` — authentication failed

The key is missing, malformed, unknown or revoked.

```json
{ "error": "Invalid API key" }
```

### `409` — merchant already exists

```json
{
  "error": "A project with this merchant_name already exists",
  "project_id": "5b1c..."
}
```

### `500` — Handover could not complete the request

```json
{ "error": "<description>" }
```

Safe to retry: with an `external_id`, a retry cannot create a duplicate.

**Rate limits:** none are enforced today. Handover may introduce a published limit later,
at which point exceeding it returns `429` and the limit is announced in advance.

---

## 11. What happens in Handover

```
CRM deal won
     ↓
API request
     ↓
Project created (state "not started", first phase)
     ↓
Default checklist seeded
     ↓
Project appears in Handover
     ↓
Handover team assigns it
     ↓
Implementation proceeds normally
```

A project created through the API behaves exactly like one created in the UI.

---

## 12. CRM requirements

Your CRM needs to support HTTPS, POST, JSON request bodies, custom headers, and a trigger
when a deal becomes Won. Mechanisms that work:

- Salesforce Flow / HTTP callout
- HubSpot Workflows / Webhooks
- Zoho automation / Deluge
- Pipedrive automations / webhooks
- Zapier or Make

---

## 13. Security

- Store the API key in your CRM's secret store, never in browser-side code or source control.
- Rotate or revoke the key immediately if it is exposed; revocation is instant.
- All requests must use HTTPS.
- A key is scoped to one workspace and cannot read or change another's data.

---

## 14. Testing

Handover provides a sandbox base URL and key. Suggested run-through:

1. Create a test opportunity in your CRM and mark it Won.
2. Confirm the project appears in Handover with the right fields.
3. Confirm the default checklist was created.
4. Confirm the project can be assigned and managed normally.
5. Send the same deal again and confirm the response is `200` with `"created": false`, and
   that no second project appears.
6. Send a deliberately invalid request (no `merchant_name`) and confirm you get `400`.

### A request you can copy

```bash
curl -X POST https://handover-sandbox-production.up.railway.app/api/public/v1/projects \
  -H "Authorization: Bearer hk_live_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_name": "BrewCraft",
    "external_id": "SF-0061234",
    "platform": "Shopify",
    "arr": 4700000,
    "expected_go_live_date": "2026-10-15"
  }'
```

---

## 15. Production setup

After sandbox testing, Handover provides the production base URL, a production API key,
any custom-field mapping, and integration guidance. Switching over is a change of host and
key in your CRM automation; the request and response formats are identical.
