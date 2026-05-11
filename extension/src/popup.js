const form = document.getElementById("id-form");
const statusEl = document.getElementById("status");

document.getElementById("convert-current").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "convertDocTokens" }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = `Could not convert in this tab: ${chrome.runtime.lastError.message}`;
      return;
    }
    statusEl.textContent = response?.ok
      ? `Converted ${response.replacedCount || 0} token group(s). Imported ${response.imported || 0} new reference(s).`
      : `Could not convert in this tab: ${response?.error || "Unknown error"}`;
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
