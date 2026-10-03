/* AGENTS.md for Empirical Legal Scholars: shows one Markdown file, AGENTS.md, rendered for reading;
   Suggest Edits, where anyone can comment, and readers who sign in with their email suggest changes by editing
   the text with track changes on; the Maintainers page; the Declined page; a page for joining the community's
   group; and a page that checks whether a copy is exactly a published version.
   Each page says what to show with attributes on <body>:
     data-mode     published (latest version) | drafter (Suggest Edits) | archive (one version) | check | join |
                   maintainers | declined
     data-root     path from the page to the site root: ".", "..", or "../.."
     data-version  archive pages only, e.g. "0.0.2"
   There is no build step: GitHub Pages serves these files as they are. Suggestions and votes are kept in a
   Supabase database (supabase/schema.sql); a robot (scripts/proposals.py) counts the votes and publishes each
   approved change. */
(() => {
  "use strict";

  const FILE = "AGENTS.md";
  const DRAFT_PATH = `draft/${FILE}`;
  const LEDGER_PATH = "governance/proposals.json";
  const MAINTAINERS_PATH = "governance/maintainers.json";
  const HYPOTHESIS_SEARCH = "https://api.hypothes.is/api/search";
  const CHECK_EVERY = "five minutes";
  const FINAL = ["adopted", "declined", "withdrawn", "cannot-apply"];
  const KIND_LABELS = { delete: "Delete", replace: "Replace", insert: "Add words", rule: "Add a rule" };
  const COMMAND = "tr -d '\\r' < AGENTS.md | sed 3d | python3 -c \"import sys; from argon2.low_level import hash_secret_raw, Type; " +
    "print(hash_secret_raw(sys.stdin.buffer.read(), b'AGENTS.md-ELS-v1', 3, 65536, 4, 32, Type.ID).hex())\"";
  // The Argon2id library for checking a copy, pinned to one version and verified by the browser before it runs.
  const ARGON2_LIBRARY = {
    src: "https://cdn.jsdelivr.net/npm/hash-wasm@4.12.0/dist/argon2.umd.min.js",
    integrity: "sha384-tP0Wy54CKmng7i9EoTlPySD0hBx6Octj0VS6MfwlnUu111MPa+JLm0CCbep6XJ1W",
  };
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
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
  const squash = (text) => String(text || "").split(/\s+/).filter(Boolean).join(" ");
  const joined = (parts, separator = " · ") => parts.flatMap((part, i) => (i ? [separator, part] : [part]));

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText || "error"} for ${url}`), { status: res.status });
    return res.text();
  }
  const fetchJSON = async (url) => JSON.parse(await fetchText(url));

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  const slugify = (text) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
  const isCommentDraft = (version) => /^0\./.test(version || "");
  const versionLabel = (version) => `Version ${version}${isCommentDraft(version) ? " · comment draft" : ""}`;
  const stampedVersion = (markdown) => (markdown.replace(/\r/g, "").split("\n")[2] || "").match(/^\*Version (\S+)/)?.[1];

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

  // Things that stick to the top of the screen (the bar above the text on Suggest Edits) sit just below the
  // header, however tall it is at this width.
  function trackHeader() {
    const header = $(".site-header");
    if (!header || !("ResizeObserver" in window)) return;
    const place = () => html.style.setProperty("--below-header",
      `${(parseFloat(getComputedStyle(header).top) || 0) + header.offsetHeight + 6}px`);
    new ResizeObserver(place).observe(header);
    place();
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

  // The rendered file, without rebuilding the outline or scrolling: for drawing the text again in place.
  function fillDoc(article, markdown) {
    currentMarkdown = markdown;
    article.classList.remove("raw");
    article.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
    markHeadings(article);
    addCopyButtons(article);
    for (const link of $$("a[href^='http']", article)) Object.assign(link, newTab);
  }

  function renderMarkdown(markdown) {
    const article = $("#doc");
    fillDoc(article, markdown);
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

  function addCopyButtons(scope) {
    for (const pre of $$("pre", scope)) {
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
    control.classList.add("raw-toggle");
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

  // ---------- Fingerprints ----------
  // A version's fingerprint is the Argon2id hash of its file without line 3, the version line
  // (which states the fingerprint). Carriage returns are removed first, so line endings don't matter.
  // The settings are fixed and public (versions.json, "fingerprint"); scripts/fingerprint.py computes the same thing.

  let fingerprintSettings = { salt: "AGENTS.md-ELS-v1", iterations: 3, memory_kib: 65536, parallelism: 4, length_bytes: 32 };
  let argon2Loading = null;

  function loadArgon2() {
    argon2Loading ||= new Promise((resolve, reject) => {
      if (window.hashwasm?.argon2id) return resolve(window.hashwasm);
      document.head.append(h("script", { src: ARGON2_LIBRARY.src, integrity: ARGON2_LIBRARY.integrity, crossorigin: "anonymous",
        onload: () => resolve(window.hashwasm),
        onerror: () => { argon2Loading = null; reject(new Error("The fingerprint tool couldn't be loaded. Check your connection and try again.")); } }));
    });
    return argon2Loading;
  }

  function canonicalLines(text) {
    const lines = String(text).replace(/^﻿/, "").replace(/\r/g, "").split("\n");
    if (lines.length < 3) return null;
    lines.splice(2, 1);
    return lines;
  }

  async function fingerprintOf(text) {
    const lines = canonicalLines(text);
    if (!lines) return null;
    const { argon2id } = await loadArgon2();
    const encode = (value) => new TextEncoder().encode(value);
    const settings = fingerprintSettings;
    return argon2id({ password: encode(lines.join("\n")), salt: encode(settings.salt), iterations: settings.iterations,
      parallelism: settings.parallelism, memorySize: settings.memory_kib, hashLength: settings.length_bytes, outputType: "hex" });
  }

  function fingerprintLine(value, label = "Fingerprint (Argon2id)") {
    if (!value) return null;
    return h("div", { class: "fingerprint" }, h("span", { class: "muted", text: `${label} ` }),
      h("code", { text: value }), " ", action("Copy", (event) => copyText(value, event.currentTarget), "copy-inline"));
  }

  // ---------- Differences ----------

  // The longest common subsequence of two lists, as [op, item] pairs: "same", "del", or "ins".
  function diffLists(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 4e6) return null;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push(["same", a[i]]); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) out.push(["del", a[i++]]);
      else out.push(["ins", b[j++]]);
    }
    while (i < n) out.push(["del", a[i++]]);
    while (j < m) out.push(["ins", b[j++]]);
    return out;
  }

  // Words, spaces, and punctuation marks, so a change to "control (git)," shows only " (git)" struck out.
  const tokens = (text) => text.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_]/gu) || [];

  // A line's changes as segments: unchanged text, or a change from old words to new words. Changes
  // separated only by a space are joined, so "null, weak, and" -> "null and" is one change.
  function changeSegments(before, after) {
    const ops = diffLists(tokens(before), tokens(after)) || [["del", before], ["ins", after]];
    const segments = [];
    for (const [op, piece] of ops) {
      const last = segments[segments.length - 1];
      if (op === "same") {
        if (last?.same !== undefined) last.same += piece;
        else segments.push({ same: piece });
      } else {
        const change = last && last.same === undefined ? last : (segments.push({ old: "", new: "" }), segments[segments.length - 1]);
        change[op === "del" ? "old" : "new"] += piece;
      }
    }
    for (let i = segments.length - 2; i > 0; i--) {
      const [a, gap, b] = [segments[i - 1], segments[i], segments[i + 1]];
      if (gap.same !== undefined && !gap.same.trim() && a.same === undefined && b && b.same === undefined) {
        segments.splice(i - 1, 3, { old: a.old + gap.same + b.old, new: a.new + gap.same + b.new });
      }
    }
    return segments;
  }

  // One line, as tracked changes: deleted words struck through, new words underlined.
  function trackChanges(before, after) {
    return changeSegments(before, after).flatMap((segment) => {
      if (segment.same !== undefined) return [segment.same];
      const oldCore = segment.old.trim(), newCore = segment.new.trim();
      if (!oldCore && !newCore) return [segment.new];
      const edge = oldCore ? segment.old : segment.new;
      const lead = edge.match(/^\s*/)[0], trail = (newCore ? segment.new : segment.old).match(/\s*$/)[0];
      return [lead, oldCore ? h("del", { text: oldCore }) : "", oldCore && newCore ? " " : "",
        newCore ? h("ins", { text: newCore }) : "", trail];
    });
  }

  // ---------- GitHub and the robot's records ----------

  const repoFile = (cfg, path) => `https://github.com/${cfg.repo}/blob/${cfg.branch}/${path}`;

  async function draftEdits(cfg, count) {
    const url = `https://api.github.com/repos/${cfg.repo}/commits?sha=${cfg.branch}` +
      `&path=${encodeURIComponent(DRAFT_PATH)}&per_page=${count}`;
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    return res.json();
  }

  // The draft is read from GitHub at its newest commit, so a new version shows up right away
  // (the GitHub Pages copy can lag). Local previews use the local file.
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

  // The robot's files (the maintainers, and every proposal and vote) are read from GitHub too, for the same reason.
  async function loadRecord(cfg, path) {
    if (!isLocal) {
      try { return await fetchJSON(`https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/${path}`); } catch { /* the site's copy */ }
    }
    try { return await fetchJSON(at(path)); } catch { return null; }
  }

  // Proposals made in comments since the robot last looked: read straight from Hypothesis, so a proposer sees
  // theirs at once.
  async function liveComments(cfg) {
    const params = new URLSearchParams({ uri: `${cfg.site}draft/`, limit: "200", sort: "updated", order: "desc" });
    try {
      const res = await fetch(`${HYPOTHESIS_SEARCH}?${params}`);
      return res.ok ? (await res.json()).rows || [] : [];
    } catch {
      return [];
    }
  }

  function newProposals(rows, known, governance) {
    const since = Date.parse(governance?.rules?.proposals_count_from || 0);
    const ignored = new Set((governance?.ignored_accounts?.hypothesis || []).map((name) => name.toLowerCase()));
    const found = [];
    for (const row of rows) {
      if (row.references || row.hidden || known.has(row.id) || Date.parse(row.updated) < since) continue;
      const user = (row.user || "").replace(/^acct:|@hypothes\.is$/g, "");
      if (ignored.has(user.toLowerCase())) continue;
      const selector = (row.target || []).flatMap((t) => t.selector || []).find((s) => s.type === "TextQuoteSelector");
      if (!selector?.exact) continue;
      const command = window.ELSCommands?.parseCommand(row.text, selector.exact);
      if (!command) continue;
      const problems = command.problems.map((p) => window.ELSCommands.PROBLEMS[p]);
      found.push({
        id: row.id, status: problems.length ? "needs-fix" : "new", note: problems.join(" "),
        kind: command.kind, old: selector.exact, new: command.new, before: selector.prefix || "", after: selector.suffix || "",
        reason: command.reason, created: row.created, updated: row.updated,
        proposer: { name: row.user_info?.display_name || user, hypothesis: user },
        link: row.links?.incontext || `https://hypothes.is/a/${row.id}`,
      });
    }
    return found;
  }

  function ruleSentence(rules = {}) {
    const n = rules.approvals_needed ?? 1;
    let text = n === 1
      ? "One maintainer's approval adopts a proposal, unless at least as many maintainers disapprove it."
      : `A proposal is adopted once ${n} maintainers approve it, as long as more approve than disapprove it.`;
    if (rules.hours_open_before_adoption) text += ` It stays open for at least ${rules.hours_open_before_adoption} hours first.`;
    if (rules.maintainers_may_approve_their_own_proposals === false) text += " Maintainers can't approve their own proposals.";
    return text;
  }

  // ---------- Proposals ----------

  function proposalStatus(p, rules = {}) {
    const need = rules.approvals_needed ?? 1;
    const approvals = (p.votes || []).filter((v) => v.vote === "approve").length;
    return {
      new: ["New", `Received. It reaches the maintainers within ${CHECK_EVERY}.`],
      open: ["Waiting for a maintainer", need > 1 ? `${approvals} of ${need} approvals so far` : ""],
      "needs-fix": ["Needs a fix", p.note],
      adopted: ["Adopted", `In version ${p.version}${p.decided ? `, ${formatDate(p.decided)}` : ""}`],
      declined: ["Disapproved", p.decided ? formatDate(p.decided) : ""],
      withdrawn: ["Withdrawn", p.note],
      "cannot-apply": ["Can't be applied", p.note],
      approved: ["Approved", `Being published as version ${p.version}`],
      disapproved: ["Disapproved", "Moving to the Declined page"],
    }[p.status] || [p.status, ""];
  }

  function contextBefore(text) {
    const words = squash(text).split(" ");
    return words.slice(-6).join(" ");
  }
  function contextAfter(text) {
    return squash(text).split(" ").slice(0, 6).join(" ");
  }

  function changeView(p) {
    const box = h("div", { class: "change" });
    const preview = p.preview;
    if (preview && (preview.before?.length || preview.after?.length)) {
      if (preview.before.length === 1 && preview.after.length === 1) {
        box.append(h("p", {}, ...trackChanges(preview.before[0], preview.after[0])));
      } else {
        if (!preview.before.length && preview.context) box.append(h("p", { class: "context", text: preview.context }));
        for (const line of preview.before) box.append(h("p", {}, h("del", { text: line })));
        for (const line of preview.after) box.append(h("p", {}, h("ins", { text: line })));
      }
      return box;
    }
    // Not checked yet, or it can't be applied: show the selected words where they were.
    const before = contextBefore(p.before), after = contextAfter(p.after), old = squash(p.old);
    const line = h("p", {}, before ? `…${before} ` : "");
    if (p.kind === "delete") line.append(h("del", { text: old }));
    else if (p.kind === "replace") line.append(h("del", { text: old }), p.new ? " " : "", p.new ? h("ins", { text: p.new }) : "");
    else if (p.kind === "insert") line.append(old, " ", h("ins", { text: p.new }));
    else line.append(old);
    line.append(after ? ` ${after}…` : "");
    box.append(line);
    if (p.kind === "rule") box.append(h("p", {}, h("ins", { text: p.new })));
    return box;
  }

  function votesView(p) {
    const votes = p.votes || [];
    const names = (kind) => votes.filter((v) => v.vote === kind).map((v) => `${v.name} (${v.via}, ${formatDate(v.when)})`).join(", ");
    const parts = [];
    if (names("approve")) parts.push(h("span", {}, h("strong", { text: "Approved by " }), names("approve")));
    if (names("reject")) parts.push(h("span", {}, h("strong", { text: "Disapproved by " }), names("reject")));
    if (p.support) parts.push(h("span", { text: `${plural(p.support, "reader")} in favor` }));
    if (p.stale_votes) parts.push(h("span", { text: `${plural(p.stale_votes, "maintainer")} voted before the proposal was last edited and must vote again` }));
    return parts.length ? h("p", { class: "votes" }, ...joined(parts)) : null;
  }

  function proposalCard(p, cfg, rules, replies, extra = null) {
    const [label, detail] = proposalStatus(p, rules);
    const count = replies.get(p.id) || 0;
    const open = !FINAL.includes(p.status);
    const note = ["needs-fix", "withdrawn", "cannot-apply"].includes(p.status) && detail; // a sentence: its own line
    return h("article", { class: `proposal is-${p.status}`, id: `proposal-${p.id}` },
      h("div", { class: "proposal-head" },
        h("span", { class: `kind kind-${p.kind}`, text: KIND_LABELS[p.kind] || p.kind }),
        h("span", { class: "proposal-status" }, h("strong", { text: label }), detail && !note ? ` · ${detail}` : ""),
        p.status === "adopted" ? h("a", { class: "proposal-version", href: at(`versions/v${p.version}/`), text: `Version ${p.version}` }) : null),
      note ? h("p", { class: "proposal-note", text: note }) : null,
      changeView(p),
      p.reason ? h("p", { class: "proposal-reason", text: `“${p.reason}”` }) : null,
      h("p", { class: "proposal-meta" }, ...joined([
        `Proposed by ${p.proposer?.name || "someone"}, ${formatDate(p.created)}`,
        p.section || null,
      ].filter(Boolean))),
      votesView(p),
      h("p", { class: "proposal-links" }, ...joined([
        p.id.startsWith("sb-") ? (open && mode === "drafter" && !["approved", "disapproved"].includes(p.status) ? h("a", { href: "#doc", text: "Show it in the text",
          onclick: (event) => { event.preventDefault(); showInText(p.id); } }) : null)
          : external(open ? (count ? `Comment on it (${plural(count, "reply", "replies")})` : "Comment on it") :
            (count ? `Read the discussion (${plural(count, "reply", "replies")})` : "Read the proposal"), p.link),
        p.issue ? external(`GitHub issue #${p.issue}`, `https://github.com/${cfg.repo}/issues/${p.issue}`) : null,
      ].filter(Boolean))),
      extra);
  }

  // Every proposal in the robot's record, and the ones made in comments since it last looked.
  async function loadProposals(cfg, governance, ledger) {
    const records = ledger?.proposals || [];
    const rows = await liveComments(cfg);
    const replies = new Map();
    for (const row of rows) if (row.references) replies.set(row.references[0], (replies.get(row.references[0]) || 0) + 1);
    return { replies, records, fresh: newProposals(rows, new Set(records.map((r) => r.id)), governance) };
  }

  function sortProposals(list) {
    const newest = (a, b) => (b.created || "").localeCompare(a.created || "");
    const latestDecision = (a, b) => (b.decided || b.created || "").localeCompare(a.decided || a.created || "");
    return {
      open: list.filter((p) => !FINAL.includes(p.status)).sort(newest),
      adopted: list.filter((p) => p.status === "adopted").sort(latestDecision),
      closed: list.filter((p) => FINAL.includes(p.status) && p.status !== "adopted").sort(latestDecision),
    };
  }

  function maintainerList(governance) {
    const how = (m) => [m.email && `signs in as ${m.email}`, m.github && `${m.github} on GitHub`, m.hypothesis && `${m.hypothesis} on Hypothesis`]
      .filter(Boolean).join(", ");
    return h("ul", { class: "member-list" }, ...(governance?.maintainers || []).map((m) => h("li", {},
      h("strong", { text: m.name }),
      m.role && m.role !== "maintainer" ? h("span", { class: "badge badge-soft", text: m.role }) : null,
      h("span", { class: "muted", text: ` · ${how(m)}${m.since ? ` · since ${formatDate(m.since)}` : ""}` }))));
  }

  // On Suggest Edits: who decides, and where to read more.
  function maintainersNote(governance) {
    const names = (governance?.maintainers || []).map((m) => m.name);
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Who decides? " }),
        `The maintainers${names.length ? ` (${names.join(", ")})` : ""} approve or disapprove each suggestion. Anyone else can comment and suggest changes, but can't change the text.`),
      h("p", {}, secondary("The maintainers", at("maintainers/"))));
  }

  // ---------- Suggest Edits: edit the text directly, with every change tracked ----------
  // Like a word processor's suggesting mode: deleted words stay, struck through, and new words appear in blue
  // under your name. Readers sign in with a code sent to their email address, which is their name on the site.
  // Each change is saved as one suggestion while it's made, and everyone sees everyone else's right away, in
  // orange. Maintainers approve or disapprove each one, and the robot (scripts/proposals.py) publishes each
  // approved change as a new version. Other people's added words are drawn by CSS, so the page's own text
  // doesn't change under them, and comments keep their places.

  const ZWSP = "​";
  const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6";

  const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
  const within = (node, selector) => {
    const found = elementOf(node)?.closest(selector);
    return found && $("#doc").contains(found) ? found : null;
  };
  const mineIns = (node) => within(node, "ins.track.mine");
  const myDel = (node) => within(node, "del.track.mine");
  const struck = (node) => within(node, "del.track");
  const blockOf = (node) => within(node, BLOCKS);
  const frozen = (node) => within(node, "[contenteditable='false']");

  function select(range) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function caretAt(node, offset) {
    const range = document.createRange();
    range.setStart(node, Math.min(offset, node.nodeType === 3 ? node.length : node.childNodes.length));
    range.collapse(true);
    select(range);
  }
  function caretBeside(node, after) {
    const range = document.createRange();
    if (after) range.setStartAfter(node); else range.setStartBefore(node);
    range.collapse(true);
    select(range);
  }

  function textNodesIn(range) {
    const root = range.commonAncestorContainer;
    if (root.nodeType === 3) return [root];
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
    return nodes;
  }

  function tidyMarks() {
    const doc = $("#doc");
    for (const del of $$("del.track.mine", doc)) {
      if (!del.isConnected) continue;
      while (del.nextSibling?.nodeType === 1 && del.nextSibling.matches("del.track.mine")) {
        const next = del.nextSibling;
        del.append(...next.childNodes);
        next.remove();
      }
    }
    for (const ins of $$("ins.track.mine", doc)) {
      if (!ins.textContent.replaceAll(ZWSP, "") && !ins.closest(".track-new")) ins.remove();
    }
    const caret = getSelection().anchorNode;
    for (const block of $$(".track-new", doc)) {
      if (!block.textContent.replaceAll(ZWSP, "").trim() && !block.contains(caret)) block.remove();
    }
  }

  const removedBy = (by) => ({ class: "track mine", "data-by": by, title: `Removed by ${by}` });
  const addedBy = (by) => ({ class: "track mine", "data-by": by, title: `Added by ${by}` });

  // Strike out what's in `range`: original words are wrapped in <del>; words you added are simply removed.
  // Words someone else suggested removing are struck again, as yours. Returns where the struck text began and
  // ended, for placing the cursor.
  function strike(range) {
    let start = null, end = null;
    for (const node of textNodesIn(range)) {
      if (frozen(node) || myDel(node) || !blockOf(node)) continue;
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (to <= from) continue;
      if (mineIns(node)) {
        node.deleteData(from, to - from);
        start ||= { node, offset: from };
        end = { node, offset: from };
        continue;
      }
      const part = from > 0 ? node.splitText(from) : node;
      if (to - from < part.length) part.splitText(to - from);
      const del = h("del", removedBy(myName()));
      part.before(del);
      del.append(part);
      start ||= { before: del };
      end = { after: del };
    }
    tidyMarks();
    return { start, end };
  }
  function placeCaret(point) {
    if (!point) return;
    if (point.node?.isConnected) caretAt(point.node, point.offset);
    else if (point.before?.isConnected) caretBeside(point.before, false);
    else if (point.after?.isConnected) caretBeside(point.after, true);
  }

  function nodeBeforeCaret(range) {
    const { startContainer: node, startOffset: offset } = range;
    if (node.nodeType === 3) return offset === 0 ? node.previousSibling : null;
    return node.childNodes[offset - 1] || null;
  }

  // A selection across more than a few rules is almost always a slip (say, Select All), so it isn't struck out.
  const MOST_RULES_AT_ONCE = 5;
  function tooMany(range) {
    const blocks = new Set(textNodesIn(range).map(blockOf).filter(Boolean));
    if (blocks.size <= MOST_RULES_AT_ONCE) return false;
    hint(`To strike out more than ${MOST_RULES_AT_ONCE} rules, do it a few at a time.`);
    return true;
  }

  function typeText(text) {
    text = String(text || "").replace(/[\r\n]+/g, " ");
    const sel = getSelection();
    if (!text || !sel.rangeCount) return;
    let range = sel.getRangeAt(0);
    if (frozen(range.startContainer) || !blockOf(range.startContainer)) return;
    if (!range.collapsed) {
      if (tooMany(range)) return;
      placeCaret(strike(range).end);
      range = sel.getRangeAt(0);
    }
    for (let del = struck(range.startContainer); del; del = struck(range.startContainer)) {  // never type inside struck words
      caretBeside(del, true);
      range = sel.getRangeAt(0);
    }
    const inside = mineIns(range.startContainer);
    if (inside && range.startContainer.nodeType === 3) {
      const node = range.startContainer, offset = range.startOffset;
      node.insertData(offset, text);
      return caretAt(node, offset + text.length);
    }
    const before = inside || nodeBeforeCaret(range);
    if (before?.nodeType === 1 && before.matches("ins.track.mine")) {
      const last = before.lastChild?.nodeType === 3 ? before.lastChild : before.appendChild(document.createTextNode(""));
      last.appendData(text);
      return caretAt(last, last.length);
    }
    const ins = h("ins", addedBy(myName()), text);
    range.insertNode(ins);
    caretAt(ins.firstChild, text.length);
  }

  function deleteText(direction, target) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const oneKey = sel.isCollapsed;  // Backspace or Delete with nothing selected
    const block = blockOf(sel.anchorNode);
    if (target) select(target);
    let range = sel.getRangeAt(0);
    if (!block) return;
    if (range.collapsed) {
      sel.modify("extend", direction, "character");
      range = sel.getRangeAt(0);
    }
    if (range.collapsed) return;
    if (oneKey && (blockOf(range.startContainer) !== block || blockOf(range.endContainer) !== block)) {
      // At the edge of a rule: rules aren't merged. But backing out of an empty new rule removes it.
      if (direction === "backward" && block.classList.contains("track-new") && !block.textContent.replaceAll(ZWSP, "").trim()) {
        const previous = block.previousElementSibling;
        block.remove();
        if (previous) caretAt(previous, previous.childNodes.length);
      } else {
        range.collapse(direction !== "backward");
        select(range);
      }
      return;
    }
    if (tooMany(range)) return;  // a selection across rules strikes out the words in each
    const { start, end } = strike(range);
    placeCaret(direction === "backward" ? start : end);
  }

  function visibleText(range) {
    const box = document.createElement("div");
    box.append(range.cloneContents());
    for (const del of box.querySelectorAll("del")) del.remove();
    return box.textContent.replaceAll(ZWSP, "");
  }

  function newRule() {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const block = blockOf(range.startContainer);
    if (!block || frozen(block)) return;
    if (block.classList.contains("track-new")) {
      return hint("Add one new rule at a time. To add another, put the cursor at the end of an existing rule and press Enter.");
    }
    const rest = document.createRange();
    rest.setStart(range.endContainer, range.endOffset);
    rest.setEnd(block, block.childNodes.length);
    if (visibleText(rest).trim()) return hint("To add a new rule, put the cursor at the end of a rule, then press Enter.");
    const next = block.nextElementSibling;
    if (next?.classList.contains("track-new")) {
      const ins = next.querySelector("ins") || next;
      return caretAt(ins, ins.childNodes.length);
    }
    const by = myName();
    const ins = h("ins", addedBy(by), ZWSP);
    block.after(h(block.tagName === "LI" ? "li" : "p", { class: "track-new mine", "data-by": by }, ins));
    caretAt(ins.firstChild, 1);
  }

  function hint(text) {
    const box = $("#suggest-hint");
    if (!box) return;
    box.textContent = text;
    clearTimeout(hint.timer);
    hint.timer = setTimeout(() => (box.textContent = ""), 8000);
  }

  function rememberForUndo() {
    suggest.undo.push($("#doc").innerHTML);
    if (suggest.undo.length > 200) suggest.undo.shift();
    suggest.redo = [];
  }
  function undo() {
    if (!suggest.editing || !suggest.me) return;
    const saved = suggest.undo.pop();
    if (saved == null) return hint("Nothing to undo.");
    suggest.redo.push($("#doc").innerHTML);
    $("#doc").innerHTML = saved;
    freezeStamp();
    afterChange();
  }
  function redo() {
    if (!suggest.editing || !suggest.me) return;
    const next = suggest.redo.pop();
    if (next == null) return hint("Nothing to redo.");
    suggest.undo.push($("#doc").innerHTML);
    $("#doc").innerHTML = next;
    freezeStamp();
    afterChange();
  }

  function onBeforeInput(event) {
    if (!suggest.editing) return;
    const type = event.inputType;
    if (type === "insertCompositionText") return; // composing (for example, with an accent or Asian-language keyboard)
    event.preventDefault();
    const target = event.getTargetRanges?.()[0];
    const asRange = (r) => { const range = document.createRange(); range.setStart(r.startContainer, r.startOffset); range.setEnd(r.endContainer, r.endOffset); return range; };
    const pasted = () => event.dataTransfer?.getData("text/plain") ?? event.data ?? "";
    const actions = {
      insertText: () => typeText(event.data),
      insertReplacementText: () => { if (target) select(asRange(target)); typeText(pasted()); },
      insertFromPaste: () => typeText(pasted()),
      insertParagraph: newRule,
      deleteContentBackward: () => deleteText("backward", target && asRange(target)),
      deleteContentForward: () => deleteText("forward", target && asRange(target)),
      deleteWordBackward: () => deleteText("backward", target && asRange(target)),
      deleteWordForward: () => deleteText("forward", target && asRange(target)),
      deleteSoftLineBackward: () => deleteText("backward", target && asRange(target)),
      deleteHardLineBackward: () => deleteText("backward", target && asRange(target)),
      deleteByCut: () => deleteText("forward", target && asRange(target)),
      historyUndo: undo,
      historyRedo: redo,
    };
    if (!actions[type]) return;
    const history = type === "historyUndo" || type === "historyRedo";
    if (!history) rememberForUndo();
    actions[type]();
    if (!history) afterChange();
  }

  function onCompositionStart() {
    const sel = getSelection();
    if (!suggest.editing || !sel.rangeCount) return;
    rememberForUndo();
    const range = sel.getRangeAt(0);
    if (!range.collapsed) placeCaret(strike(range).end);
    if (!mineIns(sel.anchorNode)) {
      const ins = h("ins", addedBy(myName()), ZWSP);
      sel.getRangeAt(0).insertNode(ins);
      caretAt(ins.firstChild, 1);
    }
  }

  // ---- The safety net ----
  // Some keyboards (and some tools) change the text without warning first, so the edit can't be tracked as it
  // happens. Then the page compares the text with its last tracked state, word by word, and turns the
  // difference into tracked changes: removed words are struck out, new words are marked as yours.

  const leafBlocks = (root) => [...root.querySelectorAll(BLOCKS)].filter((block) => !block.querySelector(BLOCKS));
  function typedChars(block) {
    const chars = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement;
      const type = el.closest("ins.track.mine") ? "ins" : el.closest("del.track.mine") ? "del" : "orig";
      for (const ch of node.data) chars.push({ ch, type });
    }
    return chars;
  }
  function rebuildBlock(block, chars) {
    const by = myName();
    const pieces = [];
    for (const { ch, type } of chars) {
      const last = pieces[pieces.length - 1];
      if (last && last.type === type) last.text += ch; else pieces.push({ type, text: ch });
    }
    block.replaceChildren(...pieces.map(({ type, text }) => type === "orig" ? document.createTextNode(text)
      : h(type, type === "ins" ? addedBy(by) : removedBy(by), text)));
  }
  function reconcile() {
    const doc = $("#doc");
    const before = document.createElement("div");
    before.innerHTML = suggest.lastGood;
    const oldBlocks = leafBlocks(before), newBlocks = leafBlocks(doc);
    if (oldBlocks.length !== newBlocks.length) {
      doc.innerHTML = suggest.lastGood;
      freezeStamp();
      return hint("That change couldn't be tracked, so it was undone. Click in the text, then type or delete.");
    }
    let lastAdded = null;
    newBlocks.forEach((block, i) => {
      const oldChars = typedChars(oldBlocks[i]);
      const newText = block.textContent;
      if (oldChars.map((c) => c.ch).join("") === newText) return;
      // Word by word: which old pieces stayed, which went, and what's new.
      const oldTokens = [];
      let k = 0;
      for (const token of tokens(oldChars.map((c) => c.ch).join(""))) { oldTokens.push(oldChars.slice(k, k + token.length)); k += token.length; }
      const ops = diffLists(oldTokens.map((t) => t.map((c) => c.ch).join("")), tokens(newText));
      if (!ops) return;
      const result = [];
      let o = 0;
      for (const [op, piece] of ops) {
        if (op === "ins") { for (const ch of piece) result.push({ ch, type: "ins" }); continue; }
        const old = oldTokens[o++];
        for (const c of old) {
          if (op === "same") result.push(c);
          else if (c.type === "orig") result.push({ ch: c.ch, type: "del" });
          else if (c.type === "del") result.push(c);  // struck words stay struck; new words you remove are dropped
        }
      }
      rebuildBlock(block, result);
      lastAdded = [...block.querySelectorAll("ins.track.mine")].pop() || lastAdded;
    });
    if (lastAdded) caretAt(lastAdded, lastAdded.childNodes.length);
  }

  // ---- From tracked marks to suggestions ----

  const isWordChar = (ch) => /[\p{L}\p{N}_'’-]/u.test(ch);

  // Every change in the document, widened to whole words, with the words around it (as everyone else sees
  // the text) so the robot can find the one place it belongs. Each change also lists the marks it's made of,
  // and the ids of the saved suggestions those marks came from.
  function collectChanges() {
    const doc = $("#doc");
    const parts = $$(BLOCKS, doc).filter((block) => !frozen(block) && !block.querySelector(BLOCKS)).map((block) => {
      const chars = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (within(node, "button")) continue;
        const ins = mineIns(node), del = ins ? null : myDel(node);
        const type = ins ? "ins" : del ? "del" : "orig";
        for (const ch of node.data) if (ch !== ZWSP) chars.push({ ch, type, mark: ins || del });
      }
      return { block, chars, isNew: block.classList.contains("track-new") };
    });
    let source = "";
    for (const part of parts) {
      if (part.isNew) continue;
      if (source) source += "\n";
      part.at = source.length;
      source += part.chars.filter((c) => c.type !== "ins").map((c) => c.ch).join("");
    }
    const context = (start, end) => ({ prefix: source.slice(Math.max(0, start - 32), start), suffix: source.slice(end, end + 32) });
    const sourceOf = (chars) => chars.filter((c) => c.type !== "ins").map((c) => c.ch).join("");
    const madeOf = (chars, extra = []) => {
      const marks = [...new Set([...extra, ...chars.map((c) => c.mark).filter(Boolean)])];
      return { marks, sids: new Set(marks.map((mark) => mark.dataset.sid).filter(Boolean)) };
    };
    const changes = [];
    parts.forEach((part, index) => {
      if (part.isNew) {
        const text = squash(part.chars.map((c) => c.ch).join(""));
        const previous = parts.slice(0, index).reverse().find((other) => !other.isNew);
        if (!text || !previous) return;
        // Anchor it on the last words of the rule above that no other change touches, so the changes can be
        // approved in any order.
        const prevText = sourceOf(previous.chars);
        let untouched = previous.chars.length;
        while (untouched > 0 && previous.chars[untouched - 1].type === "orig") untouched -= 1;
        const tailStart = sourceOf(previous.chars.slice(0, untouched)).length;
        let words = [...prevText.matchAll(/\S+/g)].filter((w) => w.index >= tailStart).slice(-6);
        if (!words.length) words = [...prevText.matchAll(/\S+/g)].slice(-6);
        if (!words.length) return;
        const start = previous.at + words[0].index, end = previous.at + words.at(-1).index + words.at(-1)[0].length;
        changes.push({ kind: "rule", exact: squash(source.slice(start, end)), new: text, ...context(start, end),
          ...madeOf(part.chars, [part.block, ...part.block.querySelectorAll("ins.track.mine")]) });
        return;
      }
      const chars = part.chars;
      const at = [];  // each character's place in the source text (added words sit between places)
      let place = part.at;
      for (const c of chars) { at.push(place); if (c.type !== "ins") place += 1; }
      const placeOf = (i) => (i < chars.length ? at[i] : place);
      for (let i = 0; i < chars.length;) {
        if (chars[i].type === "orig") { i += 1; continue; }
        let a = i, b = i;
        while (b < chars.length && chars[b].type !== "orig") b += 1;
        // A change that cuts into a word takes in the whole word ("thier" -> "their"); punctuation and
        // spaces around it stay out, so deleting "(git)" stays a plain deletion.
        while (a > 0 && isWordChar(chars[a - 1].ch) && isWordChar(chars[a].ch)) a -= 1;
        while (b < chars.length && isWordChar(chars[b].ch) && isWordChar(chars[b - 1].ch)) b += 1;
        const window = chars.slice(a, b);
        const oldText = squash(sourceOf(window));
        const newText = squash(window.filter((c) => c.type !== "del").map((c) => c.ch).join(""));
        i = b;
        if (oldText === newText) continue;
        const marks = madeOf(window);
        if (!newText) { changes.push({ kind: "delete", exact: oldText, new: "", ...context(placeOf(a), placeOf(b)), ...marks }); continue; }
        if (oldText) { changes.push({ kind: "replace", exact: oldText, new: newText, ...context(placeOf(a), placeOf(b)), ...marks }); continue; }
        // New words between spaces: add them after the word before (or put them in front of the word after).
        let e = a - 1;
        while (e >= 0 && /\s/.test(chars[e].ch)) e -= 1;
        if (e >= 0) {
          let s2 = e;
          while (s2 > 0 && !/\s/.test(chars[s2 - 1].ch)) s2 -= 1;
          changes.push({ kind: "insert", exact: squash(sourceOf(chars.slice(s2, e + 1))), new: newText, ...context(placeOf(s2), placeOf(e + 1)), ...marks });
        } else {
          let f = b;
          while (f < chars.length && /\s/.test(chars[f].ch)) f += 1;
          let g = f;
          while (g < chars.length && !/\s/.test(chars[g].ch)) g += 1;
          const next = squash(sourceOf(chars.slice(f, g)));
          if (next) changes.push({ kind: "replace", exact: next, new: `${newText} ${next}`, ...context(placeOf(f), placeOf(g)), ...marks });
        }
      }
    });
    return changes;
  }

  // ---- Signing in and saving: Supabase ----
  // Readers sign in with a 6-digit code that Supabase emails them, through the project's own email account
  // (supabase/README.md). Suggestions and votes are kept in the project's database (supabase/schema.sql): anyone
  // can read them, and each reader can add, change, and withdraw only their own.

  // The Supabase library, pinned to one version and verified by the browser before it runs.
  const SUPABASE_LIBRARY = {
    src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
    integrity: "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok",
  };

  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase?.createClient) return resolve(window.supabase);
      document.head.append(h("script", { src: SUPABASE_LIBRARY.src, integrity: SUPABASE_LIBRARY.integrity, crossorigin: "anonymous",
        onload: () => resolve(window.supabase),
        onerror: () => reject(new Error("the sign-in tool couldn't be loaded; check your connection and reload the page")) }));
    });
  }

  // A suggestion as the page uses it, from a row of the database's suggestions table.
  const fromRow = (row) => ({
    id: `sb-${row.id}`, docId: row.id, kind: row.kind, exact: row.exact, prefix: row.prefix, suffix: row.suffix,
    new: row.new_text, reason: row.reason, base: row.base, created: row.created, updated: row.updated,
    author: { id: row.author_id, email: row.author_email },
  });
  const COLUMNS = { kind: "kind", exact: "exact", prefix: "prefix", suffix: "suffix", new: "new_text", reason: "reason", base: "base" };
  const toRow = (fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => COLUMNS[key]).map(([key, value]) => [COLUMNS[key], value ?? ""]));

  async function supabaseBackend(config) {
    const library = await loadSupabase();
    const client = library.createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "els-sign-in" },
    });
    const must = ({ data, error }) => {
      if (error) throw new Error(error.message || String(error));
      return data;
    };
    const everything = async (table, order) => {  // the database sends at most 1,000 rows at a time
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const batch = must(await client.from(table).select("*").order(order, { ascending: true }).range(from, from + 999));
        rows.push(...batch);
        if (batch.length < 1000) return rows;
      }
    };
    return {
      kind: "supabase",
      onUser(callback) {
        // Supabase asks that this callback not wait on other Supabase calls, so the work happens just after it.
        client.auth.onAuthStateChange((event, session) => setTimeout(() =>
          callback(session?.user?.email ? { id: session.user.id, email: session.user.email } : null), 0));
      },
      sendCode: async (email) => must(await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })),
      verifyCode: async (email, code) => must(await client.auth.verifyOtp({ email, token: code, type: "email" })),
      signOut: async () => must(await client.auth.signOut()),
      watch(callback, failed) {
        let timer = null;
        const load = async () => {
          try {
            const [suggestions, votes] = await Promise.all([everything("suggestions", "created"), everything("votes", "at")]);
            callback({ suggestions: suggestions.map(fromRow), votes });
          } catch (error) {
            failed(error);
          }
        };
        const soon = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
        client.channel("suggest-edits")
          .on("postgres_changes", { event: "*", schema: "public", table: "suggestions" }, soon)
          .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, soon)
          .subscribe();
        setInterval(load, 60000);  // in case live updates are switched off
        load();
        return { refresh: soon };
      },
      // Saves the given fields of a suggestion; returns its id. One withdrawn meanwhile (say, in another tab)
      // is saved again as a new one.
      async save(docId, fields) {
        if (docId) {
          const updated = must(await client.from("suggestions").update(toRow(fields)).eq("id", docId).select());
          if (updated.length) return updated[0].id;
        }
        const row = must(await client.from("suggestions").insert(toRow(fields)).select().single());
        if (!row?.id) throw new Error("the database didn't say what it saved");
        return row.id;
      },
      remove: async (docId) => must(await client.from("suggestions").delete().eq("id", docId)),
      async vote(proposalId, vote, step = "patch") {
        const upsert = (row) => client.from("votes").upsert(row, { onConflict: "suggestion,voter_id" });
        let result = await upsert({ suggestion: proposalId, vote, version_step: step });
        if (result.error && /version_step/.test(result.error.message) && step === "patch") {
          result = await upsert({ suggestion: proposalId, vote });  // a database set up before version steps
        }
        must(result);
      },
    };
  }

  // For trying the page on this computer without Supabase: add ?backend=local to a local preview's address.
  // Everything stays in this browser, and any 6-digit code signs you in.
  function localBackend() {
    const SUGGESTIONS = "els-local-suggestions", VOTES = "els-local-votes", USER = "els-local-user";
    const read = (key, empty) => { try { return JSON.parse(localStorage.getItem(key)) ?? empty; } catch { return empty; } };
    const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    let onData = null, onUser = () => {};
    const emit = () => onData?.({ suggestions: read(SUGGESTIONS, []), votes: read(VOTES, []) });
    addEventListener("storage", (event) => { if (event.key === SUGGESTIONS || event.key === VOTES) emit(); });
    const me = () => read(USER, null);
    return {
      kind: "local",
      onUser(callback) { onUser = callback; setTimeout(() => callback(me()), 0); },
      async sendCode() { /* nothing is sent */ },
      async verifyCode(email, code) {
        if (!/^\d{6}$/.test(code)) throw new Error("the code is six digits");
        const user = { id: `local-${email.toLowerCase()}`, email };
        write(USER, user);
        onUser(user);
      },
      async signOut() { localStorage.removeItem(USER); onUser(null); },
      watch(callback) { onData = callback; setTimeout(emit, 0); return { refresh: emit }; },
      async save(docId, fields) {
        const list = read(SUGGESTIONS, []), now = new Date().toISOString(), user = me();
        const i = docId ? list.findIndex((s) => s.docId === docId) : -1;
        if (i >= 0) {
          list[i] = { ...list[i], ...fields, updated: now };
        } else {
          docId = crypto.randomUUID();
          list.push({ kind: "", exact: "", prefix: "", suffix: "", new: "", reason: "", base: "", ...fields,
            id: `sb-${docId}`, docId, author: { id: user.id, email: user.email }, created: now, updated: now });
        }
        write(SUGGESTIONS, list);
        emit();
        return docId;
      },
      async remove(docId) { write(SUGGESTIONS, read(SUGGESTIONS, []).filter((s) => s.docId !== docId)); emit(); },
      async vote(proposalId, vote, step = "patch") {
        const user = me();
        const votes = read(VOTES, []).filter((v) => !(v.suggestion === proposalId && v.voter_id === user.id));
        votes.push({ suggestion: proposalId, voter_id: user.id, voter_email: user.email, vote, version_step: step, at: new Date().toISOString() });
        write(VOTES, votes);
        emit();
      },
    };
  }

  // ---- The page's state ----

  const suggest = {
    cfg: null, governance: null, markdown: "", version: "",
    editing: true, backend: null, watcher: null, me: null, ready: false,
    remote: null,  // everyone's suggestions, from the database (null until it answers)
    votes: [],  // everyone's votes, from the database
    proposals: { replies: new Map(), records: [], fresh: [] },  // the robot's record, and new proposals in comments
    others: [], saved: new Map(), undrawable: new Set(), undo: [], redo: [], lastGood: "",
    dirty: false, edits: 0, lastEdit: 0, busy: false, syncing: Promise.resolve(), timer: null,
    status: { text: "All changes saved", problem: false },
    signin: { step: "email", email: "", note: "" },
  };
  const FINAL_STATUS = new Set(FINAL);
  const sameEmail = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const recordOf = (id) => suggest.proposals.records.find((r) => r.id === id);
  const isOpen = (s) => !FINAL_STATUS.has(recordOf(s.id)?.status || "open");
  const isMine = (s) => !!suggest.me && s.author?.id === suggest.me.id;
  // Accounts the lead maintainer has listed to ignore (governance/maintainers.json): their suggestions aren't shown.
  const isIgnored = (s) => (suggest.governance?.ignored_accounts?.site || []).some((email) => sameEmail(email, s.author?.email));
  const isMaintainer = () => !!suggest.me && (suggest.governance?.maintainers || []).some((m) => sameEmail(m.email, suggest.me.email));
  const myName = () => suggest.me?.email || "you";
  const mineOpen = (decided = pendingDecisions()) => (suggest.remote || []).filter((s) => isMine(s) && isOpen(s) && !decided.has(s.id));
  const pickChange = (s) => ({ kind: s.kind, exact: s.exact, prefix: s.prefix, suffix: s.suffix, new: s.new });
  const sameChange = (a, b) => ["kind", "exact", "prefix", "suffix", "new"].every((key) => (a?.[key] || "") === (b?.[key] || ""));

  // ---- Drawing suggestions into the text ----

  // The text as everyone sees it: the original words, struck ones included, without words anyone is adding.
  function sourceIndex() {
    const chars = [];
    const walker = document.createTreeWalker($("#doc"), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (within(node, "ins.track.mine, .track-new, button")) continue;
      for (let i = 0; i < node.data.length; i++) if (!/\s/.test(node.data[i]) && node.data[i] !== ZWSP) chars.push({ node, offset: i });
    }
    return { chars, text: chars.map(({ node, offset }) => node.data[offset]).join("") };
  }

  // The same rule the robot uses (scripts/edits.py, locate): the quote, chosen among repeats by the words
  // around it; a single match is trusted when one side still matches, or when the quote is long.
  function locateQuote(index, exact, prefix, suffix) {
    const key = squash(exact).replace(/\s/g, ""), before = squash(prefix).replace(/\s/g, ""), after = squash(suffix).replace(/\s/g, "");
    if (!key) return null;
    const hits = [];
    for (let i = index.text.indexOf(key); i >= 0; i = index.text.indexOf(key, i + 1)) hits.push(i);
    const sides = (i) => {
      const seenBefore = index.text.slice(0, i), seenAfter = index.text.slice(i + key.length);
      const n = Math.min(before.length, seenBefore.length), m = Math.min(after.length, seenAfter.length);
      return [n === 0 || seenBefore.slice(-n) === before.slice(-n), m === 0 || seenAfter.slice(0, m) === after.slice(0, m), n > 0, m > 0];
    };
    const good = hits.filter((i) => { const [b, a] = sides(i); return b && a; });
    if (good.length === 1) return [good[0], good[0] + key.length];
    if (!good.length && hits.length === 1) {
      const [b, a, hasBefore, hasAfter] = sides(hits[0]);
      if (key.length >= 25 || (b && hasBefore) || (a && hasAfter)) return [hits[0], hits[0] + key.length];
    }
    return null;
  }

  function wrapRange(range, make) {
    let last = null;
    for (const node of textNodesIn(range)) {
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (to <= from) continue;
      const part = from > 0 ? node.splitText(from) : node;
      if (to - from < part.length) part.splitText(to - from);
      const mark = make();
      part.before(mark);
      mark.append(part);
      last = mark;
    }
    return last;
  }

  // Draw one suggestion: someone else's in orange (with added words drawn by CSS, so the text itself doesn't
  // change), or one of yours in blue, as marks you can keep editing.
  function drawSuggestion(s, mine, taken) {
    const index = sourceIndex();
    const found = locateQuote(index, s.exact ?? s.old ?? "", s.prefix ?? s.before ?? "", s.suffix ?? s.after ?? "");
    if (!found) return false;
    const [a, b] = found;
    if (taken.some(([x, y]) => a < y && x < b)) return false;
    const first = blockOf(index.chars[a].node), block = blockOf(index.chars[b - 1].node);
    if (!first || !block || frozen(first) || frozen(block) || (mine && first !== block)) return false;
    taken.push([a, b]);
    const who = s.author?.email || s.proposer?.hypothesis || s.proposer?.name || "someone";
    const range = document.createRange();
    range.setStart(index.chars[a].node, index.chars[a].offset);
    range.setEnd(index.chars[b - 1].node, index.chars[b - 1].offset + 1);
    const endNode = index.chars[b - 1].node, endOffset = index.chars[b - 1].offset + 1;
    const label = mine ? { "data-sid": s.docId } : { "data-proposal": s.id, title: `Suggested by ${who} · click for details`, tabindex: "0" };
    let last = null;
    if (s.kind === "delete" || s.kind === "replace") {
      last = wrapRange(range, () => h("del", mine ? { ...removedBy(who), ...label } : { class: "track others", "data-by": who, ...label }));
    }
    if (s.kind === "replace" || s.kind === "insert") {
      const ins = mine ? h("ins", { ...addedBy(who), ...label }, s.kind === "insert" ? ` ${s.new}` : s.new)
        : h("ins", { class: "track others added", "data-by": who, "data-text": ` ${s.new}`, contenteditable: "false", ...label });
      if (last) last.after(ins);
      else { const r = document.createRange(); r.setStart(endNode, endOffset); r.collapse(true); r.insertNode(ins); }
    }
    if (s.kind === "rule") {
      const tag = block.tagName === "LI" ? "li" : "p";
      block.after(mine ? h(tag, { class: "track-new mine", "data-by": who, ...label }, h("ins", { ...addedBy(who), ...label }, ZWSP + s.new))
        : h(tag, { class: "track-rule others", "data-by": who, "data-text": s.new, contenteditable: "false", ...label }));
    }
    return true;
  }

  function clearOthers() {
    const doc = $("#doc");
    for (const del of $$("del.track.others", doc)) del.replaceWith(...del.childNodes);
    for (const mark of $$("ins.track.others, .track-rule.others", doc)) mark.remove();
    doc.normalize();
  }

  // Everyone else's open suggestions: from the database, and from comments (the robot's record, and any
  // made since it last looked).
  function othersOpen() {
    const decided = pendingDecisions();
    const fromSite = (suggest.remote || []).filter((s) => !isMine(s) && isOpen(s) && !isIgnored(s));
    const { records, fresh } = suggest.proposals;
    const fromComments = [...fresh, ...records.filter((r) => !FINAL_STATUS.has(r.status))]
      .filter((p) => !p.id.startsWith("sb-") || !suggest.remote);
    return [...fromSite, ...fromComments].filter((x) => !decided.has(x.id))
      .sort((x, y) => (x.created || "").localeCompare(y.created || ""));
  }

  function drawOthers() {
    clearOthers();
    const taken = [];
    suggest.others = othersOpen();
    for (const s of suggest.others) drawSuggestion(s, false, taken);
  }

  // Keep the cursor where it was while other people's marks are redrawn: they don't change the text itself.
  function keepingCaret(fn) {
    const doc = $("#doc"), sel = getSelection();
    if (!sel.rangeCount || !doc.contains(sel.anchorNode)) return fn();
    const range = sel.getRangeAt(0);
    const offsetOf = (node, offset) => {
      const before = document.createRange();
      before.selectNodeContents(doc);
      before.setEnd(node, offset);
      return before.toString().length;
    };
    const start = offsetOf(range.startContainer, range.startOffset), end = offsetOf(range.endContainer, range.endOffset);
    fn();
    const pointAt = (n) => {
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let seen = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (n <= seen + node.length) return [node, n - seen];
        seen += node.length;
      }
      return [doc, doc.childNodes.length];
    };
    const restored = document.createRange();
    restored.setStart(...pointAt(start));
    restored.setEnd(...pointAt(end));
    select(restored);
  }

  // Draw the whole text: approved changes the robot is still publishing, your suggestions, and everyone else's.
  function drawEverything() {
    const doc = $("#doc");
    fillDoc(doc, suggest.markdown);
    freezeStamp();
    const decided = pendingDecisions();
    for (const { kind, p } of decided.values()) if (kind === "adopt") applyInDoc(p);
    suggest.decidedKey = decisionsKey(decided);
    suggest.redraw = false;
    suggest.saved = new Map();
    suggest.undrawable = new Set();
    const taken = [];
    for (const s of mineOpen(decided)) {
      if (drawSuggestion(s, true, taken)) suggest.saved.set(s.docId, pickChange(s));
      else suggest.undrawable.add(s.docId);  // it no longer fits the text; it's kept, and the robot reports it
    }
    drawOthers();
    setEditable(suggest.editing);
    suggest.lastGood = doc.innerHTML;
    suggest.undo = [];
    suggest.redo = [];
    suggest.dirty = false;
    updateBar();
  }

  // Whether your suggestions in the database differ from the ones in the text (say, after you changed them in
  // another tab), so the text needs drawing again.
  function mineChangedElsewhere() {
    const signature = (entries) => JSON.stringify(entries.map(([id, s]) => [id, s.kind, s.exact, s.prefix, s.suffix, s.new]).sort());
    const remote = mineOpen().filter((s) => !suggest.undrawable.has(s.docId)).map((s) => [s.docId, s]);
    return signature(remote) !== signature([...suggest.saved]);
  }

  // New data from the database: draw it once nobody's typing, so the text doesn't move under the cursor.
  function refresh() {
    clearTimeout(refresh.timer);
    const typing = Date.now() - suggest.lastEdit < 2500;
    const field = document.activeElement;
    const inForm = field?.matches?.("input, textarea") && $("#after")?.contains(field);
    if (!suggest.ready || typing || inForm) {
      refresh.timer = setTimeout(refresh, 1500);
      return;
    }
    const changed = suggest.redraw || decisionsKey(pendingDecisions()) !== suggest.decidedKey || mineChangedElsewhere();
    if (suggest.me && !suggest.dirty && !suggest.busy && changed) drawEverything();
    else keepingCaret(drawOthers);
    renderProposals();
    updateBar();
    if (pendingDecisions().size) watchForPublication();
  }

  // Only a reader who has verified their email address can edit the text; everyone else reads it (and can comment).
  function setEditable(on) {
    const doc = $("#doc");
    const editable = on && suggest.ready && !!suggest.me;
    if (editable) {
      doc.setAttribute("contenteditable", "true");
      doc.setAttribute("spellcheck", "true");
    } else {
      doc.removeAttribute("contenteditable");
    }
    doc.classList.toggle("suggesting", editable);
    html.classList.toggle("suggesting-mode", editable);
  }

  function freezeStamp() {
    const stamp = $("#doc h1 + p");
    if (stamp) stamp.setAttribute("contenteditable", "false");
  }

  // ---- Saving your changes as you go ----

  function afterChange() {
    tidyMarks();
    suggest.lastGood = $("#doc").innerHTML;
    suggest.lastEdit = Date.now();
    suggest.edits += 1;
    suggest.dirty = true;
    setSaveStatus("Saving…");
    clearTimeout(suggest.timer);
    suggest.timer = setTimeout(sync, 1200);
  }

  function sync() {
    suggest.syncing = suggest.syncing.then(syncNow, syncNow);
    return suggest.syncing;
  }

  // Make the database match the text: each change in it is one suggestion. A change made from marks that came
  // from a saved suggestion updates that suggestion; a new change adds one; a suggestion whose marks are gone is
  // withdrawn.
  async function syncNow() {
    const { backend, me } = suggest;
    if (!backend?.save || !me || !suggest.dirty) return;
    const edits = suggest.edits;
    suggest.busy = true;
    try {
      const used = new Set();
      for (const change of collectChanges()) {
        const fields = { ...pickChange(change), base: suggest.version };
        const docId = [...change.sids].find((id) => suggest.saved.has(id) && !used.has(id));
        if (docId && sameChange(suggest.saved.get(docId), fields)) { used.add(docId); continue; }
        const id = await backend.save(docId || null, fields);
        if (docId && id !== docId) suggest.saved.delete(docId);
        used.add(id);
        suggest.saved.set(id, pickChange(fields));
        for (const mark of change.marks) mark.dataset.sid = id;
      }
      for (const id of [...suggest.saved.keys()]) {
        if (used.has(id)) continue;
        await backend.remove(id);
        suggest.saved.delete(id);
      }
      if (suggest.edits === edits) suggest.dirty = false;
      suggest.lastGood = $("#doc").innerHTML;
      setSaveStatus(suggest.dirty ? "Saving…" : "All changes saved");
      suggest.watcher?.refresh();  // so the list below the text shows them now
    } catch (error) {
      setSaveStatus(`Not saved yet (${error.message}). Trying again…`, true);
      clearTimeout(suggest.timer);
      suggest.timer = setTimeout(sync, 15000);
    } finally {
      suggest.busy = false;
    }
  }

  // ---- Verifying an email address, to edit ----
  // Until a reader verifies an email address (any address they can check), Suggest Edits shows only a popup that
  // asks them to: the text itself is on the main page. They enter the address, then the 6-digit code it's sent,
  // and the page appears with the text ready to edit. They stay signed in on that computer.

  // Supabase's messages, in plain words (with its own words kept, for whoever looks after the site).
  function plainError(error) {
    const text = String(error?.message || error);
    if (/rate limit|security purposes|request this after/i.test(text)) return `Too many codes were asked for just now. Wait a minute, then try again. (${text})`;
    if (/sending|smtp|email.*send/i.test(text)) return `The email couldn't be sent. Please try again in a few minutes. (${text})`;
    if (/expired|invalid|otp/i.test(text)) return `That code is wrong or has expired. Check it, or send a new one. (${text})`;
    return `That didn't work: ${text}`;
  }

  function gateBox() {
    const { backend, signin: step } = suggest;
    const readInstead = h("p", { class: "gate-fine" }, "Just want to read it? The current version is on the ",
      h("a", { href: at(""), text: "main page" }), ".");
    if (!suggest.ready) return [h("p", { class: "loading", text: "Loading…" })];
    if (!backend || backend.kind === "none") {
      return [h("h2", { text: "Editing isn't open yet" }),
        h("p", { text: "Verifying an email address to edit this document isn't switched on yet. Please check back soon." }), readInstead];
    }
    const note = h("p", { class: "gate-note", "aria-live": "polite", text: step.note });
    const say = (text) => { step.note = text; note.textContent = text; };
    if (step.step === "code") {
      const code = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "10", spellcheck: "false",
        class: "key-input code-input", placeholder: "123456", "aria-label": "The 6-digit code from the email" });
      const verify = async () => {
        const value = code.value.replace(/\D/g, "");
        if (value.length < 6) { say("Enter the 6-digit code from the email."); return code.focus(); }
        say("Checking…");
        try {
          await backend.verifyCode(step.email, value);
          Object.assign(step, { step: "email", note: "" });
        } catch (error) {
          say(plainError(error));
        }
      };
      const again = async () => {
        say("Sending…");
        try { await backend.sendCode(step.email); say("We sent a new code. Use the newest one."); } catch (error) { say(plainError(error)); }
      };
      code.addEventListener("keydown", (event) => { if (event.key === "Enter") verify(); });
      setTimeout(() => code.focus(), 0);
      return [
        h("h2", { text: "Check your email" }),
        h("p", {}, "We sent a 6-digit code to ", h("strong", { text: step.email }), ". Enter it here to start editing."),
        h("div", { class: "gate-row" }, code, action("Verify", verify, "button")),
        h("p", { class: "gate-links" },
          h("button", { type: "button", class: "linklike", text: "Send a new code", onclick: again }), " · ",
          h("button", { type: "button", class: "linklike", text: "Use a different email address",
            onclick: () => { Object.assign(step, { step: "email", note: "" }); updateGate(true); } })),
        note];
    }
    const email = h("input", { type: "email", class: "key-input email-input", value: step.email, placeholder: "you@example.edu",
      autocomplete: "email", spellcheck: "false", "aria-label": "An email address" });
    const send = async () => {
      const address = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { say("Enter an email address first."); return email.focus(); }
      say("Sending…");
      try {
        await backend.sendCode(address);
        Object.assign(step, { step: "code", email: address, note: backend.kind === "local" ? "(Local test: any six digits work.)" : "" });
        updateGate(true);
      } catch (error) {
        say(plainError(error));
      }
    };
    email.addEventListener("keydown", (event) => { if (event.key === "Enter") send(); });
    setTimeout(() => email.focus(), 0);
    return [
      h("h2", { text: "Verify an email address to edit" }),
      h("p", { text: "You need to verify an email address in order to edit this document. Enter any email address you can check, and we'll send it a 6-digit code." }),
      h("div", { class: "gate-row" }, email, action("Send code", send, "button")),
      note,
      h("p", { class: "gate-fine", text: "The address you verify is your name here: it's shown with your suggestions." }),
      readInstead];
  }

  // The popup, and the page behind it: hidden until you've verified an email address. Rebuilt only when its step
  // changes, so typing the address or the code isn't interrupted.
  function updateGate(rebuild = false) {
    const gate = $("#gate");
    if (!gate) return;
    const gated = !suggest.ready || !suggest.me;
    html.classList.toggle("gated", gated);
    const key = !suggest.ready ? "loading" : suggest.me ? "in"
      : `out ${suggest.backend?.kind} ${suggest.signin.step} ${suggest.signin.email}`;
    if (!rebuild && gate.dataset.key === key) return;
    gate.dataset.key = key;
    gate.hidden = !gated;
    if (gated) gate.replaceChildren(...gateBox());
  }

  // ---- The bar above the text, while you edit ----

  function setSaveStatus(text, problem = false) {
    suggest.status = { text, problem };
    const box = $("#save-status");
    if (box) { box.textContent = text; box.classList.toggle("problem", problem); }
  }

  // Who you are, and whether your changes are saved. Shown only once you've verified your email address.
  function updateBar() {
    updateGate();
    const slot = $("#suggest-slot"), who = $("#suggest-who");
    if (!slot || !who) return;
    slot.hidden = !suggest.ready || !suggest.me;
    if (slot.hidden) return;
    const key = `${suggest.me.email} ${isMaintainer()}`;
    if (who.dataset.key === key) return;
    who.dataset.key = key;
    who.replaceChildren(
      h("span", {}, "Editing as ", h("strong", { class: "mine-name", text: suggest.me.email }),
        isMaintainer() ? h("span", { class: "badge badge-soft", text: "maintainer" }) : ""),
      h("span", { class: `save-status${suggest.status.problem ? " problem" : ""}`, id: "save-status", "aria-live": "polite", text: suggest.status.text }),
      h("button", { type: "button", class: "linklike", text: "Sign out", onclick: signOut }));
  }

  async function signOut() {
    await sync();
    try { await suggest.backend.signOut(); } catch (error) { hint(`Signing out didn't work: ${error.message}`); }
  }

  const HELP = {
    edit: "Edit as in Word with track changes on: words you delete are struck out, and words you type are added in blue. Press Enter at the end of a rule to add a new one. Everything is saved as you go. Other people's suggestions are orange; click one to see it.",
    comment: "Commenting: select words, then choose Annotate to comment on them. The text can't be edited until you go back to editing.",
  };

  function suggestBar() {
    return h("div", { class: "suggest-bar", id: "suggest-bar", role: "region", "aria-label": "Editing" },
      h("div", { class: "suggest-line", id: "suggest-who" }),
      h("p", { class: "suggest-tools" },
        h("span", { class: "suggest-help", id: "suggest-help", text: HELP.edit }),
        h("span", { class: "suggest-buttons" },
          action("Undo", () => undo(), "button secondary small suggest-undo"),
          action("Redo", () => redo(), "button secondary small suggest-undo"),
          h("button", { type: "button", class: "linklike", id: "mode-toggle", text: "Comment instead", onclick: () => setMode(!suggest.editing) }))),
      h("p", { class: "suggest-hint", id: "suggest-hint", "aria-live": "polite" }));
  }

  // Editing, or commenting (selecting words to annotate them, without changing the text).
  function setMode(editing) {
    suggest.editing = editing;
    $(".suggestion-pop")?.remove();
    setEditable(editing);
    $("#suggest-bar")?.classList.toggle("commenting", !editing);
    const help = $("#suggest-help"), toggle = $("#mode-toggle");
    if (help) help.textContent = editing ? HELP.edit : HELP.comment;
    if (toggle) toggle.textContent = editing ? "Comment instead" : "Back to editing";
  }

  // ---- Approving and disapproving ----
  // A maintainer's vote takes effect on the page at once: the box closes, an approved change becomes part of the
  // text, and a disapproved one leaves it. The robot publishes the decision within a minute or two, as a new
  // version whose last number goes up, unless the maintainer chose the middle or first number instead.

  const STEPS = ["patch", "minor", "major"];
  function nextVersion(version, step = "patch") {
    const [major, minor, patch] = String(version || "0.0.0").split(".").map(Number);
    if (step === "major") return `${major + 1}.0.0`;
    if (step === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }

  // What the robot will decide, from the maintainers' votes on Suggest Edits: the same rule as scripts/proposals.py
  // (decide). An approval decides with the biggest version step any approving maintainer chose.
  function decisionFor(p) {
    const rules = suggest.governance?.rules || {};
    const maintainers = (suggest.governance?.maintainers || []).filter((m) => m.email);
    const proposer = p.proposer?.email || p.author?.email;
    const since = Date.parse(p.updated || p.created || 0);
    const latest = new Map();
    for (const v of suggest.votes) {
      if (v.suggestion !== p.id || !(Date.parse(v.at) >= since)) continue;
      const m = maintainers.find((x) => sameEmail(x.email, v.voter_email));
      if (!m || (v.vote === "approve" && rules.maintainers_may_approve_their_own_proposals === false && sameEmail(m.email, proposer))) continue;
      const known = latest.get(m.email.toLowerCase());
      if (!known || Date.parse(v.at) > Date.parse(known.at)) latest.set(m.email.toLowerCase(), v);
    }
    const votes = [...latest.values()];
    const approvals = votes.filter((v) => v.vote === "approve"), rejections = votes.filter((v) => v.vote === "reject");
    const need = rules.approvals_needed ?? 1;
    if (approvals.length >= need && approvals.length > rejections.length) {
      if (rules.hours_open_before_adoption && Date.now() - since < rules.hours_open_before_adoption * 3600e3) return null;
      const step = approvals.map((v) => v.version_step || "patch").reduce((a, b) => (STEPS.indexOf(b) > STEPS.indexOf(a) ? b : a), "patch");
      return { kind: "adopt", step };
    }
    if (rejections.length >= need && rejections.length > approvals.length) return { kind: "decline" };
    return null;
  }

  // Decided suggestions the robot hasn't published or set aside yet, oldest first (the robot's order), each
  // approved one with the version it will become.
  function pendingDecisions() {
    const pending = new Map();
    let version = suggest.version;
    const waiting = currentProposals().filter((p) => !FINAL_STATUS.has(p.status))
      .sort((a, b) => (a.created || "").localeCompare(b.created || "") || a.id.localeCompare(b.id));
    for (const p of waiting) {
      const decision = decisionFor(p);
      if (!decision) continue;
      if (decision.kind === "adopt") version = nextVersion(version, decision.step);
      pending.set(p.id, { ...decision, p, version: decision.kind === "adopt" ? version : null });
    }
    return pending;
  }
  const decisionsKey = (decided) => [...decided].map(([id, d]) => `${id}:${d.kind}:${d.version}`).join(" ");

  // An approved change, shown as part of the text until the robot publishes it.
  function applyInDoc(p) {
    const index = sourceIndex();
    const found = locateQuote(index, p.exact ?? p.old ?? "", p.prefix ?? p.before ?? "", p.suffix ?? p.after ?? "");
    if (!found) return false;
    const [a, b] = found;
    const first = blockOf(index.chars[a].node), block = blockOf(index.chars[b - 1].node);
    const range = document.createRange();
    range.setStart(index.chars[a].node, index.chars[a].offset);
    range.setEnd(index.chars[b - 1].node, index.chars[b - 1].offset + 1);
    const added = (text) => h("span", { class: "accepted", title: "Approved; being published" }, text);
    if (p.kind === "rule") {
      if (!block) return false;
      block.after(h(block.tagName === "LI" ? "li" : "p", {}, added(p.new)));
    } else if (p.kind === "insert") {
      range.collapse(false);
      range.insertNode(added(` ${p.new}`));
    } else {
      range.deleteContents();
      if (p.kind === "replace") range.insertNode(added(p.new));
      for (const emptied of new Set([first, block])) if (emptied?.isConnected && !emptied.textContent.trim()) emptied.remove();
    }
    return true;
  }

  // After a decision, look for the robot's new version every 30 seconds, for ten minutes, and show it. (GitHub
  // answers 60 such questions an hour from one computer, so it doesn't look for longer.)
  function watchForPublication(decidedNow = false) {
    if (decidedNow) watchForPublication.until = Date.now() + 10 * 60 * 1000;
    if (isLocal || watchForPublication.timer || !(Date.now() < (watchForPublication.until || 0))) return;
    const check = async () => {
      watchForPublication.timer = null;
      try {
        const head = await fetchJSON(`https://api.github.com/repos/${suggest.cfg.repo}/commits/${suggest.cfg.branch}`);
        if (head.sha && head.sha !== suggest.seenSha) {
          suggest.seenSha = head.sha;
          const raw = (path) => `https://raw.githubusercontent.com/${suggest.cfg.repo}/${head.sha}/${path}`;
          const [markdown, ledger] = await Promise.all([fetchText(raw(DRAFT_PATH)), fetchJSON(raw(LEDGER_PATH)).catch(() => null)]);
          if (ledger) suggest.proposals.records = ledger.proposals || [];
          if (markdown !== suggest.markdown) {
            const before = suggest.version;
            suggest.markdown = markdown;
            suggest.version = stampedVersion(markdown) || before;
            suggest.redraw = true;
            const badge = $(".file-meta .badge");
            if (badge) badge.textContent = versionLabel(suggest.version);
            if (suggest.version !== before) hint(`Published: version ${suggest.version}.`);
          }
          refresh();
        }
      } catch { /* try again next time */ }
      if (Date.now() < watchForPublication.until && pendingDecisions().size) watchForPublication.timer = setTimeout(check, 30000);
    };
    watchForPublication.timer = setTimeout(check, 30000);
  }

  function voteControls(p) {
    if (!isMaintainer() || !suggest.backend?.vote || FINAL_STATUS.has(p.status)) return null;
    const status = h("p", { class: "vote-status", "aria-live": "polite" });
    const say = (text, kind = "") => { status.className = `vote-status ${kind}`; status.textContent = text; };
    const mine = suggest.votes.filter((v) => v.suggestion === p.id && v.voter_id === suggest.me.id).pop();
    const labels = { patch: "", minor: " (middle number)", major: " (first number)" };
    // The numbers follow any approved changes still being published.
    const base = [...pendingDecisions().values()].filter((d) => d.kind === "adopt" && d.p.id !== p.id).map((d) => d.version).pop()
      || suggest.version;
    const step = h("select", { class: "step-select", "aria-label": "The new version's number" },
      ...STEPS.map((value) => h("option", { value, selected: (mine?.version_step || "patch") === value,
        text: `as version ${nextVersion(base, value)}${labels[value]}` })));
    const cast = async (vote) => {
      approve.disabled = disapprove.disabled = true;
      say(vote === "approve" ? "Approving…" : "Disapproving…", "pending");
      const chosen = vote === "approve" ? step.value : "patch";
      try {
        await suggest.backend.vote(p.id, vote, chosen);
      } catch (error) {
        say(/version_step/.test(error.message)
          ? "The database needs one more step first: run supabase/schema.sql again in Supabase's SQL Editor."
          : `That didn't work: ${error.message}`, "failed");
        approve.disabled = p.status === "needs-fix";
        disapprove.disabled = false;
        return;
      }
      // Count the vote here at once, rather than waiting for the database to send it back.
      const me = suggest.me, at = new Date(Math.max(Date.now(), Date.parse(p.updated || 0))).toISOString();
      suggest.votes = [...suggest.votes.filter((v) => !(v.suggestion === p.id && v.voter_id === me.id)),
        { suggestion: p.id, voter_id: me.id, voter_email: me.email, vote, version_step: chosen, at }];
      $(".suggestion-pop")?.remove();
      await sync();
      drawEverything();
      renderProposals();
      const decided = pendingDecisions().get(p.id);
      hint(decided?.kind === "adopt" ? `Approved. The text shows the change now; it's being published as version ${decided.version}.`
        : decided?.kind === "decline" ? "Disapproved. It's gone from the text, and it's moving to the Declined page."
          : `${vote === "approve" ? "Approved" : "Disapproved"}. It needs more maintainers' votes to be decided.`);
      watchForPublication(true);
      suggest.watcher?.refresh();
    };
    const approve = action("Approve", () => cast("approve"), "button small");
    const disapprove = action("Disapprove", () => cast("reject"), "button secondary small");
    if (p.status === "needs-fix") { approve.disabled = true; approve.title = "It needs a fix before it can be approved"; }
    if (mine && Date.parse(mine.at) >= Date.parse(p.updated || 0)) {
      say(mine.vote === "approve" ? "You approved it." : "You disapproved it.", "done");
    }
    return h("div", { class: "vote" }, h("p", { class: "vote-buttons" }, approve, " ", step, " ", disapprove), status);
  }

  // A reason for one of your suggestions, shown to the maintainers and kept in the record.
  function reasonField(p) {
    const s = (suggest.remote || []).find((x) => x.id === p.id);
    if (!s || !isMine(s) || FINAL_STATUS.has(p.status)) return null;
    const input = h("input", { type: "text", class: "key-input reason-input", maxlength: "1000", value: s.reason || "",
      placeholder: "Why this change? (optional)", "aria-label": "Your reason for this change" });
    const note = h("span", { class: "signin-note", "aria-live": "polite" });
    const save = async () => {
      note.textContent = "Saving…";
      try {
        await suggest.backend.save(s.docId, { reason: input.value.trim() });
        note.textContent = "Saved.";
        suggest.watcher?.refresh();
      } catch (error) {
        note.textContent = `Not saved: ${error.message}`;
      }
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") save(); });
    return h("p", { class: "reason-row" }, input, action("Save", save, "button secondary small"), note);
  }

  function suggestionCard(s) {
    const record = { ...s, old: s.old ?? s.exact, before: s.before ?? s.prefix, after: s.after ?? s.suffix,
      proposer: s.proposer || { name: s.author?.email } };
    const known = recordOf(s.id);
    const p = known && Date.parse(known.updated) === Date.parse(s.updated) ? { ...record, ...known } : { ...record, status: known?.status || "new" };
    return h("div", { class: "suggestion-pop", role: "dialog", "aria-label": "Suggestion" },
      h("p", { class: "pop-head" }, h("strong", { text: KIND_LABELS[s.kind] || "Change" }),
        ` · suggested by ${record.proposer?.name || "someone"}, ${formatDate(s.created)}`),
      changeView(record),
      s.reason ? h("p", { class: "proposal-reason", text: `“${s.reason}”` }) : "",
      s.link ? h("p", { class: "proposal-links" }, external("Comment on it", s.link)) : "",
      voteControls(p));
  }

  function onSuggestionClick(event) {
    const mark = event.target.closest?.("[data-proposal]");
    if (!event.target.closest?.(".suggestion-pop")) $(".suggestion-pop")?.remove();
    if (!mark || !$("#doc").contains(mark)) return;
    const s = suggest.others.find((x) => x.id === mark.dataset.proposal);
    if (!s) return;
    const card = suggestionCard(s);
    document.body.append(card);
    const box = mark.getBoundingClientRect();
    card.style.top = `${scrollY + box.bottom + 8}px`;
    card.style.left = `${Math.max(12, Math.min(scrollX + box.left, scrollX + innerWidth - card.offsetWidth - 12))}px`;
  }

  // ---- The list of suggestions below the text ----

  // A suggestion from the database as a proposal: the robot's record of it if that's up to date, or what's known
  // until the robot looks (within a few minutes).
  function asProposal(s, known) {
    if (known && (FINAL_STATUS.has(known.status) || Date.parse(known.updated) === Date.parse(s.updated))) return known;
    return { id: s.id, status: "new", kind: s.kind, old: s.exact, new: s.new, before: s.prefix, after: s.suffix, reason: s.reason,
      created: s.created, updated: s.updated, proposer: { name: s.author.email, email: s.author.email }, issue: known?.issue };
  }

  function currentProposals() {
    const { records } = suggest.proposals;
    const recorded = new Set(records.map((r) => r.id));
    const fresh = suggest.proposals.fresh.filter((p) => !recorded.has(p.id));
    if (!suggest.remote) return [...fresh, ...records];
    const live = new Map(suggest.remote.filter((s) => !isIgnored(s)).map((s) => [s.id, s]));
    const list = [...fresh];
    for (const r of records) {
      if (!r.id.startsWith("sb-")) list.push(r);
      else if (live.has(r.id)) { list.push(asProposal(live.get(r.id), r)); live.delete(r.id); }
      else if (FINAL_STATUS.has(r.status)) list.push(r);  // an open one that's gone was withdrawn
    }
    for (const s of live.values()) list.push(asProposal(s));
    return list;
  }

  function showInText(id) {
    const mark = $(`#doc [data-proposal="${CSS.escape(id)}"]`) || $(`#doc [data-sid="${CSS.escape(id.replace(/^sb-/, ""))}"]`);
    if (!mark) return hint("That suggestion isn't in the text as it is now.");
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.classList.add("flash");
    setTimeout(() => mark.classList.remove("flash"), 1800);
  }

  function renderProposals() {
    const section = $("#proposals");
    if (!section) return;
    const { cfg, governance } = suggest;
    const rules = governance?.rules || {};
    const { replies } = suggest.proposals;
    const decided = pendingDecisions();
    const { open: notFinal, adopted, closed } = sortProposals(currentProposals().map((p) => {
      const d = decided.get(p.id);
      return d ? { ...p, status: d.kind === "adopt" ? "approved" : "disapproved", version: d.version || p.version } : p;
    }));
    const open = notFinal.filter((p) => !decided.has(p.id));
    const publishing = notFinal.filter((p) => p.status === "approved").reverse();
    const settingAside = notFinal.filter((p) => p.status === "disapproved");
    const card = (p) => proposalCard(p, cfg, rules, replies, [reasonField(p), voteControls(p)]);
    section.replaceChildren(
      h("h2", { text: "Suggestions" }),
      h("p", {}, "Each suggestion waits for the ", h("a", { href: at("maintainers/"), text: "maintainers" }),
        `, who approve or disapprove it. ${ruleSentence(rules)} An approved change is published as a new version within ${CHECK_EVERY} or so.`));
    if (!open.length) section.append(h("p", { class: "empty", text: "No suggestions are waiting right now. Edit the text above to make one." }));
    else section.append(h("h3", { text: `Waiting for a maintainer (${open.length})` }), ...open.map(card));
    if (publishing.length) {
      section.append(h("h3", { text: `Approved, being published (${publishing.length})` }),
        h("p", { class: "muted", text: "The text above already shows these changes. Each is published as a new version within a minute or two." }),
        ...publishing.map(card));
    }
    if (settingAside.length) section.append(h("h3", { text: `Disapproved (${settingAside.length})` }), ...settingAside.map(card));
    if (adopted.length) {
      const shown = adopted.slice(0, 8), rest = adopted.slice(8);
      section.append(h("h3", { text: `Adopted (${adopted.length})` }), ...shown.map(card));
      if (rest.length) section.append(h("details", { class: "more" }, h("summary", { text: `Show ${plural(rest.length, "earlier change")}` }), ...rest.map(card)));
    }
    section.append(h("p", { class: "muted" }, "Suggestions that maintainers disapprove, and ones that are withdrawn or can't be applied, move to the ",
      h("a", { href: at("declined/"), text: "Declined page" }), closed.length ? ` (${closed.length} so far)` : "",
      ". Every suggestion, vote, and outcome is also recorded in ", external(LEDGER_PATH, repoFile(cfg, LEDGER_PATH)), "."));
    const count = $("#proposal-count");
    if (count) {
      count.replaceChildren(open.length
        ? h("a", { href: "#proposals" }, `${plural(open.length, "suggestion is", "suggestions are")} waiting for a maintainer. See ${open.length === 1 ? "it" : "them"} below the text.`)
        : adopted.length || closed.length ? h("a", { href: "#proposals", text: "No suggestions are waiting right now. See past decisions below the text." })
          : h("span", { text: "No suggestions yet. Yours could be the first." }));
    }
  }

  // ---- Starting up ----

  async function setupSuggesting(cfg, governance, ledger, markdown) {
    Object.assign(suggest, { cfg, governance, markdown, version: stampedVersion(markdown) || cfg.latest,
      proposals: { replies: new Map(), records: ledger?.proposals || [], fresh: [] } });
    const doc = $("#doc");
    doc.addEventListener("beforeinput", onBeforeInput);
    doc.addEventListener("compositionstart", onCompositionStart);
    doc.addEventListener("compositionend", () => { if (suggest.editing) { reconcile(); afterChange(); } });
    doc.addEventListener("input", (event) => { if (suggest.editing && !event.isComposing) { reconcile(); afterChange(); } });
    doc.addEventListener("dragstart", (event) => suggest.editing && event.preventDefault());
    doc.addEventListener("drop", (event) => suggest.editing && event.preventDefault());
    doc.addEventListener("keydown", (event) => {
      if (!suggest.editing || !suggest.me || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if (key === "y" && event.ctrlKey) { event.preventDefault(); redo(); }
    });

    document.addEventListener("click", onSuggestionClick);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") $(".suggestion-pop")?.remove();
      if (event.key === "Enter" && event.target.matches?.("[data-proposal]")) onSuggestionClick(event);
    });
    addEventListener("beforeunload", (event) => {
      if (suggest.me && suggest.dirty) { sync(); event.preventDefault(); }
    });
    drawEverything();
    loadProposals(cfg, governance, ledger).then((data) => { suggest.proposals = data; refresh(); }).catch(() => {});

    const useLocal = isLocal && new URLSearchParams(location.search).get("backend") === "local";
    try {
      suggest.backend = useLocal ? localBackend()
        : cfg.supabase?.url && cfg.supabase?.key ? await supabaseBackend(cfg.supabase) : { kind: "none" };
    } catch (error) {
      suggest.backend = { kind: "none" };
      hint(`Signing in isn't available right now: ${error.message}.`);
    }
    let gotUser = false, gotData = false;
    const start = () => {
      if (suggest.ready || !gotUser || !gotData) return;
      suggest.ready = true;
      drawEverything();
      renderProposals();
      if (pendingDecisions().size) watchForPublication(true);
      if (suggest.me) loadHypothesis();  // after the text is drawn, so comments' highlights stay put
    };
    const backend = suggest.backend;
    if (backend.kind === "none") { gotUser = gotData = true; return start(); }
    suggest.watcher = backend.watch(({ suggestions, votes }) => {
      suggest.remote = suggestions;
      suggest.votes = votes;
      if (!gotData) { gotData = true; return start(); }
      refresh();
    }, (error) => {
      hint(`Suggestions couldn't be loaded: ${error.message}.`);
      if (!gotData) { gotData = true; start(); }
    });
    backend.onUser((user) => {
      const before = suggest.me;
      suggest.me = user;
      if (!gotUser) { gotUser = true; return start(); }
      if (!suggest.ready || (before?.id ?? null) === (user?.id ?? null)) return updateBar();
      setSaveStatus("All changes saved");
      setMode(true);
      drawEverything();
      renderProposals();
      if (user) {
        scrollTo({ top: 0, behavior: "instant" });
        loadHypothesis();
        hint("You're verified. Click anywhere in the text to start editing.");
      }
    });
    setTimeout(() => { gotUser = gotData = true; start(); }, 10000);  // don't wait forever for a slow connection
  }

  // ---------- Pages ----------

  function draftNote() {
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Nothing here is final. " }),
        "This is a comment draft. Anyone can suggest a change on the ", h("a", { href: at("draft/"), text: "Suggest Edits" }),
        " page, by editing the text with track changes on. The maintainers approve or disapprove each suggestion, and each approved change is published as a new version, with its own number and fingerprint."),
      h("p", {}, button("Suggest edits", at("draft/"))));
  }

  // The community's Google group (versions.json: "community").
  const groupAddress = (cfg, suffix = "") => cfg.community?.email.replace("@", `${suffix}@`);

  function communityNote(cfg) {
    if (!cfg.community) return null;
    return h("aside", { class: "note community-note" },
      h("p", {}, h("strong", { text: "Talk with others who use AGENTS.md. " }),
        `People who use and shape this file talk with each other in a Google group, ${cfg.community.name}. You can join by email, with or without a Google account.`),
      h("p", {}, button("Join the group", at("join/"))));
  }

  function fingerprintNote(release) {
    if (!release?.fingerprint) return null;
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Is a copy exactly this version? " }),
        `Every version has a fingerprint: an Argon2id hash of its file without the version line. Change one character and the fingerprint changes. Version ${release.version}'s is:`),
      fingerprintLine(release.fingerprint, ""),
      h("p", {}, secondary("Check a copy", at("check/"))));
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
    $("#after").replaceChildren(draftNote(), communityNote(cfg) || "", fingerprintNote(release) || "");
    setCanonical(at(`versions/v${cfg.latest}/`));
  }

  function commandGuide() {
    const card = (command, effect, ...example) => h("div", { class: "command" },
      h("p", { class: "command-name" }, h("code", { text: command })),
      h("p", { class: "command-effect", text: effect }),
      h("p", { class: "command-example" }, ...example));
    return h("details", { class: "how", id: "propose" },
      h("summary", {}, h("h2", { id: "propose-title", text: "Or comment instead" })),
      h("p", {}, "To comment without editing, select words in the text and choose ", h("em", { text: "Annotate" }),
        " (while editing, choose ", h("em", { text: "Comment instead" }), " first). Comments use a free ",
        external("Hypothesis", "https://web.hypothes.is/start"), " account. A comment that starts with one of these is also a proposed change:"),
      h("div", { class: "command-grid" },
        card("Delete", "Strikes out the words you selected. Select a whole rule to remove it.", h("del", { text: "quickly" })),
        card("Replace with: new words", "Puts your words in place of the ones you selected.", h("del", { text: "look at" }), " ", h("ins", { text: "read" })),
        card("Add after: new words", "Adds your words right after the ones you selected.", "the source ", h("ins", { text: "and its date" })),
        card("Add rule: a new rule", "Adds a new rule below the one you selected in.", h("ins", { text: "Say when you're unsure." }))),
      h("p", { class: "muted" }, "To give a reason, add a line that starts with ", h("code", { text: "Why:" }),
        ". A note that doesn't start with one of these is an ordinary comment."));
  }

  function drafterIntro(governance) {
    return h("section", { class: "intro" },
      h("h1", { text: "Suggest Edits" }),
      h("p", { class: "lede", text: "Edit AGENTS.md as you would a Word document with track changes on. Your changes are saved automatically as suggestions under your name, and the maintainers approve or disapprove each one." }),
      h("details", { class: "how" },
        h("summary", {}, h("h2", { text: "How it works" })),
        h("ol", { class: "steps" },
          h("li", {}, h("strong", { text: "Verify your email. " }), "Enter your email address and the 6-digit code we send you. You stay signed in on this computer. You don't need GitHub."),
          h("li", {}, h("strong", { text: "Edit. " }), "Words you delete are struck out, and words you type appear in blue, labeled with your email address. Press Enter at the end of a rule to add a new one. Every change is saved automatically, as its own suggestion; Undo and Redo work as usual."),
          h("li", {}, h("strong", { text: "A maintainer decides. " }), "The ", h("a", { href: at("maintainers/"), text: "maintainers" }),
            " approve or disapprove each suggestion. ", ruleSentence(governance?.rules)),
          h("li", {}, h("strong", { text: "It's published, or set aside. " }), `An approved change is published within ${CHECK_EVERY} or so as a new version, with its own number and fingerprint. A disapproved one moves to the `,
            h("a", { href: at("declined/"), text: "Declined page" }), ". Every suggestion, decision, and version is kept."))),
      commandGuide(),
      h("p", { class: "proposal-count", id: "proposal-count" }));
  }

  async function showDrafter(cfg) {
    if (rev) return showRevision(cfg, rev);
    const [governance, ledger, { markdown, commit }] = await Promise.all([
      loadRecord(cfg, MAINTAINERS_PATH), loadRecord(cfg, LEDGER_PATH), loadDraft(cfg)]);
    html.classList.add("gated");
    $("#main").prepend(h("section", { class: "gate", id: "gate", role: "dialog", "aria-label": "Verify an email address to edit" },
      h("p", { class: "loading", text: "Loading…" })));
    $("#intro").replaceChildren(drafterIntro(governance));
    const version = stampedVersion(markdown) || cfg.latest;
    const changed = commit
      ? ` Last changed ${formatDate(commit.commit.author.date)} by ${commit.author?.login ?? commit.commit.author.name} · ` : " ";
    fileBar(
      [h("span", { class: "badge", text: versionLabel(version) }), `${changed}${fileStats(markdown)}`],
      [secondary("Download", at(DRAFT_PATH), { download: FILE }), copyButton()]);
    $(".file-bar").after(h("div", { id: "suggest-slot", hidden: true }, suggestBar()));
    renderMarkdown(markdown);
    const proposals = h("section", { class: "versions proposals", id: "proposals" }, h("h2", { text: "Suggestions" }), h("p", { class: "loading", text: "Loading suggestions…" }));
    $("#after").replaceChildren(proposals, maintainersNote(governance), communityNote(cfg) || "");
    setCanonical(at("draft/"));
    await setupSuggesting(cfg, governance, ledger, markdown);
    await showEveryVersion(cfg);
    highlightTarget(true);
    updateProgress();
  }

  async function showRevision(cfg, sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("That revision id doesn't look right.");
    const markdown = await fetchText(`https://raw.githubusercontent.com/${cfg.repo}/${sha}/${DRAFT_PATH}`);
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "An earlier version of the text" }),
      h("p", { class: "lede" }, `This is how AGENTS.md looked after change ${sha.slice(0, 7)}. Nothing is ever lost: `,
        "to bring back words from it, suggest the change on the Suggest Edits page (strike out the current words and type the earlier ones), or ask a maintainer to restore the whole text."),
      h("p", {}, button("Back to Suggest Edits", at("draft/")), " ",
        secondary("What changed in this edit", `https://github.com/${cfg.repo}/commit/${sha}`, newTab))));
    fileBar(
      [h("span", { class: "badge", text: `Change ${sha.slice(0, 7)}` }), ` ${fileStats(markdown)}`],
      [action("Copy this text", (event) => copyText(markdown, event.currentTarget)), rawToggle()]);
    renderMarkdown(markdown);
  }

  async function showEveryVersion(cfg) {
    const published = h("section", { class: "versions", id: "versions" },
      h("h2", { text: "Published versions" }),
      h("p", { class: "muted" }, "Each published version is a frozen snapshot with a permanent link and a fingerprint. Versions 0.0.x are comment drafts; 1.0 will be the first version the contributors recommend as a standard. ",
        h("a", { href: at("check/"), text: "Check a copy" }), "."),
      h("ul", { class: "version-list" }, ...cfg.versions.map((r) => h("li", {},
        h("a", { class: "version-name", href: at(`versions/v${r.version}/`), text: versionLabel(r.version) }),
        r.version === cfg.latest ? h("span", { class: "badge", text: "latest" }) : null,
        h("span", { class: "muted", text: ` · ${formatDate(r.date)}` }),
        h("div", { class: "version-summary", text: r.summary }),
        fingerprintLine(r.fingerprint),
        h("div", { class: "muted" }, h("a", { href: at(`versions/v${r.version}/${FILE}`), download: `AGENTS-v${r.version}.md`, text: "Download this version" }))))));
    const history = h("section", { class: "versions", id: "history" }, h("h2", { text: "Every change to the text" }));
    $("#after").append(published, history);
    try {
      const commits = await draftEdits(cfg, 100);
      history.append(
        h("p", { class: "muted", text: `${commits.length === 100 ? "The 100 most recent changes" : plural(commits.length, "change")}, newest first. Open any one to read the text as it was.` }),
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
      history.append(h("p", { class: "muted" }, `The list of changes couldn't be loaded from GitHub (${error.message}). `,
        isLocal ? "That's expected in a local preview. " : "",
        "The complete history is always on GitHub: ", external("history of the text", `https://github.com/${cfg.repo}/commits/${cfg.branch}/${DRAFT_PATH}`), "."));
    }
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
    $("#after").replaceChildren(draftNote(), communityNote(cfg) || "", fingerprintNote(release) || "");
  }

  // ---------- Check a copy ----------

  function checkResult(kind, title, ...body) {
    $("#check-result").replaceChildren(h("div", { class: `verdict verdict-${kind}` }, h("p", { class: "verdict-title", text: title }), ...body));
  }

  async function differences(cfg, release, text) {
    let theirs;
    try { theirs = canonicalLines(await fetchText(at(`versions/v${release.version}/${FILE}`))); } catch { return null; }
    const ours = canonicalLines(text);
    if (squash(theirs.join(" ")) === squash(ours.join(" "))) {
      return h("p", { text: `The words are exactly version ${release.version}'s; only spaces or line breaks differ. Copying text through some programs does that. Download the file again to get an exact copy.` });
    }
    const ops = diffLists(theirs, ours);
    if (!ops) return h("p", { text: `It differs from version ${release.version} in many places.` });
    const changed = ops.filter(([op]) => op !== "same");
    const list = h("ul", { class: "line-diff" }, ...changed.slice(0, 40).map(([op, line]) =>
      h("li", { class: op }, h("span", { class: "sign", "aria-label": op === "del" ? "removed" : "added", text: op === "del" ? "−" : "+" }),
        h(op, { text: line || " " }))));
    return h("div", {},
      h("p", { text: `Compared with version ${release.version}, ${plural(changed.filter(([op]) => op === "del").length, "line")} ${changed.filter(([op]) => op === "del").length === 1 ? "is" : "are"} missing or changed and ${plural(changed.filter(([op]) => op === "ins").length, "line")} ${changed.filter(([op]) => op === "ins").length === 1 ? "was" : "were"} added${changed.length > 40 ? " (the first 40 are shown)" : ""}:` }),
      list);
  }

  async function checkCopy(cfg, raw, pasted) {
    const trimmed = raw.trim();
    const asFingerprint = trimmed.toLowerCase().replace(/^argon2id:/, "");
    if (/^[0-9a-f]{64}$/.test(asFingerprint)) {
      const found = cfg.versions.filter((r) => r.fingerprint === asFingerprint);
      return found.length
        ? checkResult("good", `That's the fingerprint of version ${found.map((r) => r.version).join(" and ")}.`,
          h("p", {}, h("a", { href: at(`versions/v${found[0].version}/`), text: `Read version ${found[0].version}` }), ` (published ${formatDate(found[0].date)}).`))
        : checkResult("bad", "That fingerprint doesn't belong to any published version.");
    }
    if (!trimmed) return checkResult("bad", "There's nothing to check yet. Choose a file, or paste its text.");
    checkResult("busy", "Checking…", h("p", { text: "Computing the fingerprint takes a moment." }));
    const text = pasted && !raw.endsWith("\n") ? `${raw}\n` : raw; // pasting usually drops the final line break
    const sha = await fingerprintOf(text);
    if (!sha) return checkResult("bad", "This isn't AGENTS.md: it's shorter than three lines, so it has no version line.");
    const stamp = text.replace(/\r/g, "").split("\n")[2] || "";
    const claimed = stamp.match(/^\*Version (\S+)/)?.[1];
    const stated = stamp.match(/fingerprint[^:]*:\s*([0-9a-f]{64})/i)?.[1];
    const matches = cfg.versions.filter((r) => r.fingerprint === sha);
    const yours = fingerprintLine(sha, "This copy's fingerprint:");
    if (matches.length) {
      const named = matches.find((r) => r.version === claimed);
      const same = matches.length > 1 ? ` (the same text as version ${matches.filter((r) => r !== (named || matches[0])).map((r) => r.version).join(" and ")})` : "";
      if (named && (!stated || stated === sha)) {
        return checkResult("good", `This is version ${named.version}, exactly as published on ${formatDate(named.date)}.`,
          h("p", {}, `Every character matches${same}. `, h("a", { href: at(`versions/v${named.version}/`), text: `Read version ${named.version}` }), "."), yours);
      }
      return checkResult("warn", `The text is exactly version ${matches.map((r) => r.version).join(" and ")}, but its version line was changed.`,
        h("p", { text: `Line 3 should be version ${matches[0].version}'s version line, but it says: “${stamp.slice(0, 160)}${stamp.length > 160 ? "…" : ""}”` }), yours);
    }
    const reference = cfg.versions.find((r) => r.version === claimed) || cfg.versions.find((r) => r.version === cfg.latest);
    const detail = reference ? await differences(cfg, reference, text) : null;
    return checkResult("bad", "This copy doesn't match any published version.",
      h("p", { text: claimed && cfg.versions.some((r) => r.version === claimed)
        ? `Its version line says it's version ${claimed}, but the text was changed after it was published.`
        : "It was changed after it was published, or it isn't AGENTS.md for Empirical Legal Scholars." }),
      detail, yours);
  }

  async function showCheck(cfg) {
    $(".file").hidden = true;
    const input = h("input", { type: "file", id: "check-file", class: "visually-hidden", accept: ".md,.markdown,.txt,text/markdown,text/plain" });
    const drop = h("label", { class: "drop", for: "check-file" }, h("strong", { text: "Choose a file" }), h("span", { class: "muted", text: " or drop it here" }), input);
    const box = h("textarea", { class: "check-text", rows: "7", spellcheck: "false", placeholder: "…or paste the whole file here, or just a fingerprint",
      "aria-label": "The text of AGENTS.md, or a fingerprint" });
    const run = (text, pasted) => checkCopy(cfg, text, pasted).catch((error) => checkResult("bad", "The check didn't work.", h("p", { text: String(error.message || error) })));
    const readFile = async (file) => { box.value = ""; run(await file.text(), false); };
    input.addEventListener("change", () => input.files[0] && readFile(input.files[0]));
    for (const type of ["dragover", "drop"]) addEventListener(type, (event) => event.preventDefault()); // don't open dropped files
    drop.addEventListener("dragover", () => drop.classList.add("over"));
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (event) => { drop.classList.remove("over"); const file = event.dataTransfer.files[0]; if (file) readFile(file); });

    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "Check a copy" }),
      h("p", { class: "lede", text: "Is a copy of AGENTS.md exactly a published version? Choose the file or paste its text. The check runs in your browser, so nothing is uploaded." }),
      h("div", { class: "checker" }, drop, box, h("p", {}, action("Check", () => run(box.value, true), "button"))),
      h("div", { id: "check-result", class: "check-result", "aria-live": "polite" })));

    const command = h("pre", {}, h("code", { text: COMMAND }));
    $("#after").replaceChildren(
      h("section", { class: "versions" },
        h("h2", { text: "How the fingerprint works" }),
        h("p", {}, "A fingerprint is a 64-character code computed from the text with Argon2id, a hash function standardized in ",
          external("RFC 9106", "https://www.rfc-editor.org/rfc/rfc9106.html"),
          ". If even one character changes, the fingerprint changes, and no one can write a different text with the same fingerprint."),
        h("p", { text: "Each version's fingerprint covers its whole file except line 3, the version line, because that line states the fingerprint. Line endings (Windows or Mac) don't matter. The fingerprint is recorded when the version is published: in the version line of the file itself, in the change log, and in the list below." }),
        h("p", { text: `Anyone gets the same fingerprint, because the settings are fixed and public: the salt “${fingerprintSettings.salt}”, ${fingerprintSettings.iterations} passes, ${fingerprintSettings.parallelism} lanes, ${fingerprintSettings.memory_kib / 1024} MiB of memory, and a ${fingerprintSettings.length_bytes}-byte result (RFC 9106's second recommended settings).` }),
        h("p", {}, "To compute it yourself on a Mac or Linux, install the Argon2 package for Python once (",
          h("code", { text: "python3 -m pip install argon2-cffi" }), "), then run this in a terminal in the folder with the file:"),
        command,
        h("p", { class: "muted" }, "On Windows, use this page. (The ", h("code", { text: "argon2" }),
          " command-line program can't do it: it refuses input longer than 127 bytes.) The robot that publishes versions computes it the same way (",
          external("scripts/fingerprint.py", repoFile(cfg, "scripts/fingerprint.py")), ").")),
      h("section", { class: "versions", id: "fingerprints" },
        h("h2", { text: "Every version's fingerprint" }),
        h("div", { class: "table-wrap" }, h("table", { class: "log fingerprints" },
          h("thead", {}, h("tr", {}, ...["Version", "Published", "Fingerprint (Argon2id)"].map((t) => h("th", { text: t })))),
          h("tbody", {}, ...cfg.versions.map((r) => h("tr", {},
            h("td", {}, h("a", { href: at(`versions/v${r.version}/`), text: r.version })),
            h("td", { text: formatDate(r.date) }),
            h("td", {}, h("code", { text: r.fingerprint || "" }))))))),
        h("p", { class: "muted", text: "Versions 0.0.0 to 0.0.2 were published before fingerprints existed; theirs were computed afterward from the frozen files, which have never changed." })));
    addCopyButtons($("#after"));
  }

  // ---------- Maintainers ----------

  async function showMaintainers(cfg) {
    $(".file").hidden = true;
    const governance = await loadRecord(cfg, MAINTAINERS_PATH);
    const rules = governance?.rules || {};
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "Maintainers" }),
      h("p", { class: "lede", text: "The maintainers decide which suggested changes go into AGENTS.md." }),
      maintainerList(governance)));
    $("#after").replaceChildren(h("section", { class: "versions", id: "how" },
      h("details", { class: "how" },
        h("summary", {}, h("h2", { text: "What maintainers do" })),
        h("ol", { class: "steps" },
          h("li", {}, h("strong", { text: "Anyone suggests. " }), "On the ", h("a", { href: at("draft/"), text: "Suggest Edits" }),
            " page, readers sign in with their email and edit the text with track changes on. Each change is one suggestion under their name. Readers can't change the text themselves."),
          h("li", {}, h("strong", { text: "A maintainer decides. " }), `Signed in on Suggest Edits, a maintainer can approve or disapprove each suggestion: click it in the text, or use the list below the text. ${ruleSentence(rules)}`),
          h("li", {}, h("strong", { text: "Approved: a new version. " }), `Within ${CHECK_EVERY} or so, the change is made and published as a new version, with its own number and fingerprint. The record says who suggested it and who approved it.`),
          h("li", {}, h("strong", { text: "Disapproved: set aside. " }), "It leaves the list and moves to the ",
            h("a", { href: at("declined/"), text: "Declined page" }), ", where it's kept for the record.")),
        h("p", {}, "Maintainers suggest changes like anyone else, then approve them. The lead maintainer can also edit the text directly, and keeps this list in ",
          external(MAINTAINERS_PATH, repoFile(cfg, MAINTAINERS_PATH)), ", where every change is public."),
        h("p", { class: "muted" }, "To become a maintainer, ask the lead maintainer", cfg.community ? [", for example in the ",
          h("a", { href: at("join/"), text: "community's Google group" })] : "", ". The full rules are in ",
          external("GOVERNANCE.md", repoFile(cfg, "GOVERNANCE.md")), "."))));
    highlightTarget(true);
  }

  async function showDeclined(cfg) {
    $(".file").hidden = true;
    const [governance, ledger] = await Promise.all([loadRecord(cfg, MAINTAINERS_PATH), loadRecord(cfg, LEDGER_PATH)]);
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "Declined proposals" }),
      h("p", { class: "lede", text: "Suggested changes that the maintainers disapproved, or that were withdrawn or couldn't be applied. They're kept here for the record and no longer appear on the Suggest Edits page." })));
    const list = h("section", { class: "versions proposals" }, h("p", { class: "loading", text: "Loading…" }));
    $("#after").replaceChildren(list);
    const { replies, records } = await loadProposals(cfg, governance, ledger);
    const { closed } = sortProposals(records);
    list.replaceChildren(...(closed.length ? closed.map((p) => proposalCard(p, cfg, governance?.rules || {}, replies))
      : [h("p", { class: "empty", text: "Nothing has been declined yet." })]),
      h("p", { class: "muted" }, "A proposal made in a comment stays with the person who wrote it, so the comment can still appear in the comment sidebar on Suggest Edits. ",
        h("a", { href: at("draft/"), text: "Back to Suggest Edits" }), "."));
  }

  // ---------- Join the community ----------

  function addressLine(address, label) {
    const [user, domain] = address.split("@"); // a long address may break before the @, never mid-word
    return h("p", { class: "address" }, h("code", {}, user, h("wbr"), `@${domain}`), " ",
      action("Copy", (event) => copyText(address, event.currentTarget), "copy-inline"), label ? h("span", { class: "muted", text: ` ${label}` }) : null);
  }

  async function showJoin(cfg) {
    $(".file").hidden = true;
    const group = cfg.community;
    if (!group) {
      $("#intro").replaceChildren(h("section", { class: "intro" }, h("h1", { text: "Join the community" }),
        h("p", { class: "lede", text: "There's no community group yet." })));
      return;
    }
    const subscribe = groupAddress(cfg, "+subscribe");
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "Join the community" }),
      h("p", { class: "lede" }, `People who use and shape AGENTS.md for Empirical Legal Scholars talk with each other in a Google group, ${group.name}. Join it to ask questions, share what worked and what didn't, and talk through ideas.`),
      h("div", { class: "ways" },
        h("section", { class: "way" },
          h("h2", { text: "Join by email" }),
          h("p", { class: "way-for", text: "Works with any email address. You don't need a Google account." }),
          h("ol", {},
            h("li", { text: "Send an email to the address below. It can be empty; the subject and message don't matter." }),
            h("li", { text: "Google emails you to confirm. Reply to that email." }),
            h("li", { text: "You're in. If the group's managers approve new members first, you'll hear back once they do." })),
          addressLine(subscribe),
          h("p", {}, button("Write the email", `mailto:${subscribe}?subject=Join`))),
        h("section", { class: "way" },
          h("h2", { text: "Join on Google Groups" }),
          h("p", { class: "way-for", text: "For people with a Google account." }),
          h("ol", {},
            h("li", { text: "Open the group and sign in to Google." }),
            h("li", {}, "Choose ", h("em", { text: "Join group" }), " (or ", h("em", { text: "Ask to join group" }), ")."),
            h("li", { text: "Choose how often you want emails, and you're in." })),
          h("p", {}, secondary("Open the group", group.page, newTab)))),
      h("section", { class: "versions" },
        h("h2", { text: "Once you've joined" }),
        h("p", { text: "To write to everyone in the group, send an email to:" }),
        addressLine(group.email),
        h("p", {}, "You can also read and reply to conversations ", external("on Google Groups", group.page), ". To leave, send an email to ",
          h("code", { text: groupAddress(cfg, "+unsubscribe") }), "."),
        h("p", { class: "muted" }, "The group is for conversation. To change AGENTS.md itself, suggest the change on the ",
          h("a", { href: at("draft/"), text: "Suggest Edits" }), " page, where the maintainers decide on it."))));
  }

  function showFooter(cfg) {
    const maker = cfg.created_by;
    $("#footer")?.replaceChildren(
      h("p", {}, h("span", { class: "brand-file", text: "AGENTS.md" }), " ", h("em", { text: "for Empirical Legal Scholars" })),
      maker ? h("p", { class: "made-by" }, "Created by ", maker.url ? external(maker.name, maker.url) : maker.name) : null,
      h("p", {}, ...joined([
        external("Source on GitHub", `https://github.com/${cfg.repo}`),
        external("Changelog", repoFile(cfg, "CHANGELOG.md")),
        h("a", { href: at("maintainers/"), text: "Maintainers" }),
        cfg.community ? h("a", { href: at("join/"), text: "Join the group" }) : null,
        h("a", { href: at("check/"), text: "Check a copy" }),
        h("a", { href: at("llms.txt"), text: "llms.txt" }),
      ].filter(Boolean))));
  }

  async function main() {
    setupReaderControls();
    trackHeader();
    const views = { published: showPublished, drafter: showDrafter, archive: showArchive, check: showCheck, join: showJoin,
      maintainers: showMaintainers, declined: showDeclined };
    try {
      const cfg = JSON.parse(await fetchText(at("versions.json")));
      if (cfg.fingerprint) fingerprintSettings = { ...fingerprintSettings, ...cfg.fingerprint };
      for (const link of $$("[data-repo-link]")) link.href = `https://github.com/${cfg.repo}`;
      showFooter(cfg);
      await (views[mode] || showPublished)(cfg);
    } catch (error) {
      showError(error);
    }
  }

  main();
})();
