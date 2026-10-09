// ==============================================================================
// UI Utilities: Haptics, Toast Notifications, Sanitization & PWA
// ==============================================================================

export function triggerHaptic(type = "light") {
  if (typeof window !== "undefined" && "vibrate" in navigator) {
    try {
      if (type === "light") navigator.vibrate(12);
      else if (type === "medium") navigator.vibrate(28);
      else if (type === "heavy") navigator.vibrate(45);
      else if (type === "success") navigator.vibrate([15, 30, 20]);
      else if (type === "error") navigator.vibrate([35, 50, 35]);
    } catch (_) {
      // Ignore vibration restrictions silently
    }
  }
}

export function showToast(msg, type = "success") {
  const box = document.getElementById("toast-box");
  if (!box) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg) reg.update();
        })
        .catch((err) => {
          console.log("PWA Service Worker note:", err);
        });
    });
  }
}
