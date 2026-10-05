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
    // `isTraversal` says whether this navigation was a BROWSER HISTORY move
    // (Back/Forward) rather than following an in-app link. The caller supplies
    // it; js/main.js derives it by stamping each history entry and checking
    // whether the one being entered already carries a stamp.
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

      // A navigation to exactly the entry BELOW the top pops, with or without
      // the flag. This case is unambiguous and was the shipped behaviour for
      // months, so it must not depend on the flag arriving: if stamping is ever
      // unavailable (a context where replaceState throws) every navigation
      // reads as non-traversal, and gating this on the flag would silently
      // restore the circular A<->B loop rather than degrading safely.
      if (stack[stack.length - 2] === fullHash) { stack.pop(); return; }

      // DEEPER unwinding needs the flag, because that is the ambiguous case: at
      // depth >= 2 a matching entry is just as likely a forward breadcrumb
      // click as a multi-step Back, and guessing wrong loses the user's real
      // origin. lastIndexOf, not indexOf, so a route visited twice unwinds to
      // its most recent occurrence; a Forward past a Back lands on a hash the
      // earlier unwind already truncated away and so falls through to the push.
      if (isTraversal) {
        const prior = stack.lastIndexOf(fullHash);
        if (prior >= 0) { stack.length = prior + 1; return; }
      }
      stack.push(fullHash);
    },
    // The route to return to (one below the top), or null at the root.
    previous() { return stack.length >= 2 ? stack[stack.length - 2] : null; },
    get depth() { return stack.length; },
  };
}
