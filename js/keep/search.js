// keep/search.js — pure search + command-intent matching for the Keep.
// No DOM, no globals: takes data in, returns ranked results. Unit-tested
// (js/keep/search.test.mjs). Powers both the top-nav search box and the
// "what would you like to accomplish?" command input on the landing page.

// Action catalogue — the "intelligent" command box maps free text to one of
// these. `keywords` are the phrases we match against; `href` is where it goes.
export const KEEP_ACTIONS = [
  { id: "add-entity", label: "Add an entity", hint: "Create a business or trust", href: "#/keep/add-entity", icon: "briefcase",
    keywords: ["add entity", "new entity", "add business", "new business", "add trust", "create company", "add company", "llc", "corporation"] },
  { id: "add-asset", label: "Add an asset", hint: "Home, vehicle, valuables and more", href: "#/keep/add-asset", icon: "plus",
    keywords: ["add asset", "new asset", "add home", "add house", "add car", "add vehicle", "add property", "add boat", "add jewelry", "insure something"] },
  { id: "request-enhancement", label: "Request a policy enhancement", hint: "Ask your broker to add or increase coverage", href: "#/keep/request", icon: "spark",
    keywords: ["request enhancement", "policy enhancement", "enhance", "enhance coverage", "modify policy", "modify my policy", "increase coverage", "add coverage", "upgrade policy", "change policy", "improve coverage", "request change", "raise limits"] },
  { id: "audit", label: "Audit my policies", hint: "Review coverage and find gaps", href: "#/keep/insurance", icon: "clipboard",
    keywords: ["audit", "audit policies", "audit my policies", "review coverage", "review policies", "check coverage", "find gaps", "coverage gaps", "am i covered", "analyze coverage"] },
  { id: "documents", label: "Download a document", hint: "Find and open your documents", href: "#/keep/documents", icon: "doc",
    keywords: ["document", "documents", "download", "download document", "policy document", "declarations", "dec page", "find document", "paperwork", "files", "id card"] },
  { id: "renewals", label: "See upcoming renewals", hint: "Policies due soon", href: "#/keep/insurance", icon: "bell",
    keywords: ["renewal", "renewals", "due", "expiring", "what's due", "coming due", "renew", "expirations"] },
  { id: "policies", label: "View all policies", hint: "Every policy in one list", href: "#/keep/insurance", icon: "shield",
    keywords: ["policy", "policies", "all policies", "view policies", "my policies", "insurance"] },
  { id: "entities", label: "View my entities", hint: "Your entities and their assets", href: "#/keep/list", icon: "briefcase",
    keywords: ["entities", "my entities", "view entities", "businesses", "trusts", "list"] },
  { id: "relationships", label: "Open the relationships map", hint: "How your entities connect", href: "#/keep/entities", icon: "handshake",
    keywords: ["relationship", "relationships", "map", "connections", "diagram", "flow", "structure"] },
  { id: "account", label: "Account settings", hint: "Profile and renewal reminders", href: "#/keep/account", icon: "user",
    keywords: ["account", "settings", "profile", "reminders", "preferences", "email", "notifications"] },
  { id: "security", label: "Security & privacy", hint: "How we protect your data", href: "#/keep/security", icon: "lock",
    keywords: ["security", "privacy", "password", "protect", "encryption"] },
];

function norm(str) { return (str || "").toLowerCase().trim().replace(/\s+/g, " "); }

// Score one action against the query: exact > prefix > substring > word-overlap.
function scoreAction(action, q) {
  const hay = [action.label, action.hint, ...action.keywords].map(norm);
  let score = 0;
  for (const term of hay) {
    if (term === q) score = Math.max(score, 100);
    else if (term.startsWith(q)) score = Math.max(score, 70);
    else if (term.includes(q)) score = Math.max(score, 45);
  }
  if (!score) {
    const words = q.split(" ").filter(Boolean);
    const text = hay.join(" ");
    const hits = words.filter((w) => w.length > 2 && text.includes(w)).length;
    if (hits) score = 18 + hits * 6;
  }
  return score;
}

// Rank the action catalogue by how well it matches free-text input.
export function matchActions(query, limit = 5) {
  const q = norm(query);
  if (!q) return [];
  return KEEP_ACTIONS
    .map((a) => ({ ...a, score: scoreAction(a, q) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function scoreText(label, q) {
  const l = norm(label);
  if (l === q) return 100;
  if (l.startsWith(q)) return 70;
  if (l.includes(q)) return 45;
  return 0;
}

// Search the user's own records (entities, assets, policies, documents) by name.
// `entities` is the nested tree (getEntities()). Returns ranked result rows.
export function searchRecords(query, entities, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  const push = (type, label, sub, href, icon, score) => { if (score > 0) out.push({ type, label, sub, href, icon, score }); };

  for (const e of entities || []) {
    push("entity", e.name, e.label || "Entity", `#/keep/entity/${e.id}`, "briefcase", scoreText(e.name, q));
    for (const a of e.assets || []) {
      push("asset", a.name, `${e.name} · asset`, `#/keep/asset/${a.id}`, "home", scoreText(a.name, q));
      for (const p of a.policies || []) {
        const pScore = Math.max(scoreText(p.line, q), scoreText(p.carrier, q), scoreText(p.number, q));
        push("policy", p.line, `${a.name}${p.carrier ? ` · ${p.carrier}` : ""}`, `#/keep/policy/${p.id}`, "shield", pScore);
        for (const d of p.documents || [])
          push("document", d, `${p.line} · document`, `#/keep/policy/${p.id}`, "doc", scoreText(d, q));
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
