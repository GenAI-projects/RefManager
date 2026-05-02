const body = document.getElementById("library-body");
const preview = document.getElementById("preview");
const styleSelect = document.getElementById("style");

function renderLibrary(data) {
  body.innerHTML = "";
  (data.library || []).forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${item.sourceType}</td><td>${item.doi || item.pmid}</td><td>${item.title}</td><td>${item.authors}</td><td>${item.year}</td>`;
    body.appendChild(tr);
  });
  styleSelect.value = data.citationStyle || "apa";
}

function loadLibrary() {
  chrome.runtime.sendMessage({ type: "listLibrary" }, renderLibrary);
  chrome.runtime.sendMessage({ type: "citationPreview" }, (res) => {
    preview.innerHTML = "";
    (res.citations || []).forEach((c) => {
      const li = document.createElement("li"); li.textContent = c; preview.appendChild(li);
    });
  });
}

styleSelect.addEventListener("change", () => chrome.runtime.sendMessage({ type: "setCitationStyle", style: styleSelect.value }, loadLibrary));
document.getElementById("refresh").addEventListener("click", loadLibrary);
document.getElementById("clear").addEventListener("click", () => chrome.storage.local.set({ library: [] }, loadLibrary));
document.getElementById("merge").addEventListener("click", () => chrome.runtime.sendMessage({ type: "mergeDuplicates" }, loadLibrary));
loadLibrary();
