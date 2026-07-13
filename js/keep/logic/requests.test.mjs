// node --test js/keep/requests.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, statusDisplay, defaultSubject, SUBJECT_MAX, MESSAGE_MAX, stageInfo, isPending, nextStage, REQUEST_STAGES } from "./requests.js";

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
  assert.equal(statusDisplay("requested").label, "Submitted");
  assert.equal(statusDisplay("broker_review").label, "Broker review");
  assert.equal(statusDisplay("underwriting").label, "Underwriting");
  assert.equal(statusDisplay("declined").label, "Declined");
});

test("statusDisplay: unknown falls back to requested", () => {
  assert.equal(statusDisplay("weird").label, "Submitted");
});

test("stageInfo: steps advance along the pipeline", () => {
  assert.equal(stageInfo("requested").step, 1);
  assert.equal(stageInfo("broker_review").step, 2);
  assert.equal(stageInfo("underwriting").step, 3);
  assert.equal(stageInfo("approved").step, 4);
  assert.equal(stageInfo("requested").total, REQUEST_STAGES.length);
});

test("stageInfo: approved is terminal, declined is off-track", () => {
  assert.equal(stageInfo("approved").terminal, true);
  assert.equal(stageInfo("declined").declined, true);
  assert.equal(stageInfo("declined").step, 0);
});

test("stageInfo: unknown status defaults to the first stage", () => {
  assert.equal(stageInfo("weird").step, 1);
});

test("isPending: true until approved/declined", () => {
  assert.equal(isPending("requested"), true);
  assert.equal(isPending("underwriting"), true);
  assert.equal(isPending("approved"), false);
  assert.equal(isPending("declined"), false);
});

test("nextStage: walks the pipeline then stops", () => {
  assert.equal(nextStage("requested"), "broker_review");
  assert.equal(nextStage("broker_review"), "underwriting");
  assert.equal(nextStage("underwriting"), "approved");
  assert.equal(nextStage("approved"), null);
  assert.equal(nextStage("declined"), null);
});

test("defaultSubject: uses the policy line when present", () => {
  assert.equal(defaultSubject("Personal auto"), "Enhance Personal auto");
  assert.equal(defaultSubject(""), "Policy enhancement request");
});
