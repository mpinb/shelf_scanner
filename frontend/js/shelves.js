// ==============================================================================
// Shelves Management, Demo Shelf Mode & Usage Quota Meter
// ==============================================================================

import { state } from "./state.js";
import { triggerHaptic, showToast } from "./ui.js";
import { fetchShelves, fetchShelf, deleteShelf, fetchUsage } from "./api.js";
import { renderShelfPolygons, resetZoom } from "./canvas.js";
import { selectBook, closeBottomSheet } from "./drawer.js";

const shelfDropdown = document.getElementById("shelf-dropdown");
const btnDeleteShelf = document.getElementById("btn-delete-shelf");
const shelfStats = document.getElementById("shelf-stats");
const shelfImg = document.getElementById("shelf-image");
const svgLayer = document.getElementById("svg-layer");
const spineStrip = document.getElementById("spine-strip");
const emptyStateGuide = document.getElementById("empty-state-guide");
const demoBanner = document.getElementById("demo-banner");
const brandMenuDemoText = document.getElementById("brand-menu-demo-text");
const usageMeter = document.getElementById("usage-meter");
const usageMeterText = document.getElementById("usage-meter-text");
const stage = document.getElementById("stage");

export function updateUsageMeterUI(used, limit) {
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

export async function loadUsageMeter() {
  if (!state.currentSession) {
    updateUsageMeterUI(0, 50);
    return;
  }
  try {
    const data = await fetchUsage();
    updateUsageMeterUI(data.used || 0, data.limit || 50);
  } catch (err) {
    console.warn("Usage meter fetch note:", err);
  }
}

export async function loadShelves() {
  if (state.isDemoMode) return;
  if (!state.currentSession) {
    if (shelfStats) shelfStats.textContent = "0 shelves";
    if (shelfImg) shelfImg.src = "";
    if (svgLayer) svgLayer.innerHTML = "";
    if (spineStrip) spineStrip.innerHTML = "";
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
    state.currentShelves = await fetchShelves();
    if (shelfDropdown) shelfDropdown.innerHTML = "";

    if (state.currentShelves.length === 0) {
      if (shelfStats) shelfStats.textContent = "0 shelves";
      if (shelfImg) shelfImg.src = "";
      if (svgLayer) svgLayer.innerHTML = "";
      if (spineStrip) spineStrip.innerHTML = "";

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

    state.currentShelves.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.total_books || 0} books)`;
      shelfDropdown.appendChild(opt);
    });

    if (!state.currentShelfId || !state.currentShelves.some(s => s.id === state.currentShelfId)) {
      state.currentShelfId = state.currentShelves[0].id;
    }
    shelfDropdown.value = state.currentShelfId;
    loadShelfData(state.currentShelfId);

  } catch (err) {
    console.error("Error loading shelves:", err);
  }
}

export async function loadShelfData(shelfId) {
  try {
    const data = await fetchShelf(shelfId);
    const shelf = data.shelf;
    state.currentBooks = data.books || [];

    if (shelfStats) shelfStats.textContent = `${state.currentBooks.length} books`;
    if (shelfImg) shelfImg.src = shelf.web_image_url || shelf.image_url;
    resetZoom();
    renderShelfPolygons(state.currentBooks);

  } catch (err) {
    console.error("Error loading shelf details:", err);
  }
}

export async function activateDemoShelf() {
  triggerHaptic("medium");
  state.isDemoMode = true;

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
    if (!state.demoBooksData) {
      const res = await fetch("/static/demo_data.json");
      state.demoBooksData = await res.json();
    }
    state.currentBooks = state.demoBooksData;
    if (shelfStats) shelfStats.textContent = `${state.currentBooks.length} books`;
    if (shelfImg) shelfImg.src = "/static/demo_shelf.jpg";
    resetZoom();
    renderShelfPolygons(state.currentBooks);
    showToast("Demo Shelf Active — Tap any spine to explore!", "success");

    if (state.currentBooks.length > 0) {
      setTimeout(() => selectBook(state.currentBooks[0].id), 250);
    }
  } catch (err) {
    console.error("Error loading demo shelf data:", err);
    showToast("Failed to load demo shelf", "error");
  }
}

export function exitDemoMode() {
  triggerHaptic("light");
  state.isDemoMode = false;
  if (brandMenuDemoText) brandMenuDemoText.textContent = "Try Demo Shelf";
  if (demoBanner) demoBanner.style.display = "none";
  if (shelfDropdown) shelfDropdown.disabled = false;
  closeBottomSheet();
  loadShelves();
}

export async function handleDeleteShelf() {
  if (state.isDemoMode || !state.currentShelfId) return;
  triggerHaptic("medium");

  const currentShelf = state.currentShelves.find(s => s.id === state.currentShelfId);
  const shelfTitle = currentShelf?.name || "this shelf";
  const ok = confirm(`Delete "${shelfTitle}" and all of its book records?\n\nThis cannot be undone. Your daily scan quota limit count will not be affected.`);
  if (!ok) return;

  try {
    const res = await deleteShelf(state.currentShelfId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to delete shelf");
    }

    triggerHaptic("success");
    showToast("Shelf deleted successfully", "success");

    state.currentShelfId = null;
    await loadShelves();
    await loadUsageMeter();
  } catch (err) {
    triggerHaptic("error");
    showToast(err.message || "Failed to delete shelf", "error");
  }
}

export function setupShelvesEventListeners() {
  if (shelfDropdown) {
    shelfDropdown.addEventListener("change", (e) => {
      triggerHaptic("light");
      state.currentShelfId = e.target.value;
      loadShelfData(state.currentShelfId);
    });
  }

  if (btnDeleteShelf) {
    btnDeleteShelf.addEventListener("click", handleDeleteShelf);
  }
}
