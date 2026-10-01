# Sending deals to Handover from your CRM

**Companion to:** the Handover CRM Integration API (v1) specification.
**Who this is for:** whoever administers your CRM.

The API reference says what Handover accepts. This says how to make your CRM send it when
a deal is marked Won, in the five systems customers ask for most.

What every setup needs, whatever the CRM:

| | |
|---|---|
| Method | `POST` |
| URL | `https://seamlesshandover.in/api/public/v1/projects` |
| Header | `Authorization: Bearer hk_live_…` (your workspace key) |
| Header | `Content-Type: application/json` |
| Trigger | Deal / opportunity stage becomes Won |
| Body | JSON, `merchant_name` required, `external_id` strongly recommended |

If your CRM cannot send a custom header, skip to [Zapier or Make](#zapier-or-make).

---

## Field mapping

Map your CRM's fields onto these. Only the first is required, and sending the deal ID is
what makes retries safe.

| Handover field | Typical CRM field |
|---|---|
| `merchant_name` | Account / Company / Organisation name |
| `external_id` | Opportunity or Deal ID |
| `contact_email` | Primary contact email |
| `brand_url` | Website |
| `platform` | Platform (custom field) |
| `category` | Industry / Category |
| `arr` | Amount / Annual contract value |
| `aov` | Average order value (custom field) |
| `txns_per_day` | Transactions per day (custom field) |
| `kick_off_date` | Close date, or the agreed start date |
| `expected_go_live_date` | Target go-live (leave out to let Handover derive it) |
| `sales_spoc` | Opportunity owner's email |
| `integration_type` | Integration type (custom field) |
| `project_notes` | Deal description / notes |

Numbers must be sent as numbers, not strings: `"arr": 4700000`, never `"arr": "4700000"`.
Dates are `YYYY-MM-DD`. Fields Handover doesn't recognise are ignored silently, so check
spelling.

---

## Salesforce

Flow with an HTTP Callout. The key lives in a Named Credential, never in the flow.

1. **Setup → Named Credentials → External Credential**: authentication protocol **Custom**.
   Add a Principal (name it `Handover`), then a Custom Header: name `Authorization`, value
   `Bearer hk_live_…`.
2. **Named Credential**: URL `https://seamlesshandover.in`, link it to that External
   Credential. Give your integration user's permission set access to the principal.
3. **Flow** (Record-Triggered, Opportunity, "A record is updated"):
   - Entry condition: `StageName` equals `Closed Won`, and set the flow to run only when
     the record *starts* meeting the condition, so an edit to a won deal doesn't re-fire.
   - Action → **HTTP Callout** → the Named Credential, `POST`, path
     `/api/public/v1/projects`.
   - Provide the sample response below so Flow can build the data types.
4. Save the returned `id` or `project_url` to a field on the Opportunity if you want a link
   back to the project.

Sample response to paste when Salesforce asks for one:

```json
{
  "id": "5b1c0000-0000-0000-0000-000000000000",
  "merchant_name": "BrewCraft",
  "mid": "BREW-001",
  "external_id": "SF-0061234",
  "project_url": "https://seamlesshandover.in/projects/5b1c...",
  "checklist_items_created": 8,
  "created": true
}
```

Use `{!$Record.Id}` for `external_id` — it's unique and stable, which is exactly what the
duplicate protection needs.

---

## HubSpot

HubSpot's standard **Send a webhook** workflow action cannot add an `Authorization` header,
so use a **Custom code** action (Operations Hub Professional) — or route through Zapier if
you don't have it.

Workflow: Deal-based, enrolment trigger `Deal stage is Closed Won`. Add a Custom code
action (Node.js), with the key stored as a secret named `HANDOVER_API_KEY`:

```javascript
exports.main = async (event, callback) => {
  const props = event.inputFields;

  const res = await fetch("https://seamlesshandover.in/api/public/v1/projects", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HANDOVER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      merchant_name: props.dealname,
      external_id: String(event.object.objectId),
      arr: props.amount ? Number(props.amount) : undefined,
      kick_off_date: props.closedate ? props.closedate.slice(0, 10) : undefined,
      project_notes: props.description || undefined,
    }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(`Handover ${res.status}: ${JSON.stringify(body)}`);

  callback({ outputFields: { handover_project_url: body.project_url } });
};
```

Add `dealname`, `amount`, `closedate` and `description` as properties to copy, and map
`handover_project_url` back onto a deal property so the sales team can click through.

---

## Zoho CRM

A Deluge function, called from a workflow rule.

1. **Setup → Automation → Workflow Rules**: module Deals, trigger on edit, condition
   `Stage is Closed Won`. Action: **Function**.
2. The function (argument: `dealId` as `Deal Id`):

```javascript
deal = zoho.crm.getRecordById("Deals", dealId.toLong());

payload = Map();
payload.put("merchant_name", deal.get("Account_Name").get("name"));
payload.put("external_id", "ZOHO-" + dealId);
if (deal.get("Amount") != null) { payload.put("arr", deal.get("Amount").toDecimal()); }
if (deal.get("Closing_Date") != null) { payload.put("kick_off_date", deal.get("Closing_Date").toString("yyyy-MM-dd")); }

headers = Map();
headers.put("Authorization", "Bearer hk_live_…");
headers.put("Content-Type", "application/json");

response = invokeurl
[
  url: "https://seamlesshandover.in/api/public/v1/projects"
  type: POST
  parameters: payload.toString()
  headers: headers
];

info response;
return response;
```

Keep the key in a Zoho **connection** or a configuration record rather than inline, so it
isn't visible to everyone who can read the function.

---

## Pipedrive

Pipedrive's built-in automation webhook sends no custom headers, so use its
**Send API request** automation action (Automations, available on Professional and above),
or route through Zapier or Make.

Trigger: Deal updated, filter `Status = Won`. Action: Send API request —
`POST https://seamlesshandover.in/api/public/v1/projects`, headers as above, body:

```json
{
  "merchant_name": "{{deal.org_name}}",
  "external_id": "PD-{{deal.id}}",
  "arr": {{deal.value}},
  "project_notes": "{{deal.title}}"
}
```

Note `arr` has no quotes around it — it must go as a number.

---

## Zapier or Make

Works with any CRM, and the right answer when the CRM can't send custom headers.

**Zapier:** Trigger = your CRM's "Deal won" / "Updated deal" event (add a filter on stage).
Action = **Webhooks by Zapier → Custom Request**:

- Method `POST`, URL `https://seamlesshandover.in/api/public/v1/projects`
- Data: the JSON body, mapping CRM fields in
- Headers: `Authorization` = `Bearer hk_live_…`, `Content-Type` = `application/json`
- Set **Unflatten** to `no`

**Make:** an HTTP → "Make a request" module with the same values; set Body type to
**Raw**, content type JSON.

---

## Testing before you go live

Ask Handover for a sandbox URL and key, then:

1. Move a test deal to Won and confirm the automation fires.
2. Check the project appears in Handover with the fields you mapped.
3. Confirm the checklist was seeded.
4. **Re-run the same deal.** You should get `200` with `"created": false` and still exactly
   one project. If a second appears, `external_id` isn't being sent.
5. Send one with no `merchant_name` and confirm your automation surfaces the `400` rather
   than failing silently.

Switching to production is a change of host and key; the request body is identical.

---

## When something goes wrong

| Status | Meaning | What to do |
|---|---|---|
| `401` | Key missing, wrong or revoked | Check the header reads `Bearer hk_live_…`; some tools add their own `Authorization` and drop yours |
| `400` | Validation failed | The `fields` array names each bad field. Usually a number sent as a string, or a date not in `YYYY-MM-DD` |
| `409` | A project already exists with that merchant name, under a different deal | Send `"allow_duplicate": true` for a genuine second project, or reconcile in the CRM |
| `500` | Handover could not complete it | Retry. With an `external_id` a retry cannot duplicate anything |
| No response | Usually a timeout in the CRM | Retry the same payload; the `external_id` makes it safe |

**Duplicate projects appearing** means `external_id` is missing or not stable — check it's
the deal's own ID and not a formula that changes.

**A field isn't arriving:** unrecognised field names are ignored without error. Compare
yours against the field table in the API specification.

Log the response body in your automation. Every error Handover returns says what was wrong,
and that detail is lost if only the status code is kept.
