// ==============================================================================
// ShelfScanner Mobile Web Application Logic
// ==============================================================================

let sbClient = null;
let currentSession = null;
let currentShelves = [];
let currentBooks = [];
let selectedBookId = null;
let currentShelfId = null;
let activePollInterval = null;
let isSignUpMode = false;
let isDemoMode = false;
let demoBooksData = null;

// Zoom & Pan State
let currentZoom = 1.0;
let panX = 0;
let panY = 0;

// DOM Elements
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

// Top-Left Brand Menu Elements
const btnBrandMenu = document.getElementById("btn-brand-menu");
const brandMenuDropdown = document.getElementById("brand-menu-dropdown");
const menuItemDemo = document.getElementById("menu-item-demo");
const brandMenuDemoText = document.getElementById("brand-menu-demo-text");
const menuItemLogin = document.getElementById("menu-item-login");
const menuItemLogout = document.getElementById("menu-item-logout");

// Usage Quota Meter
const usageMeter = document.getElementById("usage-meter");
const usageMeterText = document.getElementById("usage-meter-text");

// Shelves View Elements
const shelfDropdown = document.getElementById("shelf-dropdown");
const btnDeleteShelf = document.getElementById("btn-delete-shelf");
const shelfStats = document.getElementById("shelf-stats");
const shelfImg = document.getElementById("shelf-image");
const svgLayer = document.getElementById("svg-layer");
const spineStrip = document.getElementById("spine-strip");
const emptyStateGuide = document.getElementById("empty-state-guide");
const demoBanner = document.getElementById("demo-banner");
const btnEmptyLogin = document.getElementById("btn-empty-login");
const btnEmptyScan = document.getElementById("btn-empty-scan");
const btnEmptyDemo = document.getElementById("btn-empty-demo");
const btnDemoScan = document.getElementById("btn-demo-scan");
const btnExitDemo = document.getElementById("btn-exit-demo");

// Canvas Viewport & Zoom Elements
const viewport = document.getElementById("canvas-viewport");
const stage = document.getElementById("stage");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnZoomReset = document.getElementById("btn-zoom-reset");

// Bottom Sheet Book Detail Elements
const bottomSheet = document.getElementById("bottom-sheet");
const sheetBackdrop = document.getElementById("sheet-backdrop");
const btnCloseSheet = document.getElementById("btn-close-sheet");
const btnPrevBook = document.getElementById("btn-prev-book");
const btnNextBook = document.getElementById("btn-next-book");
const sheetBookNumber = document.getElementById("sheet-book-number");

// Camera & Scan Modal
const cameraInput = document.getElementById("camera-input");
const scanModal = document.getElementById("scan-modal");
const scanStatusBadge = document.getElementById("scan-status-badge");
const scanLogs = document.getElementById("scan-logs");
const btnCloseModal = document.getElementById("btn-close-modal");

// Catalog & Export
const catalogList = document.getElementById("catalog-list");
const catalogSearch = document.getElementById("catalog-search");
const catalogCount = document.getElementById("catalog-count");
const btnExportXlsx = document.getElementById("btn-export-xlsx");

// Form inputs
const fieldTitle = document.getElementById("field-title");
const fieldAuthors = document.getElementById("field-authors");
const fieldPublisher = document.getElementById("field-publisher");
const fieldYear = document.getElementById("field-year");
const fieldIsbn = document.getElementById("field-isbn");
const fieldSubjects = document.getElementById("field-subjects");
const fieldRawText = document.getElementById("field-raw-text");
const fieldIsIgnored = document.getElementById("field-is-ignored");
const olTitlePreview = document.getElementById("ol-title-preview");
const olAuthorsPreview = document.getElementById("ol-authors-preview");
const isbnChips = document.getElementById("isbn-chips");

// --- Tactile / Haptic Feedback (Item 1) ---
function triggerHaptic(type = "light") {
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

// --- PWA Service Worker Registration (Item 1) ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(err => {
      console.log("PWA Service Worker note:", err);
    });
  });
}

// --- Initialization ---
async function init() {
  try {
    const configRes = await fetch("/api/config");
    const config = await configRes.json();

    if (window.supabase && config.supabase_url && config.supabase_anon_key) {
      sbClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
      
      const { data: { session } } = await sbClient.auth.getSession();
      currentSession = session;

      if (!session) {
        onUserSignedOut();
        openAuthModal();
      } else {
        onUserAuthenticated(session.user);
      }

      sbClient.auth.onAuthStateChange((_event, session) => {
        currentSession = session;
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
    console.error("Initialization error:", err);
    showToast("Failed to connect to server", "error");
  }

  setupGestureControls();
  setupSwipeTransitions();
}

// --- Auth Handling ---
function openAuthModal() {
  authModal.classList.add("show");
}

function closeAuthModal() {
  authModal.classList.remove("show");
}

function setAuthMode(signUp) {
  triggerHaptic("light");
  isSignUpMode = signUp;
  if (isSignUpMode) {
    tabAuthSignup.classList.add("active");
    tabAuthSignin.classList.remove("active");
    btnAuthSubmit.textContent = "Create Account";
  } else {
    tabAuthSignin.classList.add("active");
    tabAuthSignup.classList.remove("active");
    btnAuthSubmit.textContent = "Sign In";
  }
}

if (tabAuthSignin) tabAuthSignin.addEventListener("click", () => setAuthMode(false));
if (tabAuthSignup) tabAuthSignup.addEventListener("click", () => setAuthMode(true));
if (btnCloseAuth) btnCloseAuth.addEventListener("click", () => {
  triggerHaptic("light");
  closeAuthModal();
});

async function handleAuthSubmit() {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) return;

  btnAuthSubmit.disabled = true;
  btnAuthSubmit.textContent = "Please wait...";

  try {
    if (isSignUpMode) {
      const { error } = await sbClient.auth.signUp({ email, password });
      if (error) throw error;
      triggerHaptic("success");
      showToast("Account created! Logging in...", "success");
    } else {
      const { error } = await sbClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      triggerHaptic("success");
      showToast("Signed in successfully!", "success");
    }
  } catch (err) {
    triggerHaptic("error");
    showToast(err.message || "Authentication failed", "error");
  } finally {
    btnAuthSubmit.disabled = false;
    btnAuthSubmit.textContent = isSignUpMode ? "Create Account" : "Sign In";
  }
}

// --- Auth UI & State Cleanup ---
function updateAuthUI(isLoggedIn) {
  if (isLoggedIn) {
    if (btnLogout) btnLogout.style.display = "inline-flex";
    if (btnLogin) btnLogin.style.display = "none";
    if (usageMeter) usageMeter.style.display = "inline-flex";
    if (menuItemLogout) menuItemLogout.style.display = "flex";
    if (menuItemLogin) menuItemLogin.style.display = "none";
    if (btnEmptyLogin) btnEmptyLogin.style.display = "none";
    if (btnEmptyScan) btnEmptyScan.style.display = "flex";
  } else {
    if (btnLogout) btnLogout.style.display = "none";
    if (btnLogin) btnLogin.style.display = "inline-flex";
    if (usageMeter) usageMeter.style.display = "none";
    if (menuItemLogout) menuItemLogout.style.display = "none";
    if (menuItemLogin) menuItemLogin.style.display = "flex";
    if (btnEmptyLogin) btnEmptyLogin.style.display = "flex";
    if (btnEmptyScan) btnEmptyScan.style.display = "none";
  }
}

function onUserSignedOut() {
  currentSession = null;
  currentShelves = [];
  currentBooks = [];
  currentShelfId = null;
  selectedBookId = null;
  isDemoMode = false;

  updateAuthUI(false);

  // Clear Shelf View completely
  shelfStats.textContent = "0 shelves";
  shelfImg.src = "";
  svgLayer.innerHTML = "";
  spineStrip.innerHTML = "";
  shelfDropdown.innerHTML = "";
  if (demoBanner) demoBanner.style.display = "none";
  if (bottomSheet) closeBottomSheet();
  if (stage) stage.style.display = "none";
  if (spineStrip) spineStrip.parentElement.style.display = "none";
  const shelfBar = document.querySelector(".shelf-bar");
  if (shelfBar) shelfBar.style.display = "none";
  if (btnDeleteShelf) btnDeleteShelf.style.display = "none";
  const zoomControls = document.getElementById("zoom-controls");
  if (zoomControls) zoomControls.style.display = "none";

  // Clear Catalog View completely
  catalogList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">Please sign in to view your catalog</div>';
  catalogCount.textContent = "0 books";

  // Reset Quota Meter
  updateUsageMeterUI(0, 50);

  // Show Empty State Photography Guide
  if (emptyStateGuide) emptyStateGuide.style.display = "block";

  // Switch to shelves view if in catalog
  document.querySelector('[data-target="view-shelves"]')?.click();
}

async function performLogout() {
  triggerHaptic("medium");
  try {
    if (sbClient) {
      await sbClient.auth.signOut({ scope: "local" });
    }
  } catch (e) {
    console.warn("Sign out notice:", e);
    try {
      if (sbClient) await sbClient.auth.signOut();
    } catch (_) {}
  }

  // Explicitly remove all Supabase auth tokens from localStorage and sessionStorage
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

// Top-Left Brand Menu Actions
if (btnBrandMenu) {
  btnBrandMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    triggerHaptic("light");
    const isOpen = brandMenuDropdown.style.display === "flex";
    brandMenuDropdown.style.display = isOpen ? "none" : "flex";
    btnBrandMenu.classList.toggle("open", !isOpen);
    if (!isOpen && brandMenuDemoText) {
      brandMenuDemoText.textContent = isDemoMode ? "Exit Demo Shelf" : "Try Demo Shelf";
    }
  });
}

// Dismiss brand menu on outside click
document.addEventListener("click", (e) => {
  if (brandMenuDropdown && !e.target.closest(".brand-container")) {
    brandMenuDropdown.style.display = "none";
    btnBrandMenu?.classList.remove("open");
  }
});

if (menuItemDemo) {
  menuItemDemo.addEventListener("click", () => {
    brandMenuDropdown.style.display = "none";
    btnBrandMenu?.classList.remove("open");
    if (isDemoMode) {
      exitDemoMode();
    } else {
      activateDemoShelf();
    }
  });
}

if (menuItemLogin) {
  menuItemLogin.addEventListener("click", () => {
    brandMenuDropdown.style.display = "none";
    btnBrandMenu?.classList.remove("open");
    openAuthModal();
  });
}

if (menuItemLogout) {
  menuItemLogout.addEventListener("click", () => {
    brandMenuDropdown.style.display = "none";
    btnBrandMenu?.classList.remove("open");
    if (currentSession) {
      const confirmLogout = confirm(`Signed in as ${currentSession.user.email}.\nDo you want to log out?`);
      if (confirmLogout) performLogout();
    } else {
      performLogout();
    }
  });
}

const handleTopLogout = async () => {
  triggerHaptic("light");
  if (currentSession) {
    const confirmLogout = confirm(`Signed in as ${currentSession.user.email}.\nDo you want to log out?`);
    if (confirmLogout) {
      performLogout();
    }
  } else {
    performLogout();
  }
};

if (btnLogout) btnLogout.addEventListener("click", handleTopLogout);
if (btnUserMenu) btnUserMenu.addEventListener("click", handleTopLogout);

if (btnLogin) {
  btnLogin.addEventListener("click", () => {
    triggerHaptic("light");
    openAuthModal();
  });
}

function onUserAuthenticated(user) {
  updateAuthUI(true);
  loadUsageMeter();
  loadShelves();
}

// --- Daily Usage Quota Meter (Item 4) ---
async function loadUsageMeter() {
  if (!currentSession) {
    updateUsageMeterUI(0, 50);
    return;
  }
  try {
    const res = await apiFetch("/api/usage");
    if (res.ok) {
      const data = await res.json();
      updateUsageMeterUI(data.used || 0, data.limit || 50);
    }
  } catch (err) {
    console.warn("Usage meter fetch note:", err);
  }
}

function updateUsageMeterUI(used, limit) {
  if (usageMeterText) {
    usageMeterText.textContent = `${used} / ${limit}`;
  }
  const dot = usageMeter?.querySelector(".usage-dot");
  if (dot) {
    dot.classList.remove("warning", "danger");
    if (used >= limit) {
      dot.classList.add("danger");
    } else if (used >= 40) {
      dot.classList.add("warning");
    }
  }
}

// --- API Helpers (Authenticated) ---
async function apiFetch(endpoint, options = {}) {
  const token = currentSession ? currentSession.access_token : "";
  options.headers = {
    ...options.headers,
    "Authorization": `Bearer ${token}`
  };
  const res = await fetch(endpoint, options);
  if (res.status === 401) {
    onUserSignedOut();
    openAuthModal();
    throw new Error("Session expired, please sign in.");
  }
  return res;
}

// --- Shelves Management & Empty State (Item 4) ---
async function loadShelves() {
  if (isDemoMode) return;
  if (!currentSession) {
    shelfStats.textContent = "0 shelves";
    shelfImg.src = "";
    svgLayer.innerHTML = "";
    spineStrip.innerHTML = "";
    if (emptyStateGuide) emptyStateGuide.style.display = "block";
    if (stage) stage.style.display = "none";
    if (spineStrip) spineStrip.parentElement.style.display = "none";
    const shelfBar = document.querySelector(".shelf-bar");
    if (shelfBar) shelfBar.style.display = "none";
    if (btnDeleteShelf) btnDeleteShelf.style.display = "none";
    const zoomControls = document.getElementById("zoom-controls");
    if (zoomControls) zoomControls.style.display = "none";
    return;
  }
  try {
    const res = await apiFetch("/api/shelves");
    currentShelves = await res.json();
    shelfDropdown.innerHTML = "";

    if (currentShelves.length === 0) {
      shelfStats.textContent = "0 shelves";
      shelfImg.src = "";
      svgLayer.innerHTML = "";
      spineStrip.innerHTML = "";
      
      // Show Empty State & Photography Guide
      if (emptyStateGuide) emptyStateGuide.style.display = "block";
      if (stage) stage.style.display = "none";
      if (spineStrip) spineStrip.parentElement.style.display = "none";
      const shelfBar = document.querySelector(".shelf-bar");
      if (shelfBar) shelfBar.style.display = "none";
      if (btnDeleteShelf) btnDeleteShelf.style.display = "none";
      const zoomControls = document.getElementById("zoom-controls");
      if (zoomControls) zoomControls.style.display = "none";
      return;
    }

    // Shelves exist: hide empty state card
    if (emptyStateGuide) emptyStateGuide.style.display = "none";
    if (stage) stage.style.display = "inline-block";
    if (spineStrip) spineStrip.parentElement.style.display = "block";
    const shelfBar = document.querySelector(".shelf-bar");
    if (shelfBar) shelfBar.style.display = "flex";
    if (btnDeleteShelf) btnDeleteShelf.style.display = "inline-flex";
    const zoomControls = document.getElementById("zoom-controls");
    if (zoomControls) zoomControls.style.display = "flex";
    if (shelfDropdown) {
      shelfDropdown.style.display = "block";
      shelfDropdown.disabled = false;
    }

    currentShelves.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.total_books || 0} books)`;
      shelfDropdown.appendChild(opt);
    });

    if (!currentShelfId || !currentShelves.some(s => s.id === currentShelfId)) {
      currentShelfId = currentShelves[0].id;
    }
    shelfDropdown.value = currentShelfId;
    loadShelfData(currentShelfId);

  } catch (err) {
    console.error("Error loading shelves:", err);
  }
}

if (shelfDropdown) {
  shelfDropdown.addEventListener("change", (e) => {
    triggerHaptic("light");
    currentShelfId = e.target.value;
    loadShelfData(currentShelfId);
  });
}

async function loadShelfData(shelfId) {
  try {
    const res = await apiFetch(`/api/shelves/${shelfId}`);
    const data = await res.json();
    const shelf = data.shelf;
    currentBooks = data.books || [];

    shelfStats.textContent = `${currentBooks.length} books`;
    shelfImg.src = shelf.web_image_url || shelf.image_url;
    resetZoom();
    renderShelfPolygons(currentBooks);

  } catch (err) {
    console.error("Error loading shelf details:", err);
  }
}

function updateSvgViewBox() {
  if (!shelfImg || !svgLayer) return;
  const nw = shelfImg.naturalWidth;
  const nh = shelfImg.naturalHeight;
  if (!nw || !nh) return;

  let maxX = 0;
  let maxY = 0;
  for (const b of (currentBooks || [])) {
    for (const pt of (b.polygon_coords || [])) {
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] > maxY) maxY = pt[1];
    }
  }

  let vbW = nw;
  let vbH = nh;
  if (maxX > nw || maxY > nh) {
    const scale = Math.max(maxX / nw, maxY / nh);
    const multiplier = Math.ceil(scale * 10) / 10;
    vbW = Math.round(nw * multiplier);
    vbH = Math.round(nh * multiplier);
  }

  svgLayer.setAttribute("viewBox", `0 0 ${vbW} ${vbH}`);
  svgLayer.setAttribute("preserveAspectRatio", "none");
}

if (shelfImg) {
  shelfImg.addEventListener("load", () => {
    updateSvgViewBox();
  });
}
window.addEventListener("resize", () => {
  updateSvgViewBox();
});

function renderShelfPolygons(books) {
  svgLayer.innerHTML = "";
  spineStrip.innerHTML = "";
  updateSvgViewBox();

  books.forEach((book) => {
    const isIgnored = !!book.is_ignored;
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const pts = (book.polygon_coords || []).map(p => p.join(",")).join(" ");
    poly.setAttribute("points", pts);
    poly.classList.add("book-poly");
    poly.dataset.id = book.id;
    if (isIgnored) poly.classList.add("ignored");

    poly.addEventListener("click", () => {
      triggerHaptic("light");
      selectBook(book.id);
    });
    svgLayer.appendChild(poly);

    const pill = document.createElement("button");
    pill.className = "strip-pill";
    pill.dataset.id = book.id;
    pill.textContent = `#${book.book_index}`;
    if (isIgnored) pill.style.opacity = "0.5";
    pill.addEventListener("click", () => {
      triggerHaptic("light");
      selectBook(book.id);
    });
    spineStrip.appendChild(pill);
  });
}

// --- Interactive Demo Shelf Mode (Item 4) ---
async function activateDemoShelf() {
  triggerHaptic("medium");
  isDemoMode = true;

  if (brandMenuDemoText) brandMenuDemoText.textContent = "Exit Demo Shelf";
  if (emptyStateGuide) emptyStateGuide.style.display = "none";
  if (demoBanner) demoBanner.style.display = "flex";
  if (stage) stage.style.display = "inline-block";
  if (spineStrip) spineStrip.parentElement.style.display = "block";
  const shelfBar = document.querySelector(".shelf-bar");
  if (shelfBar) shelfBar.style.display = "flex";
  if (btnDeleteShelf) btnDeleteShelf.style.display = "none";
  const zoomControls = document.getElementById("zoom-controls");
  if (zoomControls) zoomControls.style.display = "flex";
  if (shelfDropdown) {
    shelfDropdown.style.display = "block";
    shelfDropdown.innerHTML = '<option value="demo">Sample Botanical Shelf (39 books)</option>';
    shelfDropdown.disabled = true;
  }

  try {
    if (!demoBooksData) {
      const res = await fetch("/static/demo_data.json");
      demoBooksData = await res.json();
    }
    currentBooks = demoBooksData;
    shelfStats.textContent = `${currentBooks.length} books`;
    shelfImg.src = "/static/demo_shelf.jpg";
    resetZoom();
    renderShelfPolygons(currentBooks);
    showToast("Demo Shelf Active — Tap any spine to explore!", "success");
    
    // Auto-select book #1
    if (currentBooks.length > 0) {
      setTimeout(() => selectBook(currentBooks[0].id), 250);
    }
  } catch (err) {
    console.error("Error loading demo shelf data:", err);
    showToast("Failed to load demo shelf", "error");
  }
}

function exitDemoMode() {
  triggerHaptic("light");
  isDemoMode = false;
  if (brandMenuDemoText) brandMenuDemoText.textContent = "Try Demo Shelf";
  if (demoBanner) demoBanner.style.display = "none";
  if (shelfDropdown) shelfDropdown.disabled = false;
  closeBottomSheet();
  loadShelves();
}

// Empty state & Demo buttons listeners
if (btnEmptyLogin) btnEmptyLogin.addEventListener("click", () => {
  triggerHaptic("light");
  openAuthModal();
});
if (btnEmptyScan) btnEmptyScan.addEventListener("click", () => {
  triggerHaptic("medium");
  cameraInput.click();
});
if (btnEmptyDemo) btnEmptyDemo.addEventListener("click", activateDemoShelf);
if (btnDemoScan) btnDemoScan.addEventListener("click", () => {
  triggerHaptic("medium");
  cameraInput.click();
});
if (btnExitDemo) btnExitDemo.addEventListener("click", exitDemoMode);

// --- Shelf Deletion Handler ---
async function handleDeleteShelf() {
  if (isDemoMode || !currentShelfId) return;
  triggerHaptic("medium");

  const currentShelf = currentShelves.find(s => s.id === currentShelfId);
  const shelfTitle = currentShelf?.name || "this shelf";
  const ok = confirm(`Delete "${shelfTitle}" and all of its book records?\n\nThis cannot be undone. Your daily scan quota limit count will not be affected.`);
  if (!ok) return;

  try {
    const res = await apiFetch(`/api/shelves/${currentShelfId}`, {
      method: "DELETE"
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to delete shelf");
    }

    triggerHaptic("success");
    showToast("Shelf deleted successfully", "success");

    currentShelfId = null;
    await loadShelves();
    await loadUsageMeter();
  } catch (err) {
    triggerHaptic("error");
    showToast(err.message || "Failed to delete shelf", "error");
  }
}

if (btnDeleteShelf) {
  btnDeleteShelf.addEventListener("click", handleDeleteShelf);
}

// --- Book Selection & Bottom Sheet ---
function selectBook(bookId) {
  selectedBookId = bookId;
  const bookIndex = currentBooks.findIndex(b => b.id === bookId);
  if (bookIndex === -1) return;
  const book = currentBooks[bookIndex];

  document.querySelectorAll(".book-poly").forEach(el => {
    el.classList.toggle("selected", el.dataset.id === bookId);
  });
  document.querySelectorAll(".strip-pill").forEach(el => {
    const active = el.dataset.id === bookId;
    el.classList.toggle("active", active);
    if (active) el.scrollIntoView({ behavior: "smooth", inline: "center" });
  });

  // Populate drawer
  sheetBookNumber.textContent = `Book #${book.book_index} of ${currentBooks.length}`;
  btnPrevBook.disabled = (bookIndex <= 0);
  btnNextBook.disabled = (bookIndex >= currentBooks.length - 1);

  fieldTitle.value = book.title || "";
  fieldAuthors.value = book.authors || "";
  fieldPublisher.value = book.publication || "";
  fieldYear.value = book.pub_year || "";
  fieldIsbn.value = book.isbn_primary || "";
  fieldSubjects.value = book.subjects || "";
  fieldRawText.value = book.raw_text || "";
  fieldIsIgnored.checked = !!book.is_ignored;

  if (book.ol_title) {
    olTitlePreview.style.display = "block";
    olTitlePreview.textContent = `Verified: ${book.ol_title}`;
  } else {
    olTitlePreview.style.display = "none";
  }

  if (book.ol_authors) {
    olAuthorsPreview.style.display = "block";
    olAuthorsPreview.textContent = `OpenLibrary Authors: ${book.ol_authors}`;
  } else {
    olAuthorsPreview.style.display = "none";
  }

  // Render ISBN candidate chips
  const isbns = Array.isArray(book.isbns) ? book.isbns : [];
  isbnChips.innerHTML = "";
  if (isbns.length > 0) {
    isbns.forEach(isbn => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${isbn} +`;
      chip.onclick = () => {
        triggerHaptic("light");
        fieldIsbn.value = isbn;
        showToast(`Selected ISBN ${isbn}`, "success");
      };
      isbnChips.appendChild(chip);
    });
  } else {
    isbnChips.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted);">None detected</span>';
  }

  openBottomSheet();
  zoomToSpine(book);
}

function zoomToSpine(book) {
  if (!book || !book.polygon_coords || book.polygon_coords.length === 0) return;
  if (!stage || !viewport) return;

  const xs = book.polygon_coords.map(p => p[0]);
  const ys = book.polygon_coords.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spineCenterX = (minX + maxX) / 2;
  const spineCenterY = (minY + maxY) / 2;

  const viewBox = svgLayer?.viewBox?.baseVal;
  const imgW = (viewBox && viewBox.width > 0) ? viewBox.width : (shelfImg.naturalWidth || 4000);
  const imgH = (viewBox && viewBox.height > 0) ? viewBox.height : (shelfImg.naturalHeight || 3000);

  const stageW = stage.offsetWidth;
  const stageH = stage.offsetHeight;
  if (!stageW || !stageH) return;

  const normX = spineCenterX / imgW;
  const normY = spineCenterY / imgH;

  // Zoom to 2.4x so the spine is prominent in the top 50vh of the screen
  currentZoom = 2.4;
  panX = (0.5 - normX) * stageW * currentZoom;
  panY = (0.5 - normY) * stageH * currentZoom;

  updateZoomTransform();
}

function openBottomSheet() {
  bottomSheet.classList.add("open");
  sheetBackdrop.classList.add("show");
}

function closeBottomSheet() {
  bottomSheet.classList.remove("open");
  sheetBackdrop.classList.remove("show");
  resetZoom();
}

if (btnCloseSheet) btnCloseSheet.addEventListener("click", () => {
  triggerHaptic("light");
  closeBottomSheet();
});
if (sheetBackdrop) sheetBackdrop.addEventListener("click", () => {
  triggerHaptic("light");
  closeBottomSheet();
});

if (btnPrevBook) {
  btnPrevBook.addEventListener("click", () => {
    triggerHaptic("light");
    const curIdx = currentBooks.findIndex(b => b.id === selectedBookId);
    if (curIdx > 0) selectBook(currentBooks[curIdx - 1].id);
  });
}

if (btnNextBook) {
  btnNextBook.addEventListener("click", () => {
    triggerHaptic("light");
    const curIdx = currentBooks.findIndex(b => b.id === selectedBookId);
    if (curIdx < currentBooks.length - 1) selectBook(currentBooks[curIdx + 1].id);
  });
}

async function saveBookDetails() {
  if (!selectedBookId) return;

  const payload = {
    title: fieldTitle.value.trim(),
    authors: fieldAuthors.value.trim(),
    publication: fieldPublisher.value.trim(),
    pub_year: parseInt(fieldYear.value) || null,
    isbn_primary: fieldIsbn.value.trim(),
    subjects: fieldSubjects.value.trim(),
    raw_text: fieldRawText.value.trim(),
    is_ignored: fieldIsIgnored.checked
  };

  // Demo shelf in-memory update
  if (isDemoMode || String(selectedBookId).startsWith("demo-")) {
    const idx = currentBooks.findIndex(b => b.id === selectedBookId);
    if (idx !== -1) Object.assign(currentBooks[idx], payload);
    const poly = document.querySelector(`.book-poly[data-id="${selectedBookId}"]`);
    if (poly) poly.classList.toggle("ignored", payload.is_ignored);
    triggerHaptic("success");
    showToast("Demo book updated in memory!", "success");
    return;
  }

  try {
    const res = await apiFetch(`/api/books/${selectedBookId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      triggerHaptic("success");
      showToast("Book saved successfully!", "success");
      const idx = currentBooks.findIndex(b => b.id === selectedBookId);
      if (idx !== -1) Object.assign(currentBooks[idx], payload);
      
      const poly = document.querySelector(`.book-poly[data-id="${selectedBookId}"]`);
      if (poly) poly.classList.toggle("ignored", payload.is_ignored);
    }
  } catch (err) {
    triggerHaptic("error");
    showToast("Error saving book", "error");
  }
}

// --- Gesture Zoom & Pan Controls (Item 1) ---
function updateZoomTransform() {
  if (stage) {
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
  }
  if (btnZoomReset) {
    btnZoomReset.textContent = `${Math.round(currentZoom * 100)}%`;
  }
}

function resetZoom() {
  currentZoom = 1.0;
  panX = 0;
  panY = 0;
  updateZoomTransform();
}

function setupGestureControls() {
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      triggerHaptic("light");
      currentZoom = Math.min(3.5, currentZoom + 0.3);
      updateZoomTransform();
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      triggerHaptic("light");
      currentZoom = Math.max(1.0, currentZoom - 0.3);
      if (currentZoom === 1.0) { panX = 0; panY = 0; }
      updateZoomTransform();
    });
  }
  if (btnZoomReset) {
    btnZoomReset.addEventListener("click", () => {
      triggerHaptic("light");
      resetZoom();
    });
  }

  if (!viewport) return;

  let initialDist = 0;
  let initialZoom = 1.0;
  let isPanning = false;
  let startTouchX = 0;
  let startTouchY = 0;
  let lastTapTime = 0;

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      initialDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialZoom = currentZoom;
    } else if (e.touches.length === 1) {
      // Double tap check to toggle 1x <-> 2.2x zoom
      const now = Date.now();
      if (now - lastTapTime < 280) {
        triggerHaptic("light");
        if (currentZoom > 1.2) {
          resetZoom();
        } else {
          currentZoom = 2.2;
          updateZoomTransform();
        }
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      if (currentZoom > 1.0) {
        isPanning = true;
        startTouchX = e.touches[0].clientX - panX;
        startTouchY = e.touches[0].clientY - panY;
      }
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && initialDist > 0) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / initialDist;
      currentZoom = Math.min(3.5, Math.max(1.0, initialZoom * ratio));
      updateZoomTransform();
    } else if (e.touches.length === 1 && isPanning && currentZoom > 1.0) {
      panX = e.touches[0].clientX - startTouchX;
      panY = e.touches[0].clientY - startTouchY;
      updateZoomTransform();
    }
  }, { passive: true });

  viewport.addEventListener("touchend", () => {
    isPanning = false;
    initialDist = 0;
    if (currentZoom <= 1.0) {
      panX = 0;
      panY = 0;
      updateZoomTransform();
    }
  }, { passive: true });
}

// --- Touch Swipe Transitions & Bottom Sheet Dismiss (Item 1) ---
function setupSwipeTransitions() {
  const appMain = document.getElementById("app-main");
  let touchStartX = 0;
  let touchStartY = 0;

  if (appMain) {
    appMain.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    appMain.addEventListener("touchend", (e) => {
      if (e.changedTouches.length === 1 && currentZoom <= 1.05) {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        // Horizontal swipe detected
        if (Math.abs(deltaX) > 70 && Math.abs(deltaY) < 45) {
          const isShelvesActive = document.getElementById("view-shelves")?.classList.contains("active");
          if (deltaX < 0 && isShelvesActive) {
            // Swipe left: open catalog
            triggerHaptic("light");
            document.querySelector('[data-target="view-catalog"]')?.click();
          } else if (deltaX > 0 && !isShelvesActive) {
            // Swipe right: open shelves
            triggerHaptic("light");
            document.querySelector('[data-target="view-shelves"]')?.click();
          }
        }
      }
    }, { passive: true });
  }

  // Swipe down to dismiss bottom sheet
  if (bottomSheet) {
    let sheetStartY = 0;
    bottomSheet.addEventListener("touchstart", (e) => {
      sheetStartY = e.touches[0].clientY;
    }, { passive: true });

    bottomSheet.addEventListener("touchend", (e) => {
      const deltaY = e.changedTouches[0].clientY - sheetStartY;
      if (deltaY > 60) {
        triggerHaptic("light");
        closeBottomSheet();
      }
    }, { passive: true });
  }
}

// --- Camera & Scan Pipeline ---
if (cameraInput) {
  cameraInput.addEventListener("change", async (e) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    triggerHaptic("medium");
    const shelfName = prompt("Enter a name for this bookshelf:", `Shelf ${currentShelves.length + 1}`) || `Shelf ${currentShelves.length + 1}`;
    
    const formData = new FormData();
    formData.append("image", file);
    formData.append("shelf_name", shelfName);
    formData.append("room", "Living Room");

    openScanModal();

    try {
      const res = await apiFetch("/api/jobs", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");

      startJobPolling(data.job_id);

    } catch (err) {
      triggerHaptic("error");
      showToast(err.message, "error");
      closeScanModal();
    }
  });
}

function openScanModal() {
  scanModal.classList.add("show");
  scanStatusBadge.className = "badge";
  scanStatusBadge.textContent = "QUEUED";
  scanLogs.textContent = "[Ready] Enqueuing image to task queue...";
  scanLogs.style.display = "block";
  const completeCard = document.getElementById("scan-complete-card");
  if (completeCard) completeCard.style.display = "none";
  btnCloseModal.style.display = "none";
  resetStepper();
}

function closeScanModal() {
  scanModal.classList.remove("show");
  if (activePollInterval) clearInterval(activePollInterval);
}

if (btnCloseModal) {
  btnCloseModal.addEventListener("click", () => {
    triggerHaptic("light");
    closeScanModal();
    loadUsageMeter();
    loadShelves();
  });
}

function resetStepper() {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`step-${i}`);
    if (el) el.className = "step-item";
  }
}

function startJobPolling(jobId) {
  if (activePollInterval) clearInterval(activePollInterval);
  activePollInterval = setInterval(async () => {
    try {
      const res = await apiFetch(`/api/jobs/${jobId}`);
      const job = await res.json();

      scanStatusBadge.textContent = (job.status || "QUEUED").toUpperCase();

      const curStep = job.current_step || 1;
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`step-${i}`);
        if (!el) continue;
        if (i < curStep) el.className = "step-item completed";
        else if (i === curStep) el.className = "step-item active";
        else el.className = "step-item";
      }

      if (job.logs && job.logs.length > 0) {
        scanLogs.textContent = job.logs.join("\n");
        scanLogs.scrollTop = scanLogs.scrollHeight;
      }

      if (job.status === "completed" || job.status === "failed") {
        clearInterval(activePollInterval);
        btnCloseModal.style.display = "block";
        if (job.status === "completed") {
          triggerHaptic("success");
          scanLogs.style.display = "none"; // Hide raw logs upon completion
          const completeCard = document.getElementById("scan-complete-card");
          if (completeCard) completeCard.style.display = "block";
          btnCloseModal.innerHTML = "<span>View My Bookshelf ➔</span>";
          showToast("Shelf scanned & enriched successfully!", "success");
          loadUsageMeter();
        } else {
          triggerHaptic("error");
          scanLogs.style.display = "block";
          showToast(`Pipeline failed: ${job.error_message}`, "error");
        }
      }

    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 1200);
}

// --- Navigation Tabs ---
document.querySelectorAll(".bottom-nav .nav-item").forEach(item => {
  item.addEventListener("click", () => {
    triggerHaptic("light");
    document.querySelectorAll(".bottom-nav .nav-item").forEach(n => n.classList.remove("active"));
    document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
    item.classList.add("active");
    const targetId = item.dataset.target;
    const viewEl = document.getElementById(targetId);
    if (viewEl) viewEl.classList.add("active");

    if (targetId === "view-catalog") loadCatalog();
  });
});

// --- Catalog View ---
async function loadCatalog() {
  try {
    let books = [];
    if (isDemoMode) {
      books = currentBooks;
    } else {
      const res = await apiFetch("/api/catalog");
      books = await res.json();
    }

    renderCatalogCards(books);
    catalogCount.textContent = `${books.length} books`;

    catalogSearch.oninput = () => {
      const q = catalogSearch.value.toLowerCase().trim();
      const filtered = books.filter(b => 
        (b.title || "").toLowerCase().includes(q) ||
        (b.authors || "").toLowerCase().includes(q) ||
        (b.isbn_primary || "").toLowerCase().includes(q)
      );
      renderCatalogCards(filtered);
      catalogCount.textContent = `${filtered.length} books`;
    };

  } catch (err) {
    console.error("Error loading catalog:", err);
  }
}

function renderCatalogCards(books) {
  catalogList.innerHTML = "";
  if (books.length === 0) {
    catalogList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">No books found</div>';
    return;
  }
  books.forEach(b => {
    const card = document.createElement("div");
    card.className = "catalog-card";
    card.innerHTML = `
      <div class="card-title">${escapeHtml(b.title || "Untitled")}</div>
      <div class="card-authors">${escapeHtml(b.authors || "Unknown author")}</div>
      <div class="card-meta">
        <span>📍 ${escapeHtml(b.shelf_name || 'Shelf')}</span>
        <span>•</span>
        <span>ISBN: ${escapeHtml(b.isbn_primary || '—')}</span>
        <span>•</span>
        <span>${b.pub_year || '—'}</span>
      </div>
    `;
    card.onclick = () => {
      triggerHaptic("light");
      // Jump to shelf
      currentShelfId = b.shelf_id;
      document.querySelector('[data-target="view-shelves"]').click();
      if (!isDemoMode) {
        shelfDropdown.value = b.shelf_id;
        loadShelfData(b.shelf_id).then(() => selectBook(b.id));
      } else {
        selectBook(b.id);
      }
    };
    catalogList.appendChild(card);
  });
}

// --- XLSX Export ---
if (btnExportXlsx) {
  btnExportXlsx.addEventListener("click", async () => {
    triggerHaptic("medium");
    if (!currentSession && !isDemoMode) {
      openAuthModal();
      return;
    }
    showToast("Generating Excel (.xlsx) spreadsheet...", "success");
    try {
      const token = currentSession ? currentSession.access_token : "";
      const res = await fetch("/api/export/xlsx", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my_library_catalog.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      triggerHaptic("success");
      showToast("Downloaded my_library_catalog.xlsx", "success");
    } catch (err) {
      triggerHaptic("error");
      showToast("Failed to download spreadsheet", "error");
    }
  });
}

// --- Toast Feedback ---
function showToast(msg, type = "success") {
  const box = document.getElementById("toast-box");
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

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init();
