// help-ask — the Help desk endpoint (feature 003).
//
// A NEW function slug, deliberately not the retired `desk-ask` stub this feature
// was first drafted over. Deploying on top of that stub would have shipped 003
// and removed the dead endpoint in one owner action, which is tempting — but it
// also silently changes what a deployed name means, and this repo has been bitten
// repeatedly by a record that still reads as current. `desk-ask` stays
// unambiguously retired and its deletion stays a separate, closable item;
// "help-ask" also matches what the feature is now called everywhere else.
//
// Deploy with the default, verify_jwt ON — see handler.ts's header for the
// probe that reversed the earlier `--no-verify-jwt` decision.
//
// ⚠️ THE LOGIC IS NOT HERE. It is in ./handler.ts, with its collaborators
// injected, because this file's `jsr:` and `npm:` specifiers are exactly what
// stopped anything from executing it — and a review's mutation test showed seven
// of eight behaviour-breaking edits leaving the whole suite green, a dropped
// `.eq("owner", owner)` on the entity read among them. That file's header has the
// full list. This one is the wiring: secrets, clients, and the network call that
// fetches the corpus.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// PINNED. `@2` was floating while the four lines below argued that a
// self-updating server dependency is the same class of surprise as the esm.sh
// incident — and the Anthropic SDK beside it WAS pinned, so the file contradicted
// itself. Version VERIFIED against the npm registry on 2026-10-07 (latest
// 2.117.2), which is also what Deno resolved `@2` to.
import { createClient } from "jsr:@supabase/supabase-js@2.117.2";
// Pinned, not floating: the esm.sh incident recorded in CLAUDE.md is about the
// browser, but a server-side dependency that self-updates is the same class of
// surprise. Version VERIFIED against the npm registry on 2026-10-06 (latest
// 0.131.0) rather than recalled.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { handle } from "./handler.ts";
import type { HelpTopic } from "./prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://akyachtsman.github.io/claude.insurance";

// The help guide has ONE home: content/help-guide.json, which also seeds the
// client's suggestion chips. Bundling a copy here would be faster and would
// drift the first time a screen was renamed, with nothing reporting it — so the
// function fetches the served copy and caches it for the life of the isolate.
// Cost of that choice, stated rather than hidden: if the guide is unreachable
// the feature is unavailable. It does NOT fall back to answering from records
// alone, because "where do I add an entity" would then be answered with no
// knowledge of the screens at all.
let guideCache: HelpTopic[] | null = null;
async function loadGuide(): Promise<HelpTopic[] | null> {
  // `?.length`, not a truthiness check: `guideCache` is an ARRAY, so `[]` is
  // truthy and a corpus whose entries all failed the field filter cached itself
  // as "loaded" for the life of the isolate. Measured: the caller's `if (!topics)`
  // guard passed too, renderTopics emitted "(no matching screens)", and the model
  // answered from records alone — the one outcome the comment above forbids.
  if (guideCache?.length) return guideCache;
  try {
    // The 10s deadline is not decoration: this fetch runs AFTER the throttle row
    // is inserted, and a hung Pages response held that reservation until the 150s
    // platform timeout killed the isolate — with no release, because nothing ran.
    // Nothing was billed, so the slot was pure loss to the client.
    const res = await fetch(`${APP_URL}/content/help-guide.json`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const topics = Array.isArray(data?.topics) ? data.topics : [];
    // A topic missing a field would render a blank line in the prompt, so an
    // incomplete corpus is filtered here rather than reaching the model.
    guideCache = topics.filter((t: HelpTopic) =>
      t && t.id && t.title && t.route && t.nav && t.body);
    return guideCache;
  } catch {
    return null;
  }
}

const callerClient = (authz: string) =>
  createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authz } }, auth: { persistSession: false },
  });

Deno.serve((req: Request) =>
  handle(req, {
    admin: createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }),
    // Built per request: it carries THIS caller's bearer token. Used both to
    // resolve the identity and — since `service_role` has NO select on the
    // client tables in this project (measured; see handler.ts Deps.admin) — to
    // read their records, where `authenticated` does hold select and RLS scopes
    // every row to `owner = auth.uid()`.
    userDb: (authz: string) => callerClient(authz),
    userClient: (authz: string) => callerClient(authz).auth.getUser(),
    // ⚠️ maxRetries: 0, NOT 1. The handler reserves exactly ONE row per ask and
    // treats a timeout as "billing unknown", keeping that row. The SDK retries a
    // timeout, so `maxRetries: 1` sent TWO billable generations against one
    // reserved slot — the throttle undercounted spend by up to 2x, which is the
    // bypass the reservation exists to prevent. It also doubled the worst case to
    // ~121s, close enough to the 150s platform limit to turn a slow provider into
    // a hard timeout. One reservation, one call.
    anthropic: new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 0 }),
    loadGuide,
    appUrl: APP_URL,
    hasKeys: Boolean(SUPABASE_URL && SERVICE_KEY && ANON_KEY && ANTHROPIC_API_KEY),
  }));
