// dom.js — tiny DOM helpers. All text goes through textContent (never innerHTML)
// so backend/user data can't inject markup (per the global directive).

export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Every screen's root passes through here, so this is where each one is marked
// `legacy-screen`: the house-style move (design.md, step 1 of 3, 2026-10-29)
// holds the old look back under that class in styles/legacy.css. A screen moved
// onto the house components in step 2 stops taking the class.
export function mount(node) {
  node.classList.add("legacy-screen");
  const app = document.getElementById("app");
  clear(app);
  app.appendChild(node);
  window.scrollTo(0, 0);
}
