document.querySelectorAll("[data-share-url]").forEach((button) => {
  button.addEventListener("click", async () => {
    const url = new URL(button.dataset.shareUrl, location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else { await navigator.clipboard.writeText(url); button.textContent = "Copied link"; }
    } catch { /* Sharing can be cancelled by the user. */ }
  });
});
