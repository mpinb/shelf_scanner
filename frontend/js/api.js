// ==============================================================================
// API Client (Authenticated fetch & endpoints)
// ==============================================================================

import { state } from "./state.js";

let onUnauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  onUnauthorizedHandler = fn;
}

export async function apiFetch(endpoint, options = {}) {
  const token = state.currentSession ? state.currentSession.access_token : "";
  options.headers = {
    ...options.headers,
    "Authorization": `Bearer ${token}`
  };
  const res = await fetch(endpoint, options);
  if (res.status === 401) {
    if (onUnauthorizedHandler) {
      onUnauthorizedHandler();
    }
    throw new Error("Session expired, please sign in.");
  }
  return res;
}

export async function fetchServerConfig() {
  const res = await fetch("/api/config");
  return res.json();
}

export async function fetchUsage() {
  const res = await apiFetch("/api/usage");
  return res.json();
}

export async function fetchShelves() {
  const res = await apiFetch("/api/shelves");
  return res.json();
}

export async function fetchShelf(shelfId) {
  const res = await apiFetch(`/api/shelves/${shelfId}`);
  return res.json();
}

export async function deleteShelf(shelfId) {
  const res = await apiFetch(`/api/shelves/${shelfId}`, {
    method: "DELETE"
  });
  return res;
}

export async function updateBook(bookId, payload) {
  const res = await apiFetch(`/api/books/${bookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res;
}

export async function fetchCatalog() {
  const res = await apiFetch("/api/catalog");
  return res.json();
}

export async function createScanJob(formData) {
  const res = await apiFetch("/api/jobs", {
    method: "POST",
    body: formData
  });
  return res;
}

export async function fetchJobStatus(jobId) {
  const res = await apiFetch(`/api/jobs/${jobId}`);
  return res.json();
}
