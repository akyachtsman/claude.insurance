// nav.js — origin-aware navigation stack (pure + unit-testable).
//
// Tracks visited routes as a STACK so "back" pops to the prior entry instead of
// treating the page you just left as the new "previous" — which would make A→B
// then back→A point A's back control at B again (a circular A↔B loop).
//
// Kept dependency-free (no DOM/router imports) so js/nav.test.mjs can exercise
// it directly; main.js owns the single live instance.

export function createNavStack() {
  const stack = [];
  return {
    // Reconcile the stack with a navigation to `fullHash`.
    // `isTraversal` is THREE-STATE, and the third state matters:
    //   true  — a browser history move (Back/Forward).
    //   false — an in-app link (a nav card, a breadcrumb, a router redirect).
    //   null / undefined — the caller CANNOT TELL. js/main.js reports this only
    //     when history.replaceState throws, so entries can never be stamped.
    // js/main.js derives the first two by stamping each history entry and
    // checking whether the one being entered already carries a stamp.
    //
    // ⚠️ IT CANNOT BE INFERRED FROM THE HASH, and both ways of guessing are
    // wrong in a case this app actually hits:
    //   - Only ever pushing means a multi-step Back (held button, history
    //     dropdown, history.go(-2)) — which fires ONE hashchange, for the final
    //     hash — appends a duplicate: [a,b,c] + back-to-a = [a,b,c,a]. The back
    //     control on `a` then pointed at `c`: FORWARD, to the page the user had
    //     just backed out of twice. That is the circular loop this module's
    //     header exists to prevent.
    //   - Only ever unwinding to an existing entry breaks forward links. After
    //     list -> entity -> asset -> policy, clicking the entity BREADCRUMB is a
    //     forward navigation to a route already deeper in the stack; truncating
    //     there throws away the intervening origins, so entity's back went to
    //     the list instead of the policy the user actually came from. This app
    //     has breadcrumbs, so that is the common case, not the exotic one.
    // Hence the flag. Both behaviours are correct — for different events.
    track(fullHash, isTraversal) {
      const top = stack[stack.length - 1];
      if (fullHash === top) return;                        // in-place re-render

      // A traversal unwinds to the matching entry at ANY depth. lastIndexOf,
      // not indexOf, so a route visited twice unwinds to its most recent
      // occurrence; a Forward past a Back lands on a hash the earlier unwind
      // already truncated away and so falls through to the push.
      if (isTraversal === true) {
        const prior = stack.lastIndexOf(fullHash);
        if (prior >= 0) { stack.length = prior + 1; return; }

      // A KNOWN link always pushes — including onto stack[len-2]. An earlier
      // version popped there unconditionally, on the reasoning that a one-step
      // match "is unambiguous". It is not: after entity -> asset -> policy,
      // clicking the ASSET breadcrumb is a forward link to exactly that entry,
      // and popping truncated the policy away, so the asset's Back returned to
      // the entity instead of the policy the user came from. Breadcrumbs make
      // that the common navigation in this app, not the exotic one.
      } else if (isTraversal == null && stack[stack.length - 2] === fullHash) {
        // Signal absent (unstampable context) — fall back to the pre-flag
        // heuristic, which gets single-step Back right and breadcrumbs wrong.
        // That trade only applies where replaceState throws; without it, EVERY
        // navigation would read as a link and a multi-step Back would push a
        // duplicate, reinstating the circular A<->B loop this module exists to
        // prevent. Wrong origin on a breadcrumb beats a back button that
        // navigates forward.
        stack.pop();
        return;
      }
      stack.push(fullHash);
    },
    // The route to return to (one below the top), or null at the root.
    previous() { return stack.length >= 2 ? stack[stack.length - 2] : null; },
    get depth() { return stack.length; },
  };
}
