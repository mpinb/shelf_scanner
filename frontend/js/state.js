// ==============================================================================
// ShelfScanner Mobile Application State
// ==============================================================================

export const state = {
  // Authentication & Session
  sbClient: null,
  currentSession: null,
  isSignUpMode: false,

  // Shelves & Books
  currentShelves: [],
  currentBooks: [],
  selectedBookId: null,
  currentShelfId: null,

  // Interactive Demo Mode
  isDemoMode: false,
  demoBooksData: null,

  // Canvas Zoom & Pan
  currentZoom: 1.0,
  panX: 0,
  panY: 0,
  justDragged: false,

  // Background Task Queue Polling
  activePollInterval: null
};
