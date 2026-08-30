(() => {
  const key = "minipress-theme";
  const root = document.documentElement;
  const toggle = document.querySelector("[data-theme-toggle]");
  function apply(theme) {
    root.dataset.theme = theme;
    if (toggle) {
      const dark = theme === "dark";
      toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      toggle.setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
      toggle.firstElementChild.textContent = dark ? "☀" : "◐";
    }
  }
  const saved = localStorage.getItem(key);
  apply(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  toggle?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(key, next);
    apply(next);
  });
})();
