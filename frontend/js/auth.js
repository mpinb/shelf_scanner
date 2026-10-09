// ==============================================================================
// Authentication (Supabase Auth Client & Session Lifecycle)
// ==============================================================================

import { state } from "./state.js";
import { triggerHaptic, showToast } from "./ui.js";
import { fetchServerConfig, setUnauthorizedHandler } from "./api.js";
import { loadShelves, loadUsageMeter, updateUsageMeterUI } from "./shelves.js";
import { closeBottomSheet } from "./drawer.js";

const authModal = document.getElementById("auth-modal");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const btnAuthSubmit = document.getElementById("btn-auth-submit");
const tabAuthSignin = document.getElementById("tab-auth-signin");
const tabAuthSignup = document.getElementById("tab-auth-signup");
const btnCloseAuth = document.getElementById("btn-close-auth");
const userAvatar = document.getElementById("user-avatar");
const btnUserMenu = document.getElementById("btn-user-menu");
const btnLogout = document.getElementById("btn-logout");
const btnLogin = document.getElementById("btn-login");
const menuItemLogin = document.getElementById("menu-item-login");
const menuItemLogout = document.getElementById("menu-item-logout");
const btnEmptyLogin = document.getElementById("btn-empty-login");
const btnEmptyScan = document.getElementById("btn-empty-scan");
const usageMeter = document.getElementById("usage-meter");

export function openAuthModal() {
  if (authModal) authModal.classList.add("show");
}

export function closeAuthModal() {
  if (authModal) authModal.classList.remove("show");
}

export function setAuthMode(signUp) {
  triggerHaptic("light");
  state.isSignUpMode = signUp;
  if (state.isSignUpMode) {
    if (tabAuthSignup) tabAuthSignup.classList.add("active");
    if (tabAuthSignin) tabAuthSignin.classList.remove("active");
    if (btnAuthSubmit) btnAuthSubmit.textContent = "Create Account";
  } else {
    if (tabAuthSignin) tabAuthSignin.classList.add("active");
    if (tabAuthSignup) tabAuthSignup.classList.remove("active");
    if (btnAuthSubmit) btnAuthSubmit.textContent = "Sign In";
  }
}

export async function handleAuthSubmit() {
  if (!authEmail || !authPassword || !btnAuthSubmit) return;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) return;

  btnAuthSubmit.disabled = true;
  btnAuthSubmit.textContent = "Please wait...";

  try {
    if (state.isSignUpMode) {
      const { error } = await state.sbClient.auth.signUp({ email, password });
      if (error) throw error;
      triggerHaptic("success");
      showToast("Account created! Logging in...", "success");
    } else {
      const { error } = await state.sbClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      triggerHaptic("success");
      showToast("Signed in successfully!", "success");
    }
  } catch (err) {
    triggerHaptic("error");
    showToast(err.message || "Authentication failed", "error");
  } finally {
    btnAuthSubmit.disabled = false;
    btnAuthSubmit.textContent = state.isSignUpMode ? "Create Account" : "Sign In";
  }
}

export function updateAuthUI(isLoggedIn) {
  if (btnLogout) btnLogout.style.display = isLoggedIn ? "inline-flex" : "none";
  if (btnLogin) btnLogin.style.display = isLoggedIn ? "none" : "inline-flex";
  if (usageMeter) usageMeter.style.display = isLoggedIn ? "inline-flex" : "none";
  if (menuItemLogout) menuItemLogout.style.display = isLoggedIn ? "flex" : "none";
  if (menuItemLogin) menuItemLogin.style.display = isLoggedIn ? "none" : "flex";
  if (btnEmptyLogin) btnEmptyLogin.style.display = isLoggedIn ? "none" : "flex";
  if (btnEmptyScan) btnEmptyScan.style.display = isLoggedIn ? "flex" : "none";
}

export function onUserSignedOut() {
  state.currentSession = null;
  state.currentShelves = [];
  state.currentBooks = [];
  state.currentShelfId = null;
  state.selectedBookId = null;
  state.isDemoMode = false;

  updateAuthUI(false);

  // Clear Shelf View completely
  const shelfStats = document.getElementById("shelf-stats");
  const shelfImg = document.getElementById("shelf-image");
  const svgLayer = document.getElementById("svg-layer");
  const spineStrip = document.getElementById("spine-strip");
  const shelfDropdown = document.getElementById("shelf-dropdown");
  const demoBanner = document.getElementById("demo-banner");
  const stage = document.getElementById("stage");
  const shelfBar = document.querySelector(".shelf-bar");
  const btnDeleteShelf = document.getElementById("btn-delete-shelf");
  const zoomControls = document.getElementById("zoom-controls");
  const emptyStateGuide = document.getElementById("empty-state-guide");
  const catalogList = document.getElementById("catalog-list");
  const catalogCount = document.getElementById("catalog-count");

  if (shelfStats) shelfStats.textContent = "0 shelves";
  if (shelfImg) shelfImg.src = "";
  if (svgLayer) svgLayer.innerHTML = "";
  if (spineStrip) spineStrip.innerHTML = "";
  if (shelfDropdown) shelfDropdown.innerHTML = "";
  if (demoBanner) demoBanner.style.display = "none";
  closeBottomSheet();
  if (stage) stage.style.display = "none";
  if (spineStrip) spineStrip.parentElement.style.display = "none";
  if (shelfBar) shelfBar.style.display = "none";
  if (btnDeleteShelf) btnDeleteShelf.style.display = "none";
  if (zoomControls) zoomControls.style.display = "none";

  // Clear Catalog View completely
  if (catalogList) catalogList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">Please sign in to view your catalog</div>';
  if (catalogCount) catalogCount.textContent = "0 books";

  updateUsageMeterUI(0, 50);

  if (emptyStateGuide) emptyStateGuide.style.display = "block";
  document.querySelector('[data-target="view-shelves"]')?.click();
}

export function onUserAuthenticated(user) {
  updateAuthUI(true);
  loadUsageMeter();
  loadShelves();
}

export async function performLogout() {
  triggerHaptic("medium");
  try {
    if (state.sbClient) {
      await state.sbClient.auth.signOut({ scope: "local" });
    }
  } catch (e) {
    console.warn("Sign out notice:", e);
    try {
      if (state.sbClient) await state.sbClient.auth.signOut();
    } catch (_) {}
  }

  // Clear tokens from storage
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth-token"))) {
        localStorage.removeItem(k);
      }
    }
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth-token"))) {
        sessionStorage.removeItem(k);
      }
    }
  } catch (storageErr) {
    console.warn("Storage cleanup notice:", storageErr);
  }

  onUserSignedOut();
  showToast("Logged out successfully", "success");
  openAuthModal();
}

export async function initAuth() {
  setUnauthorizedHandler(() => {
    onUserSignedOut();
    openAuthModal();
  });

  try {
    const config = await fetchServerConfig();

    if (window.supabase && config.supabase_url && config.supabase_anon_key) {
      state.sbClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);

      const { data: { session } } = await state.sbClient.auth.getSession();
      state.currentSession = session;

      if (!session) {
        onUserSignedOut();
        openAuthModal();
      } else {
        onUserAuthenticated(session.user);
      }

      state.sbClient.auth.onAuthStateChange((_event, session) => {
        state.currentSession = session;
        if (session) {
          closeAuthModal();
          onUserAuthenticated(session.user);
        } else {
          onUserSignedOut();
          openAuthModal();
        }
      });
    }
  } catch (err) {
    console.error("Auth init error:", err);
    showToast("Failed to connect to authentication service", "error");
  }

  setupAuthEventListeners();
}

function setupAuthEventListeners() {
  if (tabAuthSignin) tabAuthSignin.addEventListener("click", () => setAuthMode(false));
  if (tabAuthSignup) tabAuthSignup.addEventListener("click", () => setAuthMode(true));
  if (btnCloseAuth) {
    btnCloseAuth.addEventListener("click", () => {
      triggerHaptic("light");
      closeAuthModal();
    });
  }

  if (authForm) {
    authForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleAuthSubmit();
    });
  }

  const handleLogoutAction = async () => {
    triggerHaptic("light");
    if (state.currentSession) {
      const confirmLogout = confirm(`Signed in as ${state.currentSession.user.email}.\nDo you want to log out?`);
      if (confirmLogout) performLogout();
    } else {
      performLogout();
    }
  };

  if (btnLogout) btnLogout.addEventListener("click", handleLogoutAction);
  if (btnUserMenu) btnUserMenu.addEventListener("click", handleLogoutAction);
  if (menuItemLogout) menuItemLogout.addEventListener("click", handleLogoutAction);

  if (btnLogin) {
    btnLogin.addEventListener("click", () => {
      triggerHaptic("light");
      openAuthModal();
    });
  }
  if (menuItemLogin) {
    menuItemLogin.addEventListener("click", () => {
      openAuthModal();
    });
  }
  if (btnEmptyLogin) {
    btnEmptyLogin.addEventListener("click", () => {
      triggerHaptic("light");
      openAuthModal();
    });
  }
}
