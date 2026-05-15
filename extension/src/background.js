const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;
const PMID_PATTERN = /^\d{1,10}$/;

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/documents"
];

async function tokenHasRequiredScopes(token) {
  try {
    const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return false;
    const payload = await res.json();
    const granted = new Set(String(payload.scope || "").split(/\s+/).filter(Boolean));
    return REQUIRED_SCOPES.every((scope) => granted.has(scope));
  } catch (_error) {
    return false;
  }
}

async function getLibrary() {
  const { library = [], citationStyle = "apa", librariesByDoc = {}, activeDocKey = null } = await chrome.storage.local.get(["library", "citationStyle", "librariesByDoc", "activeDocKey"]);
  return { library, citationStyle, librariesByDoc, activeDocKey };
}

async function saveLibrary(library) {
  await chrome.storage.local.set({ library });
}

async function saveLibraryForDoc(docKey, docName, library, librariesByDoc) {
  const updated = { ...(librariesByDoc || {}) };
  updated[docKey] = { docName, library, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ library, librariesByDoc: updated, activeDocKey: docKey });
}

function normalizeIdentifier(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function formatCitationField(indices) {
  if (!indices.length) return "";
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (sorted.length > 3) return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  return sorted.join(",");
}

async function upsertIdentifier(mode, rawValue, currentLibrary) {
  const raw = normalizeIdentifier(rawValue);
  if (!raw) return { record: null, library: currentLibrary, imported: false };
  if (mode === "doi") {
    if (!DOI_PATTERN.test(raw)) throw new Error(`Invalid DOI format: ${raw}`);
    const existing = currentLibrary.find((x) => x.doi?.toLowerCase() === raw.toLowerCase());
    if (existing) return { record: existing, library: currentLibrary, imported: false };
    const record = await fetchReferenceByDoi(raw);
    return { record, library: [...currentLibrary, record], imported: true };
  }
  if (!PMID_PATTERN.test(raw)) throw new Error(`Invalid PMID format: ${raw}`);
  const existing = currentLibrary.find((x) => x.pmid === raw);
  if (existing) return { record: existing, library: currentLibrary, imported: false };
  const record = await fetchReferenceByPmid(raw);
  return { record, library: [...currentLibrary, record], imported: true };
}

function fingerprint(record) {
  return `${(record.title || "").toLowerCase().replace(/\W+/g, " ").trim()}|${record.year || ""}`;
}

async function fetchReferenceByDoi(doi) {
  const normalized = doi.trim();
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`);
  if (!response.ok) throw new Error(`Crossref lookup failed: ${response.status}`);
  const work = (await response.json())?.message;
  return {
    sourceType: "doi",
    doi: normalized,
    pmid: "",
    title: work?.title?.[0] ?? "Untitled",
    authors: (work?.author ?? []).map((a) => [a.family, a.given].filter(Boolean).join(", ")).join("; "),
    year: work?.published?.["date-parts"]?.[0]?.[0] ?? "n.d.",
    journal: work?.["container-title"]?.[0] ?? "",
    url: work?.URL ?? `https://doi.org/${normalized}`,
    addedAt: new Date().toISOString()
  };
}

async function fetchReferenceByPmid(pmid) {
  const normalized = pmid.trim();
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(normalized)}&retmode=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PubMed lookup failed: ${response.status}`);
  const payload = await response.json();
  const work = payload?.result?.[normalized];
  if (!work) throw new Error("PubMed record not found.");

  return {
    sourceType: "pmid",
    doi: work?.articleids?.find((x) => x.idtype === "doi")?.value ?? "",
    pmid: normalized,
    title: work?.title ?? "Untitled",
    authors: (work?.authors ?? []).map((a) => a.name).join("; "),
    year: (work?.pubdate || "").slice(0, 4) || "n.d.",
    journal: work?.fulljournalname ?? "",
    url: `https://pubmed.ncbi.nlm.nih.gov/${normalized}/`,
    addedAt: new Date().toISOString()
  };
}



function mergeLibraries(localLibrary, sharedLibrary) {
  const map = new Map();
  for (const item of [...sharedLibrary, ...localLibrary]) {
    const key = item.doi?.toLowerCase() || item.pmid || fingerprint(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    const existingDate = new Date(existing.addedAt || 0).getTime();
    const incomingDate = new Date(item.addedAt || 0).getTime();
    if (incomingDate >= existingDate) map.set(key, { ...existing, ...item });
  }
  return [...map.values()];
}

function formatCitation(record, style) {
  const authors = record.authors || "Unknown";
  if (style === "mla") return `${authors}. \"${record.title}.\" ${record.journal}, ${record.year}.`;
  if (style === "vancouver") return `${authors}. ${record.title}. ${record.journal}. ${record.year}.`;
  return `${authors} (${record.year}). ${record.title}. ${record.journal}.`;
}

function extractTokenGroupsFromText(text = "") {
  const groups = [];
  const doiPattern = /\{([^{}]*10\.\d{4,9}\/[\-._;()/:A-Z0-9]+[^{}]*)\}/gi;
  const pmidPattern = /\{([^{}]*PMID:\s*\d+[^{}]*)\}/gi;
  let match;
  while ((match = doiPattern.exec(text)) !== null) {
    groups.push({ label: "DOI", ids: match[1].split(";").map((x) => x.trim()).filter((x) => x && x.includes("/")), rawToken: match[0] });
  }
  while ((match = pmidPattern.exec(text)) !== null) {
    groups.push({ label: "PMID", ids: match[1].split(";").map((x) => x.replace(/PMID:\s*/gi, "").trim()).filter(Boolean), rawToken: match[0] });
  }
  return groups;
}

async function loadDocPlainText(docId, token) {
  const doc = await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}`, token);
  const pieces = [];
  for (const item of (doc?.body?.content || [])) {
    const elements = item?.paragraph?.elements || [];
    for (const el of elements) {
      if (el?.textRun?.content) pieces.push(el.textRun.content);
    }
  }
  return pieces.join("");
}

async function getAuthToken(interactive = false) {
  const { oauthAccessToken, oauthTokenExpiresAt = 0, oauthClientId = "" } = await chrome.storage.local.get(["oauthAccessToken", "oauthTokenExpiresAt", "oauthClientId"]);
  if (oauthAccessToken && Date.now() < oauthTokenExpiresAt - 60_000 && await tokenHasRequiredScopes(oauthAccessToken)) return oauthAccessToken;
  if (!interactive) throw new Error("Authentication required.");
  if (!oauthClientId) throw new Error("Google OAuth Client ID is not configured. Set it on the landing page.");

  const redirectUri = chrome.identity.getRedirectURL();
  const scopes = REQUIRED_SCOPES.join(" ");
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(oauthClientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&include_granted_scopes=true&prompt=consent`;
  const finalUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError || !url) {
        const launchError = chrome.runtime.lastError?.message || "OAuth flow failed.";
        reject(new Error(`${launchError} Expected redirect URI: ${redirectUri}. OAuth client ID: ${oauthClientId}`));
        return;
      }
      resolve(url);
    });
  });
  const hash = new URL(finalUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") || "3600");
  if (!token) throw new Error("OAuth token missing from response.");
  const tokenExpiresAt = Date.now() + expiresIn * 1000;
  await chrome.storage.local.set({ oauthAccessToken: token, oauthTokenExpiresAt: tokenExpiresAt });
  return token;
}

async function googleApi(path, token, method = "GET", body, headers = {}) {
  const response = await fetch(`https://www.googleapis.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    let details = "";
    try {
      const err = await response.json();
      details = err?.error?.message ? ` - ${err.error.message}` : "";
    } catch (_error) {}
    throw new Error(`Google API ${method} ${path} failed: ${response.status}${details}`);
  }
  if (response.status === 204) return {};
  return response.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const { library, citationStyle, librariesByDoc } = await getLibrary();

    if (message?.type === "addIdentifier") {
      const raw = (message.value ?? "").trim();
      const mode = (message.mode ?? "doi").toLowerCase();
      try {
        let record;
        if (mode === "doi") {
          if (!DOI_PATTERN.test(raw)) throw new Error("Invalid DOI format.");
          if (library.some((x) => x.doi?.toLowerCase() === raw.toLowerCase())) throw new Error("DOI already exists.");
          record = await fetchReferenceByDoi(raw);
        } else {
          if (!PMID_PATTERN.test(raw)) throw new Error("Invalid PMID format.");
          if (library.some((x) => x.pmid === raw)) throw new Error("PMID already exists.");
          record = await fetchReferenceByPmid(raw);
        }
        await saveLibrary([...library, record]);
        sendResponse({ ok: true, record });
      } catch (error) {
        sendResponse({ ok: false, error: `${error.message}. If this is 403, re-login with consent and ensure Drive API is enabled for this OAuth project.` });
      }
      return;
    }

    if (message?.type === "listLibrary") {
      sendResponse({ ok: true, library, citationStyle });
      return;
    }

    if (message?.type === "setCitationStyle") {
      await chrome.storage.local.set({ citationStyle: message.style || "apa" });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "citationPreview") {
      sendResponse({ ok: true, citations: library.map((r) => formatCitation(r, citationStyle)) });
      return;
    }


    if (message?.type === "syncLibraryPush") {
      const token = await getAuthToken(true);
      const payload = {
        updatedAt: new Date().toISOString(),
        library,
        csl: JSON.stringify(library),
        bib: library.map((r, i) => `@article{ref${i + 1}, title={${r.title || ""}}, author={${r.authors || ""}}, year={${r.year || ""}}, doi={${r.doi || ""}}}`).join("\n\n"),
        ris: library.map((r) => `TY  - JOUR\nTI  - ${r.title || ""}\nAU  - ${r.authors || ""}\nPY  - ${r.year || ""}\nDO  - ${r.doi || ""}\nER  -`).join("\n\n")
      };
      await chrome.storage.sync.set({ sharedLibraryPayload: payload });
      const list = await googleApi("/drive/v3/files?q=name='refmanager-shared-library.json' and trashed=false and 'appDataFolder' in parents&spaces=appDataFolder&fields=files(id,name)", token);
      const existingId = list?.files?.[0]?.id;
      if (existingId) {
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        const created = await googleApi("/drive/v3/files", token, "POST", { name: "refmanager-shared-library.json", parents: ["appDataFolder"] });
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      sendResponse({ ok: true, count: library.length });
      return;
    }

    if (message?.type === "syncLibraryPull") {
      const token = await getAuthToken(true);
      const list = await googleApi("/drive/v3/files?q=name='refmanager-shared-library.json' and trashed=false and 'appDataFolder' in parents&spaces=appDataFolder&fields=files(id,name)", token);
      if (list?.files?.[0]?.id) {
        const drivePayload = await fetch(`https://www.googleapis.com/drive/v3/files/${list.files[0].id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
        if (drivePayload.ok) {
          const json = await drivePayload.json();
          await chrome.storage.sync.set({ sharedLibraryPayload: json });
        }
      }
      const { sharedLibraryPayload } = await chrome.storage.sync.get(["sharedLibraryPayload"]);
      const shared = sharedLibraryPayload?.library || [];
      const merged = mergeLibraries(library, shared);
      await saveLibrary(merged);
      sendResponse({ ok: true, count: merged.length, resolved: library.length + shared.length - merged.length });
      return;
    }

    if (message?.type === "googleLogin") {
      try {
        const token = await getAuthToken(true);
        const profile = await googleApi("/oauth2/v2/userinfo", token);
        sendResponse({ ok: true, email: profile?.email, scopes: ["drive.appdata", "drive.file", "drive.metadata.readonly", "userinfo.email"] });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "drivePermissionCheck") {
      try {
        const token = await getAuthToken(true);
        const profile = await googleApi("/oauth2/v2/userinfo", token);
        const created = await googleApi("/drive/v3/files", token, "POST", { name: `refmanager-permission-check-${Date.now()}.json`, parents: ["appDataFolder"] });
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ping: "ok" }) });
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ping: "edited" }) });
        await fetch(`https://www.googleapis.com/drive/v3/files/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
        sendResponse({ ok: true, email: profile?.email, profileRead: true, writeCheck: true, editCheck: true, deleteCheck: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "linkCurrentDoc") {
      const docId = (message.docId || '').trim();
      if (!docId) {
        sendResponse({ ok: false, error: 'Missing Google Doc ID.' });
        return;
      }
      let docName = (message.docName || 'Google Doc').replace(/\s+-\s+Google Docs\s*$/i, '').trim();
      if (!docName || /^Manual Doc\b/i.test(docName)) {
        try {
          const token = await getAuthToken(false);
          const fileMeta = await googleApi(`/drive/v3/files/${encodeURIComponent(docId)}?fields=id,name,mimeType`, token);
          if (fileMeta?.name) docName = fileMeta.name;
        } catch (_error) {
          // best effort; keep provided name when metadata lookup is unavailable
        }
      }
      const updated = { ...(librariesByDoc || {}) };
      updated[docId] = { docName, library: updated[docId]?.library || library, updatedAt: new Date().toISOString(), url: message.url || '' };
      await chrome.storage.local.set({ librariesByDoc: updated, activeDocKey: docId });
      sendResponse({ ok: true, docId, docName });
      return;
    }

    if (message?.type === "applyDocCitationsAndReferences") {
      try {
        const docId = (message.docId || "").trim();
        if (!docId) throw new Error("Missing docId for Docs update.");
        const token = await getAuthToken(true);
        const tokenReplacements = Array.isArray(message.tokenReplacements) ? message.tokenReplacements : [];
        const replaceRequests = tokenReplacements.map((r) => ({
          replaceAllText: {
            containsText: { text: r.rawToken, matchCase: true },
            replaceText: `[${r.display}]`
          }
        }));
        const scoped = (librariesByDoc?.[docId]?.library || library);
        const references = scoped.map((rec, i) => `${i + 1}. ${formatCitation(rec, citationStyle)}`).join("\n");
        const marker = "References (RefManager)";
        const docMeta = await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}`, token);
        const endIndex = docMeta?.body?.content?.[docMeta.body.content.length - 1]?.endIndex || 1;
        const insertText = `

${marker}
${references}
`;
        const requests = [...replaceRequests, { insertText: { location: { index: Math.max(1, endIndex - 1) }, text: insertText } }];
        await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, token, "POST", { requests });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "mergeDuplicates") {
      const seen = new Map();
      const merged = [];
      for (const item of library) {
        const key = item.doi?.toLowerCase() || item.pmid || fingerprint(item);
        if (!seen.has(key)) {
          seen.set(key, item);
          merged.push(item);
        }
      }
      await saveLibrary(merged);
      sendResponse({ ok: true, removed: library.length - merged.length });
      return;
    }
    if (message?.type === "ingestTokensAndBuildCitations") {
      const docKey = message.docId || "default-doc";
      const docName = message.docName || "Untitled Doc";
      const scopedLibrary = librariesByDoc?.[docKey]?.library || library;
      let workingLibrary = [...scopedLibrary];
      let imported = 0;
      const failed = [];
      const replacements = [];

      let incomingGroups = Array.isArray(message.groups) ? message.groups : [];
      let fallbackError = "";
      if (!incomingGroups.length && message.docId) {
        try {
          const token = await getAuthToken(true);
          const docText = await loadDocPlainText(message.docId, token);
          incomingGroups = extractTokenGroupsFromText(docText);
        } catch (error) {
          fallbackError = error?.message || "Docs API fallback failed.";
          incomingGroups = [];
        }
      }

      for (const group of incomingGroups) {
        const mode = (group.label || "").toLowerCase() === "pmid" ? "pmid" : "doi";
        const ids = (group.ids || []).map((x) => normalizeIdentifier(mode === "pmid" ? String(x).replace(/^PMID:/i, "") : x)).filter(Boolean);
        const citationIndexes = [];

        for (const id of ids) {
          try {
            const result = await upsertIdentifier(mode, id, workingLibrary);
            workingLibrary = result.library;
            if (result.imported) imported += 1;
            if (result.record) citationIndexes.push(workingLibrary.indexOf(result.record) + 1);
          } catch (error) {
            failed.push({ id, error: error.message });
          }
        }

        const key = `${mode === "pmid" ? "PMID" : "DOI"}|${ids.join(";")}`;
        replacements.push({ key, display: formatCitationField(citationIndexes), rawToken: group.rawToken || "" });
      }

      await saveLibraryForDoc(docKey, docName, workingLibrary, librariesByDoc);
      sendResponse({ ok: true, replacements, imported, failed, docKey, docName, foundGroups: incomingGroups.length, fallbackError });
      return;
    }

  })();

  return true;
});
