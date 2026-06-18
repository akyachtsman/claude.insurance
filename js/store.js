// store.js — tiny in-memory state shared across views within a session.
// Holds the qualification profile + computed result so summary can read what
// qualify produced. Module singletons persist across hash navigations.

const state = {
  profile: null,   // { domain, answers: { [stepId]: {value, amount?, professional?} } }
  contact: null,   // { name, email, phone }
  submitted: false,
};

export function setProfile(domain, answers, contact) {
  state.profile = { domain, answers };
  state.contact = contact;
  state.submitted = false;
}

export function getProfile() {
  return state.profile;
}

export function getContact() {
  return state.contact;
}

export function hasProfile() {
  return Boolean(state.profile && state.profile.domain);
}

export function markSubmitted() {
  state.submitted = true;
}

export function isSubmitted() {
  return state.submitted;
}

export function reset() {
  state.profile = null;
  state.contact = null;
  state.submitted = false;
}
