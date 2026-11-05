let state;

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#folderForm").addEventListener("submit", createFolder);
  document.querySelector("#automaticToggle").addEventListener("change", toggleAutomatic);
  await load();
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
    renderFolders();
  } catch (error) { showStatus(error.message, true); }
}

async function toggleAutomatic(event) {
  try {
    await send({ type: "set-automatic-snapshots", enabled: event.target.checked });
    showStatus("Settings saved.");
  } catch (error) { event.target.checked = !event.target.checked; showStatus(error.message, true); }
}

async function createFolder(event) {
  event.preventDefault();
  try {
    const response = await send({ type: "create-folder", name: document.querySelector("#folderName").value });
    state.folders.push(response.folder);
    document.querySelector("#folderName").value = "";
    renderFolders();
    showStatus("Folder created.");
  } catch (error) { showStatus(error.message, true); }
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
    showStatus("Folder updated.");
  } catch (error) { showStatus(error.message, true); }
}

function showStatus(message, error = false) {
  const status = document.querySelector("#status");
  status.textContent = message;
  status.classList.toggle("error", error);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}
