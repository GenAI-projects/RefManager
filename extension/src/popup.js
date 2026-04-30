const form = document.getElementById("doi-form");
const statusEl = document.getElementById("status");
const openLibraryBtn = document.getElementById("open-library");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const doi = new FormData(form).get("doi");
  statusEl.textContent = "Adding...";

  chrome.runtime.sendMessage({ type: "addByDoi", doi }, (response) => {
    if (!response?.ok) {
      statusEl.textContent = response?.error ?? "Unknown error.";
      return;
    }

    statusEl.textContent = `Added: ${response.record.title}`;
    form.reset();
  });
});

openLibraryBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
