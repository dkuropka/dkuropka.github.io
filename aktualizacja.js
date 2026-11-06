/* Wpisuje w stopkę datę ostatniej aktualizacji pliku rodzina.sqlite. */
(function () {
  "use strict";

  const DB_URL = "./rodzina.sqlite";
  const COMMITS_API = "https://api.github.com/repos/dkuropka/dkuropka.github.io/commits?path=rodzina.sqlite&per_page=1";

  function format(date) {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  async function fromGitHub() {
    const response = await fetch(COMMITS_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const commits = await response.json();
    const iso = commits[0] && commits[0].commit && commits[0].commit.committer && commits[0].commit.committer.date;
    return iso ? new Date(iso) : null;
  }

  async function fromHeader() {
    const response = await fetch(DB_URL, { method: "HEAD", cache: "no-store" });
    const header = response.ok ? response.headers.get("Last-Modified") : null;
    return header ? new Date(header) : null;
  }

  async function lastUpdate() {
    if (location.hostname.endsWith("github.io")) {
      try {
        const date = await fromGitHub();
        if (date && !isNaN(date)) return date;
      } catch (error) { /* fallback do nagłówka */ }
    }
    const date = await fromHeader();
    return date && !isNaN(date) ? date : null;
  }

  async function show() {
    const targets = document.querySelectorAll("[data-aktualizacja]");
    if (!targets.length) return;
    try {
      const date = await lastUpdate();
      if (!date) return;
      targets.forEach(el => {
        el.textContent = `aktualizacja: ${format(date)} `;
        el.hidden = false;
      });
    } catch (error) { /* stopka bez daty */ }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
})();
