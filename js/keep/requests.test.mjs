// node --test js/keep/requests.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, statusDisplay, defaultSubject, SUBJECT_MAX, MESSAGE_MAX } from "./requests.js";

test("validateRequest: requires a subject", () => {
  const r = validateRequest({ subject: "", message: "raise my limit" });
  assert.equal(r.ok, false);
  assert.match(r.error, /subject/i);
});

test("validateRequest: requires a message", () => {
  const r = validateRequest({ subject: "Enhance auto", message: "   " });
  assert.equal(r.ok, false);
  assert.match(r.error, /describe/i);
});

test("validateRequest: passes with both", () => {
  assert.deepEqual(validateRequest({ subject: "Enhance auto", message: "raise liability to 500k" }), { ok: true });
});

test("validateRequest: rejects an over-long subject", () => {
  assert.equal(validateRequest({ subject: "x".repeat(SUBJECT_MAX + 1), message: "ok" }).ok, false);
});

test("validateRequest: rejects an over-long message", () => {
  assert.equal(validateRequest({ subject: "ok", message: "x".repeat(MESSAGE_MAX + 1) }).ok, false);
});

test("validateRequest: trims whitespace before checking", () => {
  assert.equal(validateRequest({ subject: "  hi  ", message: "  there  " }).ok, true);
});

test("statusDisplay: maps known statuses", () => {
  assert.equal(statusDisplay("approved").label, "Approved");
  assert.equal(statusDisplay("requested").label, "Awaiting approval");
  assert.equal(statusDisplay("declined").label, "Declined");
});

test("statusDisplay: unknown falls back to requested", () => {
  assert.equal(statusDisplay("weird").label, "Awaiting approval");
});

test("defaultSubject: uses the policy line when present", () => {
  assert.equal(defaultSubject("Personal auto"), "Enhance Personal auto");
  assert.equal(defaultSubject(""), "Policy enhancement request");
});
