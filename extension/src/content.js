const TOKEN_PATTERN = /\{[^{}]+\}/g;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const PMID_PATTERN = /^\d{1,10}$/;
const DOI_URL_PREFIX_PATTERN = /^https?:\/\/(?:dx\.)?doi\.org\//i;

function normalizeToken(id) { return String(id || "").trim().replace(/\s+/g, ""); }
function normalizeDoiCandidate(value) { return normalizeToken(value).replace(DOI_URL_PREFIX_PATTERN, ""); }
function getDocContext() {
  const match = window.location.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([^/]+)/);
  const docId = match?.[1] || document.title || "default-doc";
  const cleanTitle = (document.title || "Untitled Doc").replace(/\s+-\s+Google Docs\s*$/i, "").trim();
  return { docId, docName: cleanTitle || "Untitled Doc" };
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
    if (pmidMatch) return { style: "PMID", id: normalizeToken(pmidMatch[1]) };
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

function getEditorRoots() {
  const roots = [
    ...document.querySelectorAll('[contenteditable="true"]'),
    ...document.querySelectorAll('[role="textbox"]')
  ];
  const unique = new Set(roots.filter(Boolean));
  unique.add(document.body);
  return [...unique];
}

function collectTokenGroups() {
  const groups = [];
  getEditorRoots().forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) {
      const text = current.nodeValue || "";
      TOKEN_PATTERN.lastIndex = 0;
      let m;
      while ((m = TOKEN_PATTERN.exec(text)) !== null) {
        const parsed = parseAllowedTokenGroup(m[0]);
        if (parsed) groups.push(parsed);
      }
    }
  });
  return groups;
}

function createCitationLink(displayValue, replacement) {
  const sup = document.createElement("sup");
  const anchor = document.createElement("a");
  const urls = replacement.urls || [];
  sup.className = "refmanager-citation";
  sup.contentEditable = "true";
  sup.dataset.refmanager = JSON.stringify({ displayValue, urls, ids: replacement.ids || [], label: replacement.label });
  anchor.textContent = `[${displayValue}]`;
  anchor.href = "#refmanager-references";
  anchor.title = replacement.title ? `${replacement.title}

RefManager will link this citation to the generated References section in Google Docs.` : "RefManager citation: linked to the generated References section.";
  sup.appendChild(anchor);
  return sup;
}

function replacePatternInText(node, replacements) {
  const original = node.nodeValue;
  if (!original || !TOKEN_PATTERN.test(original)) { TOKEN_PATTERN.lastIndex = 0; return 0; }
  TOKEN_PATTERN.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let last = 0; let count = 0; let match;
  while ((match = TOKEN_PATTERN.exec(original)) !== null) {
    fragment.appendChild(document.createTextNode(original.slice(last, match.index)));
    const parsed = parseAllowedTokenGroup(match[0]);
    const replacement = parsed ? replacements.get(`${parsed.label}|${parsed.ids.map(normalizeToken).join(";")}`) : null;
    fragment.appendChild(replacement?.display ? createCitationLink(replacement.display, { ...replacement, ...parsed }) : document.createTextNode(match[0]));
    if (replacement?.display) count += 1;
    last = match.index + match[0].length;
  }
  fragment.appendChild(document.createTextNode(original.slice(last)));
  node.parentNode?.replaceChild(fragment, node);
  return count;
}

function processEditableRoots(replacements) {
  let replaced = 0;
  getEditorRoots().forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let current;
    while ((current = walker.nextNode())) nodes.push(current);
    nodes.forEach((node) => {
      replaced += replacePatternInText(node, replacements);
    });
  });
  return replaced;
}

function convertDocTokensWithAutoLookup(sendResponse) {
  try {
    chrome.runtime.sendMessage({ type: "ingestTokensAndBuildCitations", groups: collectTokenGroups(), ...getDocContext() }, (response) => {
      if (chrome.runtime.lastError) return sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      if (!response?.ok) return sendResponse({ ok: false, error: response?.error || "Failed to ingest tokens." });
      const replacements = new Map((response.replacements || []).map((r) => [r.key, { display: r.display, urls: r.urls || [], title: r.title || "", ids: r.ids || [], label: r.label || "" }]));
      const replacedCount = processEditableRoots(replacements);
      const tokenReplacements = (response.replacements || [])
        .filter((r) => r.rawToken && r.display)
        .map((r) => ({ rawToken: r.rawToken, display: r.display, urls: r.urls || [], title: r.title || "", ids: r.ids || [], label: r.label || "" }));
      chrome.runtime.sendMessage({ type: "applyDocCitationsAndReferences", docId: response?.docKey || getDocContext().docId, tokenReplacements }, (applyResponse) => {
        if (chrome.runtime.lastError) return sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        if (!applyResponse?.ok) return sendResponse({ ok: false, error: applyResponse?.error || "Failed to update Google Doc." });
        if (!replacedCount && !response?.foundGroups) {
          const fallbackHint = response?.fallbackError ? ` Fallback details: ${response.fallbackError}` : "";
          return sendResponse({ ok: false, error: `No valid DOI/PMID token groups were found to replace. Found groups: ${(collectTokenGroups() || []).length}.${fallbackHint}` });
        }
        sendResponse({ ok: true, imported: response.imported, failed: response.failed, replacedCount: tokenReplacements.length || replacedCount, styledCount: applyResponse.styledCount || 0 });
      });
    });
  } catch (error) { sendResponse({ ok: false, error: error.message || "Token conversion failed." }); }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "pingRefManager") { sendResponse({ ok: true }); return false; }
  if (msg?.type === "convertDocTokens") { convertDocTokensWithAutoLookup(sendResponse); return true; }
  return false;
});
