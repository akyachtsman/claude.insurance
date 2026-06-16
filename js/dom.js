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

export function mount(node) {
  const app = document.getElementById("app");
  clear(app);
  app.appendChild(node);
  window.scrollTo(0, 0);
}
