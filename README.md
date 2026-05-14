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

## Google OAuth setup (redirect_uri_mismatch fix)
When you click **Login to Google**, the extension uses `chrome.identity.launchWebAuthFlow` with this runtime redirect URI:

`chrome.identity.getRedirectURL()`

For unpacked installs this is tied to the current extension ID. To avoid `Error 400: redirect_uri_mismatch`:

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. In that client, add the exact redirect URI shown on the extension setup screen.
3. Paste that client ID into RefManager setup and click **Save Client ID**.
4. If the extension ID changes (different Chrome profile/machine, or reloaded without a stable key), the redirect URI changes too—update the OAuth client accordingly.

## How auth and Drive access currently work
- Login is user-consent based and stores a short-lived Google access token locally in the extension storage.
- Sync writes to the signed-in user's Google Drive `appDataFolder` (private app data area) and can create temporary test files for permission checks.
- API quotas and Drive limits are charged to the Google Cloud project tied to the OAuth client ID, while the file operations run against each signed-in user's own Drive account.

## Server model clarification
Current code is browser-only (no backend server required for normal usage):
- DOI/PMID metadata fetch: directly from the extension to Crossref and NCBI.
- Google Drive sync: directly from the extension to Google APIs with the user's token.

If you later add a server, use it for optional features (e.g., team indexing, analytics, conflict orchestration), but avoid sending raw Google access tokens to your own backend unless you redesign auth for a secure server-side OAuth flow.
