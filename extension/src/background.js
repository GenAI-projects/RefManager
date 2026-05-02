const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;
const PMID_PATTERN = /^\d{1,10}$/;

async function getLibrary() {
  const { library = [], citationStyle = "apa" } = await chrome.storage.local.get(["library", "citationStyle"]);
  return { library, citationStyle };
}

async function saveLibrary(library) {
  await chrome.storage.local.set({ library });
}

function fingerprint(record) {
  return `${(record.title || "").toLowerCase().replace(/\W+/g, " ").trim()}|${record.year || ""}`;
}

async function fetchReferenceByDoi(doi) {
  const normalized = doi.trim();
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`);
  if (!response.ok) throw new Error(`Crossref lookup failed: ${response.status}`);
  const work = (await response.json())?.message;
  return {
    sourceType: "doi",
    doi: normalized,
    pmid: "",
    title: work?.title?.[0] ?? "Untitled",
    authors: (work?.author ?? []).map((a) => [a.family, a.given].filter(Boolean).join(", ")).join("; "),
    year: work?.published?.["date-parts"]?.[0]?.[0] ?? "n.d.",
    journal: work?.["container-title"]?.[0] ?? "",
    url: work?.URL ?? `https://doi.org/${normalized}`,
    addedAt: new Date().toISOString()
  };
}

async function fetchReferenceByPmid(pmid) {
  const normalized = pmid.trim();
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(normalized)}&retmode=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PubMed lookup failed: ${response.status}`);
  const payload = await response.json();
  const work = payload?.result?.[normalized];
  if (!work) throw new Error("PubMed record not found.");

  return {
    sourceType: "pmid",
    doi: work?.articleids?.find((x) => x.idtype === "doi")?.value ?? "",
    pmid: normalized,
    title: work?.title ?? "Untitled",
    authors: (work?.authors ?? []).map((a) => a.name).join("; "),
    year: (work?.pubdate || "").slice(0, 4) || "n.d.",
    journal: work?.fulljournalname ?? "",
    url: `https://pubmed.ncbi.nlm.nih.gov/${normalized}/`,
    addedAt: new Date().toISOString()
  };
}

function formatCitation(record, style) {
  const authors = record.authors || "Unknown";
  if (style === "mla") return `${authors}. \"${record.title}.\" ${record.journal}, ${record.year}.`;
  if (style === "vancouver") return `${authors}. ${record.title}. ${record.journal}. ${record.year}.`;
  return `${authors} (${record.year}). ${record.title}. ${record.journal}.`;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const { library, citationStyle } = await getLibrary();

    if (message?.type === "addIdentifier") {
      const raw = (message.value ?? "").trim();
      const mode = (message.mode ?? "doi").toLowerCase();
      try {
        let record;
        if (mode === "doi") {
          if (!DOI_PATTERN.test(raw)) throw new Error("Invalid DOI format.");
          if (library.some((x) => x.doi?.toLowerCase() === raw.toLowerCase())) throw new Error("DOI already exists.");
          record = await fetchReferenceByDoi(raw);
        } else {
          if (!PMID_PATTERN.test(raw)) throw new Error("Invalid PMID format.");
          if (library.some((x) => x.pmid === raw)) throw new Error("PMID already exists.");
          record = await fetchReferenceByPmid(raw);
        }
        await saveLibrary([...library, record]);
        sendResponse({ ok: true, record });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return;
    }

    if (message?.type === "listLibrary") {
      sendResponse({ ok: true, library, citationStyle });
      return;
    }

    if (message?.type === "setCitationStyle") {
      await chrome.storage.local.set({ citationStyle: message.style || "apa" });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "citationPreview") {
      sendResponse({ ok: true, citations: library.map((r) => formatCitation(r, citationStyle)) });
      return;
    }

    if (message?.type === "mergeDuplicates") {
      const seen = new Map();
      const merged = [];
      for (const item of library) {
        const key = item.doi?.toLowerCase() || item.pmid || fingerprint(item);
        if (!seen.has(key)) {
          seen.set(key, item);
          merged.push(item);
        }
      }
      await saveLibrary(merged);
      sendResponse({ ok: true, removed: library.length - merged.length });
      return;
    }
  })();

  return true;
});
