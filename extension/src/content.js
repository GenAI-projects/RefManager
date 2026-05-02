const DOI_GROUP_PATTERN = /\{([^{}]*10\.\d{4,9}\/[-._;()/:A-Z0-9]+[^{}]*)\}/gi;
const PMID_GROUP_PATTERN = /\{([^{}]*PMID:\s*\d+[^{}]*)\}/gi;

function createCitationSpan(label, ids) {
  const span = document.createElement("span");
  span.className = "refmanager-citation";
  span.contentEditable = "false";
  span.textContent = `[${label}: ${ids.join(", ")}]`;
  span.dataset.refmanager = JSON.stringify({ label, ids });
  return span;
}

function replacePatternInText(node, pattern, parser, label) {
  const original = node.nodeValue;
  if (!original || !pattern.test(original)) {
    pattern.lastIndex = 0;
    return node;
  }
  pattern.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let last = 0;
  let match;
  while ((match = pattern.exec(original)) !== null) {
    fragment.appendChild(document.createTextNode(original.slice(last, match.index)));
    fragment.appendChild(createCitationSpan(label, parser(match[1])));
    last = match.index + match[0].length;
  }
  fragment.appendChild(document.createTextNode(original.slice(last)));
  node.parentNode?.replaceChild(fragment, node);
}

function parseDoiGroup(group) {
  return group.split(";").map((x) => x.trim()).filter((x) => x && x.includes("/"));
}

function parsePmidGroup(group) {
  return group.split(";").map((x) => x.replace(/PMID:\s*/i, "").trim()).filter(Boolean);
}

function processEditableRoots() {
  const editors = document.querySelectorAll('[contenteditable="true"]');
  editors.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current;
    while ((current = walker.nextNode())) textNodes.push(current);
    textNodes.forEach((node) => {
      replacePatternInText(node, DOI_GROUP_PATTERN, parseDoiGroup, "DOI");
      replacePatternInText(node, PMID_GROUP_PATTERN, parsePmidGroup, "PMID");
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "convertDocTokens") {
    processEditableRoots();
    sendResponse({ ok: true });
  }
});

const button = document.createElement("button");
button.textContent = "Convert Ref Tokens";
button.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:99999;padding:8px;";
button.addEventListener("click", processEditableRoots);
document.body.appendChild(button);
