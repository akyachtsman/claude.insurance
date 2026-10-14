// notify-enhancement — emails the broker AND the client at both steps of a
// policy-enhancement request:
//   event "requested" — a client submits a request (caller must own the row)
//   event "approved"  — the underwriter gives final approval
//
// ⚠️ REWRITTEN 2026-10-13. EVERY TABLE ACCESS NOW GOES THROUGH THE CALLER'S OWN
// CLIENT (anon key + their JWT), SO RLS SCOPES IT. The previous version built a
// service-role client and used it for the row read, the role lookup and three
// updates — and `service_role` HOLDS NO TABLE PRIVILEGES IN THIS PROJECT.
// Measured on 2026-10-13, independently of the record that first reported it:
//
//   has_table_privilege('service_role','public.enhancement_requests','SELECT')  false
//                                                             ...,'INSERT')     false
//                                                             ...,'UPDATE')     false
//   has_table_privilege('service_role','public.profiles','SELECT')              false
//   has_table_privilege('authenticated', same table, SELECT/INSERT/UPDATE)      true
//
// BYPASSRLS skips POLICIES, not PRIVILEGES. So the first DB call of EVERY
// invocation returned 42501, the error was folded into `rowErr`, and the
// function answered 404 "not_found" to every caller. No enhancement-request
// email has ever been sent, while the deployment read ACTIVE.
//
// Reading through the caller is also the stronger shape, not merely the one that
// works: RLS cannot be removed by editing a `.eq()` out of this handler, and the
// owner/role checks below became belt rather than the boundary. It is the same
// decision feature 003 made for help-ask, for the same reason.
//
// WHAT STILL USES THE SERVICE KEY, AND WHY IT IS NOT A TABLE READ. One thing:
// `auth.admin.getUserById` on the "approved" path, to get the CLIENT's email
// address so they can be told their own request was approved. The caller there
// is the underwriter, who cannot read another user's auth record, and `profiles`
// carries no email column (checked: id, full_name, role, created_at,
// reminder_email, reminder_schedule). That is the GoTrue admin API, authorised
// by the service-role JWT and unaffected by Postgres table grants — which is
// precisely why it still works where the table reads did not. It is confined to
// one call behind one narrowly-named client, and it must never touch a table.
//
// ⚠️ THE SERVICE-ROLE *CALLER* PATH IS GONE. The old code accepted the
// service-role key in the Authorization header as an alternative to a signed-in
// underwriter. Nothing uses it — the only two callers are
// js/keep/views/policies-view.js ("requested", as the client) and
// approveEnhancement() in js/supabase.js ("approved", as the underwriter), both
// browser-side with the user's JWT. And it could not have worked anyway, for the
// privilege reason above. Removing it is what lets this function deploy with
// verify_jwt ON; see supabase/config.toml.
//
// ⚠️⚠️ WHERE THE NOTIFICATION CLAIM LIVES, AND WHY IT MOVED.
//
// It is a row in `public.enhancement_notifications`, keyed (request_id, event),
// taken before any email is sent. `authenticated` holds NOTHING on that table —
// no select, insert, update or delete — and it has no policies, so the client
// has no write path to its own claim at all.
//
// It used to be two columns on `enhancement_requests`
// (`requested_notified_at`, `approved_notified_at`) written by two SECURITY
// DEFINER functions. Codex found a bypass in FOUR consecutive rounds on PR #256:
//
//   round 3  staff reset the stamp to null              -> unbounded resend
//   round 4  write-once trigger leaves the FIRST write open -> forged pre-claim
//   round 5  the INSERT path — create the row pre-stamped
//   round 6  the grantee calls the RPC DIRECTLY — no function, no email
//
// Every one of those has the same root: the claim lived on a row the client can
// write, so each fix could only narrow HOW they write it. global.md -> *Review
// Rounds Have to Terminate* says the answer to that is a redesign, not a fifth
// guard, so the root is gone rather than narrowed. There is no round 7 of that
// mechanism to find, because there is no client write path left.
//
// ⚠️ THE TWO OLD COLUMNS ARE NOW VESTIGIAL. Nothing in this file writes them,
// and the migration revokes EXECUTE on both stamp functions from
// `authenticated`, which closes round 6's bypass outright. Do not read either
// column as evidence that a notification happened; `enhancement_notifications`
// is the record, and even that records only that a CLAIM WAS TAKEN — not that
// an email was attempted, let alone delivered (a configured-but-erroring
// provider leaves a claim with nothing sent, logged as `*_send`).
//
// Email is sent via Resend. Secrets (set in the Supabase dashboard):
//   RESEND_API_KEY  — provider API key (required for email to actually send)
//   BROKER_EMAIL    — where broker notifications go
//   FROM_EMAIL      — verified sender, e.g. "The Keep <keep@yourdomain>"
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected by
// the platform. If RESEND_API_KEY is unset the function still returns 200 with
// {sent:false, reason:"no_provider_key"} so the UI degrades gracefully — and as
// of this rewrite that is the state nobody has confirmed either way, so a green
// response from here is not evidence that mail left the building.
//
// ⚠️⚠️ BEFORE DEPLOYING THIS FUNCTION — the one check CI cannot make.
// Every table this file touches is created and fenced by a migration, and
// `privilege.test.mjs` gates that those migrations SAY the right thing. It
// cannot gate that they are APPLIED: it reads directories, and a file sitting in
// supabase/migrations/ whose remote apply was skipped or failed looks identical
// to one that is live. A test that could tell would need production credentials,
// which this repo's Safety Rules forbid. So the authoritative check is a deploy
// step, and it is this:
//
//   1. list what this file touches:
//        grep -oE '\.(from|rpc)\("[^"]*"' index.ts | sort -u
//      client tables, through the caller under RLS: enhancement_requests, profiles
//      the service-role surface, and the whole of it: claim_notification, which
//      is the only writer of enhancement_notifications
//   2. run the Supabase MCP `list_migrations` and confirm, for each of them,
//      every migration that CREATES it or REVOKES on it is present. These are
//      the boundary, not housekeeping:
//        20261014195128 — creates enhancement_notifications, grants
//          service_role select+insert on it, and defines claim_notification with
//          EXECUTE to service_role only. Skipped: every claim returns 42501 or
//          "function does not exist", the handler answers `claim_failed`, nothing
//          is sent. FAIL-CLOSED — a dead endpoint, not a wrong email.
//          ✅ APPLIED 2026-10-14, with the catalog read back and every probe run.
//          ⚠️ IT WAS NOT ON THE MACHINE-CHECKED LINE BELOW UNTIL THAT DAY, AND
//          NOT BECAUSE ANYONE FORGOT. The derivation in `privilege.test.mjs`
//          took the tables this file names in `.from(...)`; this handler reaches
//          the claim table only through `.rpc("claim_notification")`, and the
//          helper it used ALSO filtered the claim table out by name. So the one
//          migration that creates the table and the RPC was structurally
//          invisible to the check — and the suite stayed green at 23/23 through
//          the apply and the move, which is how that was finally measured. The
//          derivation now takes `.from(...)` tables PLUS the claim table.
//        20261013013743 — revoke update on enhancement_requests. Skipped: staff
//          can rewrite a client's request text and lifecycle columns.
//        20261013014854 — revoke insert on enhancement_requests. Skipped: the
//          table-wide INSERT grant stands.
//        20261005120100 — revoke update/insert on profiles. Skipped: any client
//          can set their own `profiles.role` to 'underwriter', which THIS
//          HANDLER READS to authorize the approved path — so they gain approval
//          capability, and er_underwriter_select gives them every client's
//          requests. Codex #256 round 9.
//      ⚠️ Unlike the claim table, the three REVOKE migrations are NOT
//      fail-closed: the function works and the boundary is simply absent, which
//      is the worse direction. That asymmetry is why both kinds are listed.
//      `privilege.test.mjs` DERIVES this list in two hops — the tables this file
//      names in `.from(...)`, then the migrations that create or revoke on any
//      of them — and compares the next line by set equality, so it can neither
//      go stale nor keep a version whose migration is gone.
//
//   ⚠️ THE MACHINE-CHECKED LIST IS THE NEXT LINE, and it is the only part of
//   this header `privilege.test.mjs` compares against the migrations. Keeping it
//   on one line is deliberate: the first version of that check looked for each
//   version ANYWHERE in the header, and a mutation deleting 20261013014854 from
//   the checklist PASSED because the prose above still mentioned it. An
//   assertion over a wider text than the property belongs to cannot fail.
//   CONFIRM APPLIED: 20261005120100 20261013013743 20261013014854 20261014195128
//
// ⚠️⚠️ 3. AND MEASURE THE EFFECTIVE STATE, NOT ONLY THAT THE FILES ARE APPLIED.
// Six consecutive Codex rounds (17, 19, 20, 21, 22, 23) found a construct the
// source scanner in privilege.test.mjs was not reading: `all privileges`, a
// grantee it did not model, `on routine`, `on all tables in schema`, a quoted
// role, a `do '…'` body, `alter table … owner to`, `alter table … rename`, a
// SECURITY DEFINER helper, a PL/pgSQL body with the GRANT after `if … then`,
// and a decoy body hidden in a function OPTION. Each was fixed; the pattern is
// the finding. **A text scan over SQL cannot soundly decide who can write a
// table** — privileges can arrive through grants, ownership, renames, default
// privileges, role membership, a function body or dynamic SQL, and SQL has a
// procedural sublanguage inside it. The scanner is a net, not a proof.
//
// So run this against the project (Supabase MCP `execute_sql`) and read the
// four answers. It measures the END STATE, however it was reached:
//
//   -- a. who holds anything on the claim table, and who owns it
//   select 'priv' kind, grantee, privilege_type
//     from information_schema.table_privileges
//    where table_schema = 'public' and table_name = 'enhancement_notifications'
//   union all
//   select 'owner', pg_get_userbyid(c.relowner), case when c.relrowsecurity then 'rls on' else 'RLS OFF' end
//     from pg_class c join pg_namespace n on n.oid = c.relnamespace
//    where n.nspname = 'public' and c.relname = 'enhancement_notifications'
//   ;
//   -- ⚠️ THIS UNION ARM USED TO READ A RELATION NAMED `pg_policies_compat`,
//   -- WHICH DOES NOT
//   -- EXIST — not in PostgreSQL and not in this repo. Query (a) would have
//   -- stopped with `relation "pg_policies_compat" does not exist` and returned
//   -- none of the end state it promises. Codex round 24. Presenting an
//   -- unrunnable query as "runnable" is the same overclaiming defect this file
//   -- keeps recording; the policy check is (c), which is real, and it is
//   -- REQUIRED SEPARATELY rather than folded in here.
//   -- EXPECT: grantee service_role only (select, insert); owner NOT
//   -- authenticated/anon; 'rls on'. Any other grantee, or an owner that a
//   -- client can authenticate as, is the hole — a table owner is not subject
//   -- to its policies unless FORCE ROW LEVEL SECURITY is set.
//
//   -- b. who may call the claim RPC
//   select p.proname, p.prosecdef as security_definer, p.proconfig, p.proacl
//     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
//    where n.nspname = 'public' and p.proname = 'claim_notification';
//   -- EXPECT: security_definer true, proconfig {search_path=}, and proacl
//   -- naming service_role ONLY. An empty/null proacl means PUBLIC may execute.
//
//   -- c. policies on the claim table (expect ZERO rows)
//   select polname, polcmd, polroles::regrole[] from pg_policy
//     where polrelid = 'public.enhancement_notifications'::regclass;
//
//   -- d. ⚠️ THE CLIENT-CALLABLE SECURITY DEFINER SURFACE — not "every function
//   -- that can write the claim table", which is what this said and could not
//   -- deliver. Codex round 24, answering the exact question put to it: a
//   -- PUBLIC-executable definer helper can CALL claim_notification without
//   -- naming the table, so a `prosrc` substring search returns one row while a
//   -- client can still pre-consume a claim. Views, triggers and dynamically
//   -- assembled names have the same gap. A substring search over source is
//   -- the unsoundness just retracted for privilege.test.mjs, and repeating it
//   -- here would have been the same mistake one layer out.
//   --
//   -- What IS exact is the ACL: the set of functions a client role may execute
//   -- AS THEIR DEFINER is enumerable from the catalog, independent of any
//   -- source text. It is small. Every row must be one you can account for.
//   select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
//          p.prosecdef, p.proconfig, p.proacl,
//          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can,
//          has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can
//     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
//    where n.nspname = 'public' and p.prosecdef
//      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
//        or has_function_privilege('anon', p.oid, 'EXECUTE'));
//   -- EXPECT: the stamp functions only if their EXECUTE has not yet been
//   -- revoked, and NOTHING that touches enhancement_notifications. A row here
//   -- you cannot account for is a privilege-escalation path by construction —
//   -- a definer function runs as its owner, so what it can do is not bounded
//   -- by what the caller can do.
//
//   -- d2. ⚠️ AND THE TRIGGER-MEDIATED PATH, WHICH (d1) CANNOT SEE. PostgreSQL
//   -- checks EXECUTE on a trigger function when the TRIGGER IS CREATED, not
//   -- for the role whose DML fires it. So a SECURITY DEFINER trigger function
//   -- with EXECUTE revoked from anon and authenticated still runs on a
//   -- client's INSERT/UPDATE, `has_function_privilege` is false, and (d1)
//   -- omits it entirely — even if its body writes enhancement_notifications or
//   -- calls the claim RPC. Codex round 25, with the upstream thread cited; it
//   -- is the direct answer to the question put to that round, and it falsifies
//   -- the "every escalation path appears as a row" claim (d1) carried alone.
//   select c.relname as on_table, t.tgname, p.proname, p.prosecdef,
//          pg_get_userbyid(p.proowner) as fn_owner,
//          t.tgtype,   -- which events: see CREATE TRIGGER; all four are possible
//          has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
//            as client_any_dml,
//          has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
//            as anon_any_dml
//     from pg_trigger t
//     join pg_class c on c.oid = t.tgrelid
//     join pg_proc p on p.oid = t.tgfoid
//     join pg_namespace n on n.oid = c.relnamespace
//    where n.nspname = 'public' and not t.tgisinternal and p.prosecdef;
//   -- ⚠️ NO PRIVILEGE FILTER, DELIBERATELY. The first version required the
//   -- client to hold INSERT or UPDATE on the trigger's table, and that was
//   -- unsound twice over (Codex round 26, answering the question put to it):
//   --   · triggers fire on all four DML events, so a client holding only
//   --     DELETE or TRUNCATE still fires one, and the filter dropped it;
//   --   · a DELETE trigger also fires on a CASCADE from another table, so the
//   --     client may hold NO privilege on the trigger's own relation and still
//   --     cause its definer body to run.
//   -- A filter on the caller's privileges therefore cannot be sound here. The
//   -- privileges are reported as COLUMNS for the operator to read, and the row
//   -- set is every non-internal definer trigger in `public` — which is small.
//   -- EXPECT TODAY: **ZERO ROWS**. ⚠️ This said "the write-once trigger on
//   -- enhancement_requests", which CANNOT appear: `enforce_notified_write_once()`
//   -- is declared WITHOUT `security definer` (20261013013743), so it is an
//   -- INVOKER trigger and this query filters on `p.prosecdef`. An operator
//   -- reading the old line would have taken a correct empty result for a FAILED
//   -- APPLY — a checklist that cries wolf is one that stops being run, which
//   -- makes a wrong EXPECT worse than a missing one. Codex round 27.
//   -- The filter is right and stays: an INVOKER trigger runs with the CALLER's
//   -- privileges, so it is not an escalation path and does not belong here.
//   -- Each row that does appear is a definer body a client may be able to cause
//   -- to run without holding EXECUTE on it. A FIRST row appearing is the signal.
//   -- Then, as a NARROWER aid and not a proof, the substring search:
//   select p.proname, p.prosecdef, p.proacl
//     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
//    where n.nspname = 'public' and p.prosrc ilike '%enhancement_notifications%';
//   -- It finds direct writers. It does NOT find indirect ones, and must not be
//   -- read as exhaustive.
//
// ⚠️⚠️ WHAT THESE CHECKS ARE, AND WHAT THEY ARE NOT — read this before relying
// on any of them, because the previous two versions of this paragraph each
// claimed more than the queries deliver and each was corrected by review.
//
// SOUND, from the catalog, no source text involved:
//   (a) who holds privileges on the claim table, and who OWNS it
//   (b) RLS enabled, and the claim RPC's security mode, search_path and ACL
//   (c) the policies on the claim table (expect zero)
// These are what no source scan can replace.
//
// BOUNDED, not exhaustive — each enumerates ONE KIND of path to a definer body
// a client can cause to run:
//   (d1) definer functions a client may EXECUTE directly
//   (d2) definer TRIGGER functions on tables a client may write — which (d1)
//        cannot see, because EXECUTE is checked at trigger creation
// Deciding what a given row's body does is back to reading code.
//
// ⛔ NOT COVERED, stated so nobody infers it: a view with `security_invoker` off
// whose owner can read more than the caller; `ALTER DEFAULT PRIVILEGES` taking
// effect on objects created later; role MEMBERSHIP (a custom role granted to
// `authenticated` carries its privileges); rules (`CREATE RULE`); a definer
// trigger reached by a CASCADE from a table the client CANNOT write (which is
// why (d2) no longer filters on the caller's privileges at all); and anything
// a definer body assembles as dynamic SQL. Each is a known gap with no cheap
// catalog answer, and naming them is the point: the earlier wording said "every
// escalation path must appear as a row", which Codex round 25 falsified with the
// trigger case on the first try.
//
// The honest summary: these queries make the escalation surface SMALL AND
// LISTED, not empty and proven. That is a better position than the source
// scanner was in, and it is not a proof.
//   ⚠️ The claim table's own migration IS on that line now, as 20261014195128
//   (applied 2026-10-14, moved from supabase/proposed/). This text used to say it
//   was "NOT on that line because it is not applied yet ... when it is applied
//   and moves to migrations/, its version joins the line above and the test
//   requires it there" — the apply happened and the test did NOT require it, for
//   the reason recorded above. Both halves are fixed: the version is listed, and
//   the derivation can now see it.
//   ⚠️ 20261013005250 came OFF this line when the claim moved: it defines
//   stamp_requested_notified, which nothing calls any more.
//
//   3. only then deploy. A missing RPC migration is FAIL-CLOSED (the rpc errors and
//      the branch returns `claim_failed` with nothing sent), so the cost is a
//      silent dead endpoint rather than a wrong email — which is exactly the
//      failure mode that let this function read ACTIVE while sending nothing for
//      its whole life. Confirm, do not assume.
//   Also confirm RESEND_API_KEY / BROKER_EMAIL / FROM_EMAIL are set (unknowable
//   from a session, see above) and that verify_jwt is ON for the deploy.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// ⚠️ PINNED EXACTLY, AND IT WAS `@2` — A FLOATING MAJOR — UNTIL 2026-10-14.
// There is no Deno lockfile here, so a major-only JSR constraint resolves to the
// latest satisfying release AT BUILD TIME: two deploys of byte-identical
// repository source could produce different bundles, which flatly contradicts
// the "idempotent re-upload" claim functions-deploy.yml makes when it redeploys
// this function on a push that only touched the other one.
//
// It also contradicted a standard this repo states at length elsewhere and had
// not carried here. CLAUDE.md -> "No third-party code on the render path": the
// browser client was VENDORED and pinned precisely because an unpinned major put
// a third party on the critical path, and "an ES module import cannot carry an
// integrity hash". That argument is not weaker for an Edge Function — this one
// holds the service-role key and reads client rows.
//
// help-ask already pinned 2.117.2; the two now match deliberately, so a reader
// cannot find two versions of one dependency in one project and have to work out
// which is intended. Raised by Codex on #270, with the JSR semver-resolution
// docs cited; verified here by diffing the two import lines.
//
// ⚠️ `functions-js/edge-runtime.d.ts` above is left unpinned ON PURPOSE: it is a
// types-only import that Deno strips, so it contributes nothing to the runtime
// bundle, and both functions carry it identically. Pinning it would be noise.
import { createClient } from "jsr:@supabase/supabase-js@2.117.2";

// Validated at module load, not asserted away with `!`. With a missing value the
// `!` deferred the failure to createClient(undefined, ...) inside the request
// handler, surfacing as an unhandled rejection rather than a diagnosable error.
function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`notify-enhancement: required env var ${name} is not set`);
  return v;
}
const SUPABASE_URL = required("SUPABASE_URL");
const SERVICE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = required("SUPABASE_ANON_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const BROKER_EMAIL = Deno.env.get("BROKER_EMAIL") || "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "The Keep <onboarding@resend.dev>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// ⚠️ EVERY RECIPIENT IS VALIDATED BEFORE EITHER CLAIM, and this helper exists so
// that is one rule rather than a per-branch habit. `sendEmail("")` returns
// `{sent:false, reason:"no_recipient"}` — it does not throw — so an empty
// address after the claim means the handler answers 200 while the notification
// is PERMANENTLY undeliverable: the claim is write-once by design, so correcting
// the address later changes nothing.
//
// Round 10 fixed this for ONE recipient (the approved branch's client lookup).
// Round 11 pointed out the other three ways in: an unset BROKER_EMAIL on either
// branch, and a requested-event caller whose JWT carries no email. Same
// mechanism, three more doors — so per global.md -> *Review Rounds Have to
// Terminate* this is a helper both branches call, not a third patch.
//
// Returning here leaves the row CLAIMABLE, so a retry works once the address or
// the secret is fixed. Nothing has been sent at this point, so there is nothing
// to be idempotent about.
function missingRecipients(parts: Record<string, string>): Response | null {
  const missing = Object.entries(parts).filter(([, v]) => !v.trim()).map(([k]) => k);
  if (missing.length === 0) return null;
  console.error(JSON.stringify({ where: "recipients", missing }));
  return json({ error: "no_recipient", missing }, 502);
}

// THE CLAIM CLIENT — service-role, and its whole surface is ONE call:
// `claim_notification`, which writes only the server-only dedup log. It must
// never read or write a CLIENT table; `privilege.test.mjs` fails on any other
// `.from()` or `.rpc()` under this client, the same way it already pins
// `authAdmin` to the Auth admin API.
//
// Why a service-role client is correct here and nowhere else in this file: the
// point of the table is that `authenticated` holds NOTHING on it, so the caller
// cannot write its own claim. That is the whole fix — it is what removes the
// root the four bypasses grew from (see the migration). Everything about the
// client's own records still goes through `caller` under RLS.
const claims = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Takes the notification claim for one (request, event) pair, atomically.
//
// The function's `insert ... select ... where <status matches> on conflict do
// nothing returning` does two things in ONE statement: a second simultaneous
// invocation blocks on the primary key and comes back with NULL, and the
// request's status is re-checked at the instant the claim is taken.
//
// ⚠️ THE STATUS RE-CHECK IS NOT BELT. Without it, an underwriter who declines
// the request after this handler's guarded transition would still get the
// `approved` claim, and the client would be sent a FALSE final-approval email —
// the primary key bounds that to one email, it does not prevent it. Codex
// raised it as a P1 on the redesign commit, and it is the one thing the OLD
// column-based claim did right: it carried `and status = 'approved'` in the
// same statement. Restoring that is not a return to the bypassable design —
// EXECUTE here is `service_role` only, so the client cannot call it, and it
// reads no identity from `auth.uid()`.
//
// ⚠️ FAIL CLOSED, AND THE TWO OUTCOMES ARE NOT THE SAME. Zero rows means
// "someone else holds this claim" -> `already_notified`, nothing sent, correct.
// An ERROR means the claim could not be evaluated at all — the table is not
// applied yet, the grant is missing, the database is unreachable — and the
// caller gets `claim_failed` with nothing sent. Treating an error as "already
// claimed" would silently swallow every notification the moment the migration
// or the grant went missing, which is exactly how this function spent its whole
// deployed life before PR #256.
async function claimNotification(requestId: string, event: "requested" | "approved") {
  const { data, error } = await claims.rpc("claim_notification", { p_request: requestId, p_event: event });
  if (error) return { claimed: null as string | null, error };
  return { claimed: (data as string | null) ?? null, error: null };
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return { sent: false, reason: "no_provider_key" };
  if (!to) return { sent: false, reason: "no_recipient" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) return { sent: false, reason: `provider_${res.status}`, detail: (await res.text()).slice(0, 300) };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: "provider_error", detail: String(e).slice(0, 300) };
  }
}

function shell(title: string, lines: string[]): string {
  return `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#231d3a">
    <div style="background:#5b3ee6;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0;font-weight:800;font-size:18px">Harborline · The Keep</div>
    <div style="border:1px solid #ece7fb;border-top:none;border-radius:0 0 14px 14px;padding:22px">
      <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>
      ${lines.map((l) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#3a3357">${l}</p>`).join("")}
      <p style="margin:18px 0 0;font-size:12px;color:#8079a3">This is an automated notification from The Keep. Coverage changes are confirmed by your licensed broker.</p>
    </div>
  </div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: { requestId?: string; event?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { requestId, event } = payload || {};
  if (!requestId || (event !== "requested" && event !== "approved")) return json({ error: "bad_request" }, 400);

  // THE CALLER'S OWN CLIENT. Anon key plus their Authorization header, so every
  // query below is scoped by RLS exactly as it is in the browser. This is the
  // only client that touches a table; `authAdmin` below must not.
  const authz = req.headers.get("Authorization") || "";
  if (!authz) return json({ error: "unauthorized" }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });

  const { data: userData } = await caller.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  // AUTH ADMIN ONLY — never a table. Used once, on the approved path, to resolve
  // the client's email for their own notification. See the header comment.
  const authAdmin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // The row, read as the caller. RLS decides: `er_select_own` for the owner on
  // the requested path, `er_underwriter_select` for the underwriter on the
  // approved one. A caller entitled to neither gets zero rows, which is the same
  // 404 as a bad id — deliberately indistinguishable, so this endpoint cannot be
  // used to probe which request ids exist.
  const { data: row, error: rowErr } = await caller
    .from("enhancement_requests")
    // ⚠️ THE TWO STAMP COLUMNS ARE NOT SELECTED, DELIBERATELY. They are vestigial
    // after the claim moved to its own table, and two prechecks used to gate on
    // them — so for any row whose old stamp had been set (including by round 6's
    // direct-RPC bypass, and including this repo's own probe rows, whose values
    // are write-once and which the new migration neither clears nor imports)
    // this handler answered `already_notified` BEFORE consulting the claim
    // table. The suppression bypass survived the redesign for exactly those
    // rows. Codex #256, on the redesign commit. Not selecting them is the
    // cheapest way to make a relapse impossible rather than merely absent.
    .select("id, owner, subject, message, context, status")
    .eq("id", requestId)
    .maybeSingle();
  if (rowErr || !row) return json({ error: "not_found" }, 404);

  const ctx = row.context ? ` (${esc(row.context)})` : "";

  if (event === "requested") {
    // Belt, not the boundary: `er_select_own` already refused any row the caller
    // does not own, so reaching here with a foreign row would mean RLS failed.
    if (user.id !== row.owner) return json({ error: "forbidden" }, 403);

    // ⚠️ THE STAGE/IDEMPOTENCY GATE RUNS **BEFORE** THE EMAILS, AND THAT
    // ORDERING IS THE WHOLE POINT (Codex #256 round 1, P1).
    //
    // The first version of this sent both emails and only THEN called the RPC,
    // whose `status = 'requested' and requested_notified_at is null` clauses
    // were meant to be the gate. They were not: they ran after the side effect.
    // So any signed-in owner could POST `event: "requested"` for their own row
    // over and over — including after it had advanced to approved or declined,
    // where the client email still read "we've received your request and sent it
    // to your broker for review" — and the RPC would dutifully return null
    // afterwards having prevented nothing. Unbounded broker email, unbounded
    // provider spend, and a re-announcement that is actively misleading.
    // The migration's own comment claimed that clause "stops re-announcing a
    // request that has since moved to broker_review or beyond"; as integrated it
    // stopped nothing, which is the comment-overclaims-code defect this PR has
    // now produced twice.
    //
    // 1. NO PROVIDER KEY -> RETURN BEFORE CLAIMING, TO PRESERVE RETRYABILITY.
    //    With RESEND_API_KEY unset nothing can be sent and nothing ever will be
    //    on this invocation, so claiming would burn the one claim the row has:
    //    the request would be unclaimable afterwards, and once the key IS set
    //    the notification could never be sent, by design. Returning first keeps
    //    the row claimable for the invocation that can actually do something.
    //    ⚠️ Deliberately NOT justified as "only stamp when something went out",
    //    which is what this said — that phrasing reads the stamp as evidence of
    //    a send, and the header above disclaims exactly that: the claim is taken
    //    BEFORE either provider call, a provider failure leaves it populated,
    //    and a direct RPC call populates it with no send at all. The reason is
    //    retryability, not bookkeeping about mail. (Codex #256 round 8.)
    //    This is also the state the repo cannot currently verify, so it is the
    //    likely one.
    if (!RESEND_API_KEY) {
      return json({ ok: true, event, broker: { sent: false, reason: "no_provider_key" },
                    client: { sent: false, reason: "no_provider_key" }, stamped: null });
    }

    // 2. A PRE-READ CHECK, FOR A USEFUL ERROR ONLY — not the gate. The RPC
    //    cannot distinguish "wrong stage" from "already notified" (it returns a
    //    bare null by design, so it cannot be used to probe row ids), so this
    //    turns the common cases into something a log reader can act on. It
    //    RACES, and is therefore not relied on.
    if (row.status !== "requested") {
      return json({ error: "bad_stage", status: row.status, expected: "requested" }, 409);
    }

    // 3. EVERY RECIPIENT, BEFORE THE CLAIM. The caller's own address comes from
    //    their OWN session — no admin lookup, because on this path the caller
    //    IS the recipient — so this is a read of the JWT and cannot double-send.
    //    BROKER_EMAIL is checked here too: it is a secret this repo cannot
    //    verify is set (see the header), so "configured but empty" is the
    //    likely shape, not an exotic one. Codex #256 round 11.
    const clientEmail = user.email || "";
    const clientName =
      (user.user_metadata as { full_name?: string } | undefined)?.full_name || clientEmail;
    const badRecipients = missingRecipients({ broker: BROKER_EMAIL, client: clientEmail });
    if (badRecipients) return badRecipients;

    // 4. THE CLAIM — atomic, and the actual gate. The primary key on
    //    (request_id, event) IS the concurrency design: a second simultaneous
    //    invocation blocks on that unique index and then returns ZERO rows. One
    //    claim, one refusal, never two emails — the same guarantee the old
    //    `update ... where <stamp> is null` gave under a row lock, with no
    //    predicate left to get wrong.
    const { claimed, error: claimErr } = await claimNotification(requestId, "requested");
    if (claimErr) {
      console.error(JSON.stringify({ where: "claim_requested", code: claimErr.code, message: claimErr.message }));
      return json({ error: "claim_failed" }, 500);
    }
    if (!claimed) {
      // Lost the race, or this (request, event) was already claimed. Nothing was
      // sent, which is the correct outcome rather than a failure.
      return json({ error: "already_notified" }, 409);
    }

    // (Both addresses were resolved and validated above, before the claim.)
    const brokerMail = await sendEmail(
      BROKER_EMAIL,
      `New enhancement request: ${row.subject}`,
      shell("New policy enhancement request", [
        `<b>${esc(clientName)}</b> has requested a policy enhancement${ctx}.`,
        `<b>Subject:</b> ${esc(row.subject)}`,
        `<b>Details:</b><br>${esc(row.message)}`,
        `Review and give final approval in the broker console.`,
      ]),
    );
    const clientMail = await sendEmail(
      clientEmail,
      `We received your request: ${row.subject}`,
      shell("Your request has been received", [
        `Hi ${esc(clientName)}, we've received your policy enhancement request${ctx} and sent it to your broker for review.`,
        `<b>Subject:</b> ${esc(row.subject)}`,
        `<b>Details:</b><br>${esc(row.message)}`,
        `You'll get another email once it has final approval.`,
      ]),
    );

    // ⚠️ RESIDUAL, STATED RATHER THAN HIDDEN: the claim is taken before the
    // send, so a provider that is CONFIGURED but ERRORING leaves the row marked
    // notified with nothing delivered. That is the deliberate direction — the
    // same "billing unknown resolves as billed" trade help-ask makes for its
    // reservations — because the alternative, releasing the claim on failure,
    // needs an owner-callable un-stamp, and an owner-callable un-stamp
    // reopens exactly the unbounded re-send this gate closes. It is logged
    // loudly so the condition is findable, and a real retry mechanism is the
    // product answer rather than a weaker gate.
    // ⚠️ EITHER failure logs, not both — and this branch kept the `&&` for a
    // whole round after the approved branch was fixed, because the test that
    // was supposed to be "branch-generic" searched the WHOLE FILE for one `||`
    // and found the other branch's. Codex #256 round 12. Fourth time in this
    // pair that an assertion over a wider text than the property belongs to
    // could not fail.
    if (!brokerMail.sent || !clientMail.sent) {
      console.error(JSON.stringify({
        where: "requested_send", claimed,
        broker: brokerMail.reason, client: clientMail.reason,
      }));
    }
    // `stamped` keeps its wire name: the field has always meant "when this
    // notification was claimed", which is still exactly what it carries.
    return json({ ok: true, event, broker: brokerMail, client: clientMail, stamped: claimed });
  }

  // event === "approved" — the UNDERWRITER's decision.
  //
  // CLAUDE.md assigns the underwriting -> approved decision to the underwriter;
  // the broker advances a request only as far as underwriting, which is what the
  // UI already enforces (policies-view gates the broker's control on
  // requested|broker_review) and what er_broker_update's `with check` now
  // enforces in the database as well.
  //
  // The role is read from the caller's OWN profiles row under `profiles select
  // own`, so a caller can only ever assert their own role. The previous version
  // read it with the service key, which both failed (42501) and, had it worked,
  // would have been able to read anyone's.
  const { data: prof, error: profErr } = await caller
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profErr) {
    console.error(JSON.stringify({ where: "profile_role", code: profErr.code, message: profErr.message }));
    return json({ error: "forbidden" }, 403);
  }
  if (prof?.role !== "underwriter") return json({ error: "forbidden" }, 403);

  // STAGE CHECK. Without it any authorized caller could ask this function to
  // announce an approval for a request in ANY state — including a DECLINED one,
  // whose client email would still read "final approval", because `row` is read
  // before the update.
  //
  // ⚠️ BOTH "underwriting" AND "approved" are accepted, and the reason matters.
  // This function does NOT own the transition: approveEnhancement() in
  // js/supabase.js performs a direct RLS-guarded update to "approved" FIRST and
  // only then calls here, best-effort, for the email. So by the time this runs on
  // the normal path the row ALREADY reads "approved". An earlier version demanded
  // "underwriting" and therefore returned 409 on every legitimate underwriter
  // approval made through the shipped UI, silently dropping both notifications.
  //
  // Accepting "approved" gives an attacker nothing: reaching that state needs the
  // direct update, which this function has no part in. What the check still buys
  // is that an approval cannot be ANNOUNCED for a row sitting at "requested",
  // "broker_review" or "declined".
  if (row.status !== "underwriting" && row.status !== "approved") {
    return json({ error: "bad_stage", status: row.status, expected: "underwriting|approved" }, 409);
  }

  // ⚠️ THE SAME CLAIM-BEFORE-SEND GATE AS THE REQUESTED BRANCH, AND IT WAS
  // MISSING HERE FOR A ROUND (Codex #256 round 2, P1).
  //
  // Round 1 fixed the requested path and this branch kept the identical defect:
  // it accepts `approved` by design, never read `approved_notified_at`, and
  // overwrote that timestamp only AFTER the sends. So with a provider key
  // configured, any authenticated underwriter could POST `event: "approved"` for
  // an already-approved request and resend both emails indefinitely, and
  // ordinary retries or concurrent invocations duplicated them too.
  // Worth recording why it survived: the round-1 fix was written as a fix to
  // "the gate", and the review request that followed asked whether anything
  // could reach `sendEmail` in the REQUESTED branch without claiming. Both
  // framings were one branch wide. A defect that exists in two arms of the same
  // function is one defect.
  //
  // 1. No provider key -> return before claiming, for the same reason as the
  //    requested branch: claiming what cannot be sent makes the column lie.
  if (!RESEND_API_KEY) {
    return json({ ok: true, event, broker: { sent: false, reason: "no_provider_key" },
                  client: { sent: false, reason: "no_provider_key" } });
  }

  // 2. Pre-read check, for a useful error only. It races; the claim is the gate.

  // 3. The status transition, now guarded on the status we actually read. Two
  //    concurrent invocations both saw 'underwriting' before; both wrote, and the
  //    second clobbered `approved_at` with a later timestamp. `.eq("status",
  //    "underwriting")` makes it a no-op for the loser.
  if (row.status === "underwriting") {
    const { data: moved, error } = await caller.from("enhancement_requests")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "underwriting")
      .select("id");
    if (error) {
      console.error(JSON.stringify({ where: "approve_update", code: error.code, message: error.message }));
      return json({ error: "update_failed" }, 500);
    }
    // ⚠️ THE TRANSITION MUST PROVE IT MATCHED (Codex #256 round 3, P1). Without
    // `.select("id")` and this check, a concurrent underwriter who moved the row
    // to `declined` between the stage read and here left this update matching
    // ZERO rows — silently, because PostgREST does not error on that — and the
    // function carried on to announce an approval for a declined request.
    if (!moved || moved.length === 0) {
      return json({ error: "bad_stage", expected: "underwriting", note: "row moved before the transition" }, 409);
    }
  }

  // 4. THE CLAIM — through an authorizing SECURITY DEFINER function, so the
  //    handler is not the thing being trusted.
  //
  //    ⚠️ THIS WAS A PLAIN CONDITIONAL UPDATE UNTIL Codex #256 round 4, and the
  //    history is worth keeping because the update looked sufficient twice.
  //    `authenticated` held UPDATE on every column of this table, so:
  //      - staff could reset either stamp to null and make this function
  //        re-send without bound (round 3 / an automated security review), and
  //      - staff could PRE-CLAIM a stamp on an unapproved request, after which
  //        this function reads it populated, answers `already_notified`, and
  //        emails NOBODY (round 4). A write-once trigger alone made that
  //        second one permanent, which is why the trigger-only design was
  //        withdrawn.
  //    The fix is in the database, not here: `revoke update on
  //    enhancement_requests from authenticated` + `grant update (status,
  //    approved_at)`, with both stamps written only through functions that
  //    authorize caller, status and direction. `stamp_approved_notified`
  //    requires the caller to be the underwriter (read from `profiles`, not
  //    from the request), the row to be at `approved`, and the column to be
  //    null — so the role check above and the `.eq("status","approved")` this
  //    replaces are now belt, with the boundary in the function.
  //
  //    ⚠️ THE MIGRATION IS NOW APPLIED — `migrations/20261013013743_notified_
  //    stamps_write_once.sql`, live as of 2026-10-13, together with
  //    `20261013014854_enhancement_requests_insert_column_scope.sql` which
  //    narrowed INSERT the same way. An earlier version of this comment said
  //    the function existed only under `proposed/` and that this rpc would
  //    fail; leaving that in place would tell an operator a ready deployment was
  //    blocked. It is not: this call resolves against a live function.
  // ⚠️ RESOLVE THE CLIENT'S ADDRESS **BEFORE** CLAIMING — ordering, again, and
  // the mirror image of round 1. The claim must come before the SENDS (that is
  // what makes it a gate), but it must come after everything that can fail
  // without sending anything. This lookup used to sit below the claim, so a
  // transient `getUserById` failure, or an account with no email, consumed the
  // one claim the row has and then called sendEmail("") — which returns
  // `no_recipient`, not an error. The handler answered 200 and the client's
  // approval notice became **unsendable forever**, because the claim is
  // write-once by design. Worse, the log below only fired when BOTH sends
  // failed, so a successful broker send hid it completely. Codex #256 round 10.
  //
  // Returning here instead leaves the row CLAIMABLE, so a retry can still send
  // both emails. Nothing has been sent at this point, so there is nothing to be
  // idempotent about. The lookup is a READ: doing it first cannot double-send,
  // and two concurrent invocations still resolve to one claim and one refusal.
  const { data: ownerData, error: ownerErr } = await authAdmin.auth.admin.getUserById(row.owner);
  if (ownerErr) {
    console.error(JSON.stringify({ where: "owner_lookup", code: ownerErr.code ?? null, message: ownerErr.message }));
    return json({ error: "owner_lookup_failed" }, 502);
  }
  const clientEmail = ownerData?.user?.email || "";
  const clientName =
    (ownerData?.user?.user_metadata as { full_name?: string } | undefined)?.full_name || clientEmail;
  // BROKER_EMAIL is in the same gate as the client address — round 10 validated
  // only the client here, and an unset BROKER_EMAIL burns the claim exactly the
  // same way. Codex #256 round 11.
  const badRecipients = missingRecipients({ broker: BROKER_EMAIL, client: clientEmail });
  if (badRecipients) return badRecipients;

  // THE CLAIM. Same primary-key atomicity as the requested branch.
  // ⚠️ WHO MAY DO THIS IS STILL ENFORCED BY THE DATABASE, just not inside this
  // statement any more. The old SECURITY DEFINER function carried the
  // underwriter check in its own WHERE clause; the claim table knows nothing
  // about roles. What replaces it is not a handler assertion: the row was READ
  // as the caller under `er_underwriter_select`, the role came from the caller's
  // OWN `profiles` row, and the status transition below is an UPDATE as the
  // caller under `er_underwriter_update`. A caller who is not the underwriter
  // cannot reach this line, and could not move the row if they did.
  const { claimed, error: claimErr } = await claimNotification(requestId, "approved");
  if (claimErr) {
    console.error(JSON.stringify({ where: "claim_approved", code: claimErr.code, message: claimErr.message }));
    return json({ error: "claim_failed" }, 500);
  }
  if (!claimed) {
    // Lost the race, or this (request, event) was already claimed. Nothing sent,
    // which is the correct outcome rather than a failure.
    return json({ error: "already_notified" }, 409);
  }

  // (The client's address was resolved above, before the claim — the one place
  // the service key is still needed, and not a table read. See the header.)
  const brokerMail = await sendEmail(
    BROKER_EMAIL,
    `Enhancement approved: ${row.subject}`,
    shell("Enhancement approved", [
      `The enhancement request from <b>${esc(clientName)}</b>${ctx} has been marked approved.`,
      `<b>Subject:</b> ${esc(row.subject)}`,
    ]),
  );
  const clientMail = await sendEmail(
    clientEmail,
    `Approved: ${row.subject}`,
    shell("Your enhancement was approved", [
      `Good news, ${esc(clientName)} — your policy enhancement request${ctx} has final approval.`,
      `<b>Subject:</b> ${esc(row.subject)}`,
      `Your broker will follow up with the updated policy details.`,
    ]),
  );
  // Same residual as the requested branch, and the same reasoning: the claim is
  // taken before the send, so a provider configured-but-erroring leaves the row
  // marked notified with nothing delivered. Logged so it is findable.
  // ⚠️ EITHER failure logs, not both. This read `!broker && !client`, so a
  // successful broker send silently masked a failed client send — on a claim
  // that cannot be retaken. The recipient is now validated before the claim, so
  // the remaining causes are provider-side, and a half-delivered notification is
  // exactly the case worth finding in the logs. Codex #256 round 10.
  if (!brokerMail.sent || !clientMail.sent) {
    console.error(JSON.stringify({
      where: "approved_send", broker: brokerMail.reason, client: clientMail.reason,
    }));
  }
  return json({ ok: true, event, broker: brokerMail, client: clientMail });
});
