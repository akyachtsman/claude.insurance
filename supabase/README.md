# Supabase backend (prepared — not yet provisioned)

Everything here is **prepared but inert**. No Supabase project exists yet and nothing
in this folder has been applied. Provisioning is gated on explicit go-ahead and on the
project/billing being sorted.

## What's here
- `migrations/0001_init.sql` — `leads` + `rule_settings` tables, RLS policies (anon
  INSERT-only on `leads` with shape checks and no SELECT; anon SELECT-only on
  `rule_settings`), and seeded threshold defaults mirroring `content/rule-defaults.json`.
- `functions/notify-lead/index.ts` — Edge Function that emails the broker when a lead
  is inserted. Reads secrets from the environment; no secrets are committed.

The front-end already talks to this shape: `js/supabase.js` runs in STUB mode and flips
to live REST calls once `js/config.js` is filled with the project URL + anon key.

## Provisioning runbook (run only on go-ahead)
1. **Create the project** (Supabase MCP or dashboard). Capture the project URL, the
   **anon/publishable** key, and the **service-role** key (server-side only).
2. **Apply the migration** — `0001_init.sql` (via MCP `apply_migration` or the SQL
   editor). Confirm RLS is on and `get_advisors` shows no security gaps.
3. **Wire the client** — put the project URL + anon key into `js/config.js`. The anon
   key is publishable and safe to commit; the service-role key must never go here.
4. **Set function secrets** (never committed):
   ```
   supabase secrets set RESEND_API_KEY=… FROM_EMAIL=… BROKER_EMAIL=… WEBHOOK_SECRET=…
   ```
5. **Deploy the function** — `supabase functions deploy notify-lead`.
6. **Create the Database Webhook** — on `INSERT` into `public.leads`, POST to the
   `notify-lead` function URL with header `x-webhook-secret: <WEBHOOK_SECRET>`.
7. **Verify** — insert a test lead from the live site; confirm the row exists, the
   broker email arrives, and that anon cannot SELECT from `leads`.

## Security notes
- The browser only ever uses the anon key; RLS is the enforcement boundary.
- The service-role key and the email provider key live only in the function's secrets.
- A honeypot field (`js/views/qualify.js`) drops trivial bot submissions client-side;
  escalate to a CAPTCHA if abuse appears.
