// ==============================================================================
// ShelfScanner Mobile Application Entry Point
// ==============================================================================

import { state } from "./js/state.js";
import { registerServiceWorker, triggerHaptic } from "./js/ui.js";
import { initAuth } from "./js/auth.js";
import { setupGestureControls } from "./js/canvas.js";
import { setupDrawerEventListeners, setupSwipeTransitions } from "./js/drawer.js";
import {
  setupShelvesEventListeners,
  activateDemoShelf,
  exitDemoMode
} from "./js/shelves.js";
import { setupScannerEventListeners } from "./js/scanner.js";
import { setupCatalogEventListeners, loadCatalog } from "./js/catalog.js";

// Top Brand Menu Elements
const btnBrandMenu = document.getElementById("btn-brand-menu");
const brandMenuDropdown = document.getElementById("brand-menu-dropdown");
const menuItemDemo = document.getElementById("menu-item-demo");
const brandMenuDemoText = document.getElementById("brand-menu-demo-text");
const btnEmptyDemo = document.getElementById("btn-empty-demo");
const btnExitDemo = document.getElementById("btn-exit-demo");

function setupBrandMenu() {
  if (btnBrandMenu) {
    btnBrandMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerHaptic("light");
      const isOpen = brandMenuDropdown.style.display === "flex";
      brandMenuDropdown.style.display = isOpen ? "none" : "flex";
      btnBrandMenu.classList.toggle("open", !isOpen);
      if (!isOpen && brandMenuDemoText) {
        brandMenuDemoText.textContent = state.isDemoMode ? "Exit Demo Shelf" : "Try Demo Shelf";
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
      if (state.isDemoMode) {
        exitDemoMode();
      } else {
        activateDemoShelf();
      }
    });
  }

  if (btnEmptyDemo) btnEmptyDemo.addEventListener("click", activateDemoShelf);
  if (btnExitDemo) btnExitDemo.addEventListener("click", exitDemoMode);
}

function setupNavigationTabs() {
  document.querySelectorAll(".bottom-nav .nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      triggerHaptic("light");
      document.querySelectorAll(".bottom-nav .nav-item").forEach((n) => n.classList.remove("active"));
      document.querySelectorAll(".app-view").forEach((v) => v.classList.remove("active"));
      item.classList.add("active");

      const targetId = item.dataset.target;
      const viewEl = document.getElementById(targetId);
      if (viewEl) viewEl.classList.add("active");

      if (targetId === "view-catalog") {
        loadCatalog();
      }
    });
  });
}

// Application Lifecycle Initialization
async function bootstrap() {
  registerServiceWorker();
  setupBrandMenu();
  setupNavigationTabs();
  setupGestureControls();
  setupDrawerEventListeners();
  setupSwipeTransitions();
  setupShelvesEventListeners();
  setupScannerEventListeners();
  setupCatalogEventListeners();

  await initAuth();
}

bootstrap();
