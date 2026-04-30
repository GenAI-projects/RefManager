const body = document.getElementById("library-body");

function renderRow(item) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><a href="https://doi.org/${item.doi}" target="_blank" rel="noreferrer">${item.doi}</a></td>
    <td>${item.title}</td>
    <td>${item.authors}</td>
    <td>${item.year}</td>
    <td>${item.journal}</td>
  `;
  return tr;
}

function loadLibrary() {
  chrome.runtime.sendMessage({ type: "listLibrary" }, (response) => {
    body.innerHTML = "";
    if (!response?.library?.length) {
      body.innerHTML = `<tr><td colspan="5">No references yet.</td></tr>`;
      return;
    }

    response.library.forEach((item) => {
      body.appendChild(renderRow(item));
    });
  });
}

document.getElementById("refresh").addEventListener("click", loadLibrary);
document.getElementById("clear").addEventListener("click", () => {
  if (!confirm("Clear all references?")) {
    return;
  }

  chrome.runtime.sendMessage({ type: "clearLibrary" }, () => loadLibrary());
});

loadLibrary();
