# Cutover: Lovable → Supabase + Railway

The app now runs on our own Supabase project (`detbvxvhwconosapajbz`, Mumbai) and Railway.
This is the order of operations for the switch itself, and what to check afterwards.

Everything below assumes `PGPASSWORD` set and the Postgres 17 client on PATH:

```
export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
export PGPASSWORD='<database password>'
NEW="postgresql://postgres.detbvxvhwconosapajbz@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

## Before the window

| Step | Where | Notes |
|---|---|---|
| Google OAuth client | Google Cloud Console | Redirect URI `https://detbvxvhwconosapajbz.supabase.co/auth/v1/callback`, plus `http://localhost:53682/callback` while running the consent script |
| Gmail refresh token | `node scripts/google-refresh-token.mjs <id> <secret> gmail` | Paste into Settings → Integrations |
| Google provider | Supabase → Authentication → Providers | Client ID and secret from above |
| Custom domain | Railway → service → Settings → Networking | `seamlesshandover.in`, then the CNAME at the DNS provider |
| Top up AI credit | Anthropic Console | Opus 5 sits behind Buddy |
| Rotate keys | Anthropic, Supabase | Any key pasted into a chat or screenshot |

## The window

Pick a quiet hour. The mail pollers run hourly, so an hour's gap costs nothing.

1. **Freeze writes on Lovable.** Tell the team to stop, and take the Lovable app out of use.
2. **Export from Lovable**: Cloud → Advanced settings → Export data. Download the `.backup`.
3. **Wipe the staging data** in the new project — it is a copy from 22 September and must not
   be mixed with the fresh export:

   ```sql
   -- storage rows first: files go through the Storage API, not SQL
   -- (delete the objects with the API, then:)
   drop schema public cascade;
   create schema public;
   drop schema private cascade;
   delete from auth.identities;
   delete from auth.users;
   ```

4. **Restore**, in this order so foreign keys resolve:

   ```
   pg_restore -d "$NEW" --data-only --no-owner --schema=auth --table=users  handover.backup
   pg_restore -d "$NEW" --data-only --no-owner --schema=auth --table=identities handover.backup
   pg_restore -d "$NEW" --no-owner --schema=public  handover.backup
   psql "$NEW" -c "create schema if not exists private"
   pg_restore -d "$NEW" --no-owner --schema=private handover.backup
   pg_restore -d "$NEW" --data-only --no-owner --schema=storage --table=buckets --table=objects handover.backup
   pg_restore -d "$NEW" --no-owner --schema=storage --section=post-data handover.backup
   ```

   Errors about `sandbox_exec`, `must be owner of table objects` and Supabase's own
   internal storage objects are expected and harmless.

5. **Clear what must not come back.** The dump carries the old workspace's outbound
   settings, including the Slack webhook that was posting reports into a customer's
   channel, and any report recipients pointing at it:

   ```sql
   update public.tenant_integrations
      set slack_webhook_url = null, slack_bot_token = null, slack_channel = null;
   -- then check report recipients before the scheduler is switched on:
   select id, name, recipients from public.saved_reports where recipients::text ilike '%slack%';
   ```

6. **Re-apply the migrations written since the export** — the dump predates them:

   ```
   supabase db push      # scheduler extensions, portable jobs, gmail refresh token
   ```

7. **Copy the storage files.** The dump carries the rows, not the bytes. Public bucket files
   can be pulled straight from the old project; private ones download from Lovable → Storage.
   Upload with the legacy `service_role` JWT (the `sb_secret_` key is rejected by this
   project's storage API):

   ```
   curl -X PUT "https://detbvxvhwconosapajbz.supabase.co/storage/v1/object/<bucket>/<path>" \
     -H "Authorization: Bearer $SERVICE_ROLE_JWT" -H "Content-Type: <mime>" \
     --data-binary "@<file>"
   ```

8. **Point the domain** at Railway, then set APP_BASE_URL back to https://app.seamlesshandover.in on the Railway service (it points at the Railway address while the domain still serves Lovable) and wait for the certificate.

9. **Turn the scheduled jobs on** — this is what starts the new database calling the app:

   ```sql
   select private.set_app_base_url('https://app.seamlesshandover.in');
   select jobname, schedule from cron.job order by jobname;   -- expect 10
   ```

10. **Rotate the scheduler token** and put the result in Railway's `CRON_SECRET`:

   ```sql
   select private.rotate_cron_token();
   ```

11. **Update the outside world**: the Zoom webhook URL, the CRM API base URL customers call,
    the Google OAuth redirect URIs, and each workspace's App Base URL in Settings → Integrations.

## After the switch

Check, in this order — each one covers a different system:

- Sign in with a password, and with Google
- Support access into another workspace
- Buddy: an answer, a report, an approval card, undo
- A merchant portal link: roadmap, credentials, documents, the BRD form
- Outgoing email: an assignment email and a password reset
- The mail pollers, an automation firing, and a scheduled report
- File upload and download in each of the four buckets
- A CRM API call with an existing key
- `select * from cron.job_run_details order by start_time desc limit 10;`

## Then

- Keep Lovable read-only for two weeks as a fallback, then take a final backup and close it.
- Disconnect the GitHub integration so no more "Lovable update" commits arrive.
- Everyone is signed out at cutover: the new project signs tokens with a different secret.
  Passwords are unchanged, so people just sign in again.
