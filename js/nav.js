// nav.js — origin-aware navigation stack (pure + unit-testable).
//
// Tracks visited routes as a STACK so "back" pops to the prior entry instead of
// treating the page you just left as the new "previous" — which would make A→B
// then back→A point A's back control at B again (a circular A↔B loop).
//
// Kept dependency-free (no DOM/router imports) so js/nav.test.mjs can exercise
// it directly; main.js owns the single live instance.

export function createNavStack() {
  // Entries are { hash, id } — the id is the history entry's identity, not its
  // address. A HASH IS NOT AN IDENTITY: two history entries can carry the same
  // hash (visit a route, go deeper, click its breadcrumb), and every version of
  // this module that resolved a traversal by hash picked the wrong one of them.
  const stack = [];
  return {
    // Reconcile the stack with a navigation to `fullHash`.
    //
    // `signal` describes the history entry being entered, and js/main.js builds
    // it by stamping each entry and reading the stamp back:
    //   { id, traversal: false } — a fresh entry: an in-app link, or a load.
    //   { id, traversal: true }  — an entry we have stood on before, so this is
    //                              a browser Back/Forward, and `id` says WHICH.
    //   null                     — no signal at all. main.js reports this only
    //                              when history.replaceState throws, so entries
    //                              can never be stamped.
    //
    // ⚠️ NONE OF THIS IS INFERABLE FROM THE HASH. Three attempts failed here,
    // each in a case this app actually hits:
    //   1. Always push. A multi-step Back fires ONE hashchange, for the final
    //      hash: [a,b,c] + back-to-a = [a,b,c,a], and a's back control pointed
    //      at c — FORWARD, to the page the user had just backed out of twice.
    //   2. Always unwind to a matching entry. This app has breadcrumbs, so a
    //      forward link to a route already deeper in the stack is the COMMON
    //      navigation; truncating there threw away the user's real origin.
    //   3. A boolean traversal flag, resolving the target by hash. Correct
    //      until a hash appears twice: after a→b→c and a click on b's
    //      breadcrumb the stack is [a,b,c,b]; Back to c truncates to [a,b,c],
    //      and Forward to the NEWER b then matched the OLDER b and truncated to
    //      [a,b] — b's back went to a instead of the c the user came from.
    // Only the entry's own identity settles it, which is what `id` carries.
    track(fullHash, signal) {
      const sig = signal && typeof signal === "object" ? signal : null;
      const top = stack[stack.length - 1];

      // In-place re-render: the same hash, and not a traversal onto a DIFFERENT
      // entry that happens to share it. Keying this on the hash alone would
      // swallow such a traversal, since it would look like a re-render and
      // return before the identity check below ever ran.
      //
      // js/main.js cannot currently produce that input — it routes on
      // `hashchange` alone, and traversing between two entries that share a
      // hash leaves the fragment unchanged, so no hashchange fires. Handling it
      // here anyway keeps the ambiguity in the caller (the router does not
      // observe the event) rather than in the stack (which would mishandle it
      // if it did). Observing it needs a `popstate` listener, which would
      // double-fire every hash navigation and is out of scope here.
      const sameEntry = !(sig && sig.traversal && sig.id != null && sig.id !== top?.id);
      if (top && fullHash === top.hash && sameEntry) return;

      if (sig && sig.traversal) {
        // Resolve by entry identity. A Forward onto an entry an earlier unwind
        // truncated away is simply not found, and falls through to the push —
        // which is right: it is a new top, and its origin is the current one.
        const prior = stack.findIndex((e) => e.id != null && e.id === sig.id);
        if (prior >= 0) { stack.length = prior + 1; return; }
      } else if (!sig && stack.length >= 2 && stack[stack.length - 2].hash === fullHash) {
        // No signal (unstampable context) — fall back to the pre-stamp
        // heuristic, which gets single-step Back right and breadcrumbs wrong.
        // Confined to that context on purpose: without it every navigation
        // would read as a link and a multi-step Back would push a duplicate,
        // reinstating the circular A<->B loop above. A wrong origin on a
        // breadcrumb beats a back button that navigates forward.
        stack.pop();
        return;
      }
      stack.push({ hash: fullHash, id: sig ? sig.id : null });
    },
    // The route to return to (one below the top), or null at the root.
    previous() { return stack.length >= 2 ? stack[stack.length - 2].hash : null; },
    get depth() { return stack.length; },
  };
}

// Describe the history entry a navigation is entering, for createNavStack above.
// Takes the History object so it can be driven by a fake one in tests — the two
// halves of this scheme MUST agree, and keeping them in one module is what makes
// that testable. (`js/nav.test.mjs` drives both together.)
//
// A fresh hash navigation — an in-app link or go() — arrives with
// history.state === null, because setting location.hash creates a NEW entry. We
// stamp that entry immediately. When the user later traverses to it with
// Back/Forward the browser restores the entry WITH its stamp, which is how we
// know the difference. Nothing else distinguishes the two: both fire a bare
// hashchange carrying only the resulting hash.
//
// The stamp is an ID, not a flag, because two history entries can share a hash
// (visit a route, go deeper, click its breadcrumb) — so "which entry is this?"
// cannot be answered by the hash. See the header above for the three ways that
// failed before this.
//
// The id is prefixed with a per-load token because history.state SURVIVES A
// RELOAD. Without it a reload resets the counter and the new entries' ids
// collide with stale ids still sitting on entries in the back/forward list, so a
// traversal onto an old entry would resolve to an unrelated new one. A
// mismatched prefix simply fails to match and falls through to a push, which is
// the safe direction.
//
// replaceState (not pushState) — we are labelling the entry we are already on,
// not adding one. Wrapped because a sandboxed or file:// context can throw on
// it, and the throw is reported as `null` — "no signal" — NOT as a
// non-traversal. Claiming the latter would make every multi-step Back push a
// duplicate and reinstate the circular A<->B loop. `stampable` latches because
// the failure is a property of the context, not of one call.
export function createHistorySignal(history, loadToken) {
  const load = loadToken || Math.random().toString(36).slice(2, 10);
  let seq = 0;
  let stampable = true;
  return function navSignal() {
    const st = history.state;
    if (st && typeof st === "object" && typeof st.navId === "string") {
      return { id: st.navId, traversal: true };          // restored: stamped before
    }
    if (!stampable) return null;                         // no signal available
    seq += 1;
    const id = `${load}:${seq}`;
    try {
      // Preserve anything else on the entry rather than replacing the state.
      history.replaceState({ ...(st && typeof st === "object" ? st : {}), navId: id }, "");
    } catch {
      stampable = false;
      return null;
    }
    return { id, traversal: false };
  };
}
