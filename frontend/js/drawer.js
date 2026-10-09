// ==============================================================================
// Book Details Drawer (Bottom Sheet) & Form Interactions
// ==============================================================================

import { state } from "./state.js";
import { triggerHaptic, showToast } from "./ui.js";
import { updateBook } from "./api.js";
import { zoomToSpine } from "./canvas.js";

const bottomSheet = document.getElementById("bottom-sheet");
const sheetBackdrop = document.getElementById("sheet-backdrop");
const btnCloseSheet = document.getElementById("btn-close-sheet");
const btnPrevBook = document.getElementById("btn-prev-book");
const btnNextBook = document.getElementById("btn-next-book");
const sheetBookNumber = document.getElementById("sheet-book-number");

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

export function openBottomSheet() {
  if (bottomSheet) bottomSheet.classList.add("open");
  if (sheetBackdrop) sheetBackdrop.classList.add("show");
}

export function closeBottomSheet() {
  if (bottomSheet) bottomSheet.classList.remove("open");
  if (sheetBackdrop) sheetBackdrop.classList.remove("show");
  const prevSelected = document.querySelector(".book-poly.selected");
  if (prevSelected) prevSelected.classList.remove("selected");
  state.selectedBookId = null;
}

export function selectBook(bookId) {
  state.selectedBookId = bookId;
  const bookIndex = state.currentBooks.findIndex(b => b.id === bookId);
  if (bookIndex === -1) return;
  const book = state.currentBooks[bookIndex];

  document.querySelectorAll(".book-poly").forEach(el => {
    el.classList.toggle("selected", el.dataset.id === bookId);
  });
  document.querySelectorAll(".strip-pill").forEach(el => {
    const active = el.dataset.id === bookId;
    el.classList.toggle("active", active);
    if (active) el.scrollIntoView({ behavior: "smooth", inline: "center" });
  });

  if (sheetBookNumber) {
    sheetBookNumber.textContent = `Book #${book.book_index} of ${state.currentBooks.length}`;
  }
  if (btnPrevBook) btnPrevBook.disabled = (bookIndex <= 0);
  if (btnNextBook) btnNextBook.disabled = (bookIndex >= state.currentBooks.length - 1);

  if (fieldTitle) fieldTitle.value = book.title || "";
  if (fieldAuthors) fieldAuthors.value = book.authors || "";
  if (fieldPublisher) fieldPublisher.value = book.publication || "";
  if (fieldYear) fieldYear.value = book.pub_year || "";
  if (fieldIsbn) fieldIsbn.value = book.isbn_primary || "";
  if (fieldSubjects) fieldSubjects.value = book.subjects || "";
  if (fieldRawText) fieldRawText.value = book.raw_text || "";
  if (fieldIsIgnored) fieldIsIgnored.checked = !!book.is_ignored;

  if (olTitlePreview) {
    if (book.ol_title) {
      olTitlePreview.style.display = "block";
      olTitlePreview.textContent = `Verified: ${book.ol_title}`;
    } else {
      olTitlePreview.style.display = "none";
    }
  }

  if (olAuthorsPreview) {
    if (book.ol_authors) {
      olAuthorsPreview.style.display = "block";
      olAuthorsPreview.textContent = `OpenLibrary Authors: ${book.ol_authors}`;
    } else {
      olAuthorsPreview.style.display = "none";
    }
  }

  // Render ISBN candidate chips
  if (isbnChips) {
    const isbns = Array.isArray(book.isbns) ? book.isbns : [];
    isbnChips.innerHTML = "";
    if (isbns.length > 0) {
      isbns.forEach(isbn => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = `${isbn} +`;
        chip.onclick = () => {
          triggerHaptic("light");
          if (fieldIsbn) fieldIsbn.value = isbn;
          saveBookDetails();
          showToast(`Selected ISBN ${isbn}`, "success");
        };
        isbnChips.appendChild(chip);
      });
    } else {
      isbnChips.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted);">None detected</span>';
    }
  }

  openBottomSheet();
  zoomToSpine(book);
}

export async function saveBookDetails() {
  if (!state.selectedBookId) return;

  const payload = {
    title: fieldTitle ? fieldTitle.value.trim() : "",
    authors: fieldAuthors ? fieldAuthors.value.trim() : "",
    publication: fieldPublisher ? fieldPublisher.value.trim() : "",
    pub_year: fieldYear ? (parseInt(fieldYear.value) || null) : null,
    isbn_primary: fieldIsbn ? fieldIsbn.value.trim() : "",
    subjects: fieldSubjects ? fieldSubjects.value.trim() : "",
    raw_text: fieldRawText ? fieldRawText.value.trim() : "",
    is_ignored: fieldIsIgnored ? fieldIsIgnored.checked : false
  };

  // Demo mode in-memory update
  if (state.isDemoMode || String(state.selectedBookId).startsWith("demo-")) {
    const idx = state.currentBooks.findIndex(b => b.id === state.selectedBookId);
    if (idx !== -1) Object.assign(state.currentBooks[idx], payload);
    const poly = document.querySelector(`.book-poly[data-id="${state.selectedBookId}"]`);
    if (poly) poly.classList.toggle("ignored", payload.is_ignored);
    triggerHaptic("success");
    showToast("Demo book updated in memory!", "success");
    return;
  }

  try {
    const res = await updateBook(state.selectedBookId, payload);
    if (res.ok) {
      triggerHaptic("success");
      showToast("Book saved successfully!", "success");
      const idx = state.currentBooks.findIndex(b => b.id === state.selectedBookId);
      if (idx !== -1) Object.assign(state.currentBooks[idx], payload);

      const poly = document.querySelector(`.book-poly[data-id="${state.selectedBookId}"]`);
      if (poly) poly.classList.toggle("ignored", payload.is_ignored);
    }
  } catch (err) {
    triggerHaptic("error");
    showToast("Error saving book", "error");
  }
}

export function setupDrawerEventListeners() {
  if (btnCloseSheet) {
    btnCloseSheet.addEventListener("click", () => {
      triggerHaptic("light");
      closeBottomSheet();
    });
  }
  if (sheetBackdrop) {
    sheetBackdrop.addEventListener("click", () => {
      triggerHaptic("light");
      closeBottomSheet();
    });
  }

  if (btnPrevBook) {
    btnPrevBook.addEventListener("click", () => {
      triggerHaptic("light");
      const curIdx = state.currentBooks.findIndex(b => b.id === state.selectedBookId);
      if (curIdx > 0) selectBook(state.currentBooks[curIdx - 1].id);
    });
  }

  if (btnNextBook) {
    btnNextBook.addEventListener("click", () => {
      triggerHaptic("light");
      const curIdx = state.currentBooks.findIndex(b => b.id === state.selectedBookId);
      if (curIdx < state.currentBooks.length - 1) selectBook(state.currentBooks[curIdx + 1].id);
    });
  }

  // Auto-save on change
  [fieldTitle, fieldAuthors, fieldPublisher, fieldYear, fieldIsbn, fieldSubjects, fieldRawText].forEach(el => {
    if (el) el.addEventListener("change", saveBookDetails);
  });
  if (fieldIsIgnored) {
    fieldIsIgnored.addEventListener("change", () => {
      triggerHaptic("light");
      saveBookDetails();
    });
  }
}

export function setupSwipeTransitions() {
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
      if (e.changedTouches.length === 1 && state.currentZoom <= 1.05) {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(deltaX) > 70 && Math.abs(deltaY) < 45) {
          const isShelvesActive = document.getElementById("view-shelves")?.classList.contains("active");
          if (deltaX < 0 && isShelvesActive) {
            triggerHaptic("light");
            document.querySelector('[data-target="view-catalog"]')?.click();
          } else if (deltaX > 0 && !isShelvesActive) {
            triggerHaptic("light");
            document.querySelector('[data-target="view-shelves"]')?.click();
          }
        }
      }
    }, { passive: true });
  }

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
