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
      if (fullHash === top) return;                                   // in-place re-render
      if (stack[stack.length - 2] === fullHash) stack.pop();          // a back → pop to it
      else stack.push(fullHash);                                      // a forward → push
    },
    // The route to return to (one below the top), or null at the root.
    previous() { return stack.length >= 2 ? stack[stack.length - 2] : null; },
    get depth() { return stack.length; },
  };
}
