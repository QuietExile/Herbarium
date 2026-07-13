PRAIRIE HERBARIUM v3.0 — CLEAN REWRITE

This version was rebuilt from scratch rather than patched from the previous files.

Included:
- IndexedDB local record storage
- Compatible JSON restore for older v2 backups
- JSON backup and CSV export
- GPS capture and collection-location map
- Google Maps and OpenStreetMap links
- Season and multi-select weather fields
- Press date/time with automatic 24-hour paper-change time
- Direct Google Calendar reminder link
- Lifecycle observations with separate photographs
- Add existing photos and take new photos on Android
- Drag-and-drop and clipboard paste on PC
- Photo reordering and primary-image selection
- Full-screen photo viewer
- List, sortable table, and Kanban record views
- Selectable table columns
- Printable three-column field sheets
- Visible app version

INSTALLATION
1. Back up the existing GitHub repository folder.
2. Replace the repository root files with the six files in this ZIP.
3. Commit and push through GitHub Desktop.
4. Open GitHub Pages in an incognito window first and confirm the header shows:
   3.0.0-clean-rewrite
5. Restore your existing JSON backup from the Records tab.
6. After confirming the records and photos, clear old site data on the phone and reload.

IMPORTANT
This clean rewrite uses a new IndexedDB database name, so it starts empty by design.
Your previous records must be restored from JSON once.


VERSION 3.1 DRIVE-FRIENDLY MANUAL SYNC
- Uses one fixed file name: PrairieHerbarium_Master.json.
- On Android, export opens the system share menu so the file can be sent directly to Google Drive.
- On desktop browsers, export downloads the fixed-name master file.
- Import merges by record ID and only replaces a local record when the imported copy is newer.
- Displays current record count, last export, last import, and an import summary.


VERSION 3.1.1 SHARE FALLBACK
- Added separate Share master file and Download master file buttons.
- Uses a broadly compatible text MIME type while retaining the .json filename.
- If browser sharing is denied, the app automatically downloads the master file instead of losing the export.
