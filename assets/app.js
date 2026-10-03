/* AGENTS.md for Empirical Legal Scholars: shows one Markdown file, AGENTS.md, rendered for reading;
   the Drafter, where anyone can comment and propose a change; the Maintainers page, where maintainers sign in to
   approve or disapprove proposals; the Declined page; and a page that checks
   whether a copy is exactly a published version.
   Each page says what to show with attributes on <body>:
     data-mode     published (latest version) | drafter | archive (one version) | check
     data-root     path from the page to the site root: ".", "..", or "../.."
     data-version  archive pages only, e.g. "0.0.2"
   There is no build step: GitHub Pages serves these files as they are. Proposals and votes are
   counted by a robot (scripts/proposals.py); this page only shows them. */
(() => {
  "use strict";

  const FILE = "AGENTS.md";
  const DRAFT_PATH = `draft/${FILE}`;
  const LEDGER_PATH = "governance/proposals.json";
  const MAINTAINERS_PATH = "governance/maintainers.json";
  const HYPOTHESIS_SEARCH = "https://api.hypothes.is/api/search";
  const CHECK_EVERY = "15 minutes";
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

  // Proposals made since the robot last looked: read straight from Hypothesis, so a proposer sees theirs at once.
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
        external(open ? (count ? `Comment on it (${plural(count, "reply", "replies")})` : "Comment on it") :
          (count ? `Read the discussion (${plural(count, "reply", "replies")})` : "Read the proposal"), p.link),
        p.issue ? external(`GitHub issue #${p.issue}`, `https://github.com/${cfg.repo}/issues/${p.issue}`) : null,
      ].filter(Boolean))),
      extra);
  }

  // Every proposal: from the robot's record, plus any made since it last looked.
  async function loadProposals(cfg, governance, ledger) {
    const records = ledger?.proposals || [];
    const rows = await liveComments(cfg);
    const replies = new Map();
    for (const row of rows) if (row.references) replies.set(row.references[0], (replies.get(row.references[0]) || 0) + 1);
    const fresh = newProposals(rows, new Set(records.map((r) => r.id)), governance);
    const newest = (a, b) => (b.created || "").localeCompare(a.created || "");
    const latestDecision = (a, b) => (b.decided || b.created || "").localeCompare(a.decided || a.created || "");
    return {
      replies,
      open: [...fresh, ...records.filter((r) => !FINAL.includes(r.status))].sort(newest),
      adopted: records.filter((r) => r.status === "adopted").sort(latestDecision),
      closed: records.filter((r) => FINAL.includes(r.status) && r.status !== "adopted").sort(latestDecision),
    };
  }

  async function showProposals(cfg, governance, ledger, section) {
    const rules = governance?.rules || {};
    const { replies, open, adopted, closed } = await loadProposals(cfg, governance, ledger);
    section.replaceChildren(
      h("h2", { text: "Proposals" }),
      h("p", {}, "Each proposed change waits for the ", h("a", { href: at("maintainers/"), text: "maintainers" }),
        `, who approve or disapprove it. ${ruleSentence(rules)} An approved change is published as a new version within a minute or two.`));
    if (!open.length) section.append(h("p", { class: "empty" }, "No proposals are waiting right now. ", h("a", { href: "#propose", text: "Make one" }), "."));
    else section.append(h("h3", { text: `Waiting for a maintainer (${open.length})` }), ...open.map((p) => proposalCard(p, cfg, rules, replies)));
    if (adopted.length) {
      const shown = adopted.slice(0, 8), rest = adopted.slice(8);
      section.append(h("h3", { text: `Adopted (${adopted.length})` }), ...shown.map((p) => proposalCard(p, cfg, rules, replies)));
      if (rest.length) section.append(h("details", { class: "more" }, h("summary", { text: `Show ${plural(rest.length, "earlier change")}` }),
        ...rest.map((p) => proposalCard(p, cfg, rules, replies))));
    }
    section.append(h("p", { class: "muted" }, "Proposals that maintainers disapprove, and ones that are withdrawn or can't be applied, move to the ",
      h("a", { href: at("declined/"), text: "Declined page" }), closed.length ? ` (${closed.length} so far)` : "",
      ". Every proposal, vote, and outcome is also recorded in ", external(LEDGER_PATH, repoFile(cfg, LEDGER_PATH)), "."));

    const count = $("#proposal-count");
    if (count) {
      count.replaceChildren(open.length
        ? h("a", { href: "#proposals" }, `${plural(open.length, "proposal is", "proposals are")} waiting for a maintainer. See ${open.length === 1 ? "it" : "them"} below the text.`)
        : adopted.length || closed.length ? h("a", { href: "#proposals", text: "No proposals are waiting right now. See past decisions below the text." })
          : h("span", { text: "No proposals yet. Yours could be the first." }));
    }
  }

  function maintainerList(governance) {
    const how = (m) => [m.github && `${m.github} on GitHub`, m.hypothesis && `${m.hypothesis} on Hypothesis`].filter(Boolean).join(", ");
    return h("ul", { class: "member-list" }, ...(governance?.maintainers || []).map((m) => h("li", {},
      h("strong", { text: m.name }),
      m.role && m.role !== "maintainer" ? h("span", { class: "badge badge-soft", text: m.role }) : null,
      h("span", { class: "muted", text: ` · ${how(m)}${m.since ? ` · since ${formatDate(m.since)}` : ""}` }))));
  }

  // In the Drafter: who decides, and where to read more.
  function maintainersNote(governance) {
    const names = (governance?.maintainers || []).map((m) => m.name);
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Who decides? " }),
        `The maintainers${names.length ? ` (${names.join(", ")})` : ""} approve or disapprove each proposal. Anyone else can comment, and propose changes, but can't change the text.`),
      h("p", {}, secondary("How it works, and the maintainers", at("maintainers/"))));
  }

  // ---------- Suggesting: edit the text directly, with every change tracked ----------
  // Like a word processor's suggesting mode: deleted words stay, struck through; new words appear in blue, under
  // your name. Submitting turns each change into one proposal, posted under your Hypothesis account, and the
  // maintainers approve or disapprove each one. While reading, everyone's pending suggestions are drawn into the
  // text; added words are drawn by CSS, so the page's own text doesn't change and comments keep their places.

  const HYP_KEY_STORE = "els-hypothesis-key";
  const HYP_DEVELOPER = "https://hypothes.is/account/developer";
  const HYP_SIGNUP = "https://hypothes.is/signup";
  const SAVED_WORK = "els-suggesting";
  const ZWSP = "​";
  const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6";
  const suggesting = { on: false, me: null, undo: [], cfg: null, markdown: "", version: "", governance: null, open: [] };

  const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
  const within = (node, selector) => {
    const found = elementOf(node)?.closest(selector);
    return found && $("#doc").contains(found) ? found : null;
  };
  const mineIns = (node) => within(node, "ins.track.mine");
  const struck = (node) => within(node, "del.track");
  const blockOf = (node) => within(node, BLOCKS);
  const frozen = (node) => within(node, "[contenteditable='false']");
  const myName = () => suggesting.me?.username || "you";

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
  }

  // Strike out what's in `range`: original words are wrapped in <del>; words you added are simply removed.
  // Returns where the struck text began and ended, for placing the cursor.
  function strike(range) {
    let start = null, end = null;
    for (const node of textNodesIn(range)) {
      if (frozen(node) || struck(node) || !$("#doc").contains(node)) continue;
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
      const del = h("del", { class: "track mine", "data-by": myName(), title: `Removed by ${myName()}` });
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

  function typeText(text) {
    text = String(text || "").replace(/[\r\n]+/g, " ");
    const sel = getSelection();
    if (!text || !sel.rangeCount) return;
    let range = sel.getRangeAt(0);
    if (frozen(range.startContainer) || !blockOf(range.startContainer)) return;
    if (!range.collapsed) {
      placeCaret(strike(range).end);
      range = sel.getRangeAt(0);
    }
    for (let del = struck(range.startContainer); del; del = struck(range.startContainer)) {  // never type inside struck words
      caretBeside(del, true);
      range = sel.getRangeAt(0);
    }
    const by = myName();
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
    const ins = h("ins", { class: "track mine", "data-by": by, title: `Added by ${by}` }, text);
    range.insertNode(ins);
    caretAt(ins.firstChild, text.length);
  }

  function deleteText(direction, target) {
    const sel = getSelection();
    if (target) select(target);
    if (!sel.rangeCount) return;
    let range = sel.getRangeAt(0);
    const block = blockOf(sel.anchorNode);
    if (range.collapsed) {
      sel.modify("extend", direction, "character");
      range = sel.getRangeAt(0);
    }
    if (range.collapsed) return;
    if (blockOf(range.startContainer) !== block || blockOf(range.endContainer) !== block) {
      // Rules can't be merged. But backing out of an empty new rule removes it.
      if (direction === "backward" && block?.classList.contains("track-new") && !block.textContent.replaceAll(ZWSP, "").trim()) {
        const previous = block.previousElementSibling;
        block.remove();
        if (previous) caretAt(previous, previous.childNodes.length);
      } else {
        range.collapse(direction !== "backward");
        select(range);
      }
      return;
    }
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
    const ins = h("ins", { class: "track mine", "data-by": by, title: `Added by ${by}` }, ZWSP);
    block.after(h(block.tagName === "LI" ? "li" : "p", { class: "track-new mine", "data-by": by }, ins));
    caretAt(ins.firstChild, 1);
  }

  function hint(text) {
    const box = $("#suggest-hint");
    if (!box) return;
    box.textContent = text;
    clearTimeout(hint.timer);
    hint.timer = setTimeout(() => (box.textContent = ""), 6000);
  }

  function rememberForUndo() {
    suggesting.undo.push($("#doc").innerHTML);
    if (suggesting.undo.length > 200) suggesting.undo.shift();
  }
  function undo() {
    const html = suggesting.undo.pop();
    if (html == null) return hint("Nothing to undo.");
    $("#doc").innerHTML = html;
    freezeStamp();
    afterChange();
  }

  function onBeforeInput(event) {
    if (!suggesting.on) return;
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
    };
    if (!actions[type]) return;
    if (type !== "historyUndo") rememberForUndo();
    actions[type]();
    if (type !== "historyUndo") afterChange();
  }

  function onCompositionStart() {
    const sel = getSelection();
    if (!suggesting.on || !sel.rangeCount) return;
    rememberForUndo();
    const range = sel.getRangeAt(0);
    if (!range.collapsed) placeCaret(strike(range).end);
    if (!mineIns(sel.anchorNode)) {
      const ins = h("ins", { class: "track mine", "data-by": myName(), title: `Added by ${myName()}` }, ZWSP);
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
      const type = el.closest("ins.track.mine") ? "ins" : el.closest("del.track") ? "del" : "orig";
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
      : h(type, { class: "track mine", "data-by": by, title: `${type === "ins" ? "Added" : "Removed"} by ${by}` }, text)));
  }
  function reconcile() {
    const doc = $("#doc");
    const before = document.createElement("div");
    before.innerHTML = suggesting.lastGood;
    const oldBlocks = leafBlocks(before), newBlocks = leafBlocks(doc);
    if (oldBlocks.length !== newBlocks.length) {
      doc.innerHTML = suggesting.lastGood;
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

  // ---- From tracked marks to proposals ----

  const commandFor = (change) => ({ delete: "Delete", replace: `Replace with: ${change.new}`,
    insert: `Add after: ${change.new}`, rule: `Add rule: ${change.new}` })[change.kind];

  function describe(change) {
    const quote = (text) => `“${short(text, 70)}”`;
    return { delete: `Delete ${quote(change.exact)}`, replace: `Replace ${quote(change.exact)} with ${quote(change.new)}`,
      insert: `Add ${quote(change.new)} after ${quote(change.exact)}`, rule: `Add a new rule: ${quote(change.new)}` }[change.kind];
  }
  const short = (text, limit) => (text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text);

  const isWordChar = (ch) => /[\p{L}\p{N}_'’-]/u.test(ch);

  // Every change in the document, widened to whole words, with the words around it (as everyone else sees
  // the text) so the robot can find the one place it belongs.
  function collectChanges() {
    const doc = $("#doc");
    const parts = $$(BLOCKS, doc).filter((block) => !frozen(block) && !block.querySelector(BLOCKS)).map((block) => {
      const chars = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (within(node, "button")) continue;
        const type = mineIns(node) ? "ins" : struck(node) ? "del" : "orig";
        for (const ch of node.data) if (ch !== ZWSP) chars.push({ ch, type });
      }
      return { chars, isNew: block.classList.contains("track-new") };
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
        changes.push({ kind: "rule", exact: squash(source.slice(start, end)), new: text, ...context(start, end) });
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
        if (!newText) { changes.push({ kind: "delete", exact: oldText, new: "", ...context(placeOf(a), placeOf(b)) }); continue; }
        if (oldText) { changes.push({ kind: "replace", exact: oldText, new: newText, ...context(placeOf(a), placeOf(b)) }); continue; }
        // New words between spaces: add them after the word before (or put them in front of the word after).
        let e = a - 1;
        while (e >= 0 && /\s/.test(chars[e].ch)) e -= 1;
        if (e >= 0) {
          let s2 = e;
          while (s2 > 0 && !/\s/.test(chars[s2 - 1].ch)) s2 -= 1;
          changes.push({ kind: "insert", exact: squash(sourceOf(chars.slice(s2, e + 1))), new: newText, ...context(placeOf(s2), placeOf(e + 1)) });
        } else {
          let f = b;
          while (f < chars.length && /\s/.test(chars[f].ch)) f += 1;
          let g = f;
          while (g < chars.length && !/\s/.test(chars[g].ch)) g += 1;
          const next = squash(sourceOf(chars.slice(f, g)));
          if (next) changes.push({ kind: "replace", exact: next, new: `${newText} ${next}`, ...context(placeOf(f), placeOf(g)) });
        }
      }
    });
    return changes;
  }

  // ---- Hypothesis account ----

  function storedHypothesisKey() {
    try { return localStorage.getItem(HYP_KEY_STORE); } catch { return null; }
  }
  function storeHypothesisKey(key) {
    try { if (key) localStorage.setItem(HYP_KEY_STORE, key); else localStorage.removeItem(HYP_KEY_STORE); } catch { /* blocked */ }
  }
  async function hypothesisAs(key, method, path, body) {
    const res = await fetch(`https://api.hypothes.is/api${path}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw Object.assign(new Error(detail.reason || detail.message || `Hypothesis answered ${res.status}`), { status: res.status });
    }
    return res.json();
  }
  async function connectHypothesis(key) {
    const profile = await hypothesisAs(key, "GET", "/profile");
    if (!profile.userid) throw new Error("Hypothesis didn't recognize that token. Copy it again from your developer page.");
    const username = profile.userid.replace(/^acct:|@hypothes\.is$/g, "");
    suggesting.me = { username, name: profile.user_info?.display_name || username, key };
    storeHypothesisKey(key);
    for (const mark of $$("#doc [data-by='you']")) {  // changes made before connecting get your name too
      mark.dataset.by = username;
      if (mark.title) mark.title = mark.title.replace(/you$/, username);
    }
    return suggesting.me;
  }

  // Post one change as a public proposal on the Drafter, under the reader's account.
  function postChange(key, change, reason) {
    const uri = `${suggesting.cfg.site}draft/`;
    return hypothesisAs(key, "POST", "/annotations", {
      uri,
      document: { title: [document.title] },
      text: [commandFor(change), reason ? `Why: ${reason}` : ""].filter(Boolean).join("\n"),
      tags: ["suggestion"],
      group: "__world__",
      permissions: { read: ["group:__world__"] },  // public: without this, Hypothesis keeps it private
      target: [{ source: uri, selector: [{ type: "TextQuoteSelector", exact: change.exact, prefix: change.prefix, suffix: change.suffix }] }],
    });
  }

  // ---- The suggesting bar ----

  function saveWork() {
    try {
      localStorage.setItem(SAVED_WORK, JSON.stringify({ version: suggesting.version, html: $("#doc").innerHTML }));
    } catch { /* storage blocked: the work lasts until the page closes */ }
  }
  function savedWork() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_WORK) || "null");
      return saved && saved.version === suggesting.version ? saved.html : null;
    } catch { return null; }
  }
  function clearWork() {
    try { localStorage.removeItem(SAVED_WORK); } catch { /* blocked */ }
  }

  function afterChange(save = true) {
    tidyMarks();
    suggesting.lastGood = $("#doc").innerHTML;
    if (save) saveWork();
    updateSuggestBar();
  }

  function freezeStamp() {
    const stamp = $("#doc h1 + p");
    if (stamp) stamp.setAttribute("contenteditable", "false");
  }

  function updateSuggestBar() {
    const count = $("#suggest-count");
    if (!count) return;
    const n = collectChanges().length;
    count.textContent = n ? `${plural(n, "change")} so far` : "No changes yet";
    for (const id of ["#suggest-submit", "#suggest-discard"]) { const control = $(id); if (control) control.disabled = !n; }
  }

  function suggestBar() {
    const who = h("span", { class: "suggest-who" });
    const showWho = () => who.replaceChildren(suggesting.me
      ? h("span", {}, "Suggesting as ", h("strong", { class: "mine-name", text: suggesting.me.username }), " · ",
        h("button", { type: "button", class: "linklike", text: "Disconnect", onclick: () => { storeHypothesisKey(null); suggesting.me = null; showWho(); } }))
      : h("span", { text: "Your changes are tracked. You'll add your Hypothesis name when you submit." }));
    showWho();
    suggestBar.showWho = showWho;
    return h("div", { class: "suggest-bar", id: "suggest-bar", role: "region", "aria-label": "Suggesting" },
      h("p", { class: "suggest-line" },
        h("strong", { text: "Suggesting. " }),
        h("span", { class: "suggest-help", text: "Select words and press Delete to strike them out, or type to add words. To add a rule, press Enter at the end of a rule. " }),
        who),
      h("p", { class: "suggest-actions" },
        h("span", { class: "suggest-count", id: "suggest-count" }),
        Object.assign(action("Submit for review", openSubmit, "button"), { id: "suggest-submit" }),
        action("Undo", () => undo(), "button secondary"),
        Object.assign(action("Discard all", discardAll, "button secondary"), { id: "suggest-discard" }),
        action("Stop suggesting", () => setMode(false), "button secondary")),
      h("p", { class: "suggest-hint", id: "suggest-hint", "aria-live": "polite" }),
      h("div", { class: "suggest-panel", id: "suggest-panel" }));
  }

  function discardAll() {
    if (!collectChanges().length || !confirm("Discard all of your changes?")) return;
    clearWork();
    suggesting.undo = [];
    startEditing(suggesting.markdown, null);
  }

  function connectForm(onDone) {
    const input = h("input", { type: "password", class: "key-input", autocomplete: "off", spellcheck: "false",
      placeholder: "Paste your Hypothesis API token", "aria-label": "Your Hypothesis API token" });
    const problem = h("p", { class: "error" });
    const go = async () => {
      const key = input.value.trim();
      if (!key) return input.focus();
      problem.textContent = "";
      try {
        await connectHypothesis(key);
        suggestBar.showWho?.();
        onDone();
      } catch (error) {
        problem.textContent = error.status === 401 ? "Hypothesis didn't accept that token. Copy it again from your developer page." : error.message;
      }
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
    return h("div", { class: "connect" },
      h("p", {}, h("strong", { text: "Your suggestions go out under your Hypothesis name, " }),
        "so everyone can see who suggested what. Connect your account once:"),
      h("ol", { class: "signin-steps" },
        h("li", {}, "Sign in to Hypothesis, or ", external("make a free account", HYP_SIGNUP), "."),
        h("li", {}, "Open your ", external("Hypothesis developer page", HYP_DEVELOPER), ", choose ", h("em", { text: "Create API token" }),
          ", and copy the token."),
        h("li", {}, "Paste it here: ", h("span", { class: "key-row" }, input, action("Connect", go, "button")))),
      problem,
      h("p", { class: "muted", text: "The token stays in this browser and is sent only to Hypothesis. It lets this page post your suggestions for you; don't share it." }));
  }

  function openSubmit() {
    const panel = $("#suggest-panel");
    const changes = collectChanges();
    if (!changes.length) return hint("There's nothing to submit yet.");
    if (!suggesting.me) return panel.replaceChildren(connectForm(openSubmit));
    const reason = h("textarea", { class: "check-text", rows: "2", placeholder: "Why? (optional; everyone sees it)", "aria-label": "Why you suggest these changes" });
    const status = h("p", { class: "vote-status", "aria-live": "polite" });
    const send = action(`Submit ${plural(changes.length, "change")}`, async () => {
      send.disabled = true;
      const failed = [];
      for (const [i, change] of changes.entries()) {
        status.textContent = `Sending ${i + 1} of ${changes.length}…`;
        try { await postChange(suggesting.me.key, change, squash(reason.value)); } catch (error) { failed.push([change, error]); }
      }
      if (failed.length) {
        status.className = "vote-status failed";
        status.textContent = `${plural(failed.length, "change")} couldn't be sent: ${failed[0][1].message}`;
        send.disabled = false;
        return;
      }
      clearWork();
      suggesting.undo = [];
      await setMode(false, false);
      announce(`Thanks, ${suggesting.me.name}. Your ${plural(changes.length, "suggestion")} now wait for a maintainer, and you can see them marked in the text.`);
    }, "button");
    panel.replaceChildren(h("div", { class: "submit" },
      h("p", { text: "These go to the maintainers, who approve or disapprove each one:" }),
      h("ul", { class: "submit-list" }, ...changes.map((change) => h("li", { text: describe(change) }))),
      reason,
      h("p", { class: "vote-buttons" }, send, " ", action("Keep editing", () => panel.replaceChildren(), "button secondary")),
      status));
  }

  function announce(text) {
    const box = $("#suggest-note");
    if (box) { box.textContent = text; box.hidden = false; }
  }

  function startEditing(markdown, savedHtml) {
    renderMarkdown(markdown);
    const doc = $("#doc");
    if (savedHtml) doc.innerHTML = DOMPurify.sanitize(savedHtml);
    freezeStamp();
    doc.setAttribute("contenteditable", "true");
    doc.setAttribute("spellcheck", "true");
    doc.classList.add("suggesting");
    suggesting.lastGood = doc.innerHTML;
    updateSuggestBar();
  }

  async function setMode(on, keep = true) {
    suggesting.on = on;
    html.classList.toggle("suggesting-mode", on);
    for (const control of $$(".mode-switch button")) control.setAttribute("aria-pressed", String(control.dataset.mode === (on ? "suggest" : "read")));
    const raw = $(".raw-toggle");
    if (raw) raw.disabled = on;
    $(".suggestion-pop")?.remove();
    const doc = $("#doc");
    if (on) {
      $("#suggest-note").hidden = true;
      $("#suggest-legend").hidden = true;
      $("#suggest-slot").replaceChildren(suggestBar());
      startEditing(suggesting.markdown, savedWork());
      doc.focus();
      return;
    }
    if (keep && collectChanges().length) saveWork();  // kept for when you come back
    doc.removeAttribute("contenteditable");
    doc.classList.remove("suggesting");
    $("#suggest-slot").replaceChildren();
    renderMarkdown(suggesting.markdown);
    await refreshSuggestions();
  }

  // ---- Everyone's pending suggestions, drawn into the text ----

  // Each visible (non-space) character of the document, with the text node and offset it comes from.
  function docTextIndex() {
    const chars = [];
    const walker = document.createTreeWalker($("#doc"), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (within(node, ".track, button")) continue;
      for (let i = 0; i < node.data.length; i++) if (!/\s/.test(node.data[i])) chars.push({ node, offset: i });
    }
    return { chars, text: chars.map(({ node, offset }) => node.data[offset]).join("") };
  }

  // The same rule the robot uses (scripts/edits.py, locate): the quote, chosen among repeats by the words around it.
  function locateQuote(index, exact, prefix, suffix) {
    const key = squash(exact).replace(/\s/g, ""), before = squash(prefix).replace(/\s/g, ""), after = squash(suffix).replace(/\s/g, "");
    if (!key) return null;
    const hits = [];
    for (let i = index.text.indexOf(key); i >= 0; i = index.text.indexOf(key, i + 1)) hits.push(i);
    const fits = (i) => {
      const seenBefore = index.text.slice(0, i), seenAfter = index.text.slice(i + key.length);
      const n = Math.min(before.length, seenBefore.length), m = Math.min(after.length, seenAfter.length);
      return (n === 0 || seenBefore.slice(-n) === before.slice(-n)) && seenAfter.slice(0, m) === after.slice(0, m);
    };
    const good = hits.filter(fits);
    if (good.length === 1) return [good[0], good[0] + key.length];
    if (!good.length && hits.length === 1 && key.length >= 25) return [hits[0], hits[0] + key.length];
    return null;
  }

  function markSuggestion(index, p, taken) {
    const found = locateQuote(index, p.old || "", p.before || "", p.after || "");
    if (!found) return false;
    const [a, b] = found;
    if (taken.some(([x, y]) => a < y && x < b)) return false;
    taken.push([a, b]);
    const who = p.proposer?.hypothesis || p.proposer?.name || "someone";
    const start = index.chars[a], end = index.chars[b - 1];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    const label = { "data-by": who, "data-proposal": p.id, title: `Suggested by ${who} · click for details`, tabindex: "0" };
    let last = null;
    if (p.kind === "delete" || p.kind === "replace") {
      for (const node of textNodesIn(range)) {
        const from = node === range.startContainer ? range.startOffset : 0;
        const to = node === range.endContainer ? range.endOffset : node.length;
        if (to <= from) continue;
        const part = from > 0 ? node.splitText(from) : node;
        if (to - from < part.length) part.splitText(to - from);
        const del = h("del", { class: "track others", ...label });
        part.before(del);
        del.append(part);
        last = del;
      }
    }
    if (p.kind === "replace" || p.kind === "insert") {
      const ins = h("ins", { class: "track others added", "data-text": p.kind === "insert" ? ` ${p.new}` : ` ${p.new}`, ...label });
      if (last) last.after(ins);
      else { const r = document.createRange(); r.setStart(end.node, end.offset + 1); r.collapse(true); r.insertNode(ins); }
    }
    if (p.kind === "rule") {
      const block = blockOf(end.node);
      if (block) block.after(h(block.tagName === "LI" ? "li" : "p", { class: "track-rule others", "data-text": p.new, ...label }));
    }
    return true;
  }

  async function refreshSuggestions() {
    const cfg = suggesting.cfg;
    const ledger = await loadRecord(cfg, LEDGER_PATH);
    const { open } = await loadProposals(cfg, suggesting.governance, ledger);
    suggesting.open = open;
    const index = docTextIndex();
    const taken = [];
    let shown = 0;
    for (const p of [...open].sort((x, y) => (x.created || "").localeCompare(y.created || ""))) {
      if (p.status === "needs-fix" && !p.new && p.kind !== "delete") continue;
      if (markSuggestion(index, p, taken)) shown += 1;
    }
    const legend = $("#suggest-legend");
    if (legend) {
      legend.hidden = !shown;
      legend.replaceChildren(h("span", { class: "legend-marks" }, h("del", { class: "track others", text: "struck" }), " would be removed, ",
        h("ins", { class: "track others added", "data-text": "orange" }), " would be added"),
        ` · ${plural(shown, "suggestion")} waiting for a maintainer. Click one for details.`);
    }
  }

  function suggestionCard(p) {
    const box = h("div", { class: "suggestion-pop", role: "dialog", "aria-label": "Suggestion" });
    const key = storedKey();
    const status = h("p", { class: "vote-status", "aria-live": "polite" });
    const say = (text, kind = "") => { status.className = `vote-status ${kind}`; status.textContent = text; };
    const vote = (which) => async () => {
      for (const b of box.querySelectorAll("button.vote-action")) b.disabled = true;
      try { await castVote(suggesting.cfg, key, p, which, say); } catch (error) { say(`That didn't work: ${error.message}`, "failed"); }
    };
    box.append(
      h("p", { class: "pop-head" }, h("strong", { text: KIND_LABELS[p.kind] || "Change" }), ` · suggested by ${p.proposer?.name || "someone"}, ${formatDate(p.created)}`),
      changeView(p),
      p.reason ? h("p", { class: "proposal-reason", text: `“${p.reason}”` }) : "",
      h("p", { class: "proposal-links" }, external("Comment on it", p.link), " · ", h("a", { href: `#proposal-${p.id}`, text: "See it in the list" })),
      key ? h("p", { class: "vote-buttons" }, action("Approve", vote("approve"), "button vote-action"), " ",
        action("Disapprove", vote("reject"), "button secondary vote-action")) : "",
      status);
    return box;
  }

  function onSuggestionClick(event) {
    const mark = event.target.closest?.("[data-proposal]");
    $(".suggestion-pop")?.remove();
    if (!mark || suggesting.on || !$("#doc").contains(mark)) return;
    const p = suggesting.open.find((x) => x.id === mark.dataset.proposal);
    if (!p) return;
    event.preventDefault();
    const card = suggestionCard(p);
    document.body.append(card);
    const box = mark.getBoundingClientRect();
    card.style.top = `${scrollY + box.bottom + 8}px`;
    card.style.left = `${Math.max(12, Math.min(scrollX + box.left, scrollX + innerWidth - card.offsetWidth - 12))}px`;
  }

  function modeSwitch() {
    return h("span", { class: "mode-switch", role: "group", "aria-label": "Mode" },
      h("button", { type: "button", "data-mode": "read", "aria-pressed": "true", text: "Read & comment", onclick: () => suggesting.on && setMode(false) }),
      h("button", { type: "button", "data-mode": "suggest", "aria-pressed": "false", text: "Suggest edits", onclick: () => !suggesting.on && setMode(true) }));
  }

  function setupSuggesting(cfg, governance, markdown) {
    Object.assign(suggesting, { cfg, governance, markdown, version: stampedVersion(markdown) || cfg.latest });
    const key = storedHypothesisKey();
    if (key) connectHypothesis(key).then(() => suggestBar.showWho?.()).catch(() => storeHypothesisKey(null));
    const doc = $("#doc");
    doc.addEventListener("beforeinput", onBeforeInput);
    doc.addEventListener("compositionstart", onCompositionStart);
    doc.addEventListener("compositionend", () => { if (suggesting.on) { reconcile(); afterChange(); } });
    // Every change this page makes cancels the browser's own; so any input event means one got past.
    doc.addEventListener("input", (event) => { if (suggesting.on && !event.isComposing) { reconcile(); afterChange(); } });
    doc.addEventListener("dragstart", (event) => suggesting.on && event.preventDefault());
    doc.addEventListener("drop", (event) => suggesting.on && event.preventDefault());
    doc.addEventListener("keydown", (event) => {
      if (suggesting.on && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
    });
    document.addEventListener("click", onSuggestionClick);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") $(".suggestion-pop")?.remove();
      if (event.key === "Enter" && event.target.matches?.("[data-proposal]")) onSuggestionClick(event);
    });
    if (savedWork()) announce("You have unsent changes. Choose “Suggest edits” to keep working on them.");
  }

  // ---------- Pages ----------

  function draftNote() {
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Nothing here is final. " }),
        "This is a comment draft. Anyone can propose a change in the ", h("a", { href: at("draft/"), text: "Drafter" }),
        ". The maintainers approve or disapprove each proposal, and each approved change is published as a new version, with its own number and fingerprint."),
      h("p", {}, button("Open the Drafter", at("draft/"))));
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
    return h("details", { class: "commands", id: "propose" },
      h("summary", {}, h("h2", { id: "propose-title", text: "Or propose a change in a comment" })),
      h("p", {}, "You can also select words in the text, choose ", h("em", { text: "Annotate" }),
        ", and start your comment with one of these:"),
      h("div", { class: "command-grid" },
        card("Delete", "Strikes out the words you selected. Select a whole rule to remove it.", h("del", { text: "quickly" })),
        card("Replace with: new words", "Puts your words in place of the ones you selected.", h("del", { text: "look at" }), " ", h("ins", { text: "read" })),
        card("Add after: new words", "Adds your words right after the ones you selected.", "the source ", h("ins", { text: "and its date" })),
        card("Add rule: a new rule", "Adds a new rule below the one you selected in.", h("ins", { text: "Say when you're unsure." }))),
      h("p", { class: "muted" }, "To give a reason, add a line that starts with ", h("code", { text: "Why:" }),
        ". A note that doesn't start with one of these is an ordinary comment. One change per note works best; select words within one rule, or whole rules."));
  }

  function drafterIntro(governance) {
    return h("section", { class: "intro" },
      h("h1", { text: "Drafter" }),
      h("p", { class: "lede", text: "Anyone can comment on AGENTS.md here, and suggest changes. The maintainers approve or disapprove each suggestion, and every approved change is published right away as a new version." }),
      h("ol", { class: "steps" },
        h("li", {}, h("strong", { text: "Suggest. " }), "Choose ", h("em", { text: "Suggest edits" }),
          " above the text and edit it directly, as in a word processor with track changes on: words you delete are struck out, and words you type appear in blue under your name. Then submit. Your suggestions go out under your free ",
          external("Hypothesis", "https://web.hypothes.is/start"), " account; you don't need GitHub."),
        h("li", {}, h("strong", { text: "A maintainer decides. " }), "The ", h("a", { href: at("maintainers/"), text: "maintainers" }),
          " approve or disapprove each proposal. ", ruleSentence(governance?.rules)),
        h("li", {}, h("strong", { text: "It's published, or set aside. " }), "An approved change is published within a minute or two as a new version, with its own number and fingerprint. A disapproved one moves to the ",
          h("a", { href: at("declined/"), text: "Declined page" }), ". Every proposal, decision, and version is kept, so nothing is ever lost.")),
      commandGuide(),
      h("p", { class: "proposal-count", id: "proposal-count" }));
  }

  async function showDrafter(cfg) {
    if (rev) return showRevision(cfg, rev);
    const [governance, ledger, { markdown, commit }] = await Promise.all([
      loadRecord(cfg, MAINTAINERS_PATH), loadRecord(cfg, LEDGER_PATH), loadDraft(cfg)]);
    $("#intro").replaceChildren(drafterIntro(governance));
    const version = stampedVersion(markdown) || cfg.latest;
    const changed = commit
      ? ` Last changed ${formatDate(commit.commit.author.date)} by ${commit.author?.login ?? commit.commit.author.name} · ` : " ";
    fileBar(
      [h("span", { class: "badge", text: versionLabel(version) }), `${changed}${fileStats(markdown)}`],
      [modeSwitch(), secondary("Download", at(DRAFT_PATH), { download: FILE }), copyButton(), rawToggle()]);
    $(".file-bar").after(h("div", { id: "suggest-slot" }), h("p", { class: "suggest-legend", id: "suggest-legend", hidden: true }),
      h("p", { class: "suggest-note", id: "suggest-note", hidden: true, "aria-live": "polite" }));
    renderMarkdown(markdown);
    const proposals = h("section", { class: "versions proposals", id: "proposals" }, h("h2", { text: "Proposals" }), h("p", { class: "loading", text: "Loading proposals…" }));
    $("#after").replaceChildren(proposals, maintainersNote(governance), communityNote(cfg) || "");
    setCanonical(at("draft/"));
    setupSuggesting(cfg, governance, markdown);
    loadHypothesis();
    await Promise.all([showProposals(cfg, governance, ledger, proposals), showEveryVersion(cfg), refreshSuggestions()]);
    highlightTarget(true);
    updateProgress();
  }

  async function showRevision(cfg, sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("That revision id doesn't look right.");
    const markdown = await fetchText(`https://raw.githubusercontent.com/${cfg.repo}/${sha}/${DRAFT_PATH}`);
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "An earlier version of the text" }),
      h("p", { class: "lede" }, `This is how AGENTS.md looked after change ${sha.slice(0, 7)}. Nothing is ever lost: `,
        "to bring back words from it, propose the change in the Drafter (select the current words and write “Replace with:” and the earlier words), or ask a maintainer to restore the whole text."),
      h("p", {}, button("Back to the Drafter", at("draft/")), " ",
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
  // Maintainers sign in with a GitHub key (a personal access token) that stays in their browser. The page uses it
  // only to post their vote on the proposal's GitHub issue, opening the issue first if the robot hasn't yet. The
  // robot then checks that the voter is on the list of maintainers and acts on the vote.

  const KEY_STORE = "els-maintainer-key";
  const KEY_FOR_LEAD = "https://github.com/settings/personal-access-tokens/new";
  const KEY_FOR_OTHERS = "https://github.com/settings/tokens/new?scopes=public_repo&description=AGENTS.md%20for%20Empirical%20Legal%20Scholars%20maintainer";

  function storedKey() {
    try { return sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE); } catch { return null; }
  }
  function storeKey(key, stay = false) {
    try {
      sessionStorage.removeItem(KEY_STORE);
      localStorage.removeItem(KEY_STORE);
      if (key) (stay ? localStorage : sessionStorage).setItem(KEY_STORE, key);
    } catch { /* storage blocked: signed in for this page only */ }
  }

  async function githubAs(key, method, path, body) {
    const res = await fetch(`https://api.github.com${path}`, {
      method, cache: "no-store", body: body ? JSON.stringify(body) : undefined,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${key}`, "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}) },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw Object.assign(new Error(detail.message || `GitHub answered ${res.status}`), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  }

  // The proposal's GitHub issue: the robot's, or one this page opens (with the marker the robot looks for).
  async function issueFor(cfg, key, p) {
    if (p.issue) return p.issue;
    const marker = `<!-- proposal:${p.id} -->`;
    for (let page = 1; page <= 5; page++) {
      const issues = await githubAs(key, "GET", `/repos/${cfg.repo}/issues?state=all&per_page=100&page=${page}`);
      const found = issues.find((issue) => (issue.body || "").includes(marker));
      if (found) return found.number;
      if (issues.length < 100) break;
    }
    const made = await githubAs(key, "POST", `/repos/${cfg.repo}/issues`, {
      title: `Proposal: ${KIND_LABELS[p.kind] || "Change"} “${squash(p.old).slice(0, 48)}”`,
      body: `A proposal from the Drafter by ${p.proposer?.name || "a reader"}, filed on the Maintainers page so it can be decided. The robot adds the details.\n\n${marker}`,
      labels: ["proposal"],
    });
    return made.number;
  }

  // After a vote, watch the issue: the robot closes it with the outcome.
  async function outcomeOf(cfg, key, number) {
    for (let i = 0; i < 24; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      try {
        const issue = await githubAs(key, "GET", `/repos/${cfg.repo}/issues/${number}`);
        if (issue.state === "closed") return issue.state_reason === "completed" ? "adopted" : "declined";
      } catch { /* try again */ }
    }
    return null;
  }

  // Post a maintainer's vote on the proposal's GitHub issue, then wait for the robot to act on it.
  async function castVote(cfg, key, p, vote, say) {
    say(vote === "approve" ? "Approving…" : "Disapproving…");
    const number = await issueFor(cfg, key, p);
    await githubAs(key, "POST", `/repos/${cfg.repo}/issues/${number}/comments`,
      { body: `/${vote}\n\n${vote === "approve" ? "Approved" : "Disapproved"} on the site.` });
    say(vote === "approve" ? "Approved. The robot is publishing it as a new version (usually a minute or two)…"
      : "Disapproved. The robot is moving it to the Declined page (usually a minute or two)…", "pending");
    const outcome = await outcomeOf(cfg, key, number);
    if (outcome === "adopted") say("Done: it's published as a new version. Reload the page to see it.", "done");
    else if (outcome === "declined") say("Done: it's on the Declined page.", "done");
    else say("Your vote is in. The robot hasn't finished yet; reload in a few minutes to see the result.", "pending");
  }

  function voteButtons(cfg, key, p) {
    const status = h("p", { class: "vote-status", "aria-live": "polite" });
    const say = (text, kind = "") => { status.className = `vote-status ${kind}`; status.textContent = text; };
    const approve = action("Approve", () => cast("approve"), "button");
    const disapprove = action("Disapprove", () => cast("reject"), "button secondary");
    if (p.status === "needs-fix") { approve.disabled = true; approve.title = "It needs a fix before it can be approved"; }
    async function cast(vote) {
      approve.disabled = disapprove.disabled = true;
      try {
        await castVote(cfg, key, p, vote, say);
      } catch (error) {
        say(`That didn't work: ${error.message}`, "failed");
        approve.disabled = p.status === "needs-fix";
        disapprove.disabled = false;
      }
    }
    return h("div", { class: "vote" }, h("p", { class: "vote-buttons" }, approve, " ", disapprove), status);
  }

  function showSignIn(cfg, governance, ledger, section, problem = "") {
    const input = h("input", { type: "password", class: "key-input", autocomplete: "off", spellcheck: "false",
      placeholder: "Paste your key here", "aria-label": "Your GitHub key" });
    const stay = h("input", { type: "checkbox", id: "stay-signed-in" });
    const go = () => {
      const key = input.value.trim();
      if (!key) return input.focus();
      storeKey(key, stay.checked);
      showReview(cfg, governance, ledger, section, key);
    };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
    section.replaceChildren(
      h("h2", { text: "Approve or disapprove proposals" }),
      h("p", { text: "Maintainers sign in here with a key from GitHub. The key stays in this browser, and your votes are posted on GitHub under your name. Readers don't need to sign in: they comment in the Drafter." }),
      problem ? h("p", { class: "error", text: problem }) : "",
      h("ol", { class: "signin-steps" },
        h("li", {}, h("strong", { text: "Create a key on GitHub. " }),
          "The lead maintainer: ", external("create a fine-grained key", KEY_FOR_LEAD),
          ", choose “Only select repositories” and pick ", h("code", { text: cfg.repo.split("/")[1] }),
          ", then under Repository permissions set Issues to “Read and write.” Other maintainers: ",
          external("create a classic key", KEY_FOR_OTHERS), " (the form is filled in for you). Either way, choose how long it lasts (90 days is fine), choose Generate token, and copy the key."),
        h("li", {}, h("strong", { text: "Paste it here and sign in. " }), h("span", { class: "key-row" }, input, action("Sign in", go, "button"))),
        h("li", {}, h("label", { for: "stay-signed-in" }, stay, " Stay signed in on this computer. Otherwise you're signed out when you close this tab."))),
      h("p", { class: "muted", text: "The key lets this page post comments on GitHub for you, and it's sent only to GitHub. Anyone who has it could do the same, so don't share it. You can delete it any time in GitHub's settings." }));
  }

  async function showReview(cfg, governance, ledger, section, key = storedKey()) {
    if (!key) return showSignIn(cfg, governance, ledger, section);
    section.replaceChildren(h("h2", { text: "Approve or disapprove proposals" }), h("p", { class: "loading", text: "Signing in…" }));
    let user;
    try {
      user = await githubAs(key, "GET", "/user");
    } catch (error) {
      storeKey(null);
      return showSignIn(cfg, governance, ledger, section, error.status === 401
        ? "GitHub didn't accept that key. It may have expired or been mistyped; create a new one." : `Couldn't sign in: ${error.message}`);
    }
    const me = (governance?.maintainers || []).find((m) => m.github && m.github.toLowerCase() === user.login.toLowerCase());
    const { replies, open } = await loadProposals(cfg, governance, ledger);
    section.replaceChildren(
      h("h2", { text: "Approve or disapprove proposals" }),
      h("p", { class: `signed-in${me ? "" : " not-maintainer"}` }, "Signed in as ", h("strong", { text: user.name || user.login }),
        ` (${user.login} on GitHub)`, me ? ", a maintainer. " : ". That account isn't on the list of maintainers, so its votes won't count. ",
        action("Sign out", () => { storeKey(null); showSignIn(cfg, governance, ledger, section); }, "button secondary small")));
    if (!open.length) return section.append(h("p", { class: "empty", text: "Nothing is waiting for a decision right now." }));
    section.append(h("p", { class: "muted", text: `${plural(open.length, "proposal is", "proposals are")} waiting. Your vote is posted on the proposal's GitHub issue under your name, and the robot acts on it, usually within a minute or two. ${ruleSentence(governance?.rules)}` }));
    for (const p of open) section.append(proposalCard(p, cfg, governance?.rules || {}, replies, voteButtons(cfg, key, p)));
  }

  async function showMaintainers(cfg) {
    $(".file").hidden = true;
    const [governance, ledger] = await Promise.all([loadRecord(cfg, MAINTAINERS_PATH), loadRecord(cfg, LEDGER_PATH)]);
    const rules = governance?.rules || {};
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "Maintainers" }),
      h("p", { class: "lede", text: "Anyone can comment on AGENTS.md. The maintainers decide which proposed changes go in: they approve or disapprove each one, and every approved change is published as a new version." }),
      h("ol", { class: "steps" },
        h("li", {}, h("strong", { text: "Anyone suggests. " }), "In the ", h("a", { href: at("draft/"), text: "Drafter" }),
          ", readers comment, and suggest changes by editing the text with track changes on (", h("em", { text: "Suggest edits" }),
          "). Each change they submit becomes one proposal under their name. Readers can't change the text themselves."),
        h("li", {}, h("strong", { text: "A maintainer decides. " }), `Each proposal waits for a maintainer to approve or disapprove it, here on this page. ${ruleSentence(rules)}`),
        h("li", {}, h("strong", { text: "Approved: a new version. " }), "Within a minute or two, the change is made and published as a new version, with its own number and fingerprint. The record says who proposed it and who approved it."),
        h("li", {}, h("strong", { text: "Disapproved: set aside. " }), "It leaves the Drafter's list and moves to the ",
          h("a", { href: at("declined/"), text: "Declined page" }), ", where it's kept for the record."))));
    const review = h("section", { class: "versions", id: "review" });
    $("#after").replaceChildren(
      h("section", { class: "versions", id: "maintainers" },
        h("h2", { text: "The maintainers" }),
        maintainerList(governance),
        h("p", {}, "Maintainers can change the text too: they propose a change like anyone else, then approve it. The lead maintainer can also edit the text directly, and keeps this list in ",
          external(MAINTAINERS_PATH, repoFile(cfg, MAINTAINERS_PATH)), ", where every change is public."),
        h("p", { class: "muted" }, "To become a maintainer, ask the lead maintainer", cfg.community ? [", for example in the ",
          h("a", { href: at("join/"), text: "community's Google group" })] : "", ". The full rules are in ",
          external("GOVERNANCE.md", repoFile(cfg, "GOVERNANCE.md")), ".")),
      review);
    await showReview(cfg, governance, ledger, review);
    highlightTarget(true);
  }

  async function showDeclined(cfg) {
    $(".file").hidden = true;
    const [governance, ledger] = await Promise.all([loadRecord(cfg, MAINTAINERS_PATH), loadRecord(cfg, LEDGER_PATH)]);
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "Declined proposals" }),
      h("p", { class: "lede", text: "Proposed changes that the maintainers disapproved, or that were withdrawn or couldn't be applied. They're kept here for the record and no longer appear in the Drafter's list." })));
    const list = h("section", { class: "versions proposals" }, h("p", { class: "loading", text: "Loading…" }));
    $("#after").replaceChildren(list);
    const { replies, closed } = await loadProposals(cfg, governance, ledger);
    list.replaceChildren(...(closed.length ? closed.map((p) => proposalCard(p, cfg, governance?.rules || {}, replies))
      : [h("p", { class: "empty", text: "Nothing has been declined yet." })]),
      h("p", { class: "muted" }, "A proposal's comment stays with the person who wrote it, so it can still appear in the Drafter's comment sidebar. ",
        h("a", { href: at("draft/"), text: "Back to the Drafter" }), "."));
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
        h("p", { class: "muted" }, "The group is for conversation. To change AGENTS.md itself, propose the change in the ",
          h("a", { href: at("draft/"), text: "Drafter" }), ", where the maintainers decide on it."))));
  }

  function showFooter(cfg) {
    $("#footer")?.replaceChildren(
      h("p", {}, h("span", { class: "brand-file", text: "AGENTS.md" }), " ", h("em", { text: "for Empirical Legal Scholars" })),
      h("p", {}, ...joined([
        external("Source on GitHub", `https://github.com/${cfg.repo}`),
        external("Changelog", repoFile(cfg, "CHANGELOG.md")),
        h("a", { href: at("maintainers/"), text: "How changes are approved" }),
        cfg.community ? h("a", { href: at("join/"), text: "Join the group" }) : null,
        h("a", { href: at("check/"), text: "Check a copy" }),
        h("a", { href: at("llms.txt"), text: "llms.txt" }),
      ].filter(Boolean))));
  }

  async function main() {
    setupReaderControls();
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
