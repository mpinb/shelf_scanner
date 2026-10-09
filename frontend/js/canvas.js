// ==============================================================================
// Canvas Viewport, Polygons & Gesture Controls (Zoom & Pan)
// ==============================================================================

import { state } from "./state.js";
import { triggerHaptic } from "./ui.js";
import { selectBook, closeBottomSheet } from "./drawer.js";

const viewport = document.getElementById("canvas-viewport");
const stage = document.getElementById("stage");
const shelfImg = document.getElementById("shelf-image");
const svgLayer = document.getElementById("svg-layer");
const spineStrip = document.getElementById("spine-strip");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnZoomReset = document.getElementById("btn-zoom-reset");
const bottomSheet = document.getElementById("bottom-sheet");

export function updateSvgViewBox() {
  if (!shelfImg || !svgLayer) return;
  const nw = shelfImg.naturalWidth;
  const nh = shelfImg.naturalHeight;
  if (!nw || !nh) return;

  let maxX = 0;
  let maxY = 0;
  for (const b of (state.currentBooks || [])) {
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

export function renderShelfPolygons(books) {
  if (!svgLayer || !spineStrip) return;
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

    poly.addEventListener("click", (e) => {
      if (state.justDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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

export function clampPan() {
  if (!stage || !viewport) return;
  if (state.currentZoom <= 1.0) {
    state.panX = 0;
    state.panY = 0;
    return;
  }
  const vW = viewport.clientWidth || window.innerWidth;
  const vH = viewport.clientHeight || (window.innerHeight * 0.5);
  const sW = stage.offsetWidth * state.currentZoom;
  const sH = stage.offsetHeight * state.currentZoom;

  const maxPanX = Math.max(0, (sW - vW) / 2) + vW * 0.45;
  const maxPanY = Math.max(0, (sH - vH) / 2) + vH * 0.45;

  state.panX = Math.max(-maxPanX, Math.min(maxPanX, state.panX));
  state.panY = Math.max(-maxPanY, Math.min(maxPanY, state.panY));
}

export function updateZoomTransform() {
  clampPan();
  if (stage) {
    stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.currentZoom})`;
  }
  if (btnZoomReset) {
    btnZoomReset.textContent = `${Math.round(state.currentZoom * 100)}%`;
  }
  if (viewport) {
    viewport.classList.toggle("is-zoomed", state.currentZoom > 1.05);
  }
}

export function resetZoom() {
  state.currentZoom = 1.0;
  state.panX = 0;
  state.panY = 0;
  updateZoomTransform();
}

export function zoomToSpine(book) {
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

  // Zoom to 2.2x so the spine is prominent in top visible area
  state.currentZoom = 2.2;
  state.panX = (0.5 - normX) * stageW * state.currentZoom;
  const vH = viewport.clientHeight || stageH;
  state.panY = (0.5 - normY) * stageH * state.currentZoom - (vH * 0.12);

  updateZoomTransform();
}

export function setupGestureControls() {
  if (shelfImg) {
    shelfImg.addEventListener("load", updateSvgViewBox);
  }
  window.addEventListener("resize", updateSvgViewBox);

  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      triggerHaptic("light");
      state.currentZoom = Math.min(4.5, state.currentZoom + 0.35);
      updateZoomTransform();
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      triggerHaptic("light");
      state.currentZoom = Math.max(1.0, state.currentZoom - 0.35);
      if (state.currentZoom === 1.0) { state.panX = 0; state.panY = 0; }
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

  // --- Mouse Drag to Pan / Scroll ---
  let isMouseDown = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mousePanStartX = 0;
  let mousePanStartY = 0;
  let mouseDragDist = 0;

  viewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (state.currentZoom <= 1.0 && e.button !== 1) return;

    isMouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mousePanStartX = state.panX;
    mousePanStartY = state.panY;
    mouseDragDist = 0;
    viewport.classList.add("is-dragging");
  });

  window.addEventListener("mousemove", (e) => {
    if (!isMouseDown) return;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;
    mouseDragDist = Math.hypot(dx, dy);

    if (mouseDragDist > 5) {
      state.justDragged = true;
    }

    state.panX = mousePanStartX + dx;
    state.panY = mousePanStartY + dy;
    updateZoomTransform();
  });

  window.addEventListener("mouseup", () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    viewport.classList.remove("is-dragging");
    if (mouseDragDist > 5) {
      setTimeout(() => { state.justDragged = false; }, 160);
    } else {
      state.justDragged = false;
    }
  });

  // --- Mouse Wheel & Trackpad Panning & Zoom ---
  viewport.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.88;
      state.currentZoom = Math.min(4.5, Math.max(1.0, state.currentZoom * factor));
      updateZoomTransform();
    } else if (state.currentZoom > 1.0) {
      e.preventDefault();
      state.panX -= e.deltaX;
      state.panY -= e.deltaY;
      updateZoomTransform();
    }
  }, { passive: false });

  // --- Touch Gestures (Pinch to Zoom & Touch Pan) ---
  let initialDist = 0;
  let initialZoom = 1.0;
  let isTouchPanning = false;
  let startTouchX = 0;
  let startTouchY = 0;
  let touchPanStartX = 0;
  let touchPanStartY = 0;
  let touchMoveDist = 0;
  let lastTapTime = 0;

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      initialDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialZoom = state.currentZoom;
      isTouchPanning = false;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 280) {
        triggerHaptic("light");
        if (state.currentZoom > 1.2) {
          resetZoom();
        } else {
          state.currentZoom = 2.2;
          updateZoomTransform();
        }
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      if (state.currentZoom > 1.0) {
        isTouchPanning = true;
        touchMoveDist = 0;
        startTouchX = e.touches[0].clientX;
        startTouchY = e.touches[0].clientY;
        touchPanStartX = state.panX;
        touchPanStartY = state.panY;
        viewport.classList.add("is-dragging");
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
      state.currentZoom = Math.min(4.5, Math.max(1.0, initialZoom * ratio));
      updateZoomTransform();
    } else if (e.touches.length === 1 && isTouchPanning && state.currentZoom > 1.0) {
      const dx = e.touches[0].clientX - startTouchX;
      const dy = e.touches[0].clientY - startTouchY;
      touchMoveDist = Math.hypot(dx, dy);

      if (touchMoveDist > 6) {
        state.justDragged = true;
      }

      state.panX = touchPanStartX + dx;
      state.panY = touchPanStartY + dy;
      updateZoomTransform();
    }
  }, { passive: true });

  viewport.addEventListener("touchend", () => {
    isTouchPanning = false;
    initialDist = 0;
    viewport.classList.remove("is-dragging");
    if (touchMoveDist > 6) {
      setTimeout(() => { state.justDragged = false; }, 160);
    } else {
      state.justDragged = false;
    }
    if (state.currentZoom <= 1.0) {
      state.panX = 0;
      state.panY = 0;
      updateZoomTransform();
    }
  }, { passive: true });

  // Dismiss sheet when clicking empty canvas
  viewport.addEventListener("click", (e) => {
    if (state.justDragged) return;
    if (e.target === viewport || e.target === shelfImg) {
      if (bottomSheet && bottomSheet.classList.contains("open")) {
        closeBottomSheet();
      }
    }
  });
}
