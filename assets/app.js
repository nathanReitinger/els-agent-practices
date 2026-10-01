/* ELS Agent Practices: renders the guide from Markdown and adds the version chrome.
   Each page says what to show with attributes on <body>:
     data-mode     published | draft | history | versions | archive
     data-root     path from the page to the site root: ".", "..", or "../.."
     data-version  archive pages only, e.g. "0.1.0"
   There is no build step: GitHub Pages serves these files as they are. */
(() => {
  "use strict";

  const GUIDE = "agent-best-practices.md";
  const STARTER = "starter-CLAUDE.md";
  const DRAFT_PATH = `draft/${GUIDE}`;

  const { mode = "published", root = ".", version: pageVersion } = document.body.dataset;
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
  const at = (path = "") => `${root}/${path}`;

  // h("a", { href: "#", text: "Link" }, child, ...): a small element builder.
  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.filter((child) => child != null && child !== false));
    return node;
  }
  const external = (text, href, cls) => h("a", { class: cls, href, target: "_blank", rel: "noopener", text });
  const button = (text, href, attrs = {}) => h("a", { class: "button", href, ...attrs, text });
  const newTab = { target: "_blank", rel: "noopener" };

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText || "error"} for ${url}`);
    return res.text();
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  const slugify = (text) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";

  async function copyText(text, control, done = "Copied") {
    const label = control.textContent;
    try {
      await navigator.clipboard.writeText(text);
      control.textContent = done;
    } catch {
      control.textContent = "Couldn't copy; select the text instead";
    }
    setTimeout(() => (control.textContent = label), 2500);
  }

  // ---------- Rendering ----------

  function renderMarkdown(markdown) {
    const article = $("#doc");
    article.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
    addIds(article);
    addCopyButtons(article);
    for (const link of $$("a[href^='http']", article)) Object.assign(link, newTab);
    buildContents(article);
    highlightTarget();
  }

  // The ids are added after the page loads, so CSS :target can miss them; mark the target ourselves.
  function highlightTarget() {
    $(".targeted")?.classList.remove("targeted");
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    target.classList.add("targeted");
    target.scrollIntoView();
  }
  addEventListener("hashchange", highlightTarget);

  // Headings get ids for the contents list. A paragraph that opens with a bold
  // practice number ("C4.") becomes #C4, and a principle ("3.") becomes
  // #principle-3, so people can link straight to a practice.
  function addIds(article) {
    const used = new Set();
    for (const heading of $$("h1, h2, h3", article)) {
      let id = slugify(heading.textContent);
      while (used.has(id)) id += "-x";
      used.add(id);
      heading.id = id;
    }
    for (const p of $$("p", article)) {
      const lead = p.firstChild;
      if (!(lead instanceof HTMLElement) || lead.tagName !== "STRONG") continue;
      const match = lead.textContent.match(/^([A-H]\d+|\d+)\.\s/);
      if (!match) continue;
      const id = /^\d+$/.test(match[1]) ? `principle-${match[1]}` : match[1];
      if (used.has(id)) continue;
      used.add(id);
      p.id = id;
      p.classList.add("practice");
      p.prepend(h("a", { class: "anchor", href: `#${id}`, "aria-label": `Link to ${match[1]}`, text: "#" }));
    }
  }

  function addCopyButtons(article) {
    for (const pre of $$("pre", article)) {
      const code = $("code", pre) || pre;
      pre.classList.add("has-copy");
      pre.append(h("button", { class: "copy", type: "button", text: "Copy",
        onclick: (event) => copyText(code.textContent, event.currentTarget) }));
    }
  }

  function buildContents(article) {
    const toc = $("#toc");
    if (!toc) return;
    const headings = $$("h2, h3", article);
    if (headings.length < 3) { toc.hidden = true; return; }
    toc.replaceChildren(h("details", { open: matchMedia("(min-width: 1100px)").matches },
      h("summary", { text: "Contents" }),
      h("ol", {}, ...headings.map((heading) =>
        h("li", { class: heading.tagName === "H3" ? "sub" : null },
          h("a", { href: `#${heading.id}`, text: heading.textContent }))))));
    toc.hidden = false;
  }

  function showBanner(kind, ...rows) {
    const banner = $("#banner");
    banner.className = `banner banner-${kind}`;
    banner.replaceChildren(...rows);
    banner.hidden = false;
  }

  function showError(error) {
    $("#doc").replaceChildren(
      h("h1", { text: "Something didn't load" }),
      h("p", { class: "error", text: String(error?.message || error) }),
      h("p", {}, "Try reloading the page, or start from ", h("a", { href: at(""), text: "the home page" }), "."));
  }

  function citation(cfg, version, date) {
    const link = `${cfg.site}versions/v${version}/`;
    return h("span", { class: "cite" }, "Cite as: ", `${cfg.authors}, `, h("em", { text: cfg.title }),
      ` (version ${version}, ${String(date || "").slice(0, 4)}), `, h("a", { href: link, text: link }), ".");
  }

  // ---------- GitHub ----------

  const editUrl = (cfg) => `https://github.com/${cfg.repo}/edit/${cfg.branch}/${DRAFT_PATH}`;
  const repoFile = (cfg, file) => `https://github.com/${cfg.repo}/blob/${cfg.branch}/${file}`;

  async function draftCommits(cfg, count) {
    const url = `https://api.github.com/repos/${cfg.repo}/commits?sha=${cfg.branch}` +
      `&path=${encodeURIComponent(DRAFT_PATH)}&per_page=${count}`;
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    return res.json();
  }

  // The draft is read from GitHub at its newest commit, so a merged edit shows up
  // right away (the GitHub Pages copy can lag). Local previews use the local file.
  async function loadDraft(cfg) {
    if (isLocal) return { markdown: await fetchText(at(DRAFT_PATH)) };
    try {
      const [latest] = await draftCommits(cfg, 1);
      const raw = `https://raw.githubusercontent.com/${cfg.repo}/${latest.sha}/${DRAFT_PATH}`;
      return { markdown: await fetchText(raw), commit: latest };
    } catch {
      return { markdown: await fetchText(at(DRAFT_PATH)) };
    }
  }

  function loadHypothesis() {
    if ($("script[src^='https://hypothes.is/']")) return;
    document.head.append(
      h("script", { type: "application/json", class: "js-hypothesis-config",
        text: JSON.stringify({ openSidebar: false, showHighlights: "always" }) }),
      h("script", { src: "https://hypothes.is/embed.js", async: true }));
  }

  // ---------- Pages ----------

  async function showPublished(cfg) {
    if (!cfg.latest) {
      showBanner("draft", h("p", { class: "banner-title" }, "Nothing has been published yet. ",
        h("a", { href: at("draft/"), text: "Read the working draft" }), "."));
      $("#doc").replaceChildren();
      return;
    }
    const release = cfg.versions.find((r) => r.version === cfg.latest) || {};
    showBanner("published",
      h("p", { class: "banner-title" }, h("span", { class: "badge", text: `Version ${cfg.latest}` }),
        `Published ${formatDate(release.date)}. Published versions never change.`),
      h("p", { class: "banner-actions" },
        button("Download the starter CLAUDE.md", at(`latest/${STARTER}`), { download: "CLAUDE.md" }),
        button("Download the full guide (.md)", at(`latest/${GUIDE}`), { class: "button secondary", download: GUIDE })),
      h("p", { class: "banner-note" }, "The next version is being written in the open: ",
        h("a", { href: at("draft/"), text: "anyone can edit the draft" }), ".", citation(cfg, cfg.latest, release.date)));
    renderMarkdown(await fetchText(at(`versions/v${cfg.latest}/${GUIDE}`)));
  }

  async function showDraft(cfg) {
    const rev = new URLSearchParams(location.search).get("rev");
    if (rev) return showRevision(cfg, rev);
    const lastEdit = h("span", { class: "muted" });
    showBanner("draft",
      h("p", { class: "banner-title" },
        h("span", { class: "badge badge-draft", text: `Draft of version ${cfg.draft.replace(/-draft$/, "")}` }),
        "Anyone can edit this draft. Every edit is logged and can be undone. ", lastEdit),
      h("p", { class: "banner-actions" },
        button("Edit this draft", editUrl(cfg), newTab),
        button("Edit history", at("draft/history.html"), { class: "button secondary" }),
        button("How editing works", repoFile(cfg, "CONTRIBUTING.md"), { class: "button secondary", ...newTab })),
      h("p", { class: "banner-note" }, "To comment instead, highlight any passage. Comments use ",
        external("Hypothesis", "https://web.hypothes.is/"), ", which needs a free account. ",
        cfg.latest
          ? h("span", {}, "For a stable version to cite, use ", h("a", { href: at(""), text: `version ${cfg.latest}` }), ".")
          : "No version has been published yet."));
    const { markdown, commit } = await loadDraft(cfg);
    renderMarkdown(markdown);
    if (commit) {
      const who = commit.author?.login ?? commit.commit.author.name;
      lastEdit.textContent = `Last edited ${formatDate(commit.commit.author.date)} by ${who}.`;
    }
    loadHypothesis();
  }

  async function showRevision(cfg, sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("That revision id doesn't look right.");
    const markdown = await fetchText(`https://raw.githubusercontent.com/${cfg.repo}/${sha}/${DRAFT_PATH}`);
    showBanner("archive",
      h("p", { class: "banner-title" }, h("span", { class: "badge", text: `Revision ${sha.slice(0, 7)}` }),
        "This is how the draft looked after an earlier edit."),
      h("p", { class: "banner-actions" },
        button("Back to the current draft", at("draft/")),
        h("button", { class: "button secondary", type: "button", text: "Copy this revision's text",
          onclick: (event) => copyText(markdown, event.currentTarget, "Copied. Now open the editor and paste") }),
        button("Open the editor", editUrl(cfg), { class: "button secondary", ...newTab }),
        button("What changed in this edit", `https://github.com/${cfg.repo}/commit/${sha}`, { class: "button secondary", ...newTab })),
      h("p", { class: "banner-note", text: "To restore this revision, copy its text, open the editor, " +
        "select everything there, paste, and propose the change. The restore is merged and logged like any other edit." }));
    renderMarkdown(markdown);
  }

  async function showHistory(cfg) {
    const fullLog = `https://github.com/${cfg.repo}/commits/${cfg.branch}/${DRAFT_PATH}`;
    showBanner("draft",
      h("p", { class: "banner-title" }, h("span", { class: "badge badge-draft", text: "Edit history" }),
        "Every edit to the draft, newest first. Nothing is lost: any revision can be viewed and restored."),
      h("p", { class: "banner-actions" },
        button("Back to the draft", at("draft/")),
        button("Full log on GitHub", fullLog, { class: "button secondary", ...newTab })));
    const doc = $("#doc");
    let commits;
    try {
      commits = await draftCommits(cfg, 100);
    } catch (error) {
      doc.replaceChildren(h("h1", { text: "Edit history" }),
        h("p", {}, `The edit log couldn't be loaded from GitHub (${error.message}). `,
          isLocal ? "That's expected in a local preview before the repository exists. " : "",
          "The complete log is always on GitHub: ", external("history of the draft", fullLog), "."));
      return;
    }
    const rows = commits.map((c) => {
      const who = c.author?.login ?? c.commit.author.name;
      return h("tr", {},
        h("td", { text: new Date(c.commit.author.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) }),
        h("td", {}, c.author?.html_url ? external(who, c.author.html_url) : who),
        h("td", { text: c.commit.message.split("\n")[0] }),
        h("td", { class: "actions" }, h("a", { href: `./?rev=${c.sha}`, text: "View" }), " · ", external("Changes", c.html_url)));
    });
    doc.replaceChildren(
      h("h1", { text: "Edit history of the draft" }),
      h("p", { class: "muted", text: commits.length === 100
        ? "The 100 most recent edits. Older ones are in the full log on GitHub."
        : `${commits.length} edit${commits.length === 1 ? "" : "s"} so far.` }),
      h("div", { class: "table-wrap" }, h("table", { class: "log" },
        h("thead", {}, h("tr", {}, ...["When", "Who", "What", ""].map((t) => h("th", { text: t })))),
        h("tbody", {}, ...rows))));
  }

  function showVersions(cfg) {
    const items = cfg.versions.map((r) => h("li", {},
      h("a", { href: at(`versions/v${r.version}/`), text: `Version ${r.version}` }),
      r.version === cfg.latest ? h("span", { class: "badge", text: "latest" }) : null,
      h("span", { class: "muted", text: ` · ${formatDate(r.date)}` }),
      h("div", { text: r.summary }),
      h("div", { class: "muted" },
        h("a", { href: at(`versions/v${r.version}/${GUIDE}`), text: "Guide (.md)" }), " · ",
        h("a", { href: at(`versions/v${r.version}/${STARTER}`), text: "Starter CLAUDE.md" }))));
    $("#doc").replaceChildren(
      h("h1", { text: "All versions" }),
      h("p", {}, "Published versions never change, so each can be cited by its number and permanent link. " +
        "Changes happen in the ", h("a", { href: at("draft/"), text: `draft (${cfg.draft})` }), ", which anyone can edit."),
      items.length ? h("ul", { class: "versions" }, ...items) : h("p", { class: "muted", text: "Nothing has been published yet." }),
      h("h2", { text: "How version numbers work" }),
      h("ul", {},
        h("li", {}, h("strong", { text: "Patch" }), " (0.1.0 → 0.1.1): wording, typos, links, and reference fixes. The advice doesn't change."),
        h("li", {}, h("strong", { text: "Minor" }), " (0.1.0 → 0.2.0): new practices or other additions that don't contradict earlier advice."),
        h("li", {}, h("strong", { text: "Major" }), " (1.0.0 → 2.0.0): a practice is removed or reversed, so someone following the earlier version would need to change what they do."),
        h("li", {}, "Versions below 1.0 are community drafts. A practice number (like D3) keeps its meaning once published.")),
      h("p", {}, "Details are in ", external("CONTRIBUTING.md", repoFile(cfg, "CONTRIBUTING.md")),
        ", and what changed in each version is in the ", external("changelog", repoFile(cfg, "CHANGELOG.md")), "."));
  }

  async function showArchive(cfg) {
    const release = cfg.versions.find((r) => r.version === pageVersion) || {};
    const current = pageVersion === cfg.latest;
    showBanner(current ? "published" : "archive",
      h("p", { class: "banner-title" }, h("span", { class: "badge", text: `Version ${pageVersion}` }),
        `Published ${formatDate(release.date)}. `,
        current ? "This is the current version."
          : h("span", {}, "There's a newer version: ", h("a", { href: at(""), text: `version ${cfg.latest}` }), ".")),
      h("p", { class: "banner-actions" },
        button("Download the starter CLAUDE.md", `./${STARTER}`, { download: "CLAUDE.md" }),
        button("Download this version (.md)", `./${GUIDE}`, { class: "button secondary", download: GUIDE })),
      h("p", { class: "banner-note" }, citation(cfg, pageVersion, release.date)));
    renderMarkdown(await fetchText(`./${GUIDE}`));
  }

  function showFooter(cfg) {
    $("#footer")?.replaceChildren(
      h("p", { text: cfg.title }),
      h("p", {}, external("Source on GitHub", `https://github.com/${cfg.repo}`), " · ",
        external("Changelog", repoFile(cfg, "CHANGELOG.md")), " · ",
        external("How to contribute", repoFile(cfg, "CONTRIBUTING.md")), " · ",
        h("a", { href: at("llms.txt"), text: "llms.txt" })));
  }

  async function main() {
    const views = { published: showPublished, draft: showDraft, history: showHistory, versions: showVersions, archive: showArchive };
    try {
      const cfg = JSON.parse(await fetchText(at("versions.json")));
      for (const link of $$("[data-repo-link]")) link.href = `https://github.com/${cfg.repo}`;
      showFooter(cfg);
      await (views[mode] || showPublished)(cfg);
    } catch (error) {
      showError(error);
    }
  }

  main();
})();
