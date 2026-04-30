const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;

async function getLibrary() {
  const { library = [] } = await chrome.storage.local.get("library");
  return library;
}

async function saveLibrary(library) {
  await chrome.storage.local.set({ library });
}

async function fetchReferenceByDoi(doi) {
  const normalized = doi.trim();
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`);
  if (!response.ok) {
    throw new Error(`Crossref lookup failed: ${response.status}`);
  }

  const payload = await response.json();
  const work = payload?.message;
  return {
    doi: normalized,
    title: work?.title?.[0] ?? "Untitled",
    authors: (work?.author ?? [])
      .map((a) => [a.family, a.given].filter(Boolean).join(", "))
      .join("; "),
    year: work?.published?.["date-parts"]?.[0]?.[0] ?? "n.d.",
    journal: work?.["container-title"]?.[0] ?? "",
    url: work?.URL ?? "",
    addedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "addByDoi") {
    const doi = (message.doi ?? "").trim();
    if (!DOI_PATTERN.test(doi)) {
      sendResponse({ ok: false, error: "Invalid DOI format." });
      return;
    }

    (async () => {
      try {
        const library = await getLibrary();
        if (library.some((item) => item.doi.toLowerCase() === doi.toLowerCase())) {
          sendResponse({ ok: false, error: "DOI already exists in your library." });
          return;
        }

        const record = await fetchReferenceByDoi(doi);
        await saveLibrary([...library, record]);
        sendResponse({ ok: true, record });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();

    return true;
  }

  if (message?.type === "listLibrary") {
    (async () => {
      const library = await getLibrary();
      sendResponse({ ok: true, library });
    })();
    return true;
  }

  if (message?.type === "clearLibrary") {
    saveLibrary([]).then(() => sendResponse({ ok: true }));
    return true;
  }
});
