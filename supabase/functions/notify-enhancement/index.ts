// notify-enhancement — emails the broker AND the client at both steps of a
// policy-enhancement request:
//   event "requested" — a client submits a request (caller must own the row)
//   event "approved"  — a broker (or service-role) gives final approval
//
// Auth is implemented manually (verify_jwt is disabled on deploy):
//   - "requested" requires the signed-in user to be the row's owner.
//   - "approved"  requires the caller to be a broker (profiles.role='broker')
//     or to present the service-role key.
//
// Email is sent via Resend. Secrets (set in the Supabase dashboard):
//   RESEND_API_KEY  — provider API key (required for email to actually send)
//   BROKER_EMAIL    — where broker notifications go (e.g. rosa@harborline.example)
//   FROM_EMAIL      — verified sender, e.g. "The Keep <keep@yourdomain>"
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected by
// the platform. If RESEND_API_KEY is unset the function still records the
// request and returns {sent:false, reason:"no_provider_key"} so the UI degrades
// gracefully.
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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Identify the caller from the bearer token.
  const authz = req.headers.get("Authorization") || "";
  const token = authz.replace(/^Bearer\s+/i, "").trim();
  const isServiceRole = Boolean(token) && token === SERVICE_KEY;
  let user: { id: string } | null = null;
  if (token && !isServiceRole) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
    user = (await userClient.auth.getUser()).data.user;
  }

  // Load the request row (service-role; bypasses RLS).
  const { data: row, error: rowErr } = await admin.from("enhancement_requests").select("*").eq("id", requestId).maybeSingle();
  if (rowErr || !row) return json({ error: "not_found" }, 404);

  // Resolve the owner's email + name (client recipient).
  const { data: ownerData } = await admin.auth.admin.getUserById(row.owner);
  const clientEmail = ownerData?.user?.email || "";
  const clientName = (ownerData?.user?.user_metadata as { full_name?: string } | undefined)?.full_name || clientEmail || "your client";

  const ctx = row.context ? ` (${esc(row.context)})` : "";

  if (event === "requested") {
    if (!user || user.id !== row.owner) return json({ error: "forbidden" }, 403);
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
    // {sent:false, reason:"no_provider_key"} whenever RESEND_API_KEY is unset —
    // the documented default state — so an unconditional stamp recorded "we
    // tried", making the column useless for finding un-notified requests.
    if (brokerMail.sent || clientMail.sent) {
      await admin.from("enhancement_requests").update({ requested_notified_at: new Date().toISOString() }).eq("id", requestId);
    }
    return json({ ok: true, event, broker: brokerMail, client: clientMail });
  }

  // event === "approved" — the UNDERWRITER's decision, or service-role.
  //
  // CLAUDE.md assigns the underwriting -> approved decision to the underwriter;
  // the broker advances a request only as far as underwriting, which is what the
  // UI already enforces (policies-view gates the broker's control on
  // requested|broker_review). This function is the SERVER-SIDE authority and was
  // accepting "approved" from a broker as well, so the split existed only in the
  // UI. RLS does not close it either: er_broker_update gates by role with no
  // status predicate and no WITH CHECK.
  if (!isServiceRole) {
    if (!user) return json({ error: "forbidden" }, 403);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (prof?.role !== "underwriter") return json({ error: "forbidden" }, 403);
  }

  // STAGE CHECK. The row's status was loaded above and never inspected, so any
  // authorized caller could ask this function to announce an approval for a
  // request in ANY state — including a DECLINED one, whose client email would
  // still read "final approval" and never mention the decline, because `row` is
  // read before the update.
  //
  // ⚠️ BOTH "underwriting" AND "approved" are accepted, and the reason matters.
  // This function does NOT own the transition: approveEnhancement() in
  // js/supabase.js performs a direct RLS-guarded update to "approved" FIRST and
  // only then calls here, best-effort, for the email. So by the time this runs
  // on the normal path the row ALREADY reads "approved". An earlier version of
  // this check demanded "underwriting" and therefore returned 409 on every
  // legitimate underwriter approval made through the shipped UI, silently
  // dropping both the broker and the client notification. Caught in review.
  //
  // Accepting "approved" gives an attacker nothing: reaching that state needs
  // the direct update, which this function has no part in, and anyone who can do
  // it does not need this endpoint. What the check still buys is that an
  // approval cannot be ANNOUNCED for a row sitting at "requested",
  // "broker_review" or "declined".
  //
  // The lifecycle itself is enforced by RLS, not here — and today's policies
  // gate on role alone. See supabase/proposed/
  // 20261005_enhancement_request_stage_guard.sql, which is the fix that actually
  // closes it and is waiting on owner approval.
  if (row.status !== "underwriting" && row.status !== "approved") {
    return json({ error: "bad_stage", status: row.status, expected: "underwriting|approved" }, 409);
  }

  // Only write when the transition has not already happened, so the UI's
  // approved_at is not clobbered with a later timestamp on the normal path.
  if (row.status === "underwriting") {
    await admin.from("enhancement_requests")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", requestId);
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
  if (brokerMail.sent || clientMail.sent) {
    await admin.from("enhancement_requests").update({ approved_notified_at: new Date().toISOString() }).eq("id", requestId);
  }
  return json({ ok: true, event, broker: brokerMail, client: clientMail });
});
