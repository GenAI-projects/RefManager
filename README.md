# RefManager

A Chrome extension prototype for thesis writing that behaves like a lightweight Zotero/EndNote alternative.

## What this prototype currently does

- **Reference Library (local database)**
  - Add a DOI from the extension popup.
  - Fetch bibliographic metadata from Crossref.
  - Persist your library using `chrome.storage.local`.
  - View and clear all entries from the library manager page.

- **Google Docs citation token conversion**
  - On `docs.google.com/document/*`, the content script scans editable text.
  - It detects tokens like `{10.1000/xyz; 10.1038/s41586-020-2649-2}`.
  - It converts them to lightweight “citation fields” (`<span class="refmanager-citation">`) to emulate EndNote-style placeholders.

## Why this design

This provides an MVP with the 2 core workflows you asked for:
1. Build a reference library by DOI.
2. Convert inline DOI groups in Google Docs into structured citation placeholders.

## Suggested next features (high-value roadmap)

1. **Citation style engine (CSL)**: render in APA/MLA/Vancouver from the same records.
2. **Bibliography insertion**: generate and refresh the manuscript bibliography section.
3. **Word plugin parity**: editable citation dialogs (add page numbers/prefix/suffix).
4. **Cloud sync**: optional account + backup/export (BibTeX, CSL JSON, RIS).
5. **PDF metadata extraction**: drag-drop PDFs, auto-detect DOI and metadata.
6. **Duplicate resolution**: merge entries by DOI/title fingerprint.
7. **Collaboration support**: shared group libraries.
8. **Offline cache + retry queue**: resilient metadata fetching.

## Load and test in Chrome

1. Go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Open a Google Doc and type a sample token:
   - `{10.1038/s41586-020-2649-2; 10.1126/science.169.3946.635}`
5. The token should be replaced by a citation chip-like span.

## Project structure

- `extension/manifest.json` — extension configuration.
- `extension/src/background.js` — library + Crossref data service.
- `extension/src/popup.*` — quick DOI add UI.
- `extension/src/options.*` — library manager UI.
- `extension/src/content.js` — Google Docs DOI token transformer.
