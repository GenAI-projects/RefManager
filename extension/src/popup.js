const form = document.getElementById("id-form");
const statusEl = document.getElementById("status");
const linkedDocEl = document.getElementById("linked-doc");
const manualDocIdInput = document.getElementById("manual-doc-id");

function parseDoc(url = "") {
  const match = url.match(/https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([^/?#]+)/);
  return match?.[1] || null;
}


function sanitizeDocId(raw = "") {
  const text = raw.trim();
  if (!text) return "";
  const fromUrl = text.match(/\/document\/(?:u\/\d+\/)?d\/([^/?#]+)/);
  return fromUrl?.[1] || text;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}


function renderLinkedDocStatus(docName) {
  linkedDocEl.textContent = docName ? `Linked doc: ${docName}` : "No doc linked yet.";
}

async function refreshLinkedDocFromActiveTab() {
  const tab = await getActiveTab();
  const docId = parseDoc(tab?.url || "");
  if (!docId) return renderLinkedDocStatus("");
  const cleanName = (tab.title || "Google Doc").replace(/\s+-\s+Google Docs\s*$/i, "").trim();
  renderLinkedDocStatus(cleanName || "Google Doc");
}


async function findDocTabById(docId) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => parseDoc(t.url || "") === docId) || null;
}

async function ensureContentScript(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "pingRefManager" });
    return true;
  } catch (_err) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content.js"] });
    return true;
  }
}

document.getElementById("convert-current").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const activeDocId = parseDoc(tab.url || "") || sanitizeDocId(manualDocIdInput.value);
  if (!activeDocId) {
    statusEl.textContent = "Open a Google Doc tab first, or enter Manual Google Doc ID.";
    return;
  }

  const targetTab = parseDoc(tab.url || "") ? tab : await findDocTabById(activeDocId);
  if (!targetTab?.id) {
    statusEl.textContent = "Could not find an open tab for that Doc ID. Open the target Google Doc tab and try again.";
    return;
  }

  try {
    if (!parseDoc(tab.url || "")) {
      statusEl.textContent = "Using manual Doc ID fallback with a matching open Google Doc tab.";
    }
    await ensureContentScript(targetTab);
    chrome.tabs.sendMessage(targetTab.id, { type: "convertDocTokens" }, (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = `Could not convert in this tab: ${chrome.runtime.lastError.message}`;
        return;
      }
      statusEl.textContent = response?.ok
        ? `Converted ${response.replacedCount || 0} token group(s). Imported ${response.imported || 0} new reference(s).`
        : `Could not convert in this tab: ${response?.error || "Unknown error"}`;
    });
  } catch (error) {
    statusEl.textContent = `Could not convert in this tab: ${error.message}`;
  }
});

document.getElementById("link-current").addEventListener("click", async () => {
  const tab = await getActiveTab();
  const docId = parseDoc(tab?.url || "");
  if (!docId) {
    statusEl.textContent = "Open a Google Doc to link it.";
    return;
  }
  chrome.runtime.sendMessage({ type: "linkCurrentDoc", docId, docName: tab.title || "Google Doc", url: tab.url }, (res) => {
    if (!res?.ok) {
      statusEl.textContent = res?.error || "Could not link this document.";
      return;
    }
    linkedDocEl.textContent = `Linked doc: ${res.docName}`;
    statusEl.textContent = "Current document linked for RefManager actions.";
  });
});


document.getElementById("link-manual").addEventListener("click", () => {
  const docId = sanitizeDocId(manualDocIdInput.value);
  if (!docId) {
    statusEl.textContent = "Enter a Google Doc ID (or full URL) first.";
    return;
  }
  chrome.runtime.sendMessage({ type: "linkCurrentDoc", docId, docName: `Manual Doc ${docId.slice(0, 8)}...`, url: "" }, (res) => {
    if (!res?.ok) {
      statusEl.textContent = res?.error || "Could not link this document.";
      return;
    }
    renderLinkedDocStatus(res.docName);
    statusEl.textContent = "Manual document link saved.";
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  chrome.runtime.sendMessage({ type: "addIdentifier", mode: formData.get("mode"), value: formData.get("value") }, (response) => {
    statusEl.textContent = response?.ok ? `Added: ${response.record.title}` : response?.error || "Error";
  });
});

document.getElementById("open-library").addEventListener("click", () => chrome.runtime.openOptionsPage());



refreshLinkedDocFromActiveTab();
