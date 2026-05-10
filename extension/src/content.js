const DOI_GROUP_PATTERN = /\{([^{}]*10\.\d{4,9}\/[-._;()/:A-Z0-9]+[^{}]*)\}/gi;
const PMID_GROUP_PATTERN = /\{([^{}]*PMID:\s*\d+[^{}]*)\}/gi;

function normalizeToken(id) {
  return String(id || "").trim().replace(/\s+/g, "");
}

function getDocContext() {
  const match = window.location.pathname.match(/\/document\/d\/([^/]+)/);
  const docId = match?.[1] || document.title || "default-doc";
  const cleanTitle = (document.title || "Untitled Doc").replace(/\s+-\s+Google Docs\s*$/i, "").trim();
  return { docId, docName: cleanTitle || "Untitled Doc" };
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
  if (!original || !pattern.test(original)) {
    pattern.lastIndex = 0;
    return;
  }
  pattern.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let last = 0;
  let match;
  while ((match = pattern.exec(original)) !== null) {
    fragment.appendChild(document.createTextNode(original.slice(last, match.index)));
    const parsedIds = parser(match[1]);
    const normalizedKey = parsedIds.map(normalizeToken).join(";");
    const replacement = replacements.get(`${label}|${normalizedKey}`);
    if (replacement) {
      fragment.appendChild(createCitationSpan(label, replacement.display, parsedIds));
    } else {
      fragment.appendChild(document.createTextNode(match[0]));
    }
    last = match.index + match[0].length;
  }
  fragment.appendChild(document.createTextNode(original.slice(last)));
  node.parentNode?.replaceChild(fragment, node);
}

function parseDoiGroup(group) {
  return group.split(";").map((x) => x.trim()).filter((x) => x && x.includes("/"));
}

function parsePmidGroup(group) {
  return group.split(";").map((x) => x.replace(/PMID:\s*/gi, "").trim()).filter(Boolean);
}

function collectTokenGroups() {
  const groups = [];
  const editors = document.querySelectorAll('[contenteditable="true"]');
  editors.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) {
      const text = current.nodeValue || "";
      DOI_GROUP_PATTERN.lastIndex = 0;
      PMID_GROUP_PATTERN.lastIndex = 0;
      let match;
      while ((match = DOI_GROUP_PATTERN.exec(text)) !== null) {
        groups.push({ label: "DOI", ids: parseDoiGroup(match[1]) });
      }
      while ((match = PMID_GROUP_PATTERN.exec(text)) !== null) {
        groups.push({ label: "PMID", ids: parsePmidGroup(match[1]) });
      }
    }
  });
  return groups;
}

function processEditableRoots(replacements) {
  const editors = document.querySelectorAll('[contenteditable="true"]');
  editors.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current;
    while ((current = walker.nextNode())) textNodes.push(current);
    textNodes.forEach((node) => {
      replacePatternInText(node, DOI_GROUP_PATTERN, parseDoiGroup, replacements, "DOI");
      replacePatternInText(node, PMID_GROUP_PATTERN, parsePmidGroup, replacements, "PMID");
    });
  });
}

function formatCitationField(indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (!sorted.length) return "";
  if (sorted.length > 3) return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  return sorted.join(",");
}

function refreshCitationSpanOrder() {
  const editors = document.querySelectorAll('[contenteditable="true"]');
  const refOrder = new Map();
  let nextIndex = 1;
  editors.forEach((root) => {
    const spans = root.querySelectorAll(".refmanager-citation");
    spans.forEach((span) => {
      let payload = {};
      try {
        payload = JSON.parse(span.dataset.refmanager || "{}");
      } catch (_error) {
        payload = {};
      }
      const label = payload.label || "DOI";
      const ids = (payload.ids || []).map((id) => normalizeToken(label === "PMID" ? String(id).replace(/^PMID:/i, "") : id));
      const indices = ids.map((id) => {
        const key = `${label}|${id}`;
        if (!refOrder.has(key)) refOrder.set(key, nextIndex++);
        return refOrder.get(key);
      });
      const displayValue = formatCitationField(indices);
      span.textContent = `[${displayValue}]`;
      span.dataset.refmanager = JSON.stringify({ ...payload, ids, displayValue });
    });
  });
}

async function convertDocTokensWithAutoLookup(sendResponse) {
  try {
    const groups = collectTokenGroups();
    chrome.runtime.sendMessage({ type: "ingestTokensAndBuildCitations", groups, ...getDocContext() }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (!response?.ok) {
        sendResponse({ ok: false, error: response?.error || "Failed to ingest tokens." });
        return;
      }
      const replacements = new Map((response.replacements || []).map((r) => [r.key, { display: r.display }]));
      processEditableRoots(replacements);
      refreshCitationSpanOrder();
      sendResponse({ ok: true, imported: response.imported, failed: response.failed });
    });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || "Token conversion failed." });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "convertDocTokens") {
    convertDocTokensWithAutoLookup(sendResponse);
    return true;
  }
  return false;
});

const button = document.createElement("button");
button.textContent = "Convert Ref Tokens";
button.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:99999;padding:8px;";
button.addEventListener("click", () => {
  convertDocTokensWithAutoLookup((response) => {
    console.info("RefManager conversion", response);
  });
});
document.body.appendChild(button);
