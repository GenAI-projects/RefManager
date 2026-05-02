# RefManager

Google-first reference manager extension prototype for thesis workflows.

## Implemented now
- DOI + PMID capture and metadata ingestion (Crossref + PubMed).
- Local reference library manager with duplicate merge.
- Citation style preview engine (APA/MLA/Vancouver).
- Google Docs token conversion via popup command or in-doc button:
  - `{10.xxxx/...; 10.xxxx/...}`
  - `{PMID:12345; PMID:67890}`

## Google Docs behavior and export reality
- Google Docs does **not** expose true citation-field APIs to Chrome extensions.
- RefManager inserts non-editable citation spans in the live editing surface.
- When exporting to `.docx`/`.pdf`, Google Docs may flatten these to plain text (expected); structured metadata is not guaranteed.

## Local test steps
1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked -> choose `extension/`
4. In Google Docs, type tokens and click **Convert tokens in current Google Doc** from extension popup.

## Next architecture for Google ecosystem excellence
- Drive-backed library sync (shared JSON/CSL/Bib/RIS + conflict resolution)
- Team shared libraries with permissions
- PDF DOI extraction pipeline with Drive ingestion hooks
