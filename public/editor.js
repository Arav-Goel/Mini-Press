// editor.js — vanilla DOM + the built-in global WebSocket. No React,
// no htmx, no bundler. Debounced so we're not flooding the socket on
// every keystroke.

const textarea = document.getElementById("markdown");
const titleInput = document.getElementById("title");
const output = document.getElementById("preview-output");

if (textarea && output) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/admin/preview-ws`);

  let debounceTimer = null;
  function sendPreview() {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(textarea.value);
  }

  socket.addEventListener("open", sendPreview);
  socket.addEventListener("message", (event) => {
    output.innerHTML = event.data;
  });
  socket.addEventListener("close", () => {
    output.insertAdjacentHTML(
      "beforeend",
      "<p class='error'>Live preview disconnected. Reload to reconnect.</p>"
    );
  });

  textarea.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendPreview, 150);
  });
}
