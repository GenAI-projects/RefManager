const DOI_GROUP_PATTERN = /\{([^{}]*10\.\d{4,9}\/[\-._;()/:A-Z0-9]+[^{}]*)\}/gi;
const PMID_GROUP_PATTERN = /\{([^{}]*PMID:\s*\d+[^{}]*)\}/gi;

function normalizeToken(id) { return String(id || "").trim().replace(/\s+/g, ""); }
function getDocContext() {
  const match = window.location.pathname.match(/\/document\/d\/([^/]+)/);
  const docId = match?.[1] || document.title || "default-doc";
  const cleanTitle = (document.title || "Untitled Doc").replace(/\s+-\s+Google Docs\s*$/i, "").trim();
  return { docId, docName: cleanTitle || "Untitled Doc" };
}
function parseDoiGroup(group) { return group.split(";").map((x) => x.trim()).filter((x) => x && x.includes("/")); }
function parsePmidGroup(group) { return group.split(";").map((x) => x.replace(/PMID:\s*/gi, "").trim()).filter(Boolean); }


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
      DOI_GROUP_PATTERN.lastIndex = 0;
      PMID_GROUP_PATTERN.lastIndex = 0;
      let m;
      while ((m = DOI_GROUP_PATTERN.exec(text)) !== null) groups.push({ label: "DOI", ids: parseDoiGroup(m[1]) });
      while ((m = PMID_GROUP_PATTERN.exec(text)) !== null) groups.push({ label: "PMID", ids: parsePmidGroup(m[1]) });
    }
  });
  return groups;
}
function createCitationSpan(label, displayValue, ids) {
  const span = document.createElement("span");
  span.className = "refmanager-citation";
  span.contentEditable = "false";
  span.textContent = `[${displayValue}]`;
  span.dataset.refmanager = JSON.stringify({ label, ids, displayValue });
  return span;
}
function replacePatternInText(node, pattern, parser, replacements, label) {
  const original = node.nodeValue;
  if (!original || !pattern.test(original)) { pattern.lastIndex = 0; return 0; }
  pattern.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let last = 0; let count = 0; let match;
  while ((match = pattern.exec(original)) !== null) {
    fragment.appendChild(document.createTextNode(original.slice(last, match.index)));
    const parsedIds = parser(match[1]);
    const replacement = replacements.get(`${label}|${parsedIds.map(normalizeToken).join(";")}`);
    fragment.appendChild(replacement ? createCitationSpan(label, replacement.display, parsedIds) : document.createTextNode(match[0]));
    if (replacement) count += 1;
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
      replaced += replacePatternInText(node, DOI_GROUP_PATTERN, parseDoiGroup, replacements, "DOI");
      replaced += replacePatternInText(node, PMID_GROUP_PATTERN, parsePmidGroup, replacements, "PMID");
    });
  });
  return replaced;
}

function formatCitationField(indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (!sorted.length) return "";
  if (sorted.length > 3) return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  return sorted.join(",");
}
function refreshCitationSpanOrder() {
  const refOrder = new Map(); let nextIndex = 1;
  getEditorRoots().flatMap((root) => [...root.querySelectorAll('.refmanager-citation')]).forEach((span) => {
    let payload = {};
    try { payload = JSON.parse(span.dataset.refmanager || "{}"); } catch (_err) {}
    const label = payload.label || "DOI";
    const ids = (payload.ids || []).map((id) => normalizeToken(label === "PMID" ? String(id).replace(/^PMID:/i, "") : id));
    const displayValue = formatCitationField(ids.map((id) => {
      const key = `${label}|${id}`;
      if (!refOrder.has(key)) refOrder.set(key, nextIndex++);
      return refOrder.get(key);
    }));
    span.textContent = `[${displayValue}]`;
    span.dataset.refmanager = JSON.stringify({ ...payload, ids, displayValue });
  });
}

function convertDocTokensWithAutoLookup(sendResponse) {
  try {
    chrome.runtime.sendMessage({ type: "ingestTokensAndBuildCitations", groups: collectTokenGroups(), ...getDocContext() }, (response) => {
      if (chrome.runtime.lastError) return sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      if (!response?.ok) return sendResponse({ ok: false, error: response?.error || "Failed to ingest tokens." });
      const replacements = new Map((response.replacements || []).map((r) => [r.key, { display: r.display }]));
      const replacedCount = processEditableRoots(replacements);
      refreshCitationSpanOrder();
      if (!replacedCount) return sendResponse({ ok: false, error: `No DOI/PMID token groups were found to replace. Found groups: ${(collectTokenGroups() || []).length}.` });
      sendResponse({ ok: true, imported: response.imported, failed: response.failed, replacedCount });
    });
  } catch (error) { sendResponse({ ok: false, error: error.message || "Token conversion failed." }); }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "pingRefManager") { sendResponse({ ok: true }); return false; }
  if (msg?.type === "convertDocTokens") { convertDocTokensWithAutoLookup(sendResponse); return true; }
  return false;
});
