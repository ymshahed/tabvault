let state;

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#folderForm").addEventListener("submit", createFolder);
  document.querySelector("#automaticToggle").addEventListener("change", toggleAutomatic);
  document.querySelector("#saveSnapshotSettings").addEventListener("click", saveSnapshotSettings);
  document.querySelector("#snapshotInterval").addEventListener("change", saveSnapshotSettings);
  document.querySelector("#snapshotLimit").addEventListener("change", saveSnapshotSettings);
  document.querySelector("#deleteAutomaticButton").addEventListener("click", deleteAutomaticSnapshots);
  document.querySelector("#defaultFolder").addEventListener("change", changeDefaultFolder);
  document.querySelector("#clearDataButton").addEventListener("click", clearLocalData);
  document.querySelector("#exportBackupButton").addEventListener("click", exportBackup);
  await load();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.tabVaultState) {
    load();
  }

  function showControlStatus(id, message, error = false) {
    const status = document.querySelector(`#${id}`);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", error);
  }
});

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Something went wrong.");
  return response;
}

async function load() {
  try {
    state = (await send({ type: "get-state" })).state;
    document.querySelector("#automaticToggle").checked = state.settings.automaticSnapshots;
    document.querySelector("#snapshotInterval").value = String(state.settings.snapshotIntervalMinutes);
    document.querySelector("#snapshotLimit").value = String(state.settings.maxAutomaticSnapshots);
    renderFolders();
    renderDefaultFolder();
    renderSummary();
  } catch (error) { showStatus(error.message, true); }
}

async function saveSnapshotSettings() {
  const button = document.querySelector("#saveSnapshotSettings");
  button.disabled = true;
  try {
    state = (await send({
      type: "set-snapshot-settings",
      intervalMinutes: document.querySelector("#snapshotInterval").value,
      maxSnapshots: document.querySelector("#snapshotLimit").value
    })).state;
    renderSummary();
    showSnapshotStatus("Settings saved.");
  } catch (error) {
    showSnapshotStatus(`Could not save snapshot settings: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function showSnapshotStatus(message, error = false) {
  const status = document.querySelector("#snapshotSettingsStatus");
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function deleteAutomaticSnapshots() {
  if (!confirm("Delete all automatic snapshots?")) return;
  try {
    state = (await send({ type: "delete-automatic-snapshots" })).state;
    renderSummary();
    showControlStatus("deleteAutomaticStatus", "Automatic snapshots deleted.");
  } catch (error) { showControlStatus("deleteAutomaticStatus", error.message, true); }
}

async function changeDefaultFolder(event) {
  try {
    state = (await send({ type: "set-default-folder", folderId: event.target.value })).state;
    showControlStatus("defaultFolderStatus", "Default folder saved.");
  } catch (error) {
    renderDefaultFolder();
    showControlStatus("defaultFolderStatus", error.message, true);
  }
}

async function toggleAutomatic(event) {
  try {
    await send({ type: "set-automatic-snapshots", enabled: event.target.checked });
    showControlStatus("automaticStatus", "Settings saved.");
  } catch (error) {
    event.target.checked = !event.target.checked;
    showControlStatus("automaticStatus", error.message, true);
  }
}

async function createFolder(event) {
  event.preventDefault();
  try {
    const response = await send({ type: "create-folder", name: document.querySelector("#folderName").value });
    state.folders.push(response.folder);
    document.querySelector("#folderName").value = "";
    renderFolders();
    renderDefaultFolder();
    showControlStatus("folderStatus", "Folder created.");
  } catch (error) { showControlStatus("folderStatus", error.message, true); }
}

function renderFolders() {
  document.querySelector("#folderList").innerHTML = state.folders.map((folder) => `
    <div class="folder-row">
      <span class="folder-name">${escapeHtml(folder.name)}</span>
      <div class="folder-actions">
        ${folder.id === "general" ? "" : `<button data-action="rename" data-id="${folder.id}">Rename</button><button data-action="delete" data-id="${folder.id}">Delete</button>`}
      </div>
    </div>`).join("");
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => folderAction(button.dataset.action, button.dataset.id)));
}

async function folderAction(action, id) {
  const folder = state.folders.find((item) => item.id === id);
  try {
    if (action === "rename") {
      const name = prompt("New folder name:", folder.name);
      if (name === null) return;
      state = (await send({ type: "rename-folder", id, name })).state;
    } else {
      if (!confirm(`Delete "${folder.name}"? Sessions inside will move to General.`)) return;
      state = (await send({ type: "delete-folder", id })).state;
    }
    renderFolders();
      renderDefaultFolder();
      renderSummary();
      showControlStatus("folderStatus", "Folder updated.");
  } catch (error) { showControlStatus("folderStatus", error.message, true); }
}

function renderDefaultFolder() {
  const select = document.querySelector("#defaultFolder");
  const current = state.settings.defaultFolderId;
  select.innerHTML = state.folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</option>`).join("");
  select.value = state.folders.some((folder) => folder.id === current) ? current : "general";
}

function renderSummary() {
  const total = state.sessions.length + state.automaticSnapshots.length;
  document.querySelector("#storageSummary").textContent =
    `${total} saved item${total === 1 ? "" : "s"} (${state.sessions.length} manual, ${state.automaticSnapshots.length} automatic).`;
}

async function clearLocalData() {
  if (!confirm("Delete all saved tabs, sessions, and automatic snapshots? Your folders and settings will be kept.")) return;
  try {
    state = (await send({ type: "clear-local-data" })).state;
    document.querySelector("#automaticToggle").checked = state.settings.automaticSnapshots;
    document.querySelector("#snapshotInterval").value = String(state.settings.snapshotIntervalMinutes);
    document.querySelector("#snapshotLimit").value = String(state.settings.maxAutomaticSnapshots);
    renderFolders();
    renderDefaultFolder();
    renderSummary();
    showControlStatus("clearDataStatus", "Saved data cleared. Folders and settings were kept.");
  } catch (error) { showControlStatus("clearDataStatus", error.message, true); }
}

async function exportBackup() {
  const filename = prompt("Choose a backup file name:", `tabvault-settings-${new Date().toISOString().slice(0, 10)}`);
  if (filename === null) return;
  try {
    state = (await send({ type: "get-state" })).state;
    renderFolders();
    renderDefaultFolder();
    renderSummary();
    const data = encodeURIComponent(JSON.stringify({
      schemaVersion: state.schemaVersion,
      exportedAt: new Date().toISOString(),
      backupName: filename.trim(),
      folders: state.folders,
      sessions: state.sessions,
      automaticSnapshots: state.automaticSnapshots
    }, null, 2));
    const downloadId = await chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${data}`,
      filename: ensureJsonExtension(filename),
      saveAs: true,
      conflictAction: "uniquify"
    });
    if (!downloadId) throw new Error("Chrome could not start the file save dialog.");
    showControlStatus("exportStatus", "Choose where to save the backup file.");
  } catch (error) { showControlStatus("exportStatus", `Export failed: ${error.message}`, true); }
}

function ensureJsonExtension(filename) {
  const trimmed = filename.trim() || "tabvault-backup";
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

function showStatus(message, error = false) {
  const status = document.querySelector("#status");
  status.textContent = message;
  status.classList.toggle("error", error);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}
