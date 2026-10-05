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
    track(fullHash) {
      const top = stack[stack.length - 1];
      if (fullHash === top) return;                        // in-place re-render
      // Unwind to the route's EXISTING position, at any depth — do not test only
      // stack[len-2]. A multi-step browser Back (held button, history dropdown,
      // history.go(-2)) fires ONE hashchange for the final hash, so from
      // [a,b,c] a back to `a` did not match b and got PUSHED: [a,b,c,a]. The
      // back control on `a` then pointed at `c` — forward, to the page the user
      // had just backed out of twice. That is the circular loop this module's
      // header says it exists to prevent, and it breaks CLAUDE.md's
      // "Origin-aware back (always)" rule.
      //
      // lastIndexOf (not indexOf) so a route visited twice unwinds to its most
      // recent occurrence. For a single-step back and for a forward link to a
      // route already in the stack, this is identical to the old pop.
      const prior = stack.lastIndexOf(fullHash);
      if (prior >= 0) stack.length = prior + 1;            // a back → unwind to it
      else stack.push(fullHash);                           // a forward → push
    },
    // The route to return to (one below the top), or null at the root.
    previous() { return stack.length >= 2 ? stack[stack.length - 2] : null; },
    get depth() { return stack.length; },
  };
}
