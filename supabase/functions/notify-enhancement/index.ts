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
// Email is sent via Resend. Secrets (set in the Supabase dashboard):
//   RESEND_API_KEY  — provider API key (required for email to actually send)
//   BROKER_EMAIL    — where broker notifications go
//   FROM_EMAIL      — verified sender, e.g. "The Keep <keep@yourdomain>"
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected by
// the platform. If RESEND_API_KEY is unset the function still returns 200 with
// {sent:false, reason:"no_provider_key"} so the UI degrades gracefully — and as
// of this rewrite that is the state nobody has confirmed either way, so a green
// response from here is not evidence that mail left the building.
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
    .select("id, owner, subject, message, context, status")
    .eq("id", requestId)
    .maybeSingle();
  if (rowErr || !row) return json({ error: "not_found" }, 404);

  const ctx = row.context ? ` (${esc(row.context)})` : "";

  if (event === "requested") {
    // Belt, not the boundary: `er_select_own` already refused any row the caller
    // does not own, so reaching here with a foreign row would mean RLS failed.
    if (user.id !== row.owner) return json({ error: "forbidden" }, 403);

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

    // Only stamp when something actually went out. sendEmail returns
    // {sent:false, reason:"no_provider_key"} whenever RESEND_API_KEY is unset, so
    // an unconditional stamp would record "we tried" and make the column useless
    // for finding un-notified requests.
    //
    // ⚠️ VIA AN RPC, NOT AN UPDATE, AND THAT IS NOT A STYLE CHOICE. There is no
    // owner UPDATE policy on enhancement_requests — only er_insert_own,
    // er_select_own and the broker/underwriter UPDATE pair — so the owner's
    // `.update()` here would be refused by RLS. A column grant cannot fix it
    // either: column privileges are per ROLE, and client, broker and underwriter
    // are all `authenticated`. public.stamp_requested_notified is a SECURITY
    // DEFINER function that writes that one column on a row the caller owns;
    // migrations/20261013120000_stamp_requested_notified.sql carries the full
    // reasoning and the alternatives that were rejected.
    let stamped: string | null = null;
    if (brokerMail.sent || clientMail.sent) {
      const { data, error } = await caller.rpc("stamp_requested_notified", { p_request: requestId });
      // The RPC returns NULL for every refusal (not the owner, already stamped,
      // no longer at 'requested'). A null is not an error and must not read as
      // one — but a transport/privilege failure IS worth seeing in the logs,
      // because it means the column silently stops recording.
      if (error) console.error(JSON.stringify({ where: "stamp_requested", code: error.code, message: error.message }));
      else stamped = (data as string | null) ?? null;
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

  // The client's email — the one place the service key is still needed, and not
  // a table read. See the header comment.
  const { data: ownerData } = await authAdmin.auth.admin.getUserById(row.owner);
  const clientEmail = ownerData?.user?.email || "";
  const clientName =
    (ownerData?.user?.user_metadata as { full_name?: string } | undefined)?.full_name || clientEmail || "your client";

  // Only write when the transition has not already happened, so the UI's
  // approved_at is not clobbered with a later timestamp on the normal path.
  // Written as the caller: er_underwriter_update's `with check` admits
  // 'approved', so this succeeds for an underwriter and for nobody else.
  if (row.status === "underwriting") {
    const { error } = await caller.from("enhancement_requests")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", requestId);
    if (error) {
      console.error(JSON.stringify({ where: "approve_update", code: error.code, message: error.message }));
      return json({ error: "update_failed" }, 500);
    }
  }
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
  // Also as the caller. The row's status is 'approved' by now, which the
  // underwriter's `with check` admits, so writing only this timestamp passes.
  if (brokerMail.sent || clientMail.sent) {
    const { error } = await caller.from("enhancement_requests")
      .update({ approved_notified_at: new Date().toISOString() })
      .eq("id", requestId);
    if (error) console.error(JSON.stringify({ where: "stamp_approved", code: error.code, message: error.message }));
  }
  return json({ ok: true, event, broker: brokerMail, client: clientMail });
});
