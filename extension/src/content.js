const DOI_GROUP_PATTERN = /\{([^{}]*10\.\d{4,9}\/[-._;()/:A-Z0-9]+[^{}]*)\}/gi;

function parseDoiGroup(rawGroup) {
  return rawGroup
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createCitationSpan(dois) {
  const span = document.createElement("span");
  span.className = "refmanager-citation";
  span.contentEditable = "false";
  span.textContent = `[${dois.join(", ")}]`;
  span.dataset.refmanagerDois = JSON.stringify(dois);
  span.title = "RefManager citation field";
  return span;
}

function transformTextNode(node) {
  const original = node.nodeValue;
  if (!original || !DOI_GROUP_PATTERN.test(original)) {
    DOI_GROUP_PATTERN.lastIndex = 0;
    return;
  }

  DOI_GROUP_PATTERN.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = DOI_GROUP_PATTERN.exec(original)) !== null) {
    const [fullMatch, group] = match;
    fragment.appendChild(document.createTextNode(original.slice(lastIndex, match.index)));

    const dois = parseDoiGroup(group);
    fragment.appendChild(createCitationSpan(dois));

    lastIndex = match.index + fullMatch.length;
  }

  fragment.appendChild(document.createTextNode(original.slice(lastIndex)));
  node.parentNode?.replaceChild(fragment, node);
}

function processEditableRoots() {
  const editors = document.querySelectorAll('[contenteditable="true"]');
  editors.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current;
    while ((current = walker.nextNode())) {
      textNodes.push(current);
    }
    textNodes.forEach(transformTextNode);
  });
}

const observer = new MutationObserver(() => processEditableRoots());
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
processEditableRoots();
