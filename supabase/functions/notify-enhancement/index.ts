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
// ⚠️⚠️ WHAT THE NOTIFICATION STAMPS DO AND DO NOT PROMISE — read before
// trusting either column, and before adding a fifth guard to this file.
//
// They record that a CLAIM WAS TAKEN. They do **not** establish that a
// notification was attempted, let alone delivered. EXECUTE on both stamp
// functions is granted to `authenticated`, so the grantee can call
// `/rest/v1/rpc/stamp_requested_notified` (or the approved one) DIRECTLY,
// without this function running and without any email being sent — after which
// the legitimate notification answers `already_notified` and stays silent.
// ⚠️ The post-apply probe in migrations/20261013005250 demonstrates exactly this
// and was read as a passing test: calling the function as the owner IS the
// bypass.
//
// WHAT THAT IS AND IS NOT WORTH WORRYING ABOUT. A client calling the requested
// stamp suppresses their OWN email — self-harm, negligible. An UNDERWRITER
// calling the approved stamp suppresses the CLIENT's approval notice, silently.
// That one is real, and it is by a trusted staff account that can already
// approve or decline arbitrarily. Neither causes unbounded SENDING, which is
// what the claim was introduced to stop and does stop.
//
// FOUR ROUNDS, ONE MECHANISM (Codex #256 rounds 3-6): staff resetting the stamp;
// a write-once trigger that left the first write open; the INSERT path; and now
// the grantee calling the RPC directly. Each fix was right for its round and the
// mechanism kept failing, which per global.md -> *Review Rounds Have to
// Terminate* is a redesign decision rather than a fifth patch. The two candidate
// designs and the trade-offs are written up in CLAUDE.md; it is an owner call,
// deliberately not taken here.
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
// Every `.rpc(...)` below resolves against a migration, and `privilege.test.mjs`
// gates that the definition EXISTS and is shaped correctly. It cannot gate that
// the migration is APPLIED: it reads directories, and a file sitting in
// supabase/migrations/ whose remote apply was skipped or failed looks identical
// to one that is live. A test that could tell would need production credentials,
// which this repo's Safety Rules forbid. So the authoritative check is a deploy
// step, and it is this:
//
//   1. list the RPCs this file calls:
//        grep -o '\.rpc("[^"]*"' index.ts | sort -u
//      today: stamp_requested_notified, stamp_approved_notified
//   2. run the Supabase MCP `list_migrations` and confirm the migration defining
//      each one is present — 20261013005250 and 20261013013743 respectively
//   3. only then deploy. A missing migration is FAIL-CLOSED (the rpc errors and
//      the branch returns `claim_failed` with nothing sent), so the cost is a
//      silent dead endpoint rather than a wrong email — which is exactly the
//      failure mode that let this function read ACTIVE while sending nothing for
//      its whole life. Confirm, do not assume.
//   Also confirm RESEND_API_KEY / BROKER_EMAIL / FROM_EMAIL are set (unknowable
//   from a session, see above) and that verify_jwt is ON for the deploy.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
    .select("id, owner, subject, message, context, status, requested_notified_at, approved_notified_at")
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
    // 1. NO PROVIDER KEY -> RETURN BEFORE CLAIMING. With RESEND_API_KEY unset
    //    nothing can be sent, so there is nothing to record; claiming here would
    //    stamp every request as notified while sending none, which is exactly
    //    the lie the "only stamp when something went out" rule exists to
    //    prevent. This is also the state the repo cannot currently verify, so it
    //    is the likely one.
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
    if (row.requested_notified_at) {
      return json({ error: "already_notified", at: row.requested_notified_at }, 409);
    }

    // 3. THE CLAIM — atomic, and the actual gate. `update ... where
    //    requested_notified_at is null and status = 'requested'` is evaluated
    //    under a row lock: a second concurrent invocation blocks, re-evaluates
    //    the WHERE against the committed new version, matches nothing and gets
    //    null. So two simultaneous POSTs produce one claim and one refusal, not
    //    two emails — which is the half a pre-read check alone cannot give.
    const { data: claim, error: claimErr } = await caller
      .rpc("stamp_requested_notified", { p_request: requestId });
    if (claimErr) {
      console.error(JSON.stringify({ where: "stamp_requested", code: claimErr.code, message: claimErr.message }));
      return json({ error: "claim_failed" }, 500);
    }
    const stamped = (claim as string | null) ?? null;
    if (!stamped) {
      // Lost the race, or the row moved between the read and the claim. Nothing
      // was sent, which is the correct outcome rather than a failure.
      return json({ error: "already_notified" }, 409);
    }

    // The client's own address comes from their OWN session — no admin lookup,
    // because on this path the caller IS the recipient. One fewer cross-user
    // read than the version this replaces.
    const clientEmail = user.email || "";
    const clientName =
      (user.user_metadata as { full_name?: string } | undefined)?.full_name || clientEmail || "your client";

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
    if (!brokerMail.sent && !clientMail.sent) {
      console.error(JSON.stringify({
        where: "requested_send", claimed: stamped,
        broker: brokerMail.reason, client: clientMail.reason,
      }));
    }
    return json({ ok: true, event, broker: brokerMail, client: clientMail, stamped });
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
  if (row.approved_notified_at) {
    return json({ error: "already_notified", at: row.approved_notified_at }, 409);
  }

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
  const { data: claim, error: claimErr } = await caller
    .rpc("stamp_approved_notified", { p_request: requestId });
  if (claimErr) {
    console.error(JSON.stringify({ where: "stamp_approved", code: claimErr.code, message: claimErr.message }));
    return json({ error: "claim_failed" }, 500);
  }
  const claimed = (claim as string | null) ?? null;
  if (!claimed) {
    // Lost the race, already notified, the row moved, or the caller is not the
    // underwriter — the function returns a bare NULL for all of them on
    // purpose, so this endpoint cannot be used to tell them apart. Nothing
    // sent, which is the correct outcome rather than a failure.
    return json({ error: "already_notified" }, 409);
  }

  // The client's email — the one place the service key is still needed, and not
  // a table read. See the header comment.
  const { data: ownerData } = await authAdmin.auth.admin.getUserById(row.owner);
  const clientEmail = ownerData?.user?.email || "";
  const clientName =
    (ownerData?.user?.user_metadata as { full_name?: string } | undefined)?.full_name || clientEmail || "your client";

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
  if (!brokerMail.sent && !clientMail.sent) {
    console.error(JSON.stringify({
      where: "approved_send", broker: brokerMail.reason, client: clientMail.reason,
    }));
  }
  return json({ ok: true, event, broker: brokerMail, client: clientMail });
});
