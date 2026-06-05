const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const PMID_PATTERN = /^\d{1,10}$/;
const DOI_URL_PREFIX_PATTERN = /^https?:\/\/(?:dx\.)?doi\.org\//i;
const DRIVE_LIBRARY_FILENAME = "refmanager-library.json";
const LEGACY_SHARED_LIBRARY_FILENAME = "refmanager-shared-library.json";
const REFERENCES_MARKER = "References (RefManager)";

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

function createEmptyLibraryState() {
  return { library: [], citationStyle: "apa", librariesByDoc: {}, activeDocKey: null, updatedAt: new Date().toISOString() };
}

async function getCachedLibraryState() {
  const { library = [], citationStyle = "apa", librariesByDoc = {}, activeDocKey = null, driveLibraryCache = null } = await chrome.storage.local.get(["library", "citationStyle", "librariesByDoc", "activeDocKey", "driveLibraryCache"]);
  if (driveLibraryCache) return normalizeLibraryState(driveLibraryCache);
  return normalizeLibraryState({ library, citationStyle, librariesByDoc, activeDocKey });
}

function normalizeLibraryState(payload = {}) {
  return {
    ...createEmptyLibraryState(),
    ...payload,
    library: Array.isArray(payload.library) ? payload.library : [],
    citationStyle: payload.citationStyle || "apa",
    librariesByDoc: payload.librariesByDoc && typeof payload.librariesByDoc === "object" ? payload.librariesByDoc : {},
    activeDocKey: payload.activeDocKey || null,
    updatedAt: payload.updatedAt || new Date().toISOString()
  };
}

async function cacheLibraryState(state) {
  const normalized = normalizeLibraryState(state);
  await chrome.storage.local.set({
    driveLibraryCache: normalized,
    library: normalized.library,
    citationStyle: normalized.citationStyle,
    librariesByDoc: normalized.librariesByDoc,
    activeDocKey: normalized.activeDocKey
  });
  return normalized;
}

async function findDriveAppDataFile(token, name) {
  const escapedName = String(name).replace(/'/g, "\\'");
  const query = `name='${escapedName}' and trashed=false and 'appDataFolder' in parents`;
  const list = await googleApi(`/drive/v3/files?q=${encodeURIComponent(query)}&spaces=appDataFolder&fields=files(id,name,modifiedTime)`, token);
  return list?.files?.[0] || null;
}

async function uploadDriveJson(token, fileId, payload) {
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let details = "";
    try {
      const err = await response.json();
      details = err?.error?.message ? ` - ${err.error.message}` : "";
    } catch (_error) {}
    throw new Error(`Google API PATCH /upload/drive/v3/files/${fileId} failed: ${response.status}${details}`);
  }
  return response.status === 204 ? {} : response.json().catch(() => ({}));
}

async function readDriveLibraryState(token) {
  const file = await findDriveAppDataFile(token, DRIVE_LIBRARY_FILENAME);
  if (!file) return null;
  const payload = await googleApi(`/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, token);
  return normalizeLibraryState(payload);
}

async function writeDriveLibraryState(token, state) {
  const normalized = normalizeLibraryState({ ...state, updatedAt: new Date().toISOString() });
  let file = await findDriveAppDataFile(token, DRIVE_LIBRARY_FILENAME);
  if (!file) {
    file = await googleApi("/drive/v3/files", token, "POST", { name: DRIVE_LIBRARY_FILENAME, parents: ["appDataFolder"], mimeType: "application/json" });
  }
  await uploadDriveJson(token, file.id, normalized);
  await cacheLibraryState(normalized);
  return normalized;
}

async function loadLibraryState({ interactive = false } = {}) {
  try {
    const token = await getAuthToken(interactive);
    const driveState = await readDriveLibraryState(token);
    if (driveState) return cacheLibraryState(driveState);

    const cached = await getCachedLibraryState();
    const hasLegacyData = cached.library.length || Object.keys(cached.librariesByDoc || {}).length;
    const initialized = hasLegacyData ? cached : createEmptyLibraryState();
    return writeDriveLibraryState(token, initialized);
  } catch (error) {
    if (interactive) throw error;
    return getCachedLibraryState();
  }
}

async function saveLibraryState(state) {
  const token = await getAuthToken(true);
  return writeDriveLibraryState(token, state);
}

function normalizeIdentifier(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function normalizeDoiCandidate(value) {
  const raw = normalizeIdentifier(value);
  if (!raw) return "";
  return raw.replace(DOI_URL_PREFIX_PATTERN, "");
}

function normalizeTokenValue(label, value) {
  return label === "PMID" ? normalizeIdentifier(String(value).replace(/^PMID:\s*/i, "")) : normalizeDoiCandidate(value);
}

function formatCitationField(indices) {
  if (!indices.length) return "";
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (sorted.length > 3) return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  return sorted.join(",");
}

function paperUrl(record, fallbackId = "") {
  if (record?.url) return record.url;
  if (record?.doi) return `https://doi.org/${record.doi}`;
  if (record?.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`;
  return fallbackId && DOI_PATTERN.test(fallbackId) ? `https://doi.org/${fallbackId}` : "";
}

function createCitationTooltip(records) {
  return records.map((record, idx) => `${idx + 1}. ${record.title || record.doi || record.pmid || "Reference"} ${paperUrl(record)}`).join("\n");
}

async function upsertIdentifier(mode, rawValue, currentLibrary) {
  const raw = mode === "doi" ? normalizeDoiCandidate(rawValue) : normalizeIdentifier(rawValue);
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

function parseAllowedTokenGroup(rawToken) {
  const token = String(rawToken || "").trim();
  const inner = token.match(/^\{\s*([^{}]+?)\s*\}$/)?.[1];
  if (!inner) return null;
  const parts = inner.split(";").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;

  const parsed = parts.map((part) => {
    const doiMatch = part.match(/^DOI\s*:\s*(10\.\d{4,9}\/\S+)$/i);
    if (doiMatch) return { style: "DOI", id: normalizeDoiCandidate(doiMatch[1]) };
    const doiUrlMatch = part.match(/^(https?:\/\/(?:dx\.)?doi\.org\/10\.\d{4,9}\/\S+)$/i);
    if (doiUrlMatch) return { style: "DOI_URL", id: normalizeDoiCandidate(doiUrlMatch[1]) };
    const pmidMatch = part.match(/^PMID\s*:\s*(\d{1,10})$/i);
    if (pmidMatch) return { style: "PMID", id: normalizeIdentifier(pmidMatch[1]) };
    return null;
  });

  if (parsed.some((x) => !x)) return null;
  const styles = new Set(parsed.map((x) => x.style));
  if (styles.size !== 1) return null;
  const style = parsed[0].style;
  const label = style === "PMID" ? "PMID" : "DOI";
  const ids = parsed.map((x) => x.id).filter((id) => label === "PMID" ? PMID_PATTERN.test(id) : DOI_PATTERN.test(id));
  if (ids.length !== parsed.length) return null;
  return { label, tokenStyle: style, ids, rawToken: token };
}

function extractTokenGroupsFromText(text = "") {
  const groups = [];
  const tokenPattern = /\{[^{}]+\}/g;
  let match;
  while ((match = tokenPattern.exec(text)) !== null) {
    const parsed = parseAllowedTokenGroup(match[0]);
    if (parsed) groups.push(parsed);
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

function parseDocIdFromUrl(url = "") {
  const match = String(url).match(/\/document\/(?:u\/\d+\/)?d\/([^/?#]+)/);
  return match?.[1] || "";
}

async function ingestAndBuildForDoc({ docId, docName, libraryState }) {
  const docKey = docId || "default-doc";
  const scopedLibrary = libraryState.librariesByDoc?.[docKey]?.library || libraryState.library;
  let workingLibrary = [...scopedLibrary];
  let imported = 0;
  const failed = [];
  const replacements = [];

  const token = await getAuthToken(true);
  const docText = await loadDocPlainText(docId, token);
  const incomingGroups = extractTokenGroupsFromText(docText);

  for (const group of incomingGroups) {
    const processed = await buildReplacementForGroup(group, workingLibrary);
    workingLibrary = processed.library;
    imported += processed.imported;
    failed.push(...processed.failed);
    replacements.push(processed.replacement);
  }

  const updatedState = saveLibraryForDocState(libraryState, docKey, docName || "Google Doc", workingLibrary);
  await saveLibraryState(updatedState);
  return { replacements, imported, failed, foundGroups: incomingGroups.length, docKey, workingLibrary, libraryState: updatedState };
}

function saveLibraryForDocState(libraryState, docKey, docName, library) {
  const updated = { ...(libraryState.librariesByDoc || {}) };
  updated[docKey] = { ...(updated[docKey] || {}), docName, library, updatedAt: new Date().toISOString() };
  return normalizeLibraryState({ ...libraryState, library, librariesByDoc: updated, activeDocKey: docKey });
}

async function buildReplacementForGroup(group, startingLibrary) {
  const mode = (group.label || "").toLowerCase() === "pmid" ? "pmid" : "doi";
  const ids = (group.ids || []).map((x) => normalizeTokenValue(mode === "pmid" ? "PMID" : "DOI", x)).filter(Boolean);
  let workingLibrary = [...startingLibrary];
  let imported = 0;
  const failed = [];
  const citationIndexes = [];
  const records = [];

  for (const id of ids) {
    try {
      const result = await upsertIdentifier(mode, id, workingLibrary);
      workingLibrary = result.library;
      if (result.imported) imported += 1;
      if (result.record) {
        citationIndexes.push(workingLibrary.indexOf(result.record) + 1);
        records.push(result.record);
      }
    } catch (error) {
      failed.push({ id, error: error.message });
    }
  }

  const key = `${mode === "pmid" ? "PMID" : "DOI"}|${ids.join(";")}`;
  const display = formatCitationField(citationIndexes);
  return {
    library: workingLibrary,
    imported,
    failed,
    replacement: {
      key,
      display,
      rawToken: group.rawToken || "",
      ids,
      label: mode === "pmid" ? "PMID" : "DOI",
      urls: records.map((record, idx) => paperUrl(record, ids[idx])).filter(Boolean),
      title: createCitationTooltip(records)
    }
  };
}

async function getAuthenticatedProfileEmail() {
  try {
    const token = await getAuthToken(false);
    const profile = await googleApi("/oauth2/v2/userinfo", token);
    return profile?.email || "unknown-account";
  } catch (_error) {
    return "unknown-account";
  }
}

async function diagnoseDocAccess(docId) {
  const token = await getAuthToken(true);
  const encoded = encodeURIComponent(docId);
  const authEmail = await getAuthenticatedProfileEmail();
  try {
    const fileMeta = await googleApi(`/drive/v3/files/${encoded}?fields=id,name,mimeType,owners(emailAddress)&supportsAllDrives=true`, token);
    if (fileMeta?.mimeType !== "application/vnd.google-apps.document") {
      return `ID resolves, but it is not a Google Doc (mimeType=${fileMeta?.mimeType || "unknown"}).`;
    }
    return `Drive can see this Doc as \"${fileMeta?.name || docId}\" for ${authEmail}. If Docs API still fails, re-login and verify the OAuth client belongs to the same Google account.`;
  } catch (error) {
    const msg = String(error?.message || "");
    if (msg.includes("failed: 404")) {
      return `Drive cannot find this Doc ID for ${authEmail} (404). Common causes: wrong Doc ID, Doc belongs to a different Google account, or the Doc is not shared with the authenticated account.`;
    }
    if (msg.includes("failed: 403")) {
      return `Drive access is forbidden (403) for ${authEmail}. Re-run Google login consent and ensure Drive API + Google Docs API are enabled for this OAuth client.`;
    }
    return `Drive access check failed for ${authEmail}: ${msg || "unknown error"}`;
  }
}

function docsTextStyleForCitation(referenceHeadingId = "") {
  return {
    baselineOffset: "SUPERSCRIPT",
    ...(referenceHeadingId ? { link: { headingId: referenceHeadingId } } : {}),
    fontSize: { magnitude: 9, unit: "PT" },
    foregroundColor: { color: { rgbColor: { blue: 0.8, red: 0.06, green: 0.33 } } }
  };
}

function docsTextStyleFieldsForCitation(referenceHeadingId = "") {
  return referenceHeadingId ? "baselineOffset,link,fontSize,foregroundColor" : "baselineOffset,fontSize,foregroundColor";
}

function docsTextStyleForReferenceContext() {
  return {
    backgroundColor: { color: { rgbColor: { red: 1, green: 0.96, blue: 0.72 } } },
    foregroundColor: { color: { rgbColor: { red: 0.16, green: 0.16, blue: 0.16 } } }
  };
}

function docsTextStyleFieldsForReferenceContext() {
  return "backgroundColor,foregroundColor";
}

function extractReferenceMarkerRange(doc) {
  let cursor = 1;
  for (const block of (doc?.body?.content || [])) {
    const elements = block?.paragraph?.elements || [];
    for (const el of elements) {
      const content = el?.textRun?.content || "";
      const markerIndex = content.indexOf(REFERENCES_MARKER);
      if (markerIndex >= 0) {
        const startIndex = (el.startIndex || cursor) + markerIndex;
        const endIndex = doc?.body?.content?.[doc.body.content.length - 1]?.endIndex || startIndex + REFERENCES_MARKER.length;
        return { startIndex, endIndex: Math.max(startIndex + REFERENCES_MARKER.length, endIndex - 1) };
      }
      cursor = el.endIndex || cursor + content.length;
    }
  }
  return null;
}


function extractReferenceMarkerParagraphRange(doc) {
  for (const block of (doc?.body?.content || [])) {
    const elements = block?.paragraph?.elements || [];
    if (elements.some((el) => (el?.textRun?.content || "").includes(REFERENCES_MARKER))) {
      const startIndex = block.startIndex || elements[0]?.startIndex || 1;
      const endIndex = block.endIndex || elements[elements.length - 1]?.endIndex || startIndex + REFERENCES_MARKER.length;
      return { startIndex, endIndex: Math.max(startIndex + 1, endIndex - 1) };
    }
  }
  return null;
}

function docEndInsertIndex(doc) {
  const endIndex = doc?.body?.content?.[doc.body.content.length - 1]?.endIndex || 1;
  return Math.max(1, endIndex - 1);
}

function citationIndicesFromDisplay(display) {
  const value = String(display || "").trim();
  if (!value) return [];
  if (value.includes("-")) {
    const [start, end] = value.split("-").map((n) => Number(n.trim()));
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
      return Array.from({ length: end - start + 1 }, (_x, i) => start + i);
    }
  }
  return value.split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

function buildReferencesTextFromDisplays(citationDisplays, scopedLibrary, citationStyle) {
  const citedDisplays = new Set(citationDisplays.map((display) => String(display || "")).filter(Boolean));
  const citedIndices = [...citedDisplays].flatMap(citationIndicesFromDisplay);
  const uniqueIndices = [...new Set(citedIndices)].sort((a, b) => a - b);
  const references = uniqueIndices.map((idx) => {
    const rec = scopedLibrary[idx - 1];
    return rec ? `${idx}. ${formatCitation(rec, citationStyle)} ${paperUrl(rec)}` : "";
  }).filter(Boolean).join("\n");
  return references ? `\n\n${REFERENCES_MARKER}\n${references}\n` : "";
}

function collectCitationDisplaysBeforeReferences(doc, referenceRange = null) {
  const displays = [];
  const citationPattern = /\[(\d+(?:\s*(?:-|,)\s*\d+)*)\]/g;
  const referenceStart = referenceRange?.startIndex || Number.POSITIVE_INFINITY;
  for (const block of (doc?.body?.content || [])) {
    for (const el of (block?.paragraph?.elements || [])) {
      if ((el.startIndex || 1) >= referenceStart) continue;
      const content = el?.textRun?.content || "";
      citationPattern.lastIndex = 0;
      let match;
      while ((match = citationPattern.exec(content)) !== null) displays.push(match[1].replace(/\s+/g, ""));
    }
  }
  return displays;
}

function extractReferenceHeadingId(doc) {
  for (const block of (doc?.body?.content || [])) {
    const elements = block?.paragraph?.elements || [];
    if (elements.some((el) => (el?.textRun?.content || "").includes(REFERENCES_MARKER))) {
      return block?.paragraph?.paragraphStyle?.headingId || "";
    }
  }
  return "";
}

function buildReferenceContextStyleRequests(doc) {
  const markerRange = extractReferenceMarkerRange(doc);
  if (!markerRange) return [];
  const requests = [];
  for (const block of (doc?.body?.content || [])) {
    const startIndex = block.startIndex || 1;
    const endIndex = block.endIndex || startIndex;
    if (startIndex <= markerRange.startIndex || endIndex <= markerRange.startIndex) continue;
    requests.push({
      updateTextStyle: {
        range: { startIndex, endIndex: Math.max(startIndex, endIndex - 1) },
        textStyle: docsTextStyleForReferenceContext(),
        fields: docsTextStyleFieldsForReferenceContext()
      }
    });
  }
  return requests;
}

async function applyDocCitationsAndReferencesForLibrary({ docId, tokenReplacements, citationStyle, scopedLibrary }) {
  const token = await getAuthToken(true);
  let docMeta = await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}`, token);

  const existingReferenceRange = extractReferenceMarkerRange(docMeta);
  const existingDisplays = collectCitationDisplaysBeforeReferences(docMeta, existingReferenceRange);
  if (existingReferenceRange) {
    await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, token, "POST", {
      requests: [{ deleteContentRange: { range: existingReferenceRange } }]
    });
    docMeta = await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}`, token);
  }

  const replaceRequests = tokenReplacements
    .filter((r) => r.rawToken && r.display)
    .map((r) => ({
      replaceAllText: {
        containsText: { text: r.rawToken, matchCase: true },
        replaceText: `[${r.display}]`
      }
    }));

  if (replaceRequests.length) {
    await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, token, "POST", { requests: replaceRequests });
    docMeta = await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}`, token);
  }

  const currentDisplays = collectCitationDisplaysBeforeReferences(docMeta);
  const replacementDisplays = tokenReplacements.map((r) => r.display);
  const allDisplays = [...existingDisplays, ...currentDisplays, ...replacementDisplays];
  const referencesText = buildReferencesTextFromDisplays(allDisplays, scopedLibrary, citationStyle);
  if (referencesText) {
    await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, token, "POST", {
      requests: [{ insertText: { location: { index: docEndInsertIndex(docMeta) }, text: referencesText } }]
    });
    docMeta = await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}`, token);
  }

  const newReferenceRange = extractReferenceMarkerParagraphRange(docMeta);
  if (newReferenceRange) {
    await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, token, "POST", {
      requests: [{
        updateParagraphStyle: {
          range: newReferenceRange,
          paragraphStyle: { namedStyleType: "HEADING_2" },
          fields: "namedStyleType"
        }
      }]
    });
    docMeta = await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}`, token);
  }

  const referenceHeadingId = extractReferenceHeadingId(docMeta);
  const citedDisplays = [...new Set(allDisplays.map((display) => String(display || "").trim()).filter(Boolean))];
  const styleRequests = [...buildReferenceContextStyleRequests(docMeta)];
  for (const display of citedDisplays) {
    const citationText = `[${display}]`;
    for (const block of (docMeta?.body?.content || [])) {
      for (const el of (block?.paragraph?.elements || [])) {
        const content = el?.textRun?.content || "";
        let idx = content.indexOf(citationText);
        while (idx >= 0) {
          const startIndex = (el.startIndex || 1) + idx;
          const end = startIndex + citationText.length;
          styleRequests.push({
            updateTextStyle: {
              range: { startIndex, endIndex: end },
              textStyle: docsTextStyleForCitation(referenceHeadingId),
              fields: docsTextStyleFieldsForCitation(referenceHeadingId)
            }
          });
          idx = content.indexOf(citationText, idx + citationText.length);
        }
      }
    }
  }
  if (styleRequests.length) await googleApi(`/docs/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, token, "POST", { requests: styleRequests });
  return { ok: true, replacedCount: replaceRequests.length, referencesInserted: Boolean(referencesText), styledCount: styleRequests.length, linkedToReferences: Boolean(referenceHeadingId) };
}

function getPackagedOAuthClientId() {
  return chrome.runtime.getManifest?.()?.oauth2?.client_id || "";
}

async function getConfiguredOAuthClientId() {
  const { oauthClientId = "" } = await chrome.storage.local.get(["oauthClientId"]);
  return String(oauthClientId || getPackagedOAuthClientId()).trim();
}

async function getAuthToken(interactive = false) {
  const { oauthAccessToken, oauthTokenExpiresAt = 0 } = await chrome.storage.local.get(["oauthAccessToken", "oauthTokenExpiresAt"]);
  const oauthClientId = await getConfiguredOAuthClientId();
  if (oauthAccessToken && Date.now() < oauthTokenExpiresAt - 60_000 && await tokenHasRequiredScopes(oauthAccessToken)) return oauthAccessToken;
  if (!interactive) throw new Error("Authentication required.");
  if (!oauthClientId) throw new Error("Google OAuth Client ID is not configured. Add a packaged client ID for release or set one on the landing page for local testing.");

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

function googleApiUrl(path) {
  const normalizedPath = String(path);
  if (normalizedPath.startsWith("/docs/v1/")) {
    return `https://docs.googleapis.com${normalizedPath.replace(/^\/docs/, "")}`;
  }
  return `https://www.googleapis.com${normalizedPath}`;
}

async function googleApi(path, token, method = "GET", body, headers = {}) {
  const response = await fetch(googleApiUrl(path), {
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
  const text = await response.text();
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`Google API ${method} ${path} returned non-JSON response.`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "addIdentifier") {
      const libraryState = await loadLibraryState({ interactive: true });
      const raw = (message.value ?? "").trim();
      const mode = (message.mode ?? "doi").toLowerCase();
      try {
        const result = await upsertIdentifier(mode, raw, libraryState.library);
        const updatedState = normalizeLibraryState({ ...libraryState, library: result.library });
        await saveLibraryState(updatedState);
        sendResponse({ ok: true, record: result.record });
      } catch (error) {
        sendResponse({ ok: false, error: `${error.message}. If this is 403, re-login with consent and ensure Drive API is enabled for this OAuth project.` });
      }
      return;
    }

    if (message?.type === "listLibrary") {
      try {
        const libraryState = await loadLibraryState({ interactive: false });
        sendResponse({ ok: true, library: libraryState.library, citationStyle: libraryState.citationStyle, driveBacked: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, library: [], citationStyle: "apa" });
      }
      return;
    }

    if (message?.type === "setCitationStyle") {
      const libraryState = await loadLibraryState({ interactive: true });
      const updatedState = normalizeLibraryState({ ...libraryState, citationStyle: message.style || "apa" });
      await saveLibraryState(updatedState);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "citationPreview") {
      const libraryState = await loadLibraryState({ interactive: false });
      sendResponse({ ok: true, citations: libraryState.library.map((r) => formatCitation(r, libraryState.citationStyle)) });
      return;
    }

    if (message?.type === "syncLibraryPush") {
      try {
        const cached = await getCachedLibraryState();
        const saved = await saveLibraryState(cached);
        sendResponse({ ok: true, count: saved.library.length, file: DRIVE_LIBRARY_FILENAME });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "syncLibraryPull") {
      try {
        const token = await getAuthToken(true);
        const driveState = await readDriveLibraryState(token);
        const legacyFile = await findDriveAppDataFile(token, LEGACY_SHARED_LIBRARY_FILENAME);
        let importedLegacy = 0;
        let finalState = driveState || createEmptyLibraryState();
        if (legacyFile) {
          const legacyJson = await googleApi(`/drive/v3/files/${legacyFile.id}?alt=media`, token);
          const shared = legacyJson?.library || [];
          if (shared.length) {
            finalState = normalizeLibraryState({ ...finalState, library: mergeLibraries(finalState.library, shared) });
            importedLegacy = shared.length;
          }
        }
        finalState = await writeDriveLibraryState(token, finalState);
        sendResponse({ ok: true, count: finalState.library.length, resolved: importedLegacy, file: DRIVE_LIBRARY_FILENAME });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "googleLogin") {
      try {
        const token = await getAuthToken(true);
        const profile = await googleApi("/oauth2/v2/userinfo", token);
        await loadLibraryState({ interactive: true });
        sendResponse({ ok: true, email: profile?.email, scopes: REQUIRED_SCOPES });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "drivePermissionCheck") {
      try {
        const token = await getAuthToken(true);
        const profile = await googleApi("/oauth2/v2/userinfo", token);
        const created = await googleApi("/drive/v3/files", token, "POST", { name: `refmanager-permission-check-${Date.now()}.json`, parents: ["appDataFolder"], mimeType: "application/json" });
        await uploadDriveJson(token, created.id, { ping: "ok" });
        await uploadDriveJson(token, created.id, { ping: "edited" });
        await googleApi(`/drive/v3/files/${created.id}`, token, "DELETE");
        await loadLibraryState({ interactive: true });
        sendResponse({ ok: true, email: profile?.email, profileRead: true, writeCheck: true, editCheck: true, deleteCheck: true, libraryFile: DRIVE_LIBRARY_FILENAME });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "linkCurrentDoc") {
      const libraryState = await loadLibraryState({ interactive: false });
      const docId = (message.docId || "").trim();
      if (!docId) {
        sendResponse({ ok: false, error: "Missing Google Doc ID." });
        return;
      }
      let docName = (message.docName || "Google Doc").replace(/\s+-\s+Google Docs\s*$/i, "").trim();
      if (!docName || /^Manual Doc\b/i.test(docName)) {
        try {
          const token = await getAuthToken(false);
          const fileMeta = await googleApi(`/drive/v3/files/${encodeURIComponent(docId)}?fields=id,name,mimeType`, token);
          if (fileMeta?.name) docName = fileMeta.name;
        } catch (_error) {
          // best effort; keep provided name when metadata lookup is unavailable
        }
      }
      const updated = { ...(libraryState.librariesByDoc || {}) };
      updated[docId] = { ...(updated[docId] || {}), docName, library: updated[docId]?.library || libraryState.library, updatedAt: new Date().toISOString(), url: message.url || "" };
      const saved = await saveLibraryState(normalizeLibraryState({ ...libraryState, librariesByDoc: updated, activeDocKey: docId }));
      sendResponse({ ok: true, docId, docName, count: saved.library.length });
      return;
    }

    if (message?.type === "applyDocCitationsAndReferences") {
      try {
        const libraryState = await loadLibraryState({ interactive: true });
        const docId = (message.docId || "").trim();
        if (!docId) throw new Error("Missing docId for Docs update.");
        const tokenReplacements = Array.isArray(message.tokenReplacements) ? message.tokenReplacements : [];
        const scoped = (libraryState.librariesByDoc?.[docId]?.library || libraryState.library);
        const result = await applyDocCitationsAndReferencesForLibrary({ docId, tokenReplacements, citationStyle: libraryState.citationStyle, scopedLibrary: scoped });
        sendResponse(result);
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "clearLibrary") {
      const libraryState = await loadLibraryState({ interactive: true });
      await saveLibraryState(normalizeLibraryState({ ...libraryState, library: [] }));
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "mergeDuplicates") {
      const libraryState = await loadLibraryState({ interactive: true });
      const seen = new Map();
      const merged = [];
      for (const item of libraryState.library) {
        const key = item.doi?.toLowerCase() || item.pmid || fingerprint(item);
        if (!seen.has(key)) {
          seen.set(key, item);
          merged.push(item);
        }
      }
      await saveLibraryState(normalizeLibraryState({ ...libraryState, library: merged }));
      sendResponse({ ok: true, removed: libraryState.library.length - merged.length });
      return;
    }

    if (message?.type === "ingestTokensAndBuildCitations") {
      const libraryState = await loadLibraryState({ interactive: true });
      const docKey = message.docId || "default-doc";
      const docName = message.docName || "Untitled Doc";
      const scopedLibrary = libraryState.librariesByDoc?.[docKey]?.library || libraryState.library;
      let workingLibrary = [...scopedLibrary];
      let imported = 0;
      const failed = [];
      const replacements = [];

      let incomingGroups = Array.isArray(message.groups) ? message.groups.map((group) => parseAllowedTokenGroup(group.rawToken) || group).filter((group) => group?.ids?.length) : [];
      let fallbackError = "";
      if (!incomingGroups.length) {
        const candidates = [];
        if (message.docId) candidates.push(message.docId);
        if (docKey && !candidates.includes(docKey)) candidates.push(docKey);
        const linkedUrlId = parseDocIdFromUrl(libraryState.librariesByDoc?.[docKey]?.url || "");
        if (linkedUrlId && !candidates.includes(linkedUrlId)) candidates.push(linkedUrlId);

        let lastError = "";
        for (const candidateDocId of candidates) {
          try {
            const token = await getAuthToken(true);
            const docText = await loadDocPlainText(candidateDocId, token);
            incomingGroups = extractTokenGroupsFromText(docText);
            if (incomingGroups.length) break;
          } catch (error) {
            lastError = error?.message || "Docs API fallback failed.";
          }
        }
        fallbackError = lastError;
      }

      for (const group of incomingGroups) {
        const processed = await buildReplacementForGroup(group, workingLibrary);
        workingLibrary = processed.library;
        imported += processed.imported;
        failed.push(...processed.failed);
        replacements.push(processed.replacement);
      }

      const updatedState = saveLibraryForDocState(libraryState, docKey, docName, workingLibrary);
      await saveLibraryState(updatedState);
      sendResponse({ ok: true, replacements, imported, failed, docKey, docName, foundGroups: incomingGroups.length, fallbackError });
      return;
    }

    if (message?.type === "convertDocById") {
      try {
        const libraryState = await loadLibraryState({ interactive: true });
        const docId = (message.docId || "").trim();
        if (!docId) throw new Error("Missing Google Doc ID.");
        const built = await ingestAndBuildForDoc({ docId, docName: `Manual Doc ${docId.slice(0, 8)}...`, libraryState });
        const tokenReplacements = (built.replacements || []).filter((r) => r.rawToken).map((r) => ({ rawToken: r.rawToken, display: r.display, urls: r.urls, title: r.title, ids: r.ids || [], label: r.label || "" }));
        if (!built.foundGroups) throw new Error("No valid DOI/PMID token groups were found in this Google Doc.");
        const applied = await applyDocCitationsAndReferencesForLibrary({ docId: built.docKey, tokenReplacements, citationStyle: built.libraryState.citationStyle, scopedLibrary: built.workingLibrary });
        sendResponse({ ok: true, replacedCount: tokenReplacements.length, imported: built.imported, failed: built.failed, applied });
      } catch (error) {
        const raw = error?.message || "Document conversion failed.";
        if (raw.includes("/docs/v1/documents/") && raw.includes("failed: 404")) {
          const diagnostic = await diagnoseDocAccess((message.docId || "").trim());
          sendResponse({ ok: false, error: `${raw}. ${diagnostic} Library import is skipped in this path because token ingestion reads the Doc through the Docs API first.` });
          return;
        }
        sendResponse({ ok: false, error: raw });
      }
      return;
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message || "Unexpected RefManager error." }));

  return true;
});
