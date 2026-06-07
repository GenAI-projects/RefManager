# RefManager

RefManager is a Chrome extension for turning DOI/PMID tokens in Google Docs into numbered in-document citations and a generated reference list.

## Current behavior

- Imports DOI metadata from Crossref and PMID metadata from NCBI PubMed.
- Stores the user's library in their own Google Drive `appDataFolder` as `refmanager-library.json`.
- Converts valid Google Docs tokens into bracketed superscript citations.
- Adds or rebuilds a `References (RefManager)` section at the bottom of the Doc.
- Links each converted citation to the first matching generated reference paragraph. For example, `[1-4]` targets reference `1`, while the generated reference entries for `1`, `2`, `3`, and `4` are included/highlighted in the reference section.
- Re-running conversion after adding new tokens preserves existing bracketed citation displays and adds the new references to the generated section.

Google Docs does not expose a true citation-field API to Chrome extensions, so exported `.docx`/`.pdf` files may flatten RefManager citations into styled text.

## Supported token syntax

Use one style per token block:

```text
{DOI: 10.xxxx/one}
{DOI: 10.xxxx/one; DOI: 10.xxxx/two}
{https://doi.org/10.xxxx/one; https://doi.org/10.xxxx/two}
{PMID: 12345; PMID: 67890}
```

Do not mix DOI and PMID, or DOI-prefix and DOI-URL styles, inside the same block.

## Local development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose `extension/`.
4. Open the RefManager setup page.
5. Add a Google OAuth client ID for local testing if the build does not include a packaged OAuth client.
6. Open a Google Doc, add valid tokens, then use the extension popup to link the Doc and click **Convert Tokens**.

For unpacked builds, `chrome.identity.getRedirectURL()` depends on the local extension ID. If the extension ID changes, update the redirect URI in the local OAuth client.

## Production OAuth model

For Chrome Web Store release, use one RefManager-owned OAuth client instead of asking every user to paste their own client ID.

Recommended setup:

1. Create a production Google Cloud project for RefManager.
2. Enable the Google Drive API and Google Docs API.
3. Configure the OAuth consent screen with the RefManager name, logo, support email, homepage, and privacy policy.
4. Create an OAuth client for the Chrome extension / web auth flow and add the extension redirect URI shown by the setup page.
5. Add the production client ID to the extension manifest `oauth2.client_id` for release builds.
6. Keep the setup-page client ID field only as an advanced local override for development or enterprise forks.
7. Submit the OAuth app for verification if Google requires review for the requested scopes.

Required scopes today:

- `https://www.googleapis.com/auth/drive.appdata` — private library storage.
- `https://www.googleapis.com/auth/drive.file` — file access/permission checks for Docs the user authorizes.
- `https://www.googleapis.com/auth/drive.metadata.readonly` — linked Doc metadata checks.
- `https://www.googleapis.com/auth/documents` — read/update token text and generated references.
- `https://www.googleapis.com/auth/userinfo.email` — display/check the signed-in account.

## Cost, quota, and limits

- Users sign in with their own Google accounts. Their Docs, Drive files, tokens, and libraries remain under their own Google account, not yours.
- The RefManager Google Cloud project owns API quota/accountability for Drive and Docs requests made through the packaged OAuth client.
- Google API usage is normally quota-limited by project/API. Monitor usage in Google Cloud Console under **APIs & Services** and **Quotas & System Limits**.
- If many users convert large Docs frequently, you may hit per-minute or per-day API quotas. Request quota increases from Google Cloud if needed.
- Drive/Docs API calls used here are usually free within Google Cloud's normal API quota model, but you should still monitor billing/quota pages before public launch.
- Crossref and NCBI are external free metadata services with their own fair-use/rate-limit expectations; add caching and polite request headers before scaling widely.
- Chrome Web Store publishing requires a developer account and a one-time registration fee according to the Chrome Web Store registration docs.

Official docs to keep handy:

- Chrome Web Store publishing: https://developer.chrome.com/docs/webstore/publish
- Chrome Web Store developer registration: https://developer.chrome.com/docs/webstore/register
- Chrome Identity API: https://developer.chrome.com/docs/extensions/reference/api/identity
- Google Cloud quota management: https://docs.cloud.google.com/docs/quotas/view-manage
- Google OAuth verification: https://developers.google.com/identity/protocols/oauth2/production-readiness

## Chrome Web Store publishing checklist

1. Finalize the extension name, description, icons, screenshots, and privacy policy.
2. Remove development-only wording from the public UI.
3. Package only the `extension/` directory as a zip.
4. Register/sign in to the Chrome Web Store Developer Dashboard.
5. Upload the zip as a new item.
6. Complete Store Listing, Privacy, Distribution, and Test Instructions.
7. Explain the single purpose clearly: converting DOI/PMID tokens into Google Docs citations/references.
8. Declare Google Docs/Drive data usage accurately.
9. Include test instructions for reviewers: login, link a Doc, convert sample tokens, inspect generated references.
10. Submit for review, preferably with deferred publishing enabled until OAuth verification and store review both pass.

## UI direction

A cleaner production UI should separate daily use from setup:

- **Popup:** show only linked Doc status, **Convert Tokens**, last conversion result, and a small **Library** link.
- **Setup page:** show sign-in status, permission check, privacy link, and an **Advanced** section for OAuth override. Hide saved OAuth client IDs by default.
- **Options/library page:** show references, citation style, sync status, duplicate merge, and export/import actions.
- **Conversion result:** report imported count, failed DOI/PMID lookups, citations converted, and whether citations were linked to reference paragraphs.
- **Errors:** translate OAuth/Docs API errors into actionable messages such as “wrong Google account,” “Doc not shared,” or “OAuth redirect URI mismatch.”
