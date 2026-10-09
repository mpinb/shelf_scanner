// ==============================================================================
// Camera Capture & Vision Scan Job Polling
// ==============================================================================

import { state } from "./state.js";
import { triggerHaptic, showToast } from "./ui.js";
import { createScanJob, fetchJobStatus } from "./api.js";
import { loadUsageMeter, loadShelves } from "./shelves.js";

const cameraInput = document.getElementById("camera-input");
const scanModal = document.getElementById("scan-modal");
const scanStatusBadge = document.getElementById("scan-status-badge");
const scanLogs = document.getElementById("scan-logs");
const btnCloseModal = document.getElementById("btn-close-modal");
const completeCard = document.getElementById("scan-complete-card");
const btnEmptyScan = document.getElementById("btn-empty-scan");
const btnDemoScan = document.getElementById("btn-demo-scan");

export function resetStepper() {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`step-${i}`);
    if (el) el.className = "step-item";
  }
}

export function openScanModal() {
  if (scanModal) scanModal.classList.add("show");
  if (scanStatusBadge) {
    scanStatusBadge.className = "badge";
    scanStatusBadge.textContent = "QUEUED";
  }
  if (scanLogs) {
    scanLogs.textContent = "[Ready] Enqueuing image to task queue...";
    scanLogs.style.display = "block";
  }
  if (completeCard) completeCard.style.display = "none";
  if (btnCloseModal) btnCloseModal.style.display = "none";
  resetStepper();
}

export function closeScanModal() {
  if (scanModal) scanModal.classList.remove("show");
  if (state.activePollInterval) {
    clearInterval(state.activePollInterval);
    state.activePollInterval = null;
  }
}

export function startJobPolling(jobId) {
  if (state.activePollInterval) clearInterval(state.activePollInterval);
  state.activePollInterval = setInterval(async () => {
    try {
      const job = await fetchJobStatus(jobId);

      if (scanStatusBadge) {
        scanStatusBadge.textContent = (job.status || "QUEUED").toUpperCase();
      }

      const curStep = job.current_step || 1;
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`step-${i}`);
        if (!el) continue;
        if (i < curStep) el.className = "step-item completed";
        else if (i === curStep) el.className = "step-item active";
        else el.className = "step-item";
      }

      if (job.logs && job.logs.length > 0 && scanLogs) {
        scanLogs.textContent = job.logs.join("\n");
        scanLogs.scrollTop = scanLogs.scrollHeight;
      }

      if (job.status === "completed" || job.status === "failed") {
        clearInterval(state.activePollInterval);
        state.activePollInterval = null;
        if (btnCloseModal) btnCloseModal.style.display = "block";

        if (job.status === "completed") {
          triggerHaptic("success");
          if (scanLogs) scanLogs.style.display = "none";
          if (completeCard) completeCard.style.display = "block";
          if (btnCloseModal) btnCloseModal.innerHTML = "<span>View My Bookshelf ➔</span>";
          showToast("Shelf scanned & enriched successfully!", "success");
          loadUsageMeter();
        } else {
          triggerHaptic("error");
          if (scanLogs) scanLogs.style.display = "block";
          showToast(`Pipeline failed: ${job.error_message}`, "error");
        }
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 1200);
}

export async function handleCameraFile(file) {
  triggerHaptic("medium");
  const shelfName = prompt("Enter a name for this bookshelf:", `Shelf ${state.currentShelves.length + 1}`) || `Shelf ${state.currentShelves.length + 1}`;

  const formData = new FormData();
  formData.append("image", file);
  formData.append("shelf_name", shelfName);
  formData.append("room", "Living Room");

  openScanModal();

  try {
    const res = await createScanJob(formData);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed");

    startJobPolling(data.job_id);
  } catch (err) {
    triggerHaptic("error");
    showToast(err.message, "error");
    closeScanModal();
  }
}

export function setupScannerEventListeners() {
  if (cameraInput) {
    cameraInput.addEventListener("change", async (e) => {
      if (!e.target.files || e.target.files.length === 0) return;
      await handleCameraFile(e.target.files[0]);
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener("click", () => {
      triggerHaptic("light");
      closeScanModal();
      loadUsageMeter();
      loadShelves();
    });
  }

  if (btnEmptyScan) {
    btnEmptyScan.addEventListener("click", () => {
      triggerHaptic("medium");
      cameraInput?.click();
    });
  }

  if (btnDemoScan) {
    btnDemoScan.addEventListener("click", () => {
      triggerHaptic("medium");
      cameraInput?.click();
    });
  }
}
