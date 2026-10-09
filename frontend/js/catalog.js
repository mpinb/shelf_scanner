// ==============================================================================
// Library Catalog View, Search & Excel (.xlsx) Export
// ==============================================================================

import { state } from "./state.js";
import { triggerHaptic, showToast, escapeHtml } from "./ui.js";
import { fetchCatalog } from "./api.js";
import { loadShelfData } from "./shelves.js";
import { selectBook } from "./drawer.js";
import { openAuthModal } from "./auth.js";

const catalogList = document.getElementById("catalog-list");
const catalogSearch = document.getElementById("catalog-search");
const catalogCount = document.getElementById("catalog-count");
const btnExportXlsx = document.getElementById("btn-export-xlsx");
const shelfDropdown = document.getElementById("shelf-dropdown");

export function renderCatalogCards(books) {
  if (!catalogList) return;
  catalogList.innerHTML = "";

  if (books.length === 0) {
    catalogList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">No books found</div>';
    return;
  }

  books.forEach((b) => {
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
      state.currentShelfId = b.shelf_id;
      document.querySelector('[data-target="view-shelves"]')?.click();
      if (!state.isDemoMode) {
        if (shelfDropdown) shelfDropdown.value = b.shelf_id;
        loadShelfData(b.shelf_id).then(() => selectBook(b.id));
      } else {
        selectBook(b.id);
      }
    };
    catalogList.appendChild(card);
  });
}

export async function loadCatalog() {
  try {
    let books = [];
    if (state.isDemoMode) {
      books = state.currentBooks;
    } else {
      books = await fetchCatalog();
    }

    renderCatalogCards(books);
    if (catalogCount) catalogCount.textContent = `${books.length} books`;

    if (catalogSearch) {
      catalogSearch.oninput = () => {
        const q = catalogSearch.value.toLowerCase().trim();
        const filtered = books.filter(b =>
          (b.title || "").toLowerCase().includes(q) ||
          (b.authors || "").toLowerCase().includes(q) ||
          (b.isbn_primary || "").toLowerCase().includes(q)
        );
        renderCatalogCards(filtered);
        if (catalogCount) catalogCount.textContent = `${filtered.length} books`;
      };
    }
  } catch (err) {
    console.error("Error loading catalog:", err);
  }
}

export async function exportXlsx() {
  triggerHaptic("medium");
  if (!state.currentSession && !state.isDemoMode) {
    openAuthModal();
    return;
  }

  showToast("Generating Excel (.xlsx) spreadsheet...", "success");
  try {
    const token = state.currentSession ? state.currentSession.access_token : "";
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
}

export function setupCatalogEventListeners() {
  if (btnExportXlsx) {
    btnExportXlsx.addEventListener("click", exportXlsx);
  }
}
