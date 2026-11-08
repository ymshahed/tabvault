const STORAGE_KEY = "tabVaultState";
const CURRENT_SCHEMA = 2;
const MAX_AUTOMATIC_SNAPSHOTS = 5;
const SNAPSHOT_DEBOUNCE_MS = 1500;
let snapshotTimer;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureState();
  await chrome.alarms.create("tabvault-periodic-snapshot", { periodInMinutes: 30 });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureState();
  await createAutomaticSnapshot("browser-start");
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "save-session") {
    await saveCurrentSession("manual");
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tabvault-periodic-snapshot") {
    await createAutomaticSnapshot("scheduled");
  }
});

const scheduleSnapshot = (reason) => {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => createAutomaticSnapshot(reason), SNAPSHOT_DEBOUNCE_MS);
};

chrome.tabs.onCreated.addListener(() => scheduleSnapshot("tab-created"));
chrome.tabs.onRemoved.addListener(() => scheduleSnapshot("tab-removed"));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    scheduleSnapshot("tab-updated");
  }
});
chrome.windows.onCreated.addListener(() => scheduleSnapshot("window-created"));
chrome.windows.onRemoved.addListener(() => scheduleSnapshot("window-removed"));

async function ensureState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: emptyState() });
  }
}

function emptyState() {
  return {
    schemaVersion: CURRENT_SCHEMA,
    sessions: [],
    automaticSnapshots: [],
    folders: [{ id: "general", name: "General" }],
    settings: { automaticSnapshots: true }
  };
}

async function readState() {
  await ensureState();
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const migrated = migrateState(result[STORAGE_KEY]);
  await writeState(migrated);
  return migrated;
}

function migrateState(value) {
  if (!value || typeof value !== "object") return emptyState();
  const folders = Array.isArray(value.folders) && value.folders.length
    ? value.folders.filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
    : [{ id: "general", name: "General" }];
  const normalizeRecord = (record) => ({
    ...record,
    folderId: folders.some((folder) => folder.id === record.folderId) ? record.folderId : "general"
  });
  const normalizeAutomaticRecord = (record) => {
    const windows = Array.isArray(record.windows)
      ? record.windows.map((window) => ({
        ...window,
        tabs: Array.isArray(window.tabs) ? window.tabs.filter((tab) => isRestorableUrl(tab.url)) : []
      })).filter((window) => window.tabs.length > 0)
      : [];
    if (!windows.length) return null;
    const tabs = windows.flatMap((window) => window.tabs);
    return {
      ...record,
      windows,
      windowCount: windows.length,
      tabCount: tabs.length,
      domains: [...new Set(tabs.map((tab) => getDomain(tab.url)).filter(Boolean))].sort(),
      folderId: folders.some((folder) => folder.id === record.folderId) ? record.folderId : "general"
    };
  };
  return {
    schemaVersion: CURRENT_SCHEMA,
    sessions: Array.isArray(value.sessions) ? value.sessions.map(normalizeRecord) : [],
    automaticSnapshots: Array.isArray(value.automaticSnapshots)
      ? value.automaticSnapshots.map(normalizeRecord).map(normalizeAutomaticRecord).filter(Boolean)
      : [],
    folders,
    settings: {
      automaticSnapshots: value.settings?.automaticSnapshots !== false
    }
  };
}

async function writeState(state) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: { ...state, schemaVersion: CURRENT_SCHEMA }
  });
}

async function getBrowserSnapshot() {
  const windows = await chrome.windows.getAll({ populate: true });
  return windows
    .filter((window) => window.type === "normal")
    .map((window) => ({
      windowId: window.id,
      focused: Boolean(window.focused),
      state: window.state || "normal",
      tabs: (window.tabs || []).map((tab) => ({
        url: safeUrl(tab.url),
        title: typeof tab.title === "string" ? tab.title : "",
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        index: typeof tab.index === "number" ? tab.index : 0,
        discarded: Boolean(tab.discarded)
      }))
    }));
}

async function getCurrentTabSnapshot() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab) throw new Error("No active tab was found.");
  const window = await chrome.windows.get(tab.windowId);
  return [{
    windowId: window.id,
    focused: Boolean(window.focused),
    state: window.state || "normal",
    tabs: [{
      url: safeUrl(tab.url),
      title: typeof tab.title === "string" ? tab.title : "",
      pinned: Boolean(tab.pinned),
      active: true,
      index: typeof tab.index === "number" ? tab.index : 0,
      discarded: Boolean(tab.discarded)
    }]
  }];
}

async function getCurrentWindowSnapshot() {
  const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"], populate: true });
  if (!window?.id) throw new Error("No focused browser window was found.");
  return [{
    windowId: window.id,
    focused: Boolean(window.focused),
    state: window.state || "normal",
    tabs: (window.tabs || []).map((tab) => ({
      url: safeUrl(tab.url),
      title: typeof tab.title === "string" ? tab.title : "",
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
      index: typeof tab.index === "number" ? tab.index : 0,
      discarded: Boolean(tab.discarded)
    }))
  }];
}

function safeUrl(url) {
  return typeof url === "string" && url.length > 0 ? url : null;
}

function createRecord(windows, type, name, folderId = "general") {
  const tabs = windows.flatMap((window) => window.tabs);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type,
    folderId,
    name: name || `${type === "automatic" ? "Automatic snapshot" : "Saved session"} - ${formatDate(new Date())}`,
    windowCount: windows.length,
    tabCount: tabs.length,
    domains: [...new Set(tabs.map((tab) => getDomain(tab.url)).filter(Boolean))].sort(),
    windows
  };
}

function formatDate(date) {
  return date.toLocaleString();
}

function getDomain(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function saveCurrentSession(type, name, folderId = "general") {
  const state = await readState();
  const windows = await getBrowserSnapshot();
  const targetFolderId = state.folders.some((folder) => folder.id === folderId) ? folderId : "general";
  const record = createRecord(windows, type, name, targetFolderId);
  if (type === "automatic") {
    state.automaticSnapshots = [record, ...state.automaticSnapshots]
      .slice(0, MAX_AUTOMATIC_SNAPSHOTS);
  } else {
    state.sessions = [record, ...state.sessions];
  }
  await writeState(state);
  return record;
}

async function saveCurrentTab(name, folderId = "general") {
  const state = await readState();
  const targetFolderId = state.folders.some((folder) => folder.id === folderId) ? folderId : "general";
  const record = createRecord(
    await getCurrentTabSnapshot(),
    "tab",
    name || `Saved tab - ${formatDate(new Date())}`,
    targetFolderId
  );
  state.sessions = [record, ...state.sessions];
  await writeState(state);
  return record;
}

async function createAutomaticSnapshot(reason) {
  const state = await readState();
  if (state.settings.automaticSnapshots === false) return null;
  const windows = (await getBrowserSnapshot())
    .map((window) => ({
      ...window,
      tabs: window.tabs.filter((tab) => isRestorableUrl(tab.url))
    }))
    .filter((window) => window.tabs.length > 0);
  if (!windows.some((window) => window.tabs.length > 0)) return null;
  const latest = state.automaticSnapshots[0];
  const currentSignature = JSON.stringify(windows);
  if (latest && JSON.stringify(latest.windows) === currentSignature) return latest;
  return saveCurrentSession("automatic", `Automatic backup (${reason})`);
}

async function restoreRecord(record, selectedTabIds, destination = "new-window") {
  const selected = selectedTabIds ? new Set(selectedTabIds) : null;
  let skippedCount = 0;
  const windows = record.windows.map((window) => ({
    ...window,
    tabs: window.tabs.filter((tab, index) => {
      const selectedByUser = !selected || selected.has(`${record.id}:${window.windowId}:${index}`);
      if (selectedByUser && !isRestorableUrl(tab.url)) skippedCount += 1;
      return selectedByUser && isRestorableUrl(tab.url);
    })
  })).filter((window) => window.tabs.length > 0);
  if (!windows.length) {
    throw new Error("This saved item contains only browser-internal pages, which Chrome does not allow the extension to reopen.");
  }

  const createdWindows = [];
  if (destination === "current-window") {
    const currentWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (!currentWindow?.id) throw new Error("Could not find the current browser window.");
    const urls = windows.flatMap((window) => window.tabs)
      .filter((tab) => tab.url)
      .map((tab) => tab.url);
    for (const url of urls) {
      await chrome.tabs.create({ windowId: currentWindow.id, url });
    }
    return { windowIds: [currentWindow.id], skippedCount };
  }
  for (const window of windows) {
    const urls = window.tabs.filter((tab) => tab.url).map((tab) => tab.url);
    if (!urls.length) continue;
    const created = await chrome.windows.create({ url: urls });
    createdWindows.push(created.id);
    const createdTabs = created.tabs || [];
    for (let index = 0; index < Math.min(createdTabs.length, window.tabs.length); index += 1) {
      if (window.tabs[index].pinned && createdTabs[index]?.id) {
        await chrome.tabs.update(createdTabs[index].id, { pinned: true });
      }
    }
  }
  return { windowIds: createdWindows, skippedCount };
}

function isRestorableUrl(url) {
  if (!url) return false;
  try {
    return ["http:", "https:", "file:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "get-state") {
      sendResponse({ ok: true, state: await readState() });
    } else if (message.type === "save-session") {
      sendResponse({ ok: true, record: await saveCurrentSession("manual", message.name, message.folderId) });
    } else if (message.type === "save-tab") {
      sendResponse({ ok: true, record: await saveCurrentTab(message.name, message.folderId) });
    } else if (message.type === "capture-current-window") {
      const windows = await getCurrentWindowSnapshot();
      sendResponse({ ok: true, record: createRecord(windows, "manual", `Current window - ${formatDate(new Date())}`, "general") });
    } else if (message.type === "restore-session") {
      sendResponse({
        ok: true,
        ...(await restoreRecord(message.record, message.selectedTabIds, message.destination))
      });
    } else if (message.type === "set-automatic-snapshots") {
      const state = await readState();
      state.settings.automaticSnapshots = Boolean(message.enabled);
      await writeState(state);
      sendResponse({ ok: true });
    } else if (message.type === "replace-state") {
      const migrated = migrateState(message.state);
      await writeState(migrated);
      sendResponse({ ok: true, state: migrated });
    } else if (message.type === "create-folder") {
      const state = await readState();
      const name = String(message.name || "").trim();
      if (!name) throw new Error("Folder name cannot be empty.");
      if (state.folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("A folder with that name already exists.");
      }
      const folder = { id: crypto.randomUUID(), name };
      state.folders.push(folder);
      await writeState(state);
      sendResponse({ ok: true, folder });
    } else if (message.type === "rename-folder") {
      const state = await readState();
      const folder = state.folders.find((item) => item.id === message.id);
      const name = String(message.name || "").trim();
      if (!folder || folder.id === "general") throw new Error("The General folder cannot be renamed.");
      if (!name) throw new Error("Folder name cannot be empty.");
      folder.name = name;
      await writeState(state);
      sendResponse({ ok: true, state });
    } else if (message.type === "delete-folder") {
      const state = await readState();
      if (message.id === "general") throw new Error("The General folder cannot be deleted.");
      state.folders = state.folders.filter((folder) => folder.id !== message.id);
      for (const record of [...state.sessions, ...state.automaticSnapshots]) {
        if (record.folderId === message.id) record.folderId = "general";
      }
      await writeState(state);
      sendResponse({ ok: true, state });
    } else if (message.type === "move-record") {
      const state = await readState();
      if (!state.folders.some((folder) => folder.id === message.folderId)) throw new Error("Folder not found.");
      for (const record of [...state.sessions, ...state.automaticSnapshots]) {
        if (record.id === message.recordId) record.folderId = message.folderId;
      }
      await writeState(state);
      sendResponse({ ok: true, state });
    } else if (message.type === "rename-record") {
      const state = await readState();
      const name = String(message.name || "").trim();
      if (!name) throw new Error("Session name cannot be empty.");
      const record = [...state.sessions, ...state.automaticSnapshots].find((item) => item.id === message.recordId);
      if (!record) throw new Error("Session not found.");
      record.name = name;
      await writeState(state);
      sendResponse({ ok: true, state });
    } else {
      sendResponse({ ok: false, error: "Unknown message." });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
