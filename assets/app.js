/* AGENTS.md for Empirical Legal Scholars: shows one Markdown file, AGENTS.md, rendered for reading,
   and the Drafter, where anyone can comment on the draft or make a new version.
   Each page says what to show with attributes on <body>:
     data-mode     published (latest version) | drafter (working draft) | archive (one version)
     data-root     path from the page to the site root: ".", "..", or "../.."
     data-version  archive pages only, e.g. "0.0.2"
   There is no build step: GitHub Pages serves these files as they are. */
(() => {
  "use strict";

  const FILE = "AGENTS.md";
  const DRAFT_PATH = `draft/${FILE}`;
  const TEXT_SIZES = [0.85, 0.92, 1, 1.08, 1.17, 1.27, 1.38];
  const WORDS_PER_MINUTE = 230;

  const { mode = "published", root = ".", version: pageVersion } = document.body.dataset;
  const html = document.documentElement;
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const rev = new URLSearchParams(location.search).get("rev");

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
    node.append(...children.flat().filter((child) => child != null && child !== false));
    return node;
  }
  const newTab = { target: "_blank", rel: "noopener" };
  const external = (text, href, cls) => h("a", { class: cls, href, ...newTab, text });
  const button = (text, href, attrs = {}) => h("a", { class: "button", href, ...attrs, text });
  const secondary = (text, href, attrs = {}) => button(text, href, { class: "button secondary", ...attrs });
  const action = (text, onclick, cls = "button secondary") => h("button", { class: cls, type: "button", text, onclick });

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText || "error"} for ${url}`), { status: res.status });
    return res.text();
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  const slugify = (text) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
  const isCommentDraft = (version) => /^0\./.test(version || "");
  const versionLabel = (version) => `Version ${version}${isCommentDraft(version) ? " · comment draft" : ""}`;

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

  // ---------- Reader preferences ----------
  // Stored in this browser only. If storage is blocked, the controls still work for this visit.

  function remember(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* storage unavailable */ }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function setupReaderControls() {
    const smaller = $("[data-size='down']");
    const larger = $("[data-size='up']");
    let index = TEXT_SIZES.indexOf(Number(recall("els-size") || 1));
    if (index < 0) index = TEXT_SIZES.indexOf(1);
    const applySize = () => {
      html.style.setProperty("--reading-scale", TEXT_SIZES[index]);
      remember("els-size", TEXT_SIZES[index] === 1 ? null : String(TEXT_SIZES[index]));
      if (smaller) smaller.disabled = index === 0;
      if (larger) larger.disabled = index === TEXT_SIZES.length - 1;
      updateProgress();
    };
    smaller?.addEventListener("click", () => { if (index > 0) { index -= 1; applySize(); } });
    larger?.addEventListener("click", () => { if (index < TEXT_SIZES.length - 1) { index += 1; applySize(); } });
    applySize();

    const toggle = $("[data-theme-toggle]");
    if (!toggle) return;
    const systemDark = matchMedia("(prefers-color-scheme: dark)");
    const current = () => html.dataset.theme || (systemDark.matches ? "dark" : "light");
    const label = () => {
      const next = current() === "dark" ? "light" : "dark";
      toggle.dataset.current = current();
      toggle.setAttribute("aria-label", `Switch to ${next} mode`);
      toggle.title = `Switch to ${next} mode`;
    };
    toggle.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      html.dataset.theme = next;
      remember("els-theme", next);
      label();
    });
    systemDark.addEventListener?.("change", label);
    label();
  }

  // A hairline across the top shows how far through the page you are.
  const bar = $(".progress span");
  function updateProgress() {
    if (!bar) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0})`;
  }
  addEventListener("scroll", updateProgress, { passive: true });
  addEventListener("resize", updateProgress);

  // ---------- The file ----------

  let currentMarkdown = "";

  function renderMarkdown(markdown) {
    currentMarkdown = markdown;
    const article = $("#doc");
    article.classList.remove("raw");
    article.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
    markHeadings(article);
    addCopyButtons(article);
    for (const link of $$("a[href^='http']", article)) Object.assign(link, newTab);
    buildOutline(article);
    highlightTarget(true);
    updateProgress();
  }

  function fileStats(markdown) {
    const words = (markdown.match(/\S+/g) || []).length;
    const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
    return `${markdown.trimEnd().split("\n").length} lines · about ${minutes} minute${minutes === 1 ? "" : "s"} to read`;
  }

  // Headings get ids for the outline and for links, and a faint Markdown marker (#, ##, ###)
  // in the margin, so the page reads as a rendered .md file.
  function markHeadings(article) {
    const used = new Set();
    for (const heading of $$("h1, h2, h3, h4", article)) {
      let id = slugify(heading.textContent);
      while (used.has(id)) id += "-x";
      used.add(id);
      heading.id = id;
      heading.dataset.md = "#".repeat(Number(heading.tagName[1]));
    }
  }

  function showRaw(show) {
    const article = $("#doc");
    if (!show) return renderMarkdown(currentMarkdown);
    article.classList.add("raw");
    article.replaceChildren(h("pre", { class: "raw-file" }, h("code", { text: currentMarkdown })));
    addCopyButtons(article);
    updateProgress();
  }

  function addCopyButtons(article) {
    for (const pre of $$("pre", article)) {
      const code = $("code", pre) || pre;
      pre.classList.add("has-copy");
      pre.append(h("button", { class: "copy", type: "button", text: "Copy",
        onclick: (event) => copyText(code.textContent, event.currentTarget) }));
    }
  }

  function buildOutline(article) {
    const toc = $("#toc");
    if (!toc) return;
    const headings = $$("h2", article);
    if (headings.length < 3) { toc.hidden = true; return; }
    const links = new Map();
    toc.replaceChildren(h("details", { open: matchMedia("(min-width: 1100px)").matches },
      h("summary", { text: "Outline" }),
      h("ol", {}, ...headings.map((heading) => {
        const link = h("a", { href: `#${heading.id}`, text: heading.textContent });
        links.set(heading.id, link);
        return h("li", {}, link);
      }))));
    toc.hidden = false;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        $$("#toc a.current").forEach((a) => a.classList.remove("current"));
        links.get(entry.target.id)?.classList.add("current");
      }
    }, { rootMargin: "-10% 0px -75% 0px" });
    headings.forEach((heading) => observer.observe(heading));
  }

  // The ids are added after the page loads, so CSS :target can miss them; mark the target ourselves.
  // On first render, jump without animation (a smooth scroll can be cut short), and jump again once
  // the web fonts arrive, since they reflow the page. Later clicks keep the browser's smooth scroll.
  function highlightTarget(jump = false) {
    $(".targeted")?.classList.remove("targeted");
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    if ($("#doc").contains(target)) target.classList.add("targeted");
    if (!jump) return;
    target.scrollIntoView({ behavior: "instant", block: "start" });
    document.fonts?.ready.then(() => target.scrollIntoView({ behavior: "instant", block: "start" }));
  }
  addEventListener("hashchange", () => highlightTarget(false));

  // The file bar: what this is, and what you can do with it.
  function fileBar(meta, actions) {
    $("#file-meta").replaceChildren(...meta.flat().filter(Boolean));
    $("#file-actions").replaceChildren(...actions.flat().filter(Boolean));
  }

  function rawToggle() {
    const control = action("Raw", () => {
      const showing = $("#doc").classList.contains("raw");
      showRaw(!showing);
      control.textContent = showing ? "Raw" : "Rendered";
    });
    return control;
  }

  const copyButton = () => action("Copy", (event) => copyText(currentMarkdown, event.currentTarget));

  function showError(error) {
    $("#doc").replaceChildren(
      h("h1", { text: "Something didn't load" }),
      h("p", { class: "error", text: String(error?.message || error) }),
      h("p", {}, "Try reloading the page, or start from ", h("a", { href: at(""), text: "the home page" }), "."));
  }

  // Comments (Hypothesis) attach to the canonical URL.
  function setCanonical(url) {
    const absolute = new URL(url, location.href).href;
    const link = $("link[rel=canonical]") || document.head.appendChild(h("link", { rel: "canonical" }));
    link.href = absolute;
  }

  function loadHypothesis() {
    if ($("script[src^='https://hypothes.is/']")) return;
    html.classList.add("has-annotations"); // the layout leaves room for its toolbar on the right edge
    document.head.append(
      h("script", { type: "application/json", class: "js-hypothesis-config",
        text: JSON.stringify({ openSidebar: false, showHighlights: "always" }) }),
      h("script", { src: "https://hypothes.is/embed.js", async: true }));
  }

  // ---------- GitHub ----------

  const editUrl = (cfg) => `https://github.com/${cfg.repo}/edit/${cfg.branch}/${DRAFT_PATH}`;
  const repoFile = (cfg, path) => `https://github.com/${cfg.repo}/blob/${cfg.branch}/${path}`;

  async function draftEdits(cfg, count) {
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
      const [latest] = await draftEdits(cfg, 1);
      const raw = `https://raw.githubusercontent.com/${cfg.repo}/${latest.sha}/${DRAFT_PATH}`;
      return { markdown: await fetchText(raw), commit: latest };
    } catch {
      return { markdown: await fetchText(at(DRAFT_PATH)) };
    }
  }

  // ---------- Pages ----------

  function draftNote() {
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Nothing here is final. " }),
        "This is a comment draft. Anyone can comment on it or make a new version in the ",
        h("a", { href: at("draft/"), text: "Drafter" }), "."),
      h("p", {}, button("Open the Drafter", at("draft/"))));
  }

  async function showPublished(cfg) {
    const release = cfg.versions.find((r) => r.version === cfg.latest);
    if (!release) {
      $("#doc").replaceChildren(h("p", {}, "Nothing has been published yet. ", h("a", { href: at("draft/"), text: "Read the draft" }), "."));
      return;
    }
    const markdown = await fetchText(at(`versions/v${cfg.latest}/${FILE}`));
    fileBar(
      [h("span", { class: "badge", text: versionLabel(cfg.latest) }), ` Published ${formatDate(release.date)} · ${fileStats(markdown)}`],
      [button("Download", at(`latest/${FILE}`), { download: FILE }), copyButton(), rawToggle()]);
    renderMarkdown(markdown);
    $("#after").replaceChildren(draftNote());
    setCanonical(at(`versions/v${cfg.latest}/`));
  }

  function drafterIntro(cfg) {
    return h("section", { class: "intro" },
      h("h1", { text: "Drafter" }),
      h("p", { class: "lede", text: "The working draft of AGENTS.md. Anyone can comment on it or make a new version, and every version is kept, so nothing is ever lost." }),
      h("ol", { class: "steps" },
        h("li", {}, h("strong", { text: "Comment. " }), "Select any passage below and choose ", h("em", { text: "Annotate" }),
          ". Comments appear right away for everyone (they use ", external("Hypothesis", "https://web.hypothes.is/start"), ", which asks for a free account)."),
        h("li", {}, h("strong", { text: "Make a new version. " }), "Choose ", h("em", { text: "Make a new version" }),
          ", edit the text on GitHub, and propose the change. Edits to the draft are saved automatically as a new version and show up here within a minute or two (free GitHub account; ",
          external("how it works", repoFile(cfg, "CONTRIBUTING.md")), ")."),
        h("li", {}, h("strong", { text: "Go back to any version. " }), "Every version is listed below the draft. Open one to read it, or restore it as the newest version.")));
  }

  async function showDrafter(cfg) {
    if (rev) return showRevision(cfg, rev);
    $("#intro").replaceChildren(drafterIntro(cfg));
    const { markdown, commit } = await loadDraft(cfg);
    const edited = commit
      ? ` Last edited ${formatDate(commit.commit.author.date)} by ${commit.author?.login ?? commit.commit.author.name} · ` : " ";
    fileBar(
      [h("span", { class: "badge badge-draft", text: `Draft of version ${cfg.draft.replace(/-draft$/, "")}` }), `${edited}${fileStats(markdown)}`],
      [button("Make a new version", editUrl(cfg), newTab), secondary("Download", at(DRAFT_PATH), { download: FILE }), copyButton(), rawToggle()]);
    renderMarkdown(markdown);
    await showEveryVersion(cfg);
    setCanonical(at("draft/"));
    loadHypothesis();
  }

  async function showRevision(cfg, sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("That revision id doesn't look right.");
    const markdown = await fetchText(`https://raw.githubusercontent.com/${cfg.repo}/${sha}/${DRAFT_PATH}`);
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "An earlier version of the draft" }),
      h("p", { class: "lede" }, `This is how AGENTS.md looked after edit ${sha.slice(0, 7)}. `,
        "To make it the newest version again: copy its text, open the editor, select everything there, paste, and propose the change. The restore is saved like any other version."),
      h("p", {}, button("Back to the current draft", at("draft/")), " ",
        secondary("What changed in this edit", `https://github.com/${cfg.repo}/commit/${sha}`, newTab))));
    fileBar(
      [h("span", { class: "badge", text: `Edit ${sha.slice(0, 7)}` }), ` ${fileStats(markdown)}`],
      [action("Copy this version", (event) => copyText(markdown, event.currentTarget, "Copied. Now open the editor and paste"), "button"),
        secondary("Open the editor", editUrl(cfg), newTab), rawToggle()]);
    renderMarkdown(markdown);
  }

  async function showEveryVersion(cfg) {
    const published = h("section", { class: "versions", id: "versions" },
      h("h2", { text: "Published versions" }),
      h("p", { class: "muted", text: "Each published version is a frozen snapshot with a permanent link. Versions 0.0.x are comment drafts; 1.0 will be the first version the contributors recommend as a standard." }),
      h("ul", { class: "version-list" }, ...cfg.versions.map((r) => h("li", {},
        h("a", { class: "version-name", href: at(`versions/v${r.version}/`), text: versionLabel(r.version) }),
        r.version === cfg.latest ? h("span", { class: "badge", text: "latest" }) : null,
        h("span", { class: "muted", text: ` · ${formatDate(r.date)}` }),
        h("div", { class: "version-summary", text: r.summary }),
        h("div", { class: "muted" }, h("a", { href: at(`versions/v${r.version}/${FILE}`), download: `AGENTS-v${r.version}.md`, text: "Download this version" }))))));
    const history = h("section", { class: "versions", id: "history" }, h("h2", { text: "Every edit to the draft" }));
    $("#after").replaceChildren(published, history);
    try {
      const commits = await draftEdits(cfg, 100);
      history.append(
        h("p", { class: "muted", text: `${commits.length === 100 ? "The 100 most recent edits" : `${commits.length} edit${commits.length === 1 ? "" : "s"}`}, newest first. Nothing is lost: open any one to read it or restore it.` }),
        h("div", { class: "table-wrap" }, h("table", { class: "log" },
          h("thead", {}, h("tr", {}, ...["When", "Who", "What", ""].map((t) => h("th", { text: t })))),
          h("tbody", {}, ...commits.map((c) => {
            const who = c.author?.login ?? c.commit.author.name;
            return h("tr", {},
              h("td", { text: new Date(c.commit.author.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) }),
              h("td", {}, c.author?.html_url ? external(who, c.author.html_url) : who),
              h("td", { text: c.commit.message.split("\n")[0] }),
              h("td", { class: "actions" }, h("a", { href: `./?rev=${c.sha}`, text: "Open" }), " · ", external("Changes", c.html_url)));
          })))));
    } catch (error) {
      history.append(h("p", { class: "muted" }, `The edit list couldn't be loaded from GitHub (${error.message}). `,
        isLocal ? "That's expected in a local preview. " : "",
        "The complete log is always on GitHub: ", external("history of the draft", `https://github.com/${cfg.repo}/commits/${cfg.branch}/${DRAFT_PATH}`), "."));
    }
    highlightTarget(true);
    updateProgress();
  }

  async function showArchive(cfg) {
    const release = cfg.versions.find((r) => r.version === pageVersion) || {};
    const markdown = await fetchText(`./${FILE}`);
    const newer = pageVersion !== cfg.latest
      ? [" · ", h("a", { href: at(""), text: `newer version: ${cfg.latest}` })] : [" · the current version"];
    fileBar(
      [h("span", { class: "badge", text: versionLabel(pageVersion) }), ` Published ${formatDate(release.date)}`, ...newer, ` · ${fileStats(markdown)}`],
      [button("Download", `./${FILE}`, { download: FILE }), copyButton(), rawToggle()]);
    renderMarkdown(markdown);
    $("#after").replaceChildren(draftNote());
  }

  function showFooter(cfg) {
    $("#footer")?.replaceChildren(
      h("p", {}, h("span", { class: "brand-file", text: "AGENTS.md" }), " ", h("em", { text: "for Empirical Legal Scholars" })),
      h("p", {}, external("Source on GitHub", `https://github.com/${cfg.repo}`), " · ",
        external("Changelog", repoFile(cfg, "CHANGELOG.md")), " · ",
        external("How to contribute", repoFile(cfg, "CONTRIBUTING.md")), " · ",
        h("a", { href: at("llms.txt"), text: "llms.txt" })));
  }

  async function main() {
    setupReaderControls();
    const views = { published: showPublished, drafter: showDrafter, archive: showArchive };
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
