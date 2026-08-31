(() => {
  const loader = document.querySelector("[data-site-loader]");
  if (!loader) return;

  const startedAt = performance.now();
  const minimumVisibleMs = 700;
  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    const wait = Math.max(0, minimumVisibleMs - (performance.now() - startedAt));
    window.setTimeout(() => {
      loader.classList.add("is-ready");
      window.setTimeout(() => loader.remove(), 450);
    }, wait);
  }

  window.addEventListener("load", dismiss, { once: true });
  window.setTimeout(dismiss, 3000);
})();
