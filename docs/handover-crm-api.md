# Handover CRM Integration API (proposed spec)

Purpose: let a customer's CRM push a **won deal** into Handover so a project is
created automatically, with owner assignment and checklist seeding, exactly as if
it were created in the UI.

Status: **specification / plan**. The endpoint below is not built yet — this
document is the contract to review before implementation.

---

## 1. Do we need connectors, or is an API enough?

An API is enough for the core requirement.

| Direction | Mechanism | Why |
|---|---|---|
| CRM -> Handover (deal won creates a project) | **Inbound REST API + API key** | The CRM already supports outbound webhooks / HTTP actions (Salesforce Flow + Outbound Message, HubSpot Workflow Webhook, Zoho Deluge, Pipedrive Automation). No connector needed. |
| Handover -> CRM (push status / go-live back) | Outbound webhook from Handover, or a per-CRM connector | Only needed if customers want two-way sync. Phase 2. |
| No-code customers with no webhook capability | Zapier / Make recipe hitting the same API | Still the same API underneath. |

Recommendation: ship the inbound API first (phase 1), add outbound webhooks
(phase 2), and only build native per-CRM connectors if a large customer cannot
send an HTTP request.

---

## 2. Authentication

Each workspace (tenant) generates one or more API keys in
**Settings → Integrations → API Keys**.

```
Authorization: Bearer hk_live_xxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

- Keys are tenant-scoped; the tenant is derived from the key, never from the body.
- Keys are stored hashed (SHA-256); shown once at creation.
- Revocable and rotatable per key; every call is written to the activity log.

## 3. Base URL

```
https://handover-sandbox.lovable.app/api/public/v1
```

---

## 4. Create / upsert a project from a won deal

`POST /api/public/v1/projects`

### Request body

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
  "owner_email": "rahul@customer.com",
  "integration_type": "Standard",
  "project_notes": "Won from Q3 pipeline",
  "custom_fields": { "region": "West" }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `merchant_name` | string | yes | Brand / account name |
| `external_id` | string | recommended | Your CRM deal ID. Used for idempotency and updates |
| `mid` | string | no | Auto-generated if omitted |
| `contact_email` | string | no | Merchant contact, used for the customer portal link |
| `arr` | number | no | Annual value in rupees (not crores) |
| `aov`, `txns_per_day` | number | no | |
| `kick_off_date`, `expected_go_live_date` | date `YYYY-MM-DD` | no | Defaults to today for kick-off |
| `owner_email` | string | no | Must match a Handover user in the workspace; otherwise unassigned |
| `custom_fields` | object | no | Keys must match custom fields configured in Settings |

### Response `201 Created`

```json
{
  "id": "5b1c…",
  "merchant_name": "BrewCraft",
  "mid": "BREW-001",
  "external_id": "SF-0061234",
  "project_url": "https://handover-sandbox.lovable.app/projects/5b1c…",
  "portal_url": "https://handover-sandbox.lovable.app/portal?token=…",
  "checklist_items_created": 9,
  "created": true
}
```

Repeating the same `external_id` returns `200` with `"created": false` and
updates the changed fields — safe to retry.

### Errors

| Status | Meaning |
|---|---|
| 400 | Validation failed; body lists the offending fields |
| 401 | Missing / invalid / revoked API key |
| 409 | Duplicate `merchant_name` with a different `external_id` (set `"allow_duplicate": true` to override) |
| 429 | Rate limit (60 requests/minute per key) |

---

## 5. Supporting endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects/{id or external_id}` | Read current state, phase, % complete, checklist summary |
| PATCH | `/v1/projects/{id or external_id}` | Update deal fields (value, dates, owner, notes) |
| GET | `/v1/projects?updated_since=…` | Poll changes for CRM write-back |
| GET | `/v1/users` | List workspace users, to map CRM owners to Handover owners |
| GET | `/v1/health` | Key validation ping |

---

## 6. Phase 2 — outbound webhooks (optional)

Workspace admins register a URL; Handover POSTs signed events:

```
X-Handover-Signature: sha256=<hmac of raw body with the webhook secret>
```

Events: `project.created`, `project.state_changed`, `project.owner_assigned`,
`checklist.completed`, `project.went_live`.

---

## 7. Build plan

1. `api_keys` table (tenant_id, name, key_hash, last_used_at, revoked_at) + Settings UI to create/revoke.
2. Key-auth helper for `/api/public/v1/*` routes.
3. `POST /v1/projects` with Zod validation, idempotency on `external_id`, owner mapping, checklist seeding (existing DB trigger) and activity logging.
4. Read/update endpoints + `/v1/users`, `/v1/health`.
5. Rate limiting and per-key request log visible in Settings.
6. Publish this document, plus copy-paste recipes for Salesforce, HubSpot, Zoho and Pipedrive.

Estimated: steps 1–3 are the minimum viable integration; 4–6 follow.
