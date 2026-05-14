const form = document.getElementById("id-form");
const statusEl = document.getElementById("status");
const linkedDocEl = document.getElementById("linked-doc");

function parseDoc(url = "") {
  const match = url.match(/https:\/\/docs\.google\.com\/document\/d\/([^/]+)/);
  return match?.[1] || null;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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
  if (!parseDoc(tab.url || "")) {
    statusEl.textContent = "Open a Google Doc tab first, then run conversion.";
    return;
  }

  try {
    await ensureContentScript(tab);
    chrome.tabs.sendMessage(tab.id, { type: "convertDocTokens" }, (response) => {
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  chrome.runtime.sendMessage({ type: "addIdentifier", mode: formData.get("mode"), value: formData.get("value") }, (response) => {
    statusEl.textContent = response?.ok ? `Added: ${response.record.title}` : response?.error || "Error";
  });
});

document.getElementById("open-library").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.local.get(["activeDocKey", "librariesByDoc"], ({ activeDocKey, librariesByDoc }) => {
  const doc = activeDocKey ? librariesByDoc?.[activeDocKey] : null;
  linkedDocEl.textContent = doc ? `Linked doc: ${doc.docName}` : "No doc linked yet.";
});
