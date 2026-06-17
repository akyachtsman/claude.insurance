// motion.js — tasteful scroll-reveal + stat count-up, fully gated by
// prefers-reduced-motion (design.md). Pairs with motion.css (.reveal classes).

const prefersReduced = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Reveal .reveal / .reveal-stagger elements as they enter the viewport.
// Under reduced motion (or no IntersectionObserver) everything is shown at once.
export function observeReveals(root = document) {
  const els = root.querySelectorAll(".reveal, .reveal-stagger");
  if (prefersReduced() || !("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach((el) => io.observe(el));
}

// Animate [data-count-to] numbers from 0 once visible. format(n) -> display string.
export function observeCounts(root = document, format = (n) => String(n)) {
  const els = root.querySelectorAll("[data-count-to]");
  if (prefersReduced() || !("IntersectionObserver" in window)) {
    els.forEach((el) => { el.textContent = format(Number(el.dataset.countTo)); });
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        animateCount(entry.target, Number(entry.target.dataset.countTo), format);
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.5 }
  );
  els.forEach((el) => io.observe(el));
}

function animateCount(el, target, format) {
  const duration = 1100;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Convenience: run all enhancers after a view mounts.
export function enhance(root = document, countFormat) {
  observeReveals(root);
  observeCounts(root, countFormat);
}
