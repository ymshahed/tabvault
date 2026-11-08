const $ = (selector) => document.querySelector(selector);
let state = null;
const selectedRecordIds = new Set();

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadState();
});

function bindEvents() {
  $("#saveButton").addEventListener("click", saveSession);
  $("#saveTabButton").addEventListener("click", saveCurrentTab);
  $("#exportButton").addEventListener("click", exportBackup);
  $("#importButton").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", importBackup);
  $("#searchInput").addEventListener("input", render);
  $("#selectAllCheckbox").addEventListener("change", toggleSelectVisible);
  $("#deleteSelectedButton").addEventListener("click", deleteSelected);
  $("#automaticToggle").addEventListener("change", toggleAutomaticSnapshots);
  $("#settingsButton").addEventListener("click", openSettings);
  $("#openSettingsButton").addEventListener("click", openSettings);
  $("#folderFilter").addEventListener("change", render);
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Something went wrong.");
  return response;
}

async function loadState() {
  try {
    state = (await send({ type: "get-state" })).state;
    $("#automaticToggle").checked = state.settings.automaticSnapshots;
    renderFolders();
    render();
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function saveSession() {
  try {
    await send({ type: "save-session", folderId: getSaveFolderId() });
    await loadState();
    showStatus(`Session saved in ${getSaveFolderName()}.`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function saveCurrentTab() {
  try {
    await send({ type: "save-tab", folderId: getSaveFolderId() });
    await loadState();
    showStatus(`Current tab saved in ${getSaveFolderName()}.`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

function getSaveFolderId() {
  const selectedFolderId = $("#folderFilter").value;
  if (state?.folders.some((folder) => folder.id === selectedFolderId)) return selectedFolderId;
  return state?.folders.some((folder) => folder.id === state.settings.defaultFolderId)
    ? state.settings.defaultFolderId
    : "general";
}

function getSaveFolderName() {
  const folderId = getSaveFolderId();
  return state?.folders.find((folder) => folder.id === folderId)?.name || "General";
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

async function toggleAutomaticSnapshots(event) {
  try {
    await send({ type: "set-automatic-snapshots", enabled: event.target.checked });
    showStatus(event.target.checked ? "Automatic snapshots enabled." : "Automatic snapshots paused.");
  } catch (error) {
    event.target.checked = !event.target.checked;
    showStatus(error.message, true);
  }
}

function allRecords() {
  return [...(state?.sessions || []), ...(state?.automaticSnapshots || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderFolders() {
  const select = $("#folderFilter");
  const current = select.value || "all";
  select.innerHTML = `<option value="all">All folders</option>${state.folders.map((folder) => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`).join("")}`;
  select.value = state.folders.some((folder) => folder.id === current) || current === "all" ? current : "all";
}

function render() {
  if (!state) return;
  const query = normalizeSearchText($("#searchInput").value);
  const folderId = $("#folderFilter").value || "all";
  const candidates = allRecords().filter((record) => {
    // A search should find a saved item even when it is inside another folder.
    if (!query && folderId !== "all" && record.folderId !== folderId) return false;
    if (!query) return true;
    return true;
  });
  const nameMatches = query
    ? candidates.filter((record) => normalizeSearchText(record.name).includes(query))
    : candidates;
  const records = query && nameMatches.length
    ? nameMatches
    : candidates.filter((record) => matchesSearchDetails(record, query));
  const list = $("#sessionList");
  const recordIds = new Set(allRecords().map((record) => record.id));
  for (const id of selectedRecordIds) {
    if (!recordIds.has(id)) selectedRecordIds.delete(id);
  }
  updateBulkControls(records);
  if (!records.length) {
    list.innerHTML = `<div class="empty">${query ? "No matching sessions." : "No saved sessions yet. Save your first local backup above."}</div>`;
    return;
  }

  list.innerHTML = records.map((record) => `
    <article class="session">
      <div class="session-heading">
        <input class="record-checkbox" type="checkbox" data-record-id="${record.id}" ${selectedRecordIds.has(record.id) ? "checked" : ""} aria-label="Select ${escapeHtml(record.name)}">
        <span class="session-name" title="${escapeHtml(record.name)}">${escapeHtml(record.name)}</span>
        <span class="badge">${record.imported ? "IMPORTED" : record.type === "automatic" ? "AUTO" : record.type === "tab" ? "TAB" : "SAVED"}</span>
      </div>
      <div class="session-meta">
        <span>${formatDate(record.createdAt)}</span>
        <span>${escapeHtml(getRecordFolderName(record))}</span>
        <span>${record.windowCount} window${record.windowCount === 1 ? "" : "s"}</span>
        <span>${record.tabCount} tab${record.tabCount === 1 ? "" : "s"}</span>
      </div>
      <div class="session-actions">
        <button data-action="restore" data-id="${record.id}">Restore</button>
        <button data-action="rename" data-id="${record.id}">Rename</button>
        <button data-action="export" data-id="${record.id}">Export</button>
        <button data-action="move" data-id="${record.id}">Move</button>
        <button class="delete-button" data-action="delete" data-id="${record.id}">Delete</button>
      </div>
    </article>
  `).join("");
  list.querySelectorAll(".record-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedRecordIds.add(checkbox.dataset.recordId);
      else selectedRecordIds.delete(checkbox.dataset.recordId);
      updateBulkControls(records);
    });
  });
  list.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => handleRecordAction(button.dataset.action, button.dataset.id)));
}

function updateBulkControls(visibleRecords) {
  const selectedVisible = visibleRecords.filter((record) => selectedRecordIds.has(record.id)).length;
  const selectAll = $("#selectAllCheckbox");
  selectAll.checked = visibleRecords.length > 0 && selectedVisible === visibleRecords.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleRecords.length;
  const deleteButton = $("#deleteSelectedButton");
  deleteButton.disabled = selectedRecordIds.size === 0;
  deleteButton.textContent = selectedRecordIds.size
    ? `Delete selected (${selectedRecordIds.size})`
    : "Delete selected";
}

function getVisibleRecords() {
  const query = normalizeSearchText($("#searchInput").value);
  const folderId = $("#folderFilter").value || "all";
  const candidates = allRecords().filter((record) => {
    if (!query && folderId !== "all" && record.folderId !== folderId) return false;
    return true;
  });
  const nameMatches = query
    ? candidates.filter((record) => normalizeSearchText(record.name).includes(query))
    : candidates;
  return query && nameMatches.length
    ? nameMatches
    : candidates.filter((record) => matchesSearchDetails(record, query));
}

function toggleSelectVisible(event) {
  const visibleRecords = getVisibleRecords();
  for (const record of visibleRecords) {
    if (event.target.checked) selectedRecordIds.add(record.id);
    else selectedRecordIds.delete(record.id);
  }
  render();
}

async function deleteSelected() {
  const ids = [...selectedRecordIds];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected saved item${ids.length === 1 ? "" : "s"}?`)) return;
  try {
    const selected = new Set(ids);
    state.sessions = state.sessions.filter((record) => !selected.has(record.id));
    state.automaticSnapshots = state.automaticSnapshots.filter((record) => !selected.has(record.id));
    state = (await send({ type: "replace-state", state })).state;
    ids.forEach((id) => selectedRecordIds.delete(id));
    render();
    showStatus(`${ids.length} saved item${ids.length === 1 ? "" : "s"} deleted.`);
  } catch (error) {
    showStatus(`Delete failed: ${error.message}`, true);
  }
}

function getRecordFolderName(record) {
  return state?.folders.find((folder) => folder.id === record.folderId)?.name || "General";
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function getSearchText(record) {
  const tabs = Array.isArray(record.windows)
    ? record.windows.flatMap((window) => Array.isArray(window.tabs) ? window.tabs : [])
    : [];
  const domains = Array.isArray(record.domains) ? record.domains : [];
  return normalizeSearchText([
    record.name,
    ...domains,
    ...tabs.flatMap((tab) => [tab.title, tab.url])
  ].filter(Boolean).join(" "));
}

function matchesSearchDetails(record, query) {
  if (!query) return true;
  const text = getSearchText(record);
  return text.includes(query);
}

async function handleRecordAction(action, id) {
  const record = allRecords().find((item) => item.id === id);
  if (!record) return;
  try {
    if (action === "restore") {
      const destination = await chooseRestoreDestination();
      if (!destination) return;
      const response = await send({ type: "restore-session", record, destination });
      const location = destination === "current-window" ? "this window" : "a new window";
      showStatus(response.skippedCount
        ? `Restored supported tabs in ${location}. ${response.skippedCount} browser-internal tab${response.skippedCount === 1 ? "" : "s"} skipped.`
        : `Tabs restored in ${location}.`);
    } else if (action === "rename") {
      const name = prompt("Name this saved item:", record.name);
      if (name === null) return;
      state = (await send({ type: "rename-record", recordId: id, name })).state;
      render();
      showStatus("Saved item renamed.");
    } else if (action === "export") {
      const filename = prompt("Choose a backup file name:", `tabvault-${fileDate(record.createdAt)}`);
      if (filename === null) return;
      await downloadJson({
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        backupName: filename.replace(/\.json$/i, "").trim(),
        folders: state.folders,
        sessions: [record],
        automaticSnapshots: []
      }, ensureJsonExtension(filename));
      showStatus("Choose where to save the backup file.");
    } else if (action === "delete") {
      if (!confirm("Delete this local snapshot?")) return;
      state.sessions = state.sessions.filter((item) => item.id !== id);
      state.automaticSnapshots = state.automaticSnapshots.filter((item) => item.id !== id);
      await send({ type: "replace-state", state });
      render();
      showStatus("Snapshot deleted.");
    } else if (action === "move") {
      const folderName = prompt(`Move to which folder?\n${state.folders.map((folder) => `${folder.id}: ${folder.name}`).join("\n")}`, "general");
      const folder = state.folders.find((item) => item.id === folderName || item.name.toLowerCase() === String(folderName).toLowerCase());
      if (!folder) throw new Error("Folder not found. Use the folder ID or exact name.");
      state = (await send({ type: "move-record", recordId: id, folderId: folder.id })).state;
      renderFolders();
      render();
      showStatus(`Moved to ${folder.name}.`);
    }
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function exportBackup() {
  if (!state) return;
  const filename = prompt("Choose a backup file name:", `tabvault-window-${fileDate(new Date().toISOString())}`);
  if (filename === null) return;
  try {
    const currentWindow = (await send({ type: "capture-current-window" })).record;
    await downloadJson({
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      backupName: filename.replace(/\.json$/i, "").trim(),
      folders: state.folders,
      sessions: [currentWindow],
      automaticSnapshots: []
    }, ensureJsonExtension(filename));
    showStatus("Choose where to save the backup file.");
  } catch (error) {
    showStatus(`Export failed: ${error.message}`, true);
  }
}

async function importBackup(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    showStatus(`Reading ${file.name}...`);
    const text = typeof file.text === "function"
      ? await file.text()
      : await readFileAsText(file);
    const imported = JSON.parse(text.replace(/^\uFEFF/, ""));
    const normalized = normalizeBackup(imported);
    const recordsToImport = normalized.sessions.length
      ? normalized.sessions
      : normalized.automaticSnapshots;
    const importedRecords = recordsToImport.length
      ? [createImportedFileRecord(recordsToImport, imported.backupName || file.name)]
      : [];
    if (!importedRecords.length) throw new Error("This backup does not contain any saved tabs or sessions.");
    const existingFolders = new Set(state.folders.map((folder) => folder.id));
    for (const folder of normalized.folders) {
      if (!existingFolders.has(folder.id)) state.folders.push(folder);
    }
    state.sessions = [...state.sessions, ...importedRecords.filter((record) => record.type !== "automatic")];
    state.automaticSnapshots = [...state.automaticSnapshots, ...importedRecords.filter((record) => record.type === "automatic")];
    state = (await send({ type: "replace-state", state })).state;
    renderFolders();
    render();
    showStatus(`${importedRecords.length} saved item${importedRecords.length === 1 ? "" : "s"} imported.`);
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, true);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Chrome could not read the selected file."));
    reader.readAsText(file);
  });
}

function createImportedFileRecord(records, filename) {
  const fileName = String(filename || "")
    .replace(/\.[^/.]+$/, "")
    .trim()
    .replace(/\s+\(imported\)$/i, "");
  const baseName = fileName || "Imported backup";
  const windows = records.flatMap((record) => Array.isArray(record.windows) ? record.windows : []);
  const tabs = windows.flatMap((window) => Array.isArray(window.tabs) ? window.tabs : []);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type: "manual",
    folderId: records[0].folderId || "general",
    sourceName: baseName,
    name: `${baseName} (imported)`,
    imported: true,
    windowCount: windows.length,
    tabCount: tabs.length,
    domains: [...new Set(tabs.map((tab) => getDomainFromUrl(tab.url)).filter(Boolean))].sort(),
    windows
  };
}

function getDomainFromUrl(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function chooseRestoreDestination() {
  return new Promise((resolve) => {
    const dialog = $("#restoreDialog");
    const finish = () => {
      dialog.removeEventListener("close", finish);
      resolve(dialog.returnValue === "current-window" || dialog.returnValue === "new-window" ? dialog.returnValue : null);
    };
    dialog.addEventListener("close", finish);
    dialog.showModal();
  });
}

function validateBackup(value) {
  if (!value || !Array.isArray(value.sessions) || !Array.isArray(value.automaticSnapshots || [])) {
    throw new Error("Unsupported or malformed TabVault backup.");
  }
  for (const record of [...value.sessions, ...value.automaticSnapshots]) {
    if (!record || typeof record !== "object" || !Array.isArray(record.windows)) {
      throw new Error("A snapshot in this file is invalid.");
    }
    for (const window of record.windows) {
      if (!Array.isArray(window.tabs)) throw new Error("A window in this file is invalid.");
    }
  }
}

function normalizeBackup(value) {
  validateBackup(value);
  const records = [...value.sessions, ...(value.automaticSnapshots || [])].map((record) => ({
    ...record,
    id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    type: record.type === "automatic" ? "automatic" : record.type === "tab" ? "tab" : "manual",
    folderId: typeof record.folderId === "string" ? record.folderId : "general",
    name: typeof record.name === "string" && record.name.trim() ? record.name : "Imported saved session",
    windowCount: typeof record.windowCount === "number" ? record.windowCount : record.windows.length,
    tabCount: typeof record.tabCount === "number"
      ? record.tabCount
      : record.windows.reduce((count, window) => count + (Array.isArray(window.tabs) ? window.tabs.length : 0), 0)
  }));
  return {
    folders: Array.isArray(value.folders)
      ? value.folders.filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
      : [{ id: "general", name: "General" }],
    sessions: records.filter((record) => record.type !== "automatic"),
    automaticSnapshots: records.filter((record) => record.type === "automatic")
  };
}

async function downloadJson(value, filename) {
  const data = encodeURIComponent(JSON.stringify(value, null, 2));
  const downloadId = await chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${data}`,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });
  if (!downloadId) throw new Error("Chrome could not start the file save dialog.");
  return downloadId;
}

function ensureJsonExtension(filename) {
  const trimmed = filename.trim() || "tabvault-backup";
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

function showStatus(message, isError = false) {
  const status = $("#status");
  status.textContent = message;
  status.classList.toggle("error", isError);
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => { status.textContent = ""; }, 4500);
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function fileDate(value) {
  return value.replace(/[:.]/g, "-").replace(/T/g, "_").replace(/Z/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}
