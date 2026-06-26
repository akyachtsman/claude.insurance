// test-settings.mjs — shared threshold fixture for the needs/analysis tests.
// Sourced from content/rule-defaults.json so the tests exercise the real seed
// defaults (and stay in sync with them) rather than a hand-copied duplicate.
// Read via fs (not a JSON import assertion) to stay portable across Node versions.
import { readFileSync } from "node:fs";

const defaults = JSON.parse(
  readFileSync(new URL("../content/rule-defaults.json", import.meta.url))
);
const { _comment, ...SETTINGS } = defaults;

export { SETTINGS };
