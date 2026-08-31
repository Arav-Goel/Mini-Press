(() => {
  const key = "minipress-theme";
  const root = document.documentElement;
  const toggle = document.querySelector("[data-theme-toggle]");
  function apply(theme) {
    root.dataset.theme = theme;
    if (toggle) {
      const next = theme === "light" ? "dark" : theme === "dark" ? "future" : theme === "future" ? "environment" : theme === "environment" ? "ocean" : "light";
      const labels = {
        light: "Switch to dark mode",
        dark: "Switch to futuristic mode",
        future: "Switch to environment mode",
        environment: "Switch to ocean mode",
        ocean: "Switch to light mode"
      };
      const icons = { light: "◐", dark: "✦", future: "☀", environment: "♧", ocean: "≋" };
      toggle.setAttribute("aria-label", labels[theme]);
      toggle.setAttribute("title", labels[theme]);
      toggle.firstElementChild.textContent = icons[theme];
      toggle.dataset.nextTheme = next;
    }
  }
  const saved = localStorage.getItem(key);
  apply(saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  toggle?.addEventListener("click", () => {
    const next = toggle.dataset.nextTheme;
    localStorage.setItem(key, next);
    apply(next);
  });
})();
