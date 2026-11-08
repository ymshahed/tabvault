# TabVault Local

TabVault Local is a privacy-first Chrome extension for saving and restoring browser sessions. It stores tab URLs, titles, and supported metadata locally in the browser. It does not use an account, backend, cloud sync, analytics, or remote code.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project folder.
5. Pin **TabVault Local** and open it from the toolbar.

## Current MVP

- Manual local session save.
- Save the currently active tab as its own saved item.
- Automatic snapshots with a five-snapshot retention limit.
- Automatic snapshots keep only tabs that Chrome allows the extension to reopen.
- Search saved names as you type; name matches are prioritized, and tab titles, URLs, and domains are searched only when no saved name matches.
- Safe restore into new windows.
- JSON backup export and validated import.
- The main export button exports only the currently focused browser window; individual saved-item Export buttons export that saved item.
- Import works from any valid backup file, even when its records were never previously saved in this extension.
- Each selected backup file imports as one saved item using the backup filename. If the file contains several saved records, their tabs are combined into that one imported item.
- When a backup contains normal saved sessions, automatic snapshots are skipped during import so one backup does not create many confusing copies. A backup containing only automatic snapshots is combined into one imported item.
- Exported backups store the filename chosen in the export prompt, so importing a renamed copy keeps that file's own name.
- Saved and imported items are never blocked or merged because of matching names, IDs, URLs, or tab contents. The same backup can be imported multiple times.
- Backup folders with create, rename, delete, and move support.
- Choose a folder before saving; saved items appear in both that folder and the **All folders** view.
- Rename saved sessions and tabs.
- Select and delete multiple saved items at once, including all currently visible search results.
- Dedicated Settings page for automatic snapshots and folders.
- Settings include snapshot frequency/retention, default save folder, full local export, storage summary, privacy information, and guarded clear-data controls.
- The Settings page updates live when sessions or tabs are saved from the dashboard, so its counts and exports use current local data.
- Delete individual snapshots.
- Automatic snapshot toggle.
- Restricted browser URLs are stored for reference but skipped during restore.

## Product boundary

The planned Pro tier will unlock unlimited history, snapshot comparison, duplicate/stale-tab reports, scheduled backup reminders, encrypted backup files, and advanced exports. Payment and license activation are intentionally not included until the local MVP has been tested with users.
