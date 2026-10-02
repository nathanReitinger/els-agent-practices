/* AGENTS.md for Empirical Legal Scholars: renders the guide and AGENTS.md from Markdown, adds the version
   chrome, and gives readers controls for text size and light or dark mode.
   Each page says what to show with attributes on <body>:
     data-mode     published | draft | history | versions | archive
     data-file     guide | agents (default guide)
     data-root     path from the page to the site root: ".", "..", or "../.."
     data-version  archive pages only, e.g. "0.0.1"
   There is no build step: GitHub Pages serves these files as they are. */
(() => {
  "use strict";

  const FILES = {
    guide: { name: "agent-best-practices.md", label: "Guide" },
    agents: { name: "AGENTS.md", label: "AGENTS.md" },
  };
  const TEXT_SIZES = [0.85, 0.92, 1, 1.08, 1.17, 1.27, 1.38];
  const WORDS_PER_MINUTE = 230;

  const { mode = "published", file = "guide", root = ".", version: pageVersion } = document.body.dataset;
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

  // ---------- Where things live ----------

  const releaseFiles = (release) => release?.files || (release ? [FILES.guide.name] : []);
  const hasAgents = (release) => releaseFiles(release).includes(FILES.agents.name);

  function pageUrl(which, inMode = mode, version = pageVersion) {
    const agents = which === "agents";
    if (inMode === "draft") return at(agents ? "draft/agents.html" : "draft/");
    if (inMode === "archive") return at(`versions/v${version}/${agents ? "agents.html" : ""}`);
    return at(agents ? "agents/" : "");
  }

  // Practice IDs in AGENTS.md, like (C4) or (P5), link to the practice in the matching guide.
  function guideHref(id) {
    const anchor = /^P\d$/.test(id) ? `principle-${id.slice(1)}` : id;
    if (mode === "draft") return `${at("draft/")}${rev ? `?rev=${rev}` : ""}#${anchor}`;
    if (mode === "archive") return `./#${anchor}`;
    return `${at("")}#${anchor}`;
  }

  // ---------- Rendering ----------

  let currentMarkdown = "";

  function renderMarkdown(markdown) {
    currentMarkdown = markdown;
    const article = $("#doc");
    article.classList.remove("raw");
    article.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
    addIds(article);
    linkPracticeIds(article);
    addCopyButtons(article);
    for (const link of $$("a[href^='http']", article)) Object.assign(link, newTab);
    buildContents(article);
    showReadingTime(article);
    highlightTarget(true);
    updateProgress();
  }

  function showRaw(show) {
    const article = $("#doc");
    if (!show) return renderMarkdown(currentMarkdown);
    article.classList.add("raw");
    article.replaceChildren(h("pre", { class: "raw-file" }, h("code", { text: currentMarkdown })));
    addCopyButtons(article);
    updateProgress();
  }

  function showReadingTime(article) {
    const slot = $(".read-time");
    if (!slot) return;
    const words = (article.textContent.match(/\S+/g) || []).length;
    const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
    slot.textContent = ` · about ${minutes} minute${minutes === 1 ? "" : "s"} to read`;
  }

  // Headings get ids for the contents list. A paragraph that opens with a bold
  // practice number ("C4.") becomes #C4, and a principle ("3.") becomes
  // #principle-3, so people can link straight to a practice. The number itself
  // is set apart in small caps.
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
      const text = lead.firstChild;
      if (text?.nodeType === Node.TEXT_NODE && text.nodeValue.startsWith(match[0])) {
        text.nodeValue = text.nodeValue.slice(match[0].length);
        lead.prepend(h("span", { class: "pid", text: match[1] }));
      }
      p.prepend(h("a", { class: "anchor", href: `#${id}`, "aria-label": `Link to ${match[1]}`, text: "#" }));
    }
  }

  function linkPracticeIds(article) {
    const ID = "(?:P[1-8]|[A-H]\\d{1,2})";
    const pattern = new RegExp(`\\((${ID}(?:\\s*[,;]\\s*${ID})*)\\)`, "g");
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement.closest("pre, code, a") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      const matches = [...text.matchAll(pattern)];
      if (!matches.length) continue;
      const parts = [];
      let last = 0;
      for (const m of matches) {
        parts.push(text.slice(last, m.index), "(");
        m[1].split(/\s*[,;]\s*/).forEach((id, i) => {
          if (i) parts.push(", ");
          parts.push(h("a", { class: "practice-ref", href: guideHref(id), title: `Why: practice ${id} in the guide`, text: id }));
        });
        parts.push(")");
        last = m.index + m[0].length;
      }
      parts.push(text.slice(last));
      node.replaceWith(...parts);
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
    const links = new Map();
    toc.replaceChildren(h("details", { open: matchMedia("(min-width: 1100px)").matches },
      h("summary", { text: "Contents" }),
      h("ol", {}, ...headings.map((heading) => {
        const link = h("a", { href: `#${heading.id}`, text: heading.textContent });
        links.set(heading.id, link);
        return h("li", { class: heading.tagName === "H3" ? "sub" : null }, link);
      }))));
    toc.hidden = false;
    // Light up the section you're reading.
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
    target.classList.add("targeted");
    if (!jump) return;
    target.scrollIntoView({ behavior: "instant", block: "start" });
    document.fonts?.ready.then(() => target.scrollIntoView({ behavior: "instant", block: "start" }));
  }
  addEventListener("hashchange", () => highlightTarget(false));

  function showBanner(kind, ...rows) {
    const banner = $("#banner");
    banner.className = `banner banner-${kind}`;
    banner.replaceChildren(...rows.flat().filter(Boolean));
    banner.hidden = false;
  }

  // Guide | AGENTS.md switch for the same version or draft.
  function fileSwitch(available = ["guide", "agents"]) {
    return h("span", { class: "file-switch", role: "tablist", "aria-label": "Document" },
      ...available.map((which) => h("a", {
        class: which === file ? "active" : null, href: pageUrl(which), role: "tab",
        "aria-selected": which === file ? "true" : "false", text: FILES[which].label })));
  }

  const docBar = (switcher, badge, ...meta) =>
    h("div", { class: "doc-bar" }, switcher, badge, h("span", { class: "meta" }, ...meta, h("span", { class: "read-time" })));
  const note = (...kids) => h("p", { class: "banner-note" }, ...kids);
  const howToComment = () => [
    "To comment, select any passage and choose ", h("em", { text: "Annotate" }),
    "; comments appear right away (", external("Hypothesis", "https://web.hypothes.is/start"), ", free account). "];
  const agentsUse = () => note("Save it in your project folder as AGENTS.md (or CLAUDE.md for Claude Code), fill in the [bracketed] parts, and delete what you don't need. Each rule's code, like (C4), links to its reason in the guide.");

  function showError(error) {
    $("#doc").replaceChildren(
      h("h1", { text: "Something didn't load" }),
      h("p", { class: "error", text: String(error?.message || error) }),
      h("p", {}, "Try reloading the page, or start from ", h("a", { href: at(""), text: "the home page" }), "."));
  }

  // Comments (Hypothesis) attach to the canonical URL, so comments made on the
  // "latest" pages stay with the version they were about.
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

  const editUrl = (cfg, which) => `https://github.com/${cfg.repo}/edit/${cfg.branch}/draft/${FILES[which].name}`;
  const repoFile = (cfg, path) => `https://github.com/${cfg.repo}/blob/${cfg.branch}/${path}`;

  async function draftCommits(cfg, count, path = "draft") {
    const url = `https://api.github.com/repos/${cfg.repo}/commits?sha=${cfg.branch}` +
      `&path=${encodeURIComponent(path)}&per_page=${count}`;
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    return res.json();
  }

  // Edits to the text: commits that changed either file, merged and newest first.
  async function textEdits(cfg, count) {
    const lists = await Promise.all(["guide", "agents"].map((which) =>
      draftCommits(cfg, count, `draft/${FILES[which].name}`).then((list) => list.map((c) => ({ which, c })))));
    const bySha = new Map();
    for (const { which, c } of lists.flat()) {
      const entry = bySha.get(c.sha) || { ...c, files: [] };
      entry.files.push(which);
      bySha.set(c.sha, entry);
    }
    return [...bySha.values()]
      .sort((a, b) => new Date(b.commit.author.date) - new Date(a.commit.author.date))
      .slice(0, count);
  }

  // The draft is read from GitHub at its newest commit, so a merged edit shows up
  // right away (the GitHub Pages copy can lag). Local previews use the local file.
  async function loadDraft(cfg, which) {
    const path = `draft/${FILES[which].name}`;
    if (isLocal) return { markdown: await fetchText(at(path)) };
    try {
      const [latest] = await draftCommits(cfg, 1, path);
      const raw = `https://raw.githubusercontent.com/${cfg.repo}/${latest.sha}/${path}`;
      return { markdown: await fetchText(raw), commit: latest };
    } catch {
      return { markdown: await fetchText(at(path)) };
    }
  }

  // ---------- Pages ----------

  function downloadButtons(release, base) {
    const files = releaseFiles(release);
    return [
      files.includes(FILES.agents.name)
        ? button("Download AGENTS.md", `${base}${FILES.agents.name}`, { download: "AGENTS.md" }) : null,
      secondary("Download the guide (.md)", `${base}${FILES.guide.name}`, { download: FILES.guide.name }),
    ];
  }

  function agentsButtons() {
    const rawToggle = h("button", { class: "button secondary", type: "button", text: "Show the raw file" });
    rawToggle.addEventListener("click", () => {
      const showing = $("#doc").classList.contains("raw");
      showRaw(!showing);
      rawToggle.textContent = showing ? "Show the raw file" : "Show it formatted";
    });
    return [
      h("button", { class: "button secondary", type: "button", text: "Copy AGENTS.md",
        onclick: (event) => copyText(currentMarkdown, event.currentTarget) }),
      rawToggle,
    ];
  }

  const fetchLine = (url) => h("p", { class: "banner-note fetch" }, "Or, in your project folder: ", h("code", { text: `curl -O ${url}` }));

  async function showPublished(cfg) {
    const release = cfg.versions.find((r) => r.version === cfg.latest);
    if (!release) {
      showBanner("draft", note("Nothing has been published yet. ",
        h("a", { href: pageUrl(file, "draft"), text: "Read the working draft" }), "."));
      $("#doc").replaceChildren();
      return;
    }
    if (file === "agents" && !hasAgents(release)) {
      showBanner("draft", h("div", { class: "doc-bar" }, fileSwitch()),
        note("AGENTS.md isn't in a published version yet. ",
          h("a", { href: pageUrl("agents", "draft"), text: "Read the working draft of AGENTS.md" }), "."));
      $("#doc").replaceChildren();
      return;
    }
    const agents = file === "agents";
    showBanner("published",
      docBar(fileSwitch(hasAgents(release) ? ["guide", "agents"] : ["guide"]),
        h("span", { class: "badge", text: versionLabel(cfg.latest) }), `Published ${formatDate(release.date)}`),
      h("p", { class: "banner-actions" }, ...downloadButtons(release, at("latest/")), ...(agents ? agentsButtons() : [])),
      agents ? fetchLine(`${cfg.site}latest/${FILES.agents.name}`) : null,
      note(isCommentDraft(cfg.latest) ? "Nothing here is final. " : "", ...howToComment(),
        "To change the text itself, ", h("a", { href: pageUrl(file, "draft"), text: "edit the draft" }), "; anyone can."),
      agents ? agentsUse() : null);
    renderMarkdown(await fetchText(at(`versions/v${cfg.latest}/${FILES[file].name}`)));
    setCanonical(pageUrl(file, "archive", cfg.latest));
    loadHypothesis();
  }

  async function showDraft(cfg) {
    if (rev) return showRevision(cfg, rev);
    const lastEdit = h("span");
    const agents = file === "agents";
    showBanner("draft",
      docBar(fileSwitch(), h("span", { class: "badge badge-draft", text: `Draft of version ${cfg.draft.replace(/-draft$/, "")}` }), lastEdit),
      h("p", { class: "banner-actions" },
        button(`Edit ${agents ? "AGENTS.md" : "the guide"}`, editUrl(cfg, file), newTab),
        secondary("Edit history", at("draft/history.html")),
        secondary("How editing works", repoFile(cfg, "CONTRIBUTING.md"), newTab),
        ...(agents ? agentsButtons() : [])),
      note("Anyone can edit this draft, and every edit is logged and can be undone. ", ...howToComment(),
        cfg.latest ? ["For a frozen snapshot, see ", h("a", { href: pageUrl(file, "published"), text: `version ${cfg.latest}` }), "."] : ""),
      agents ? agentsUse() : null);
    const { markdown, commit } = await loadDraft(cfg, file);
    renderMarkdown(markdown);
    if (commit) {
      const who = commit.author?.login ?? commit.commit.author.name;
      lastEdit.textContent = `Last edited ${formatDate(commit.commit.author.date)} by ${who}`;
    }
    setCanonical(pageUrl(file, "draft"));
    loadHypothesis();
  }

  async function showRevision(cfg, sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("That revision id doesn't look right.");
    const path = `draft/${FILES[file].name}`;
    let markdown;
    try {
      markdown = await fetchText(`https://raw.githubusercontent.com/${cfg.repo}/${sha}/${path}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      showBanner("archive", h("div", { class: "doc-bar" }, fileSwitch()),
        note(`${FILES[file].label} didn't exist yet at revision ${sha.slice(0, 7)}. `,
          h("a", { href: at("draft/history.html"), text: "Back to the edit history" }), "."));
      $("#doc").replaceChildren();
      return;
    }
    showBanner("archive",
      docBar(fileSwitch(), h("span", { class: "badge", text: `Revision ${sha.slice(0, 7)}` }),
        `How ${file === "agents" ? "AGENTS.md" : "the guide"} looked after an earlier edit`),
      h("p", { class: "banner-actions" },
        button("Back to the current draft", pageUrl(file, "draft")),
        h("button", { class: "button secondary", type: "button", text: "Copy this revision's text",
          onclick: (event) => copyText(markdown, event.currentTarget, "Copied. Now open the editor and paste") }),
        secondary("Open the editor", editUrl(cfg, file), newTab),
        secondary("What changed in this edit", `https://github.com/${cfg.repo}/commit/${sha}`, newTab)),
      note("To restore this revision, copy its text, open the editor, select everything there, paste, " +
        "and propose the change. The restore is merged and logged like any other edit."));
    // The guide/AGENTS.md switch keeps the same revision.
    for (const link of $$(".file-switch a")) link.href += `?rev=${sha}`;
    renderMarkdown(markdown);
  }

  async function showHistory(cfg) {
    const fullLog = `https://github.com/${cfg.repo}/commits/${cfg.branch}/draft`;
    showBanner("draft",
      h("div", { class: "doc-bar" }, h("span", { class: "badge badge-draft", text: "Edit history" }),
        h("span", { class: "meta", text: "Every edit to the text of the guide and AGENTS.md, newest first" })),
      h("p", { class: "banner-actions" },
        button("Back to the draft", at("draft/")),
        secondary("Full log on GitHub", fullLog, newTab)),
      note("Nothing is lost: any revision can be viewed and restored."));
    const doc = $("#doc");
    let commits;
    try {
      commits = await textEdits(cfg, 100);
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
        h("td", { class: "actions" },
          ...c.files.flatMap((which) => [h("a", { href: which === "agents" ? `./agents.html?rev=${c.sha}` : `./?rev=${c.sha}`, text: FILES[which].label }), " · "]),
          external("Changes", c.html_url)));
    });
    doc.replaceChildren(
      h("h1", { text: "Edit history of the draft" }),
      h("p", { class: "muted", text: (commits.length === 100
        ? "The 100 most recent edits. Older ones are in the full log on GitHub."
        : `${commits.length} edit${commits.length === 1 ? "" : "s"} so far.`) +
        " Choose the file name to read it as it was after the edit." }),
      h("div", { class: "table-wrap" }, h("table", { class: "log" },
        h("thead", {}, h("tr", {}, ...["When", "Who", "What", "View"].map((t) => h("th", { text: t })))),
        h("tbody", {}, ...rows))));
    updateProgress();
  }

  function showVersions(cfg) {
    const fileLinks = (r) => {
      const files = releaseFiles(r);
      const links = [h("a", { href: at(`versions/v${r.version}/`), text: "Guide" })];
      if (files.includes(FILES.agents.name)) links.push(" · ", h("a", { href: at(`versions/v${r.version}/agents.html`), text: "AGENTS.md" }));
      links.push(" · Raw files: ", ...files.flatMap((name, i) => [i ? ", " : "", h("a", { href: at(`versions/v${r.version}/${name}`), text: name })]));
      return links;
    };
    const items = cfg.versions.map((r) => h("li", {},
      h("a", { href: at(`versions/v${r.version}/`), text: versionLabel(r.version) }),
      r.version === cfg.latest ? h("span", { class: "badge", text: "latest" }) : null,
      h("span", { class: "muted", text: ` · ${formatDate(r.date)}` }),
      h("div", { text: r.summary }),
      h("div", { class: "muted" }, ...fileLinks(r))));
    $("#doc").replaceChildren(
      h("h1", { text: "All versions" }),
      h("p", {}, "Each version is a frozen snapshot with a permanent link, so links and comments always point to the same text. Changes happen in the ",
        h("a", { href: at("draft/"), text: `draft (${cfg.draft})` }), ", which anyone can edit."),
      items.length ? h("ul", { class: "versions" }, ...items) : h("p", { class: "muted", text: "Nothing has been published yet." }),
      h("h2", { text: "How version numbers work" }),
      h("ul", {},
        h("li", {}, h("strong", { text: "0.0.x: comment drafts." }), " Nothing is final. Each new comment draft adds one to the last number (0.0.1, 0.0.2, ...)."),
        h("li", {}, h("strong", { text: "1.0.0" }), " will be the first version the contributors are ready to recommend as a standard."),
        h("li", {}, "After 1.0: ", h("strong", { text: "patch" }), " (1.0.1) fixes wording and references, ",
          h("strong", { text: "minor" }), " (1.1.0) adds practices, and ", h("strong", { text: "major" }),
          " (2.0.0) removes or reverses advice."),
        h("li", {}, "Practice numbers (like D3) keep their meaning once published.")),
      h("p", {}, "Details are in ", external("CONTRIBUTING.md", repoFile(cfg, "CONTRIBUTING.md")),
        ", and what changed in each version is in the ", external("changelog", repoFile(cfg, "CHANGELOG.md")), "."));
    updateProgress();
  }

  async function showArchive(cfg) {
    const release = cfg.versions.find((r) => r.version === pageVersion) || {};
    const current = pageVersion === cfg.latest;
    const agents = file === "agents";
    showBanner(current ? "published" : "archive",
      docBar(fileSwitch(hasAgents(release) ? ["guide", "agents"] : ["guide"]),
        h("span", { class: "badge", text: versionLabel(pageVersion) }), `Published ${formatDate(release.date)}`),
      h("p", { class: "banner-actions" }, ...downloadButtons(release, "./"), ...(agents ? agentsButtons() : [])),
      agents ? fetchLine(`${cfg.site}versions/v${pageVersion}/${FILES.agents.name}`) : null,
      note(current ? "This is the current version. " : ["There's a newer version: ",
        h("a", { href: pageUrl(file, "published"), text: `version ${cfg.latest}` }), ". "], ...howToComment()),
      agents ? agentsUse() : null);
    renderMarkdown(await fetchText(`./${FILES[file].name}`));
    setCanonical(location.href.split(/[?#]/)[0]);
    loadHypothesis();
  }

  function showFooter(cfg) {
    $("#footer")?.replaceChildren(
      h("p", {}, h("em", { text: cfg.name || cfg.title })),
      h("p", {}, external("Source on GitHub", `https://github.com/${cfg.repo}`), " · ",
        external("Changelog", repoFile(cfg, "CHANGELOG.md")), " · ",
        external("How to contribute", repoFile(cfg, "CONTRIBUTING.md")), " · ",
        h("a", { href: at("llms.txt"), text: "llms.txt" })));
  }

  async function main() {
    setupReaderControls();
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
