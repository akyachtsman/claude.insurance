// content.js — small fetch-once loader/cache for content/*.json.

const cache = {};

async function load(name) {
  if (cache[name]) return cache[name];
  const res = await fetch(`content/${name}.json`);
  if (!res.ok) throw new Error(`failed to load content/${name}.json: ${res.status}`);
  cache[name] = await res.json();
  return cache[name];
}

export function getCoverage() {
  return load("coverage");
}

export function getQuestionnaire() {
  return load("questionnaire");
}

// Find a topic by id across sections; returns { section, topic } or null.
export function findTopic(data, id) {
  for (const section of data.sections) {
    const topic = section.topics.find((t) => t.id === id);
    if (topic) return { section, topic };
  }
  return null;
}

export function getSection(data, id) {
  return data.sections.find((s) => s.id === id) || null;
}

// First sentence of a definition — a compact card blurb without new content.
export function firstSentence(text) {
  if (!text) return "";
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}
