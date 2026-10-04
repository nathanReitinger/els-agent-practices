/* AGENTS.md for Empirical Legal Scholars: shows one Markdown file, AGENTS.md, rendered for reading;
   Suggest Edits, where readers who verify an email address suggest changes by editing the text with track
   changes on, add sections, and comment on and highlight it; History, every version with the changes from the one before it marked in the text; the
   Maintainers page; the Declined page; a page for joining the community's group; and a page that checks
   whether a copy is exactly a published version.
   Each page says what to show with attributes on <body>:
     data-mode     published (latest version) | drafter (Suggest Edits) | history | archive (one version) | check |
                   join | maintainers | declined
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
  const CHECK_EVERY = "five minutes";
  const FINAL = ["adopted", "declined", "withdrawn", "cannot-apply"];
  const KIND_LABELS = { delete: "Delete", replace: "Replace", insert: "Add words", rule: "Add a rule", section: "Add a section" };
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

  // A time as milliseconds. Supabase writes times with six decimal places, which some browsers can't read, so
  // they're cut to three first.
  const toTime = (value) => Date.parse(String(value ?? "").replace(/(\.\d{3})\d+/, "$1"));

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : toTime(value));
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
    const headings = $$("h2", article).filter((heading) => heading.id);  // not History's removed headings
    if (headings.length < 3) { toc.hidden = true; return; }
    toc.replaceChildren(h("details", { open: matchMedia("(min-width: 1100px)").matches },
      h("summary", { text: "Outline" }),
      h("ol", {}, ...headings.map((heading) => h("li", {}, h("a", { href: `#${heading.id}`, text: plainText(heading) }))))));
    toc.hidden = false;
    markCurrentSection();
  }

  // The outline marks the section being read: the last heading above a line a third of the way down the screen
  // (the last one, at the very end of the page). Headings are looked up by id each time, so this keeps working
  // when the text is drawn again, as it often is on Suggest Edits.
  function markCurrentSection() {
    const toc = $("#toc");
    if (!toc || toc.hidden) return;
    const links = $$("a[href^='#']", toc);
    const line = innerHeight / 3;
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 4;
    let current = null;
    for (const link of links) {
      const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (heading && heading.getBoundingClientRect().top <= line) current = link;
    }
    if (atEnd && links.length) current = links[links.length - 1];
    for (const link of links) link.classList.toggle("current", link === current);
    if (current) current.setAttribute("aria-current", "location");
    for (const link of links) if (link !== current) link.removeAttribute("aria-current");
    // On wide screens the outline is a column that scrolls by itself: keep the current section in view in it.
    if (current && toc.scrollHeight > toc.clientHeight + 2) {
      const top = current.getBoundingClientRect().top - toc.getBoundingClientRect().top + toc.scrollTop;
      const bottom = top + current.offsetHeight;
      if (top < toc.scrollTop) toc.scrollTop = top - 8;
      else if (bottom > toc.scrollTop + toc.clientHeight) toc.scrollTop = bottom - toc.clientHeight + 8;
    }
  }
  let sectionFrame = 0;
  const followSection = () => { cancelAnimationFrame(sectionFrame); sectionFrame = requestAnimationFrame(markCurrentSection); };
  addEventListener("scroll", followSection, { passive: true });
  addEventListener("resize", followSection);

  // A block's own words, without History's labels and the old words shown beside new ones.
  function plainText(block) {
    const copy = block.cloneNode(true);
    for (const extra of $$(".h-label, .h-old", copy)) extra.remove();
    return squash(copy.textContent);
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

  // The page's own address, for search engines and shared links.
  function setCanonical(url) {
    const absolute = new URL(url, location.href).href;
    const link = $("link[rel=canonical]") || document.head.appendChild(h("link", { rel: "canonical" }));
    link.href = absolute;
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
  // separated only by a space, or by a punctuation mark or two, are joined, so "null, weak, and" -> "null and" is
  // one change, and so is "read it." -> "know it (e.g., can I run it).".
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
      const slight = gap.same !== undefined && (!gap.same.trim() || (gap.same.length <= 3 && !/[\p{L}\p{N}]/u.test(gap.same)));
      if (slight && a.same === undefined && b && b.same === undefined) {
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
      adopted: ["Done", `Published as version ${p.version}${p.decided ? `, ${formatDate(p.decided)}` : ""}`],
      declined: ["Disapproved", p.decided ? formatDate(p.decided) : ""],
      withdrawn: ["Withdrawn", p.note],
      "cannot-apply": ["Can't be applied", p.note],
      approved: ["In the publishing queue", `${p.place === 1 ? "next" : `number ${p.place} in line`} · will be version ${p.version}`],
      disapproved: ["Disapproved", "moving to the Declined page"],
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
    if (p.kind === "section") {
      const [title, ...rules] = String(p.new || "").split("\n");
      box.append(h("p", { class: "new-section-title" }, h("ins", { text: title })), ...rules.map((rule) => h("p", {}, h("ins", { text: rule }))));
    }
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

  function proposalCard(p, cfg, rules, extra = null) {
    const [label, detail] = proposalStatus(p, rules);
    const open = !FINAL.includes(p.status);
    const note = ["needs-fix", "withdrawn", "cannot-apply"].includes(p.status) && detail; // a sentence: its own line
    return h("article", { class: `proposal is-${p.status}`, id: `proposal-${p.id}` },
      h("div", { class: "proposal-head" },
        h("span", { class: `kind kind-${p.kind}`, text: KIND_LABELS[p.kind] || p.kind }),
        h("span", { class: "proposal-status" }, h("strong", { text: label }), detail && !note ? ` · ${detail}` : ""),
        p.status === "adopted" ? h("a", { class: "proposal-version", href: at(`history/?v=${p.version}`), text: `Version ${p.version}`,
          title: "See this change in History" }) : null),
      note ? h("p", { class: "proposal-note", text: note }) : null,
      changeView(p),
      p.reason ? h("p", { class: "proposal-reason", text: `“${p.reason}”` }) : null,
      mode === "drafter" && p.builds_on ? buildsOnNote(p) : null,
      mode === "drafter" && !FINAL.includes(p.status) ? checkNote(p) : null,
      h("p", { class: "proposal-meta" }, ...joined([
        `Proposed by ${p.proposer?.name || "someone"}, ${formatDate(p.created)}`,
        p.section || null,
      ].filter(Boolean))),
      votesView(p),
      h("p", { class: "proposal-links" }, ...joined([
        open && mode === "drafter" && !["approved", "disapproved"].includes(p.status) ? h("a", { href: "#doc", text: "Show it in the text",
          onclick: (event) => { event.preventDefault(); showInText(p.id); } }) : null,
        p.issue ? external(`GitHub issue #${p.issue}`, `https://github.com/${cfg.repo}/issues/${p.issue}`) : null,
      ].filter(Boolean))),
      extra);
  }

  function sortProposals(list) {
    const newest = (a, b) => (b.created || "").localeCompare(a.created || "");
    // Changes published in the same run were decided at the same moment: the one suggested later comes first.
    const latestDecision = (a, b) => (b.decided || b.created || "").localeCompare(a.decided || a.created || "")
      || (b.created || "").localeCompare(a.created || "");
    return {
      open: list.filter((p) => !FINAL.includes(p.status)).sort(newest),
      adopted: list.filter((p) => p.status === "adopted").sort(latestDecision),
      closed: list.filter((p) => FINAL.includes(p.status) && p.status !== "adopted").sort(latestDecision),
    };
  }

  function maintainerList(governance) {
    const how = (m) => [m.email && `signs in as ${m.email}`, m.github && `${m.github} on GitHub`].filter(Boolean).join(", ");
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
        `The maintainers${names.length ? ` (${names.join(", ")})` : ""} approve or disapprove each suggestion. Anyone else can suggest changes, but can't change the text.`),
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
      if (block.textContent.replaceAll(ZWSP, "").trim() || block.contains(caret)) continue;
      if (block.matches("h2.track-section") && sectionHasRules(block)) continue;  // a new section's heading stays while it has rules
      block.remove();
    }
    for (const list of $$("ul.track-section-list", doc)) if (!list.children.length) list.remove();
    for (const block of $$(".track-section", doc)) block.toggleAttribute("data-empty", !block.textContent.replaceAll(ZWSP, "").trim());
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
        if (block.matches("h2.track-section") && sectionHasRules(block)) return;  // a new section keeps its heading while it has rules
        const list = block.parentElement?.matches("ul.track-section-list") ? block.parentElement : null;
        const previous = block.previousElementSibling || list?.previousElementSibling || null;
        if (block.matches("h2.track-section") && block.nextElementSibling?.matches("ul.track-section-list")) block.nextElementSibling.remove();
        block.remove();
        if (list && !list.children.length) list.remove();
        if (previous) {
          const end = [...previous.querySelectorAll("ins.track.mine")].pop() || previous;
          caretAt(end, end.childNodes.length);
        }
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
    if (block.classList.contains("track-section")) return sectionEnter(block);
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

  // A short message ("Approved…", "Your vote wasn't saved…") at the bottom of the screen for a few seconds, so it's
  // seen wherever the reader is on the page.
  function hint(text) {
    let box = $("#toast");
    if (!box) document.body.append(box = h("div", { class: "toast", id: "toast", role: "status", "aria-live": "polite", hidden: true }));
    box.textContent = text;
    box.hidden = !text;
    clearTimeout(hint.timer);
    hint.timer = setTimeout(() => { box.hidden = true; box.textContent = ""; }, 8000);
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
      if (el.closest("button")) continue;  // a "+1" beside someone's change isn't text
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
    // A new rule or section is anchored on the last words of the rule above it that no other change touches, so
    // the changes can be approved in any order.
    const anchorAfter = (index) => {
      const previous = parts.slice(0, index).reverse().find((other) => !other.isNew);
      if (!previous) return null;
      const prevText = sourceOf(previous.chars);
      let untouched = previous.chars.length;
      while (untouched > 0 && previous.chars[untouched - 1].type === "orig") untouched -= 1;
      const tailStart = sourceOf(previous.chars.slice(0, untouched)).length;
      let words = [...prevText.matchAll(/\S+/g)].filter((w) => w.index >= tailStart).slice(-6);
      if (!words.length) words = [...prevText.matchAll(/\S+/g)].slice(-6);
      if (!words.length) return null;
      const start = previous.at + words[0].index, end = previous.at + words.at(-1).index + words.at(-1)[0].length;
      return { exact: squash(source.slice(start, end)), ...context(start, end) };
    };
    const changes = [];
    const sections = new Map();  // each new section's blocks (its heading and rules), by its id
    parts.forEach((part, index) => {
      if (part.isNew && part.block.dataset.section) {
        const id = part.block.dataset.section;
        if (!sections.has(id)) sections.set(id, { index, parts: [] });
        sections.get(id).parts.push(part);
        return;
      }
      if (part.isNew) {
        const text = squash(part.chars.map((c) => c.ch).join(""));
        const anchor = text && anchorAfter(index);
        if (!anchor) return;
        changes.push({ kind: "rule", ...anchor, new: text, ...madeOf(part.chars, [part.block, ...part.block.querySelectorAll("ins.track.mine")]) });
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
    // A new section is one change: its heading, then one rule a line. It's saved once it has a heading.
    for (const { index, parts: group } of sections.values()) {
      const textOf = (part) => squash(part.chars.map((c) => c.ch).join(""));
      const title = group.filter((part) => part.block.tagName === "H2").map(textOf).join(" ");
      const rules = group.filter((part) => part.block.tagName === "LI").map(textOf).filter(Boolean);
      const anchor = title && anchorAfter(index);
      if (!anchor) continue;
      changes.push({ kind: "section", ...anchor, new: [title, ...rules].join("\n"),
        ...madeOf(group.flatMap((part) => part.chars), group.flatMap((part) => [part.block, ...part.block.querySelectorAll("ins.track.mine")])) });
    }
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
    author: { id: row.author_id, email: row.author_email }, builds_on: row.builds_on || null, aiCheck: row.ai_check || null,
  });
  const COLUMNS = { kind: "kind", exact: "exact", prefix: "prefix", suffix: "suffix", new: "new_text", reason: "reason", base: "base",
    builds_on: "builds_on" };
  const toRow = (fields) => Object.fromEntries(Object.entries(fields).filter(([key]) => COLUMNS[key]).map(([key, value]) => [COLUMNS[key], value ?? ""]));

  async function supabaseBackend(config) {
    const library = await loadSupabase();
    const client = library.createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "els-sign-in" },
    });
    // An error from the database carries its code; one from the connection has none, so it's tried again later.
    const must = ({ data, error }) => {
      if (error) throw Object.assign(new Error(error.message || String(error)), { code: error.code || "" });
      return data;
    };
    // The comments table comes from a later version of supabase/schema.sql: until it's run again, no comments.
    const missingTable = (error) => /PGRST205|42P01/.test(error.code) || /does not exist|could not find the table/i.test(error.message);
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
        let timer = null, commentsChannel = null;
        const load = async () => {
          try {
            const [suggestions, votes, comments] = await Promise.all([everything("suggestions", "created"), everything("votes", "at"),
              everything("comments", "created").catch((error) => (missingTable(error) ? null : Promise.reject(error)))]);
            // Live updates for comments only once the table is there, so a database without it still gets them for the rest.
            if (comments && !commentsChannel) {
              commentsChannel = client.channel("suggest-edits-comments")
                .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, soon).subscribe();
            }
            callback({ suggestions: suggestions.map(fromRow), votes, comments: comments || [], commentsReady: !!comments });
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
      // The AI check of new rules (supabase/robot.sql): ask, then look up the answer; and keep it with the suggestion.
      startRuleCheck: async (request) => must(await client.rpc("start_rule_check", { request })),
      ruleCheckResult: async (id) => must(await client.rpc("rule_check_result", { check_id: id })),
      saveCheck: async (docId, check) => must(await client.from("suggestions").update({ ai_check: check }).eq("id", docId)),
      // Comments have ids made on this computer, so one sent twice (say, after the connection dropped) is added once.
      addComment: async (row) => must(await client.from("comments").upsert(row, { onConflict: "id", ignoreDuplicates: true })),
      deleteComment: async (id) => must(await client.from("comments").delete().eq("id", id)),
      resolveComment: async (id, done) => must(await client.rpc("resolve_comment", { comment_id: id, done })),
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
    const SUGGESTIONS = "els-local-suggestions", VOTES = "els-local-votes", COMMENTS = "els-local-comments", USER = "els-local-user";
    const read = (key, empty) => { try { return JSON.parse(localStorage.getItem(key)) ?? empty; } catch { return empty; } };
    const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    let onData = null, onUser = () => {};
    const emit = () => onData?.({ suggestions: read(SUGGESTIONS, []), votes: read(VOTES, []), comments: read(COMMENTS, []), commentsReady: true });
    addEventListener("storage", (event) => { if ([SUGGESTIONS, VOTES, COMMENTS].includes(event.key)) emit(); });
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
      async startRuleCheck() { return { unavailable: "off" }; },  // no AI check here: the word check stands in
      async vote(proposalId, vote, step = "patch") {
        const user = me();
        const votes = read(VOTES, []).filter((v) => !(v.suggestion === proposalId && v.voter_id === user.id));
        votes.push({ suggestion: proposalId, voter_id: user.id, voter_email: user.email, vote, version_step: step, at: new Date().toISOString() });
        write(VOTES, votes);
        emit();
      },
      async addComment(row) {
        const list = read(COMMENTS, []), now = new Date().toISOString(), user = me();
        if (!list.some((c) => c.id === row.id)) {
          list.push({ ...row, author_id: user.id, author_email: user.email, resolved: false, resolved_by: "", created: now, updated: now });
        }
        write(COMMENTS, list);
        emit();
      },
      async deleteComment(id) { write(COMMENTS, read(COMMENTS, []).filter((c) => c.id !== id && c.parent !== id)); emit(); },
      async resolveComment(id, done) {
        write(COMMENTS, read(COMMENTS, []).map((c) => (c.id === id ? { ...c, resolved: done, resolved_by: done ? me().email : "" } : c)));
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
    pendingVotes: [],  // votes cast here that the database hasn't sent back yet
    voting: new Map(),  // a maintainer's choices on a card before voting (version number, buttons shown), kept on redraws
    comments: [], commentsReady: false, outbox: [], commentSpots: new Map(),  // comments and highlights, and ones not sent yet
    alsoHere: new Map(),  // a drawn suggestion's id: the other suggestions for the same words
    checked: new Set(), lastChanges: [],  // changes already checked against the other rules, and your changes as last saved
    asked: new Map(), aiOn: null,  // the AI check's answers, by the change they're about; and whether it's on (null: not known yet)
    proposals: { records: [] },  // the robot's record (governance/proposals.json)
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
      if (within(node, "ins.track.mine, .track-new, button, .track-section-others")) continue;
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
    // Additions don't change the words they follow, so they never stand in another change's way. A change to words
    // already changed is shown with the one drawn there.
    const additive = ["insert", "rule", "section"].includes(s.kind);
    const hit = additive ? null : taken.find(([x, y]) => a < y && x < b);
    if (hit) return { under: hit[2] };
    const first = blockOf(index.chars[a].node), block = blockOf(index.chars[b - 1].node);
    if (!first || !block || frozen(first) || frozen(block) || (mine && first !== block)) return false;
    if (!additive) taken.push([a, b, mine ? `mine:${s.docId}` : s.id]);
    const who = s.author?.email || s.proposer?.email || s.proposer?.name || "someone";
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
    if (s.kind === "section") {
      const [title, ...rules] = String(s.new || "").split("\n");
      const end = sectionEndAfter(block);
      if (mine) {
        const ins = (text) => h("ins", { ...addedBy(who), ...label }, ZWSP + text);
        const part = (tag, text) => h(tag, { class: "track-new mine track-section", "data-by": who, "data-section": s.docId, ...label }, ins(text));
        end.after(part("h2", title), ...(rules.length ? [h("ul", { class: "track-section-list", "data-section": s.docId }, ...rules.map((rule) => part("li", rule)))] : []));
      } else {
        end.after(h("div", { class: "track-section-others", "data-by": who, contenteditable: "false", ...label },
          h("div", { class: "ts-title", text: title }), ...rules.map((rule) => h("div", { class: "ts-rule", text: rule }))));
      }
    }
    return true;
  }

  function clearOthers() {
    const doc = $("#doc");
    for (const del of $$("del.track.others", doc)) del.replaceWith(...del.childNodes);
    for (const mark of $$("ins.track.others, .track-rule.others, .track-section-others, button.also-here", doc)) mark.remove();
    doc.normalize();
  }

  // Everyone else's open suggestions: from the database, and from comments (the robot's record, and any
  // made since it last looked).
  function othersOpen() {
    const decided = pendingDecisions();
    const fromSite = (suggest.remote || []).filter((s) => !isMine(s) && isOpen(s) && !isIgnored(s));
    // Without the database (it didn't answer), the robot's record of open suggestions stands in.
    const fromRecord = suggest.remote ? [] : suggest.proposals.records.filter((r) => !FINAL_STATUS.has(r.status));
    return [...fromSite, ...fromRecord].filter((x) => !decided.has(x.id))
      .sort((x, y) => (x.created || "").localeCompare(y.created || ""));
  }

  function drawOthers() {
    clearOthers();
    // Your own changes are in the text already: someone else's change to the same words is shown with yours.
    const taken = [], index = sourceIndex();
    for (const [docId, s] of suggest.saved) {
      if (s.kind !== "delete" && s.kind !== "replace") continue;
      const found = locateQuote(index, s.exact, s.prefix, s.suffix);
      if (found) taken.push([...found, `mine:${docId}`]);
    }
    suggest.others = othersOpen();
    suggest.alsoHere = new Map();
    for (const s of suggest.others) {
      const drawn = drawSuggestion(s, false, taken);
      if (drawn?.under) suggest.alsoHere.set(drawn.under, [...(suggest.alsoHere.get(drawn.under) || []), s.id]);
    }
    addAlsoHereBadges();
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
      if (drawSuggestion(s, true, taken) === true) suggest.saved.set(s.docId, pickChange(s));
      else suggest.undrawable.add(s.docId);  // it no longer fits the text; it's kept, and the robot reports it
    }
    drawOthers();
    drawComments();
    addSectionControls();
    setEditable(suggest.editing);
    suggest.lastGood = doc.innerHTML;
    suggest.undo = [];
    suggest.redo = [];
    suggest.dirty = false;
    updateBar();
    if (suggest.me && suggest.remote === null) {
      setSaveStatus("Can't reach the database yet. Editing starts as soon as it answers; changes not yet saved are kept on this computer.", true);
    }
    if (suggest.restoreLater) restoreUnsaved();
  }

  async function redrawNow() {
    if (suggest.dirty || suggest.busy) await sync();
    drawEverything();
    renderProposals();
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
    const inForm = field?.matches?.("input, textarea, select") && $("#after")?.contains(field);
    if (!suggest.ready || typing || inForm) {
      refresh.timer = setTimeout(refresh, 1500);
      return;
    }
    const changed = suggest.redraw || decisionsKey(pendingDecisions()) !== suggest.decidedKey || mineChangedElsewhere();
    if (suggest.me && !suggest.dirty && !suggest.busy && changed) drawEverything();
    else keepingCaret(() => { drawOthers(); drawComments(); });
    renderProposals();
    refreshSpot();
    updateBar();
    if (pendingDecisions().size) watchForPublication();
  }

  // Only a reader who has verified their email address can edit the text.
  function setEditable(on) {
    const doc = $("#doc");
    // Editing starts once your saved suggestions have loaded, so nothing is saved twice.
    const editable = on && suggest.ready && !!suggest.me && suggest.remote !== null;
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
    relayoutRail();
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
    keepUnsaved();  // on this computer too, in case the connection or the page goes first
    suggest.busy = true;
    try {
      const used = new Set();
      const changes = collectChanges();
      for (const change of changes) {
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
      if (suggest.edits === edits) {
        suggest.dirty = false;
        forgetUnsaved();
      }
      suggest.lastGood = $("#doc").innerHTML;
      suggest.lastChanges = changes;
      const untitled = $$("#doc h2.track-section").some((heading) => !heading.textContent.replaceAll(ZWSP, "").trim());
      setSaveStatus(untitled ? "Give the new section a heading to save it." : suggest.dirty ? "Saving…" : "All changes saved", untitled);
      suggest.watcher?.refresh();  // so the list below the text shows them now
      setTimeout(checkNewRules, 0);
    } catch (error) {
      // New sections come from a later version of supabase/schema.sql (the sections are saved last, so the rest are saved).
      const needsUpdate = error.code === "23514" && /kind/.test(error.message);
      setSaveStatus(needsUpdate ? "New sections need one more step from the lead maintainer: run supabase/schema.sql again in Supabase. Your other changes are saved."
        : navigator.onLine && error.code ? `Not saved yet (${error.message}). Trying again…`
          : "Can't reach the database right now. Your changes are kept on this computer and will be saved when it's back.", true);
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
      h("span", { class: "check-status", id: "check-status", "aria-live": "polite", hidden: true }),
      h("button", { type: "button", class: "linklike", text: "Sign out", onclick: signOut }));
  }

  async function signOut() {
    await sync();
    try { await suggest.backend.signOut(); } catch (error) { hint(`Signing out didn't work: ${error.message}`); }
  }

  const HELP = "Edit as in Word with track changes on: words you delete are struck out, and words you type are added in blue. Press Enter at the end of a rule to add a new one. Everything is saved as you go. Other people's suggestions are orange; click one to see it.";

  function suggestBar() {
    return h("div", { class: "suggest-bar", id: "suggest-bar", role: "region", "aria-label": "Editing" },
      h("div", { class: "suggest-line", id: "suggest-who" }),
      h("p", { class: "suggest-tools" },
        h("span", { class: "suggest-help", id: "suggest-help", text: HELP }),
        h("span", { class: "suggest-buttons" },
          action("Undo", () => undo(), "button secondary small suggest-undo"),
          action("Redo", () => redo(), "button secondary small suggest-undo"))));
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
    const since = toTime(p.updated || p.created) || 0;
    const latest = new Map();
    for (const v of suggest.votes) {
      if (v.suggestion !== p.id || !(toTime(v.at) >= since)) continue;
      const m = maintainers.find((x) => sameEmail(x.email, v.voter_email));
      if (!m || (v.vote === "approve" && rules.maintainers_may_approve_their_own_proposals === false && sameEmail(m.email, proposer))) continue;
      const known = latest.get(m.email.toLowerCase());
      if (!known || toTime(v.at) > toTime(known.at)) latest.set(m.email.toLowerCase(), v);
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
  const robotOrder = (a, b) => (a.created || "").localeCompare(b.created || "") || a.id.localeCompare(b.id);
  function pendingDecisions() {
    const pending = new Map();
    let version = suggest.version;
    const waiting = currentProposals().filter((p) => !FINAL_STATUS.has(p.status)).sort(robotOrder);
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
    const added = (text) => h("span", { class: "accepted", title: "Approved: in the publishing queue" }, text);
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

  // After a decision, look for the robot's new version (every 15 seconds at first, then every 30) for ten minutes,
  // and show it. (GitHub answers 60 such questions an hour from one computer, so it doesn't look for longer.)
  function watchForPublication(decidedNow = false) {
    if (decidedNow) watchForPublication.until = Date.now() + 10 * 60 * 1000;
    if (watchForPublication.timer || !(Date.now() < (watchForPublication.until || 0))) return;
    const check = async () => {
      watchForPublication.timer = null;
      try {
        // A local preview reads its own files; the site asks GitHub for its newest commit.
        const head = isLocal ? { sha: String(Date.now()) }
          : await fetchJSON(`https://api.github.com/repos/${suggest.cfg.repo}/commits/${suggest.cfg.branch}`);
        if (head.sha && head.sha !== suggest.seenSha) {
          suggest.seenSha = head.sha;
          const raw = (path) => (isLocal ? at(path) : `https://raw.githubusercontent.com/${suggest.cfg.repo}/${head.sha}/${path}`);
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
      const soon = watchForPublication.until - Date.now() > 7 * 60 * 1000;  // the first three minutes
      if (Date.now() < watchForPublication.until && pendingDecisions().size) watchForPublication.timer = setTimeout(check, soon ? 15000 : 30000);
    };
    watchForPublication.timer = setTimeout(check, 15000);
  }

  function voteControls(p) {
    if (!isMaintainer() || !suggest.backend?.vote || FINAL_STATUS.has(p.status)) return null;
    const status = h("p", { class: "vote-status", "aria-live": "polite" });
    const say = (text, kind = "") => { status.className = `vote-status ${kind}`; status.textContent = text; };
    const mine = suggest.votes.filter((v) => v.suggestion === p.id && v.voter_id === suggest.me.id).pop();
    const labels = { patch: "", minor: " (middle number)", major: " (first number)" };
    // The numbers follow the approved changes ahead of this one in the publishing queue (the robot's order).
    const base = [...pendingDecisions().values()].filter((d) => d.kind === "adopt" && d.p.id !== p.id && robotOrder(d.p, p) < 0)
      .map((d) => d.version).pop() || suggest.version;
    const choice = suggest.voting.get(p.id) || {};
    const remember = (what) => suggest.voting.set(p.id, { ...suggest.voting.get(p.id), ...what });
    const step = h("select", { class: "step-select", "aria-label": "The new version's number", onchange: () => remember({ step: step.value }) },
      ...STEPS.map((value) => h("option", { value, selected: (choice.step || mine?.version_step || "patch") === value,
        text: `as version ${nextVersion(base, value)}${labels[value]}` })));
    // A vote counts at once: the box closes, an approved change joins the text and the publishing queue,
    // and the vote is saved in the background. If saving fails, the vote is taken back and the page says so.
    const cast = async (vote) => {
      const chosen = vote === "approve" ? step.value : "patch";
      suggest.voting.delete(p.id);
      const me = suggest.me, at = new Date(Math.max(Date.now(), toTime(p.updated) || 0)).toISOString();
      const mine = { suggestion: p.id, voter_id: me.id, voter_email: me.email, vote, version_step: chosen, at };
      const others = (list) => list.filter((v) => !(v.suggestion === p.id && v.voter_id === me.id));
      suggest.pendingVotes = [...others(suggest.pendingVotes), mine];
      suggest.votes = [...others(suggest.votes), mine];
      $(".spot-pop")?.remove();
      await redrawNow();
      const decided = pendingDecisions().get(p.id);
      hint(decided?.kind === "adopt" ? `Approved. It's in the publishing queue, and the text shows it now; it will be version ${decided.version}.`
        : decided?.kind === "decline" ? "Disapproved. It's gone from the text, and it's in the queue to move to the Declined page."
          : `${vote === "approve" ? "Approved" : "Disapproved"}. It needs more maintainers' votes to be decided.`);
      try {
        await suggest.backend.vote(p.id, vote, chosen);
        watchForPublication(true);
        suggest.watcher?.refresh();
      } catch (error) {
        suggest.pendingVotes = others(suggest.pendingVotes);
        suggest.votes = others(suggest.votes);
        await redrawNow();
        hint(/version_step/.test(error.message)
          ? "Your vote wasn't saved: the database needs one more step first (run supabase/schema.sql again in Supabase's SQL Editor)."
          : `Your vote wasn't saved (${error.message}). Please try again.`);
      }
    };
    const approve = action("Approve", () => cast("approve"), "button small");
    const disapprove = action("Disapprove", () => cast("reject"), "button secondary small");
    if (p.status === "needs-fix") { approve.disabled = true; approve.title = "It needs a fix before it can be approved"; }
    const current = mine && toTime(mine.at) >= (toTime(p.updated) || 0);
    if (current) say(mine.vote === "approve" ? "You approved it." : "You disapproved it.", "done");
    const buttons = h("p", { class: "vote-buttons" }, approve, " ", step, " ", disapprove);
    if (!["approved", "disapproved"].includes(p.status)) return h("div", { class: "vote" }, buttons, status);
    // Decided, and in the queue: it doesn't ask for a vote. The buttons are there only to change it.
    if (!choice.open) {
      buttons.hidden = true;
      const change = h("button", { type: "button", class: "linklike", text: current ? "Change your vote" : "Vote on it",
        onclick: () => { buttons.hidden = false; change.remove(); remember({ open: true }); } });
      status.append(current ? " " : "", change);
    }
    return h("div", { class: "vote" }, status, buttons);
  }

  // A reason for one of your suggestions, shown to the maintainers and kept in the record.
  function reasonField(p) {
    const s = (suggest.remote || []).find((x) => x.id === p.id);
    if (!s || !isMine(s) || FINAL_STATUS.has(p.status) || ["approved", "disapproved"].includes(p.status)) return null;
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

  // ---- New sections: a heading and its rules ----
  // While editing, a "+ New section" control sits at the end of each section. A new section is one suggestion:
  // its heading on the first line, then one rule a line, and the robot adds it after the section it follows
  // (scripts/edits.py). Enter moves from the heading to its first rule, and from a rule to a new one.

  let sectionCount = 0;
  const sectionHasRules = (heading) => {
    const list = heading.nextElementSibling;
    return !!list?.matches?.("ul.track-section-list") && !!list.textContent.replaceAll(ZWSP, "").trim();
  };

  // The last element of each section (and of the introduction), where a new section can follow.
  function sectionEnds() {
    const children = [...$("#doc").children].filter((el) => !el.matches(".add-here"));
    const ends = [];
    children.forEach((el, i) => {
      const next = children[i + 1];
      if (el.tagName === "H1" || el.matches("h1 + p")) return;
      if (!next || (next.tagName === "H2" && !next.matches(".track-section"))) ends.push(el);
    });
    return ends;
  }

  // The last element of the section holding `block`: a new section drawn for it goes after this.
  function sectionEndAfter(block) {
    const doc = $("#doc");
    let end = topBlock(block, doc);
    for (let next = end.nextElementSibling; next; next = end.nextElementSibling) {
      if ((next.tagName === "H2" && !next.matches(".track-section")) || next.matches(".add-here")) break;
      end = next;
    }
    return end;
  }

  function addSectionControls() {
    const doc = $("#doc");
    for (const old of $$(".add-here", doc)) old.remove();
    if (!suggest.me) return;
    for (const end of sectionEnds()) {
      end.after(h("div", { class: "add-here", contenteditable: "false" },
        h("button", { type: "button", class: "add-section", title: "Add a new section here: a heading and its rules", text: "+ New section" })));
    }
  }

  function startSection(control) {
    if (!suggest.editing || !suggest.me) return;
    rememberForUndo();
    const by = myName();
    const title = h("ins", addedBy(by), ZWSP);
    control.before(h("h2", { class: "track-new mine track-section", "data-by": by, "data-section": `new-${Date.now()}-${++sectionCount}`,
      "data-empty": "" }, title));
    caretAt(title.firstChild, 1);
    afterChange();
  }

  // Enter in a new section: from its heading to its first rule, or from a rule to a new one after it.
  function sectionEnter(block) {
    const by = myName(), id = block.dataset.section;
    const rule = () => {
      const ins = h("ins", addedBy(by), ZWSP);
      return [h("li", { class: "track-new mine track-section", "data-by": by, "data-section": id, "data-empty": "" }, ins), ins];
    };
    if (block.tagName === "H2") {
      let list = block.nextElementSibling;
      if (!list?.matches?.("ul.track-section-list")) {
        list = h("ul", { class: "track-section-list", "data-section": id });
        block.after(list);
      }
      const first = list.querySelector("li");
      if (first) {
        const ins = first.querySelector("ins") || first;
        return caretAt(ins, ins.childNodes.length);
      }
      const [li, ins] = rule();
      list.append(li);
      return caretAt(ins.firstChild, 1);
    }
    const [li, ins] = rule();
    block.after(li);
    caretAt(ins.firstChild, 1);
  }

  // ---- Several people's changes to the same words ----
  // Only one change can be drawn on any word, so the others for the same words are shown with it: a "+1" next to
  // it opens all of them. Anyone can also suggest a different change for words someone else changed; it's saved as
  // their own suggestion, marked as built on the other one, and the maintainers choose.

  function addAlsoHereBadges() {
    for (const [key, ids] of suggest.alsoHere) {
      const marks = key.startsWith("mine:") ? $$(`#doc [data-sid="${CSS.escape(key.slice(5))}"]`) : $$(`#doc [data-proposal="${CSS.escape(key)}"]`);
      const last = marks.pop();
      if (!last) continue;
      last.after(h("button", { type: "button", class: "also-here", contenteditable: "false", "data-also": ids.join(" "), "data-under": key,
        title: `${plural(ids.length, "more suggestion")} for these words. Click to see ${ids.length === 1 ? "it" : "them"}.`, text: `+${ids.length}` }));
    }
  }

  async function suggestDifferent(s, text) {
    const lines = String(text || "").split("\n").map(squash).filter(Boolean);
    const words = s.kind === "section" ? lines.join("\n") : squash(text);
    const kind = s.kind === "delete" ? (words ? "replace" : "delete") : s.kind;
    if (kind === "replace" && squash(words) === squash(s.exact)) return hint("Those are the words in the text now. To keep them as they are, add a comment instead.");
    if (kind !== "delete" && !words) return hint("Write the change you suggest first.");
    if (words === squash(s.new) && kind === s.kind) return hint("That's the same change. To support it, add a comment instead.");
    const fields = { kind, exact: s.exact ?? s.old, prefix: s.prefix ?? s.before ?? "", suffix: s.suffix ?? s.after ?? "", new: kind === "delete" ? "" : words,
      base: suggest.version, builds_on: s.id };
    try {
      if (suggest.dirty || suggest.busy) await sync();
      const docId = await suggest.backend.save(null, fields);
      const now = new Date().toISOString();
      suggest.remote = [...(suggest.remote || []), { ...fields, id: `sb-${docId}`, docId, reason: "", created: now, updated: now,
        author: { id: suggest.me.id, email: suggest.me.email } }];
      $(".spot-pop")?.remove();
      drawEverything();
      renderProposals();
      hint("Saved as your own suggestion, built on the other one. The maintainers will see both and choose.");
      suggest.watcher?.refresh();
    } catch (error) {
      hint(`It wasn't saved (${error.message}).${/builds_on/.test(error.message) ? " The database needs one more step first (run supabase/schema.sql again in Supabase's SQL Editor)." : ""}`);
    }
  }

  function differentChangeForm(s) {
    const start = s.kind === "delete" ? (s.exact ?? s.old) : s.kind === "section" ? s.new : s.new;
    const input = h("textarea", { class: "c-input", rows: s.kind === "section" ? "4" : "2", "aria-label": "Your different change" });
    input.value = start || "";
    const box = h("div", { class: "different", hidden: true },
      h("p", { class: "muted", text: s.kind === "delete" ? "Keep these words, changed as you write them here:"
        : s.kind === "section" ? "Your version of the new section: the heading on the first line, one rule a line." : "Your version of the new words:" }),
      input,
      h("p", { class: "c-actions" }, action("Suggest it", () => suggestDifferent(s, input.value), "button small"), " ",
        action("Cancel", () => { box.hidden = true; open.hidden = false; }, "button secondary small")));
    const open = h("button", { type: "button", class: "linklike", text: "Suggest a different change",
      onclick: () => { box.hidden = false; open.hidden = true; input.focus(); } });
    return [open, box];
  }

  // ---- Comments and highlights ----
  // Select words to comment on them or highlight them. Both carry your email address, everyone sees them, and they
  // never change the text. A comment can be on words, on a suggestion, or a reply; anyone signed in can resolve a
  // comment, and only its author can delete it. Each is sent from an outbox kept on this computer, so one written
  // offline is sent once the connection is back; it has its own id, so sending it twice adds it once.

  const fromCommentRow = (row) => ({ id: row.id, kind: row.kind || "comment", body: row.body || "", exact: row.exact || "",
    prefix: row.prefix || "", suffix: row.suffix || "", suggestion: row.suggestion || null, parent: row.parent || null,
    base: row.base || "", resolved: !!row.resolved, resolvedBy: row.resolved_by || "", created: row.created, updated: row.updated,
    author: { id: row.author_id, email: row.author_email || "" } });
  const COMMENT_FIELDS = ["id", "kind", "body", "exact", "prefix", "suffix", "suggestion", "parent", "base"];
  const commentRow = (row) => Object.fromEntries(COMMENT_FIELDS.map((key) => [key, row[key] ?? (key === "suggestion" || key === "parent" ? null : "")]));
  const cut = (text, n) => { const t = squash(text); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const byCreated = (a, b) => (a.created || "").localeCompare(b.created || "");

  const outboxKey = () => `els-outbox:${suggest.me?.id || "nobody"}`;
  function readOutbox() {
    try { return JSON.parse(localStorage.getItem(outboxKey())) || []; } catch { return suggest.outbox || []; }
  }
  function writeOutbox(list) {
    suggest.outbox = list;
    try { localStorage.setItem(outboxKey(), JSON.stringify(list)); } catch { /* kept in this tab only */ }
  }

  // Everyone's comments as they'll be once this computer's outbox is sent, without ignored accounts'.
  function allComments() {
    let list = [...suggest.comments];
    for (const op of suggest.outbox) {
      if (op.op === "add" && !list.some((c) => c.id === op.row.id)) list.push({ ...fromCommentRow(op.row), pending: true });
      if (op.op === "delete") list = list.filter((c) => c.id !== op.id && c.parent !== op.id);
      if (op.op === "resolve") list = list.map((c) => (c.id === op.id ? { ...c, resolved: op.done, resolvedBy: op.done ? myName() : "" } : c));
    }
    const ignored = suggest.governance?.ignored_accounts?.site || [];
    return list.filter((c) => !ignored.some((email) => sameEmail(email, c.author.email)));
  }

  async function sendOutbox() {
    if (sendOutbox.busy || !suggest.backend?.addComment || !suggest.me) return;
    sendOutbox.busy = true;
    clearTimeout(sendOutbox.timer);
    try {
      for (let op = readOutbox()[0]; op; op = readOutbox()[0]) {
        try {
          if (op.op === "add") await suggest.backend.addComment(commentRow(op.row));
          else if (op.op === "delete") await suggest.backend.deleteComment(op.id);
          else if (op.op === "resolve") await suggest.backend.resolveComment(op.id, op.done);
        } catch (error) {
          if (!error.code) throw error;  // the connection: try again later
          hint(`A comment couldn't be saved (${error.message}).`);  // the database said no: drop it
        }
        writeOutbox(readOutbox().filter((other) => other.key !== op.key));  // by its own key, in case another tab sent it too
      }
      suggest.watcher?.refresh();
    } catch {
      sendOutbox.timer = setTimeout(sendOutbox, 30000);
    } finally {
      sendOutbox.busy = false;
      afterComments();
    }
  }

  function addComment(fields) {
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), kind: "comment", body: "", exact: "", prefix: "", suffix: "", suggestion: null, parent: null,
      base: suggest.version, ...fields, author_id: suggest.me.id, author_email: suggest.me.email, created: now, updated: now };
    writeOutbox([...readOutbox(), { op: "add", row, key: crypto.randomUUID() }]);
    afterComments();
    sendOutbox();
    return row.id;
  }
  function deleteComment(c) {
    const list = readOutbox();
    if (list.some((op) => op.op === "add" && op.row.id === c.id)) writeOutbox(list.filter((op) => !(op.op === "add" && op.row.id === c.id)));
    else writeOutbox([...list, { op: "delete", id: c.id, key: crypto.randomUUID() }]);
    afterComments();
    sendOutbox();
  }
  function resolveComment(c, done) {
    writeOutbox([...readOutbox(), { op: "resolve", id: c.id, done, key: crypto.randomUUID() }]);
    afterComments();
    sendOutbox();
  }

  function afterComments() {
    if (!suggest.ready) return;
    keepingCaret(drawComments);
    renderProposals();
    refreshSpot();
  }

  // Comments and highlights on words are drawn over the text, after everything else; overlapping ones nest.
  function drawComments() {
    const doc = $("#doc");
    for (const mark of $$("mark.c-mark", doc)) mark.replaceWith(...mark.childNodes);
    doc.normalize();
    suggest.commentSpots = new Map();
    if (!suggest.commentsReady) return;
    const onWords = allComments().filter((c) => !c.parent && !c.suggestion && c.exact && !(c.kind === "comment" && c.resolved));
    for (const c of onWords.sort(byCreated)) {
      const index = sourceIndex();
      const found = locateQuote(index, c.exact, c.prefix, c.suffix);
      suggest.commentSpots.set(c.id, !!found);
      if (!found) continue;
      const [a, b] = found;
      const range = document.createRange();
      range.setStart(index.chars[a].node, index.chars[a].offset);
      range.setEnd(index.chars[b - 1].node, index.chars[b - 1].offset + 1);
      wrapRange(range, () => h("mark", { class: `c-mark c-${c.kind}${c.pending ? " c-pending" : ""}`, "data-cid": c.id,
        title: c.kind === "highlight" ? `Highlighted by ${c.author.email}` : `${c.author.email}: ${cut(c.body, 240)}` }));
    }
    renderRail();
  }

  // ---- Comments in the margin ----
  // On wide screens the open comments sit in the right margin, each beside the words (or the suggestion) it's on,
  // joined to them by a dotted line, as in a word processor. Clicking a comment, or its words, opens the whole
  // conversation there, with Reply and Resolve. On narrow screens there's no margin: hovering over commented words
  // shows the comment, and clicking them opens it in a box over the text.

  const railWide = matchMedia("(min-width: 1100px)");
  const SVG = "http://www.w3.org/2000/svg";
  let railFrame = 0;
  const relayoutRail = () => { cancelAnimationFrame(railFrame); railFrame = requestAnimationFrame(layoutRail); };

  function anchorOf(c) {
    if (c.suggestion) {
      return $(`#doc [data-proposal="${CSS.escape(c.suggestion)}"]`) || $(`#doc [data-sid="${CSS.escape(c.suggestion.replace(/^sb-/, ""))}"]`);
    }
    return $(`#doc mark[data-cid="${CSS.escape(c.id)}"]`);
  }

  function renderRail() {
    if (mode !== "drafter") return;
    let rail = $(".comment-rail");
    if (!rail) {
      rail = h("aside", { class: "comment-rail", "aria-label": "Comments" });
      $(".layout").append(rail);
      rail.addEventListener("click", (event) => {
        const card = event.target.closest(".rail-card");
        if (!card || card.classList.contains("open") || event.target.closest("button, textarea, a")) return;
        openRailCard(card.dataset.cid);
      });
      for (const [type, on] of [["mouseover", true], ["mouseout", false], ["focusin", true], ["focusout", false]]) {
        rail.addEventListener(type, (event) => { const card = event.target.closest(".rail-card"); if (card) markHot(card.dataset.cid, on); });
        $("#doc").addEventListener(type, (event) => { const mark = event.target.closest?.("mark.c-comment"); if (mark) markHot(mark.dataset.cid, on); });
      }
    }
    const typing = document.activeElement?.closest?.(".comment-rail") && document.activeElement.matches("textarea") && document.activeElement.value.trim();
    if (!typing) {
      const roots = suggest.commentsReady ? allComments().filter((c) => c.kind === "comment" && !c.parent && !c.resolved) : [];
      rail.replaceChildren(...roots.map((c) => {
        const replies = allComments().filter((x) => x.parent === c.id);
        const open = rail.dataset.open === c.id;
        return h("article", { class: `rail-card${open ? " open" : ""}${c.pending ? " c-pending" : ""}`, "data-cid": c.id, tabindex: "0",
          "aria-label": `Comment by ${c.author.email}` },
          ...(open ? [threadView(c), h("p", { class: "c-actions" }, h("button", { type: "button", class: "linklike", text: "Close",
            onclick: () => { delete rail.dataset.open; renderRail(); } }))]
            : [h("p", { class: "c-head" }, h("strong", { text: c.author.email }), ` · ${formatDate(c.created)}${c.pending ? " · not sent yet" : ""}`),
              h("p", { class: "c-body", text: c.body }),
              replies.length ? h("p", { class: "rail-replies", text: plural(replies.length, "reply", "replies") }) : null]));
      }));
    }
    relayoutRail();
  }

  function openRailCard(id) {
    const rail = $(".comment-rail");
    if (!rail) return;
    rail.dataset.open = id;  // opened, not focused: clicking commented words to edit them keeps the cursor there
    renderRail();
  }

  // Whether the margin is showing comments now (a wide screen, past the sign-in).
  const railShowing = () => mode === "drafter" && railWide.matches && !html.classList.contains("gated") && !!$(".comment-rail");

  function markHot(id, on) {
    for (const el of $$(`#doc mark[data-cid="${CSS.escape(id)}"], .rail-card[data-cid="${CSS.escape(id)}"], .comment-lines [data-cid="${CSS.escape(id)}"]`)) {
      el.classList.toggle("hot", on);
    }
  }

  // Each comment as near its words as it can be without overlapping the one above, and a dotted line from the words'
  // line, across the margin, to it.
  function layoutRail() {
    if (mode !== "drafter") return;
    const rail = $(".comment-rail");
    let lines = $(".comment-lines");
    if (!lines) {
      lines = document.createElementNS(SVG, "svg");
      lines.setAttribute("class", "comment-lines");
      lines.setAttribute("aria-hidden", "true");
      document.body.append(lines);
    }
    lines.replaceChildren();
    if (!rail || !railShowing()) return;
    const byId = new Map(allComments().map((c) => [c.id, c]));
    const railBox = rail.getBoundingClientRect(), railTop = railBox.top + scrollY;
    const placed = [];
    for (const card of rail.children) {
      const c = byId.get(card.dataset.cid);
      const rect = c && anchorOf(c)?.getClientRects()[0];
      card.hidden = !rect;
      if (rect) placed.push({ card, rect, top: rect.top + scrollY - railTop });
    }
    placed.sort((a, b) => a.top - b.top);
    let bottom = -Infinity;
    for (const p of placed) {
      p.y = Math.max(p.top - 8, bottom + 10);
      p.card.style.top = `${p.y}px`;
      bottom = p.y + p.card.offsetHeight;
    }
    rail.style.height = `${Math.max(0, bottom)}px`;
    const doc = $("#doc").getBoundingClientRect(), file = $(".file").getBoundingClientRect();
    const textRight = doc.right - parseFloat(getComputedStyle($("#doc")).paddingRight) + scrollX;
    const bend = (file.right + railBox.left) / 2 + scrollX;
    for (const p of placed) {
      const y1 = p.rect.top + scrollY + p.rect.height / 2, y2 = railTop + p.y + 16;
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", `M${textRight + 6},${y1} H${bend} L${railBox.left + scrollX},${y2}`);
      path.setAttribute("data-cid", p.card.dataset.cid);
      const dot = document.createElementNS(SVG, "circle");
      dot.setAttribute("cx", textRight + 6);
      dot.setAttribute("cy", y1);
      dot.setAttribute("r", 2.5);
      dot.setAttribute("data-cid", p.card.dataset.cid);
      if (p.card.classList.contains("hot") || p.card.classList.contains("open")) { path.classList.add("hot"); dot.classList.add("hot"); }
      lines.append(path, dot);
    }
  }
  railWide.addEventListener?.("change", () => { renderRail(); });
  addEventListener("resize", relayoutRail);
  document.fonts?.ready.then(relayoutRail);

  // The selected words as everyone sees them, with the words around them, so a comment finds its place again
  // (the same way a suggestion does), or null if they can't be told apart from words elsewhere.
  function quoteOf(range) {
    const chars = [];
    const walker = document.createTreeWalker($("#doc"), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (within(node, "ins.track.mine, .track-new, button, .track-section-others, h1 + p")) continue;
      for (let i = 0; i < node.length; i++) if (node.data[i] !== ZWSP) chars.push([node, i]);
    }
    const inside = ([node, i]) => range.comparePoint(node, i) >= 0 && range.comparePoint(node, i + 1) <= 0;
    const a = chars.findIndex(inside);
    if (a < 0) return null;
    let b = a;
    while (b < chars.length && inside(chars[b])) b += 1;
    const text = (from, to) => chars.slice(Math.max(0, from), to).map(([node, i]) => node.data[i]).join("").replace(/\s+/g, " ");
    const quote = { exact: squash(text(a, b)), prefix: text(a - 32, a), suffix: text(b, b + 32) };
    if (!quote.exact || quote.exact.length > 2000) return null;
    return locateQuote(sourceIndex(), quote.exact, quote.prefix, quote.suffix) ? quote : null;
  }

  // While editing, selecting words shows two buttons above them: Comment and Highlight.
  function showSelectionTools() {
    const sel = getSelection(), doc = $("#doc"), old = $(".sel-tools");
    const usable = suggest.ready && suggest.me && suggest.commentsReady && sel.rangeCount && !sel.isCollapsed
      && doc.contains(sel.anchorNode) && doc.contains(sel.focusNode) && !$(".comment-composer");
    const range = usable ? sel.getRangeAt(0) : null;
    const quote = range && quoteOf(range);
    if (!quote) return old?.remove();
    const box = range.getBoundingClientRect();
    const keep = { onmousedown: (event) => event.preventDefault() };  // so the words stay selected
    const tools = old || h("div", { class: "sel-tools", role: "toolbar", "aria-label": "Comment on or highlight the selected words" });
    tools.replaceChildren(
      h("button", { type: "button", ...keep, text: "Comment", onclick: () => composeComment(quote, box) }),
      h("button", { type: "button", ...keep, text: "Highlight", onclick: () => {
        tools.remove();
        addComment({ kind: "highlight", ...quote });
        hint("Highlighted, under your name. Click the highlight to remove it.");
      } }));
    if (!old) document.body.append(tools);
    const above = box.top - tools.offsetHeight - 10;
    tools.style.top = `${scrollY + (above > 70 ? above : box.bottom + 10)}px`;
    tools.style.left = `${Math.max(12, Math.min(scrollX + box.left + box.width / 2 - tools.offsetWidth / 2, scrollX + innerWidth - tools.offsetWidth - 12))}px`;
  }

  function placePop(pop, box) {
    pop.style.top = `${scrollY + box.bottom + 10}px`;
    pop.style.left = `${Math.max(12, Math.min(scrollX + box.left, scrollX + innerWidth - pop.offsetWidth - 12))}px`;
  }

  function composeComment(quote, box) {
    $(".sel-tools")?.remove();
    $(".comment-composer")?.remove();
    const input = h("textarea", { class: "c-input", rows: "3", placeholder: "Your comment", "aria-label": "Your comment" });
    const send = () => {
      const body = input.value.trim();
      if (!body) return input.focus();
      addComment({ ...quote, body });
      pop.remove();
      hint("Comment added, under your name.");
    };
    const pop = h("div", { class: "spot-pop comment-composer", role: "dialog", "aria-label": "Add a comment" },
      h("p", { class: "c-quote", text: `“${cut(quote.exact, 160)}”` }), input,
      h("p", { class: "c-actions" }, action("Comment", send, "button small"), " ", action("Cancel", () => pop.remove(), "button secondary small")));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
      if (event.key === "Escape") pop.remove();
    });
    document.body.append(pop);
    placePop(pop, box);
    input.focus();
  }

  // A comment and its replies, with Reply, Resolve, and (for its author) Delete.
  function threadView(root) {
    const replies = allComments().filter((c) => c.parent === root.id).sort(byCreated);
    const mine = (c) => !!suggest.me && c.author.id === suggest.me.id;
    const item = (c) => h("div", { class: `c-item${c.pending ? " c-pending" : ""}` },
      h("p", { class: "c-head" }, h("strong", { text: c.author.email }), ` · ${formatDate(c.created)}${c.pending ? " · not sent yet" : ""}`),
      h("p", { class: "c-body", text: c.body }),
      mine(c) ? h("p", { class: "c-actions" }, h("button", { type: "button", class: "linklike", text: c === root ? "Delete the comment" : "Delete",
        onclick: () => deleteComment(c) })) : null);
    const box = h("div", { class: `c-thread${root.resolved ? " resolved" : ""}`, "data-thread": root.id },
      root.resolved ? h("p", { class: "c-state", text: `Resolved${root.resolvedBy ? ` by ${root.resolvedBy}` : ""}` }) : null,
      item(root), ...replies.map(item));
    if (suggest.me) {
      const input = h("textarea", { class: "c-input", rows: "2", placeholder: "Reply", "aria-label": "Your reply" });
      box.append(input, h("p", { class: "c-actions" },
        action("Reply", () => { const body = input.value.trim(); if (body) addComment({ parent: root.id, body }); }, "button small"), " ",
        action(root.resolved ? "Open it again" : "Resolve", () => resolveComment(root, !root.resolved), "button secondary small")));
    }
    return box;
  }

  // What's at a spot in the text: the suggestions there (with votes for maintainers, a different change to
  // suggest, and comments on each), and the comments and highlights on those words.
  function spotCard(proposalIds, commentIds) {
    const comments = allComments();
    const card = h("div", { class: "spot-pop", role: "dialog", "aria-label": "Suggestions and comments here" },
      h("button", { type: "button", class: "pop-close", "aria-label": "Close", text: "×", onclick: () => card.remove() }));
    proposalIds.forEach((id) => {
      const s = suggest.others.find((x) => x.id === id);
      if (!s) return;
      const record = { ...s, old: s.old ?? s.exact, before: s.before ?? s.prefix, after: s.after ?? s.suffix, proposer: s.proposer || { name: s.author?.email } };
      const known = recordOf(s.id);
      const p = known && toTime(known.updated) === toTime(s.updated) ? { ...record, ...known } : { ...record, status: known?.status || "new" };
      const basis = s.builds_on && currentProposals().find((x) => x.id === s.builds_on);
      const onIt = comments.filter((c) => c.suggestion === s.id && !c.parent).sort(byCreated);
      const block = h("div", { class: "spot-suggestion" },
        h("p", { class: "pop-head" }, h("strong", { text: KIND_LABELS[s.kind] || "Change" }), ` · suggested by ${record.proposer?.name || "someone"}, ${formatDate(s.created)}`),
        basis ? h("p", { class: "muted", text: `A different change for the same words as a suggestion by ${basis.proposer?.name || "someone"}.` }) : null,
        changeView(record), s.reason ? h("p", { class: "proposal-reason", text: `“${s.reason}”` }) : null,
        checkNote(p), voteControls(p));
      if (suggest.me) {
        const [open, form] = differentChangeForm(s);
        const say = h("textarea", { class: "c-input", rows: "2", placeholder: "Comment on this suggestion", "aria-label": "Your comment on this suggestion", hidden: true });
        const send = action("Comment", () => { const body = say.value.trim(); if (body) addComment({ suggestion: s.id, body }); }, "button small");
        send.hidden = true;
        block.append(h("p", { class: "c-actions" }, open, " · ",
          h("button", { type: "button", class: "linklike", text: "Comment", onclick: (event) => { say.hidden = send.hidden = false; event.currentTarget.hidden = true; say.focus(); } })),
        form, say, send);
      }
      for (const root of onIt) block.append(threadView(root));
      card.append(block);
    });
    const here = commentIds.map((id) => comments.find((c) => c.id === id)).filter(Boolean);
    const highlights = here.filter((c) => c.kind === "highlight");
    if (highlights.length) {
      const names = [...new Set(highlights.map((c) => c.author.email))];
      const mine = highlights.filter((c) => suggest.me && c.author.id === suggest.me.id);
      card.append(h("div", { class: "c-highlights" },
        h("p", {}, h("strong", { text: "Highlighted by " }), names.join(", ")),
        mine.length ? h("p", { class: "c-actions" }, action("Remove my highlight", () => mine.forEach(deleteComment), "button secondary small")) : null));
    }
    for (const root of here.filter((c) => c.kind === "comment").sort(byCreated)) card.append(threadView(root));
    return card;
  }

  function openSpot(proposalIds, commentIds, box) {
    $(".spot-pop:not(.comment-composer)")?.remove();
    const card = spotCard(proposalIds, commentIds);
    if (card.childElementCount <= 1) return;
    openSpot.last = { proposalIds, commentIds, box };
    document.body.append(card);
    placePop(card, box);
  }
  function refreshSpot() {
    const open = $(".spot-pop:not(.comment-composer)");
    if (!open || !openSpot.last) return;
    const { proposalIds, commentIds, box } = openSpot.last;
    const focused = document.activeElement?.closest?.(".spot-pop") ? document.activeElement : null;
    if (focused?.matches("textarea") && focused.value.trim()) return;  // don't lose what someone is writing
    const card = spotCard(proposalIds, commentIds);
    card.style.top = open.style.top;
    card.style.left = open.style.left;
    open.replaceWith(card);
  }

  // A click in the text: on a new-section control, on a suggestion or a "+1", or on a comment or highlight.
  function onDocClick(event) {
    const target = event.target;
    if (target.closest?.(".spot-pop, .sel-tools")) return;
    if (!target.closest?.(".comment-composer")) $(".spot-pop:not(.comment-composer)")?.remove();
    const doc = $("#doc");
    if (!doc.contains(target)) return;
    const control = target.closest(".add-section");
    if (control) return startSection(control.parentElement);
    const ids = new Set();
    const badge = target.closest(".also-here");
    const mark = target.closest("[data-proposal]");
    if (mark) [mark.dataset.proposal, ...(suggest.alsoHere.get(mark.dataset.proposal) || [])].forEach((id) => ids.add(id));
    if (badge) {
      if (!badge.dataset.under.startsWith("mine:")) ids.add(badge.dataset.under);
      badge.dataset.also.split(" ").forEach((id) => ids.add(id));
    }
    let commentIds = [];
    for (let el = target; el && el !== doc; el = el.parentElement) if (el.matches("mark.c-mark")) commentIds.push(el.dataset.cid);
    if (railShowing()) {  // comments are in the margin: open the innermost one there; highlights still open the box
      const inMargin = commentIds.filter((id) => $(`.rail-card[data-cid="${CSS.escape(id)}"]`));
      if (inMargin.length) openRailCard(inMargin[0]);
      commentIds = commentIds.filter((id) => !inMargin.includes(id));
    }
    if (!ids.size && !commentIds.length) return;
    openSpot([...ids], commentIds, (badge || mark || target).getBoundingClientRect());
  }

  // Comments that aren't resolved, for the list below the text: each with what it's on and its newest reply.
  function commentCard(root) {
    const replies = allComments().filter((c) => c.parent === root.id);
    const on = root.suggestion ? currentProposals().find((p) => p.id === root.suggestion) : null;
    const placed = root.exact && suggest.commentSpots?.get(root.id);
    const show = () => {
      if (railShowing() && $(`.rail-card[data-cid="${CSS.escape(root.id)}"]:not([hidden])`)) {
        anchorOf(root)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return openRailCard(root.id);
      }
      const mark = root.suggestion ? $(`#doc [data-proposal="${CSS.escape(root.suggestion)}"]`) : $(`#doc mark[data-cid="${CSS.escape(root.id)}"]`);
      if (!mark) return openSpot(root.suggestion ? [root.suggestion] : [], [root.id], card.getBoundingClientRect());
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => openSpot(root.suggestion ? [root.suggestion] : [], root.suggestion ? [] : [root.id], mark.getBoundingClientRect()), 450);
    };
    const card = h("article", { class: "comment-card" },
      h("p", { class: "c-head" }, h("strong", { text: root.author.email }), ` · ${formatDate(root.created)}${root.pending ? " · not sent yet" : ""}`),
      root.exact ? h("p", { class: "c-quote", text: `On “${cut(root.exact, 110)}”${placed === false ? " (those words have changed since)" : ""}` })
        : on ? h("p", { class: "c-quote", text: `On a suggestion by ${on.proposer?.name || "someone"}` }) : null,
      h("p", { class: "c-body", text: root.body }),
      h("p", { class: "c-actions" }, `${plural(replies.length, "reply", "replies")} · `,
        h("button", { type: "button", class: "linklike", text: placed === false ? "Read and reply" : "Show it in the text", onclick: show })));
    return card;
  }

  // ---- Does a change repeat or contradict another rule? ----
  // Once you move on from a new rule, a new section, or a change to what a rule says, the page checks it against
  // the published text and everyone's open suggestions. If the lead maintainer has turned on the AI check
  // (supabase/robot.sql), an AI model reads the rule before and after your change and judges what it means;
  // otherwise the page compares words. Moving or reordering words within a rule, fixing a typo, or changing one word
  // (other than one like "never," "only," or a number) isn't checked: that rarely changes what a rule asks for. A
  // likely repeat or contradiction is shown beside the change, and you decide whether to keep it. The maintainers
  // see what the check found beside the suggestion.

  const STOPWORDS = new Set(("a about after all also an and any are as at be been before but by can could did do does each every for from " +
    "has have how i if in into is it its just may me might more most must my no not of on only or other our own same shall should so " +
    "some such than that the their them then there these this those to too very was we were what when where which while who why will " +
    "with would you your").split(" "));
  const stemOf = (word) => (word.length > 4 ? word.replace(/(?:ings?|ed|es|s|ly)$/, "") : word);
  const wordsOf = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => !STOPWORDS.has(w)).map(stemOf);
  const termsOf = (text) => wordsOf(text).filter((w) => w.length > 2);
  const NEGATED = /\b(?:never|not|no|without|avoid|cannot|don't|do not|must not|should not)\s+(?:(?:a|an|the|to|be|any)\s+)?([\p{L}\p{N}]+)/giu;
  const negatedOf = (text) => new Set([...String(text).matchAll(NEGATED)].map((m) => stemOf(m[1].toLowerCase())));
  const leadOf = (text) => new Set(termsOf(text).slice(0, 2));
  const startsNegative = (text) => /^\s*(?:never|do not|don't|no|avoid)\b/i.test(text);
  const rulesOut = (a, b) => { const no = negatedOf(b); return [...negatedOf(a)].some((term) => leadOf(b).has(term) && !no.has(term)); };
  // Words that change what a rule asks for, though comparing words leaves them out.
  const LOGIC = /\b(?:never|not|no|none|without|avoid|cannot|can't|don't|always|only|must|should|may|every|all|any|unless|except)\b/gu;
  const logicOf = (text) => new Set(String(text).toLowerCase().replaceAll("’", "'").match(LOGIC) || []);

  // Two spellings of one word, as when a typo is fixed.
  function nearlySame(a, b) {
    if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 2) return false;
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length] <= 2;
  }

  // What a change does to a rule's meaning: the words it brings in that weren't there before (typos fixed aside),
  // and whether it adds or drops a word like "never" or "only". Moving words around does neither.
  function meaningChange(before, after) {
    const was = new Set(wordsOf(before)), now = new Set(wordsOf(after));
    const removed = [...was].filter((w) => !now.has(w));
    const added = [...now].filter((w) => !was.has(w) && !removed.some((r) => nearlySame(w, r)));
    const logicBefore = logicOf(before), logicAfter = logicOf(after);
    const logic = [...logicAfter].some((w) => !logicBefore.has(w)) || [...logicBefore].some((w) => !logicAfter.has(w));
    return { added, logic, matters: logic || added.length >= 2 || added.some((w) => /\d/.test(w)) };
  }

  // A rule's words as published (nobody's changes in them), or as they read with your changes made.
  function blockText(block, withMine) {
    const box = block.cloneNode(true);
    for (const extra of $$(withMine ? "del.track.mine, ins.track:not(.mine), button" : "ins.track, button", box)) extra.remove();
    return squash(box.textContent.replaceAll(ZWSP, ""));
  }

  // The rules to compare a change with: every rule in the text except `skip` (as it reads with your changes, or as
  // published), and the new words of every open suggestion except `exceptId` (and, with your changes, except yours,
  // which are in the text already).
  function ruleCandidates({ skip = [], withMine = false, exceptId = null } = {}) {
    const doc = $("#doc"), list = [];
    for (const block of leafBlocks(doc)) {
      if (skip.includes(block) || block.matches("h1, h2, h3, h4, h5, h6, h1 + p") || frozen(block)) continue;
      const text = blockText(block, withMine);
      if (text.split(" ").length >= 4) list.push({ text, where: sectionOf(block, doc) || "the introduction" });
    }
    for (const s of suggest.remote || []) {
      if (s.id === exceptId || isIgnored(s) || !isOpen(s) || (withMine && isMine(s))) continue;
      const lines = s.kind === "section" ? String(s.new).split("\n").slice(1) : ["rule", "insert", "replace"].includes(s.kind) ? [s.new] : [];
      for (const line of lines) {
        if (squash(line).split(" ").length >= 4) list.push({ text: squash(line), where: `a suggestion by ${isMine(s) ? "you" : s.author?.email || "someone"}` });
      }
    }
    return list;
  }

  // The candidates most like `text`, by the words they share: [{ text, where, score, kind: "repeat" | "conflict" }],
  // best first. A possible contradiction is one rule ruling out what the other starts with ("without a pilot"
  // against "Pilot on 1 percent"), or a "never" or "do not" against a closely worded rule without one.
  function similarRules(text, candidates) {
    const mine = termsOf(text);
    if (mine.length < 3) return [];
    const docs = candidates.map((c) => termsOf(c.text));
    const df = new Map();
    for (const terms of [mine, ...docs]) for (const term of new Set(terms)) df.set(term, (df.get(term) || 0) + 1);
    const n = docs.length + 1;
    const vector = (terms) => {
      const v = new Map();
      for (const term of terms) v.set(term, (v.get(term) || 0) + Math.log(1 + n / df.get(term)));
      return v;
    };
    const norm = (v) => Math.sqrt([...v.values()].reduce((sum, x) => sum + x * x, 0)) || 1;
    const a = vector(mine), na = norm(a);
    const found = [];
    candidates.forEach((c, i) => {
      const b = vector(docs[i]);
      let dot = 0;
      for (const [term, x] of a) dot += x * (b.get(term) || 0);
      const score = dot / (na * norm(b));
      const opposite = rulesOut(text, c.text) || rulesOut(c.text, text) || (startsNegative(text) !== startsNegative(c.text) && score >= 0.45);
      if (opposite && score >= 0.2) found.push({ ...c, score, kind: "conflict" });
      else if (!opposite && score >= 0.55) found.push({ ...c, score, kind: "repeat" });
    });
    return found.sort((x, y) => y.score - x.score).slice(0, 3);
  }

  // The word check of one change: its new words against the other rules, and, when it changes a word like "never",
  // the rule as changed against rules it didn't seem to contradict before.
  function wordCheck({ lines = [], before = "", after = "", logic = false }, candidates) {
    const found = lines.flatMap((line) => similarRules(line, candidates));
    if (logic && after) {
      const known = new Set(similarRules(before, candidates).filter((m) => m.kind === "conflict").map((m) => m.text));
      found.push(...similarRules(after, candidates).filter((m) => m.kind === "conflict" && !known.has(m.text)));
    }
    const seen = new Set();
    return found.sort((x, y) => y.score - x.score).filter((m) => !seen.has(m.text) && seen.add(m.text)).slice(0, 3);
  }

  // What to check for one of your changes, or null if there's nothing to: a new rule, a new section with at least
  // one rule, or a rule whose meaning your changes alter (all your changes to it together, as it would read).
  function checkSubject(change) {
    const doc = $("#doc");
    const blocks = [...new Set(change.marks.map((mark) => blockOf(mark) || mark))].filter((el) => el?.isConnected && doc.contains(el));
    if (!blocks.length) return null;
    const where = sectionOf(blocks[0], doc) || "the introduction";
    if (change.kind === "rule") {
      return { signature: `rule|${change.exact}|${change.new}`, kind: "rule", blocks, where, anchor: change.exact, lines: [change.new],
        describe: `A new rule, added after the rule that ends “…${change.exact}” in the section “${where}”:\n“${change.new}”` };
    }
    if (change.kind === "section") {
      const [title, ...rules] = change.new.split("\n");
      if (!rules.length) return null;
      return { signature: `section|${change.exact}|${change.new}`, kind: "section", blocks, where, lines: rules,
        describe: `A new section, “${title}”, added after the rule that ends “…${change.exact}”, with these rules:\n${rules.map((rule) => `- ${rule}`).join("\n")}` };
    }
    const block = blocks[0];
    if (/^H\d$/.test(block.tagName)) return null;  // a heading isn't a rule
    const before = blockText(block, false), after = blockText(block, true);
    if (after.split(" ").length < 3) return null;  // the rule taken out, or nearly
    const { added, logic, matters } = meaningChange(before, after);
    if (!matters) return null;  // moved or reordered words, a fixed typo, or one word changed
    const lines = $$("ins.track.mine", block).map((ins) => squash(ins.textContent.replaceAll(ZWSP, "")))
      .filter((text) => added.length >= 3 && text.split(" ").length >= 6);
    return { signature: `edit|${before}|${after}`, kind: "edit", blocks, where, before, after, lines, logic,
      describe: `A change to a rule in the section “${where}”.\nThe rule as published: “${before}”\nThe rule after the change: “${after}”` };
  }

  // The question for the AI check: the published file, the other open suggestions, and the change.
  function checkRequest(subject, sids) {
    const others = [];
    for (const s of suggest.remote || []) {
      if (sids.has(s.docId) || isIgnored(s) || !isOpen(s)) continue;
      const at = `the words “…${squash(`${s.prefix} ${s.exact} ${s.suffix}`)}…”`;
      const by = isMine(s) ? " (by the same author)" : "";
      if (s.kind === "rule") others.push(`- A new rule after ${at}${by}: “${squash(s.new)}”`);
      else if (s.kind === "section") {
        const [title, ...rules] = String(s.new).split("\n");
        others.push(`- A new section, “${title}”, after ${at}${by}, with the rules: ${rules.map((rule) => `“${squash(rule)}”`).join(" ")}`);
      } else if (s.kind === "insert") others.push(`- Adds “${squash(s.new)}” after “${s.exact}” in ${at}${by}`);
      else if (s.kind === "replace") others.push(`- Replaces “${s.exact}” with “${squash(s.new)}” in ${at}${by}`);
      else if (s.kind === "delete") others.push(`- Removes “${s.exact}” from ${at}${by}`);
    }
    let text = "";
    for (const line of others) {
      if (text.length + line.length > 38000) break;
      text += `${line}\n`;
    }
    return { document: suggest.markdown, others: text.trim(), change: subject.describe };
  }

  // The AI check of one change, asked once: its answer, or why there isn't one, is kept by the change's signature.
  async function askAI(subject, sids) {
    const entry = { status: "asking" };
    suggest.asked.set(subject.signature, entry);
    showChecking();
    try {
      const started = await suggest.backend.startRuleCheck(checkRequest(subject, sids));
      if (!started?.id) {
        if (started?.unavailable === "off") suggest.aiOn = false;
        Object.assign(entry, { status: "unavailable", why: started?.unavailable || "" });
        return;
      }
      suggest.aiOn = true;
      for (let wait = 2000, until = Date.now() + 5 * 60000; ; wait = Math.min(wait * 1.25, 6000)) {
        if (Date.now() > until) throw new Error("no answer in time");
        await new Promise((resolve) => setTimeout(resolve, wait));
        const answer = await suggest.backend.ruleCheckResult(started.id);
        if (answer?.status === "waiting") continue;
        if (answer?.status !== "done") throw new Error(answer?.error || "no answer");
        Object.assign(entry, { status: "done", result: answer.result, model: answer.model || "" });
        await keepCheck(subject, entry);
        return;
      }
    } catch (error) {
      // A database without the AI check (supabase/robot.sql not run again yet) has no such function.
      if (/PGRST202|42883/.test(error.code || "") || /could not find the function/i.test(error.message)) suggest.aiOn = false;
      Object.assign(entry, { status: "failed", why: error.message });
    } finally {
      showChecking();
      setTimeout(checkNewRules, 0);
    }
  }

  // A short fingerprint of a text (cyrb53), to tell whether a saved check is about a change as it reads now.
  function hashOf(text) {
    let a = 0xdeadbeef, b = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 2654435761);
      b = Math.imul(b ^ c, 1597334677);
    }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
  }

  // The AI's answer, kept with the suggestions it's about, if they still say what was checked.
  async function keepCheck(subject, entry) {
    const now = suggest.lastChanges.map(checkSubject).filter(Boolean);
    if (!now.some((s) => s.signature === subject.signature)) return;
    const check = { verdict: entry.result.verdict, findings: entry.result.findings || [], model: entry.model,
      about: hashOf(subject.signature), at: new Date().toISOString() };
    for (const change of suggest.lastChanges) {
      if (checkSubject(change)?.signature !== subject.signature) continue;
      for (const mark of change.marks) {
        const id = mark.dataset.sid;
        if (id && suggest.saved.has(id)) await suggest.backend.saveCheck?.(id, check).catch(() => {});
      }
    }
    suggest.watcher?.refresh();  // so the list below the text shows it now
  }

  function showChecking() {
    const box = $("#check-status");
    if (!box) return;
    const asking = [...suggest.asked.values()].some((entry) => entry.status === "asking");
    box.hidden = !asking;
    box.textContent = asking ? "Checking your change against the other rules…" : "";
  }

  const AI_KINDS = { repeats: ["repeat", "Repeats "], contradicts: ["conflict", "Contradicts "], tension: ["conflict", "Is in tension with "],
    inconsistent: ["conflict", "Is inconsistent within itself"] };
  const modelName = (id) => (String(id).match(/^claude-([a-z]+)-(\d+)-(\d+)/) || []).slice(1).reduce((name, part, i) =>
    (i === 0 ? `Claude ${part[0].toUpperCase()}${part.slice(1)}` : `${name}${i === 1 ? " " : "."}${part}`), "") || "an AI model";

  // After your changes are saved: a change that may repeat or contradict another rule gets a warning beside it,
  // once you've moved on from it, asking whether to keep it.
  function checkNewRules() {
    if (!suggest.me || $(".rule-check")) return;
    const caret = getSelection().anchorNode;
    const subjects = new Map();  // by signature, with the changes that make it up and their saved suggestions
    for (const change of suggest.lastChanges || []) {
      const subject = checkSubject(change);
      if (!subject || suggest.checked.has(subject.signature)) continue;
      const entry = subjects.get(subject.signature) || { subject, changes: [], sids: new Set() };
      entry.changes.push(change);
      for (const mark of change.marks) if (mark.dataset.sid) entry.sids.add(mark.dataset.sid);
      subjects.set(subject.signature, entry);
    }
    for (const { subject, changes, sids } of subjects.values()) {
      if (caret && subject.blocks.some((el) => el.contains(caret))) continue;  // still writing it
      const asked = suggest.asked.get(subject.signature);
      // Checked by the AI before this page was opened (its answer is saved with the suggestion): not asked again.
      const about = hashOf(subject.signature);
      if (!asked && sids.size && [...sids].every((id) => (suggest.remote || []).find((s) => s.docId === id)?.aiCheck?.about === about)) {
        suggest.checked.add(subject.signature);
        continue;
      }
      if (!asked && suggest.aiOn !== false && suggest.backend?.startRuleCheck) { askAI(subject, sids); continue; }
      if (asked?.status === "asking") continue;
      const byAI = asked?.status === "done";
      const found = byAI
        ? (asked.result.findings || []).map((f) => ({ kind: AI_KINDS[f.kind]?.[0] || "conflict", label: AI_KINDS[f.kind]?.[1] || "", text: f.rule, where: f.where, explanation: f.explanation }))
        : wordCheck(subject, ruleCandidates({ skip: subject.blocks, withMine: true }));
      if (!found.length) {
        suggest.checked.add(subject.signature);
        if (byAI) hint(`Checked by ${modelName(asked.model)}: your change doesn't repeat or contradict another rule.`);
        continue;
      }
      showRuleCheck(subject, changes, found, byAI ? asked.model : null);
      return;
    }
  }

  function showRuleCheck(subject, changes, found, model) {
    const yours = subject.kind === "edit" ? `Your change makes the rule read: “${cut(subject.after, 200)}”`
      : `Your ${subject.kind === "section" ? "section's rules" : "rule"}: “${cut(subject.lines.join(" "), 200)}”`;
    const done = () => { suggest.checked.add(subject.signature); pop.remove(); };
    const pop = h("div", { class: "spot-pop rule-check", role: "alertdialog", "aria-label": "This change may repeat or contradict another rule" },
      h("p", { class: "rule-check-title", text: "Before you keep this" }),
      h("p", { class: "c-quote", text: yours }),
      ...found.map((m) => h("div", { class: `rule-match ${m.kind}` },
        model ? h("p", {}, h("strong", { text: m.label }), m.text ? `“${cut(m.text, 220)}”${m.where ? ` (${m.where})` : ""}` : "")
          : h("p", {}, h("strong", { text: m.kind === "repeat" ? "Looks like " : "May contradict " }), `this rule in ${m.where}: “${cut(m.text, 180)}”`),
        m.explanation ? h("p", { class: "rule-why", text: m.explanation }) : null)),
      h("p", { class: "muted", text: model ? `Checked by ${modelName(model)}, an AI model, which can be wrong. Do you still want to keep your change?`
        : "This check compares words, not meaning, so it can be wrong. Do you still want to keep your change?" }),
      h("p", { class: "c-actions" },
        action("Keep it", done, "button small"), " ",
        action(subject.kind === "edit" ? "Undo my changes to this rule" : "Remove it", () => { done(); changes.forEach(removeChange); }, "button secondary small")));
    document.body.append(pop);
    placePop(pop, subject.blocks[subject.blocks.length - 1].getBoundingClientRect());
  }

  // For the maintainers, beside a suggestion: what the AI check found when it was made, or else what the word check
  // finds now (for a change to a rule, only if it adds words, compared with the other rules).
  function checkNote(p) {
    if (FINAL_STATUS.has(p.status)) return null;
    const check = p.aiCheck;
    if (check?.verdict === "fine") {
      return h("div", { class: "similar-note fine" }, h("p", { text: `Checked by ${modelName(check.model)}: no repeat or contradiction found.` }));
    }
    if (check?.verdict === "problem" && check.findings?.length) {
      return h("div", { class: "similar-note" }, ...check.findings.slice(0, 3).map((f) => h("p", {},
        h("strong", { text: AI_KINDS[f.kind]?.[1] || "" }), f.rule ? `“${cut(f.rule, 140)}”${f.where ? ` (${f.where})` : ""}` : "",
        f.explanation ? h("span", { class: "rule-why", text: ` ${f.explanation}` }) : null)),
        h("p", { class: "muted", text: `Found by ${modelName(check.model)}, an AI model, which can be wrong.` }));
    }
    if (!["rule", "section", "insert", "replace"].includes(p.kind)) return null;
    let subject = { lines: p.kind === "section" ? String(p.new || "").split("\n").slice(1) : [p.new] }, skip = [];
    if (p.kind === "insert" || p.kind === "replace") {
      const index = sourceIndex(), found = locateQuote(index, p.old || "", p.before || "", p.after || "");
      const block = found && blockOf(index.chars[found[0]].node);
      if (!block) return null;
      const before = blockText(block, false);
      const after = p.kind === "insert" ? before.replace(p.old, `${p.old} ${p.new}`) : before.replace(p.old, p.new);
      const { added, logic, matters } = meaningChange(before, after);
      if (!matters) return null;
      subject = { lines: added.length >= 3 && squash(p.new).split(" ").length >= 6 ? [p.new] : [], before, after, logic };
      skip = [block];
    }
    const found = wordCheck(subject, ruleCandidates({ skip, exceptId: p.id }));
    if (!found.length) return null;
    return h("div", { class: "similar-note" }, ...found.slice(0, 2).map((m) => h("p", {},
      h("strong", { text: m.kind === "repeat" ? "May repeat: " : "May contradict: " }), `“${cut(m.text, 120)}” (${m.where})`)));
  }

  // Take back one of your changes: added words go, struck words come back, a new rule or section goes.
  function removeChange(change) {
    rememberForUndo();
    for (const mark of change.marks) {
      if (!mark.isConnected) continue;
      if (mark.matches(".track-new")) {
        const list = mark.matches("h2.track-section") ? mark.nextElementSibling : null;
        if (list?.matches("ul.track-section-list")) list.remove();
        mark.remove();
      } else if (mark.matches("del.track.mine")) mark.replaceWith(...mark.childNodes);
      else mark.remove();
    }
    for (const list of $$("#doc ul.track-section-list")) if (!list.children.length) list.remove();
    afterChange();
  }

  // ---- Editing offline ----
  // While the connection is down, your changes stay in the text and are kept on this computer too, then saved when
  // it's back. If the page is closed first, they're put back the next time it's opened here, and saved, as long as
  // the words they're on are still in the text. Nobody else's work is touched: each person's changes are their own
  // suggestions, so there's nothing to merge.

  const unsavedKey = () => `els-unsaved:${suggest.me?.id}`;
  function keepUnsaved() {
    if (!suggest.me) return;
    try {
      localStorage.setItem(unsavedKey(), JSON.stringify({ version: suggest.version, at: new Date().toISOString(),
        changes: collectChanges().map((change) => ({ ...pickChange(change), ...(change.builds_on ? { builds_on: change.builds_on } : {}) })) }));
    } catch { /* private browsing: nothing kept */ }
  }
  function forgetUnsaved() {
    try { localStorage.removeItem(unsavedKey()); } catch { /* nothing kept */ }
  }

  function removeMarksOf(docId) {
    for (const mark of $$(`#doc [data-sid="${CSS.escape(docId)}"]`)) {
      if (!mark.isConnected) continue;
      if (mark.matches(".track-new")) mark.remove();
      else if (mark.matches("del")) mark.replaceWith(...mark.childNodes);
      else mark.remove();
    }
    for (const list of $$("#doc ul.track-section-list")) if (!list.children.length) list.remove();
  }

  // Only additions and changes come back: a change withdrawn offline isn't withdrawn again here, so a suggestion
  // saved meanwhile from another tab or computer is never lost.
  function restoreUnsaved() {
    if (!suggest.me || suggest.remote === null) return;  // once your saved suggestions are drawn
    suggest.restoreLater = false;
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(unsavedKey())); } catch { /* nothing kept */ }
    if (!kept?.changes?.length) return;
    const known = (suggest.remote || []).filter(isMine).map(pickChange);  // saved, approved, or published already
    const sameSpot = (a, b) => ["kind", "exact", "prefix", "suffix"].every((key) => (a?.[key] || "") === (b?.[key] || ""));
    let restored = 0;
    const lost = [];
    for (const change of kept.changes) {
      if (known.some((c) => sameChange(c, change))) continue;
      // A saved suggestion changed while offline: drawn as changed, with its id, so saving updates it.
      const edited = [...suggest.saved].find(([, saved]) => sameSpot(saved, change));
      if (edited) removeMarksOf(edited[0]);
      if (drawSuggestion({ ...change, docId: edited?.[0] }, true, []) === true) restored += 1;
      else lost.push(change);
    }
    if (restored) {
      afterChange();
      hint(`Put back ${plural(restored, "change")} you made on this computer while offline. Saving ${restored === 1 ? "it" : "them"} now.`);
    } else forgetUnsaved();
    if (lost.length) {
      const list = h("div", { class: "lost-changes" },
        h("p", {}, h("strong", { text: `${plural(lost.length, "change")} you made offline no longer ${lost.length === 1 ? "fits" : "fit"} the text, ` }),
          "because the words have changed since. Make them again if you still want them:"),
        h("ul", {}, ...lost.map((c) => h("li", { text: changeSentence(c) }))),
        h("p", {}, action("Dismiss", () => list.remove(), "button secondary small")));
      $("#suggest-bar")?.append(list);
    }
  }

  // On a suggestion that builds on another: whose.
  function buildsOnNote(p) {
    const basis = currentProposals().find((x) => x.id === p.builds_on);
    return h("p", { class: "proposal-builds", text: `A different change for the same words as ${basis ? `a suggestion by ${basis.proposer?.name || "someone"}` : "another suggestion"}.` });
  }

  // ---- The list of suggestions below the text ----

  // A suggestion from the database as a proposal: the robot's record of it if that's up to date, or what's known
  // until the robot looks (within a few minutes).
  function asProposal(s, known) {
    if (known && (FINAL_STATUS.has(known.status) || toTime(known.updated) === toTime(s.updated))) {
      return { ...known, ...(s.builds_on ? { builds_on: s.builds_on } : {}), aiCheck: s.aiCheck || null };
    }
    return { id: s.id, status: "new", kind: s.kind, old: s.exact, new: s.new, before: s.prefix, after: s.suffix, reason: s.reason,
      created: s.created, updated: s.updated, proposer: { name: s.author.email, email: s.author.email }, issue: known?.issue,
      builds_on: s.builds_on || null, aiCheck: s.aiCheck || null };
  }

  function currentProposals() {
    const { records } = suggest.proposals;
    if (!suggest.remote) return [...records];
    const live = new Map(suggest.remote.filter((s) => !isIgnored(s)).map((s) => [s.id, s]));
    const list = [];
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

  const WEEK = 7 * 24 * 3600 * 1000;

  // Numbers at a glance; each links to where those suggestions are, when there are any.
  function statsRow(items) {
    return h("div", { class: "stats" }, ...items.map(({ n, label, href, kind }) => {
      const body = [h("strong", { text: String(n) }), h("span", { text: label })];
      return n && href ? h("a", { class: `stat stat-${kind}`, href }, ...body) : h("div", { class: `stat stat-${kind}` }, ...body);
    }));
  }

  // A change in a few words: Replaced “every” with “each”.
  function changeSentence(p) {
    const cut = (text, n) => { const t = squash(text); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
    return { delete: `Removed “${cut(p.old, 70)}”`, replace: `Replaced “${cut(p.old, 40)}” with “${cut(p.new, 40)}”`,
      insert: `Added “${cut(p.new, 70)}”`, rule: `Added a rule: “${cut(p.new, 70)}”`,
      section: `Added a section: “${cut(String(p.new).split("\n")[0], 70)}”` }[p.kind] || "Changed the text";
  }

  // Below the text on Suggest Edits: the suggestions waiting for a maintainer, and the publishing queue. Published
  // changes aren't listed here, only counted: they're all in History, marked in the text.
  function renderProposals() {
    const section = $("#proposals");
    if (!section) return;
    const { cfg, governance } = suggest;
    const rules = governance?.rules || {};
    const decided = pendingDecisions();
    // Redraw only when something shown has changed, so nothing a maintainer is doing is interrupted.
    const comments = suggest.commentsReady ? allComments() : [];
    const shown = JSON.stringify([suggest.version, suggest.me?.id ?? null, currentProposals(), suggest.votes, decisionsKey(decided),
      suggest.commentsReady, comments, [...suggest.commentSpots]]);
    if (shown === renderProposals.shown && section.childElementCount) return;
    renderProposals.shown = shown;
    const place = new Map([...decided].filter(([, d]) => d.kind === "adopt").map(([id], i) => [id, i + 1]));  // the robot's order
    const { open: notFinal, adopted, closed } = sortProposals(currentProposals().map((p) => {
      const d = decided.get(p.id);
      return d ? { ...p, status: d.kind === "adopt" ? "approved" : "disapproved", version: d.version || p.version, place: place.get(p.id) } : p;
    }));
    const open = notFinal.filter((p) => !decided.has(p.id));
    const rank = (p) => p.place || Number.MAX_SAFE_INTEGER;  // disapproved ones (no place) last
    const queue = notFinal.filter((p) => decided.has(p.id)).sort((a, b) => rank(a) - rank(b));
    // Published while this page is open: a line each, so a maintainer sees an approval go through.
    const justDone = adopted.filter((p) => renderProposals.queued?.has(p.id));
    renderProposals.published = [...justDone, ...(renderProposals.published || [])];
    renderProposals.queued = new Set(queue.map((p) => p.id));
    const card = (p) => proposalCard(p, cfg, rules, [reasonField(p), voteControls(p)]);
    const thisWeek = adopted.filter((p) => Date.now() - (toTime(p.decided) || 0) < WEEK).length;
    const openComments = comments.filter((c) => c.kind === "comment" && !c.parent && !c.resolved)
      .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    section.replaceChildren(
      h("h2", { text: "Suggestions" }),
      h("p", {}, "Each suggestion waits for the ", h("a", { href: at("maintainers/"), text: "maintainers" }),
        `, who approve or disapprove it. ${ruleSentence(rules)} An approved change is published as a new version within ${CHECK_EVERY} or so.`),
      statsRow([
        { n: open.length, label: "waiting for approval", href: "#waiting", kind: "waiting" },
        { n: queue.length, label: "being published now", href: "#queue", kind: "queue" },
        { n: thisWeek, label: "published in the past week", href: at("history/"), kind: "done" },
        { n: adopted.length, label: "published in all", href: at("history/"), kind: "done" },
        ...(suggest.commentsReady ? [{ n: openComments.length, label: openComments.length === 1 ? "open comment" : "open comments", href: "#comments", kind: "comment" }] : []),
      ]));
    if (!open.length) section.append(h("p", { class: "empty", text: "No suggestions are waiting right now. Edit the text above to make one." }));
    else section.append(h("h3", { id: "waiting", text: `Waiting for approval (${open.length})` }), ...open.map(card));
    if (queue.length) {
      section.append(h("div", { class: "queue", id: "queue" },
        h("h3", { text: `Publishing queue (${queue.length})` }),
        h("p", { class: "muted", text: "Decided, and waiting for the robot, which takes them in this order, usually within a minute or two. The text above already shows the approved changes, in purple; each leaves the queue once it's published, and is then in History. Disapproved ones move to the Declined page." }),
        ...queue.map(card)));
    }
    if (openComments.length) {
      section.append(h("div", { class: "comments-list", id: "comments" }, h("h3", { text: `Open comments (${openComments.length})` }),
        h("p", { class: "muted", text: "Comments never change the text. Anyone signed in can reply to one, or resolve it once it's settled; resolved comments are hidden." }),
        ...openComments.map(commentCard)));
    }
    if (renderProposals.published.length) {
      section.append(h("div", { class: "just-published", "aria-live": "polite" }, ...renderProposals.published.map((p) =>
        h("p", { class: justDone.includes(p) ? "just-done" : null },
          h("strong", { text: `Published as version ${p.version}: ` }), `${changeSentence(p)}. `,
          h("a", { href: at(`history/?v=${p.version}`), text: "See it in History" })))));
    }
    section.append(
      h("p", { class: "history-cta" }, h("a", { class: "button button-old", href: at("history/"), text: "See every published change in History" })),
      h("p", { class: "muted" }, "Suggestions that maintainers disapprove, and ones that are withdrawn or can't be applied, move to the ",
        h("a", { href: at("declined/"), text: "Declined page" }), closed.length ? ` (${closed.length} so far)` : "",
        ". Every suggestion, vote, and outcome is also recorded in ", external(LEDGER_PATH, repoFile(cfg, LEDGER_PATH)), "."));
    const count = $("#proposal-count");
    if (count) {
      count.replaceChildren(open.length
        ? h("a", { href: "#waiting" }, `${plural(open.length, "suggestion is", "suggestions are")} waiting for approval. See ${open.length === 1 ? "it" : "them"} below the text.`)
        : adopted.length || closed.length ? h("span", {}, "No suggestions are waiting right now. ", h("a", { href: at("history/"), text: "See past changes in History" }), ".")
          : h("span", { text: "No suggestions yet. Yours could be the first." }));
    }
  }

  // ---- Starting up ----

  async function setupSuggesting(cfg, governance, ledger, markdown) {
    Object.assign(suggest, { cfg, governance, markdown, version: stampedVersion(markdown) || cfg.latest,
      proposals: { records: ledger?.proposals || [] } });
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

    document.addEventListener("click", onDocClick);
    if ("ResizeObserver" in window) new ResizeObserver(relayoutRail).observe($("#main"));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { $(".spot-pop")?.remove(); $(".sel-tools")?.remove(); }
      if (event.key === "Enter" && event.target.matches?.("[data-proposal], .also-here")) onDocClick(event);
    });
    let selectionTimer = 0;
    document.addEventListener("selectionchange", () => {
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => { showSelectionTools(); checkNewRules(); }, 200);
    });
    // Offline and back: changes and comments wait on this computer, and go as soon as the connection is back.
    addEventListener("offline", () => setSaveStatus("Offline. Your changes are kept on this computer and will be saved when you're back online.", true));
    addEventListener("online", () => {
      setSaveStatus(suggest.dirty ? "Back online. Saving…" : "All changes saved");
      if (suggest.dirty) sync();
      sendOutbox();
      suggest.watcher?.refresh();
    });
    addEventListener("pagehide", () => { if (suggest.me && suggest.dirty) keepUnsaved(); });
    addEventListener("beforeunload", (event) => {
      if (suggest.me && suggest.dirty) { keepUnsaved(); sync(); event.preventDefault(); }
    });
    drawEverything();

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
      suggest.outbox = readOutbox();
      suggest.restoreLater = true;  // changes kept on this computer go back in once your saved ones are drawn
      drawEverything();
      renderProposals();
      sendOutbox();
      if (pendingDecisions().size) watchForPublication(true);
    };
    const backend = suggest.backend;
    if (backend.kind === "none") { gotUser = gotData = true; return start(); }
    suggest.watcher = backend.watch(({ suggestions, votes, comments = [], commentsReady = false }) => {
      if (suggest.remote === null && suggest.ready) {  // the first data, after a slow start: draw it all
        suggest.redraw = true;
        setSaveStatus("All changes saved");
      }
      suggest.remote = suggestions;
      suggest.comments = comments.map(fromCommentRow);
      suggest.commentsReady = commentsReady;
      const saved = (mine) => votes.some((v) => v.suggestion === mine.suggestion && v.voter_id === mine.voter_id && v.vote === mine.vote);
      suggest.pendingVotes = suggest.pendingVotes.filter((mine) => !saved(mine) && Date.now() - toTime(mine.at) < 120000);
      suggest.votes = [...votes.filter((v) => !suggest.pendingVotes.some((mine) => mine.suggestion === v.suggestion && mine.voter_id === v.voter_id)),
        ...suggest.pendingVotes];
      if (!gotData) { gotData = true; return start(); }
      refresh();
    }, (error) => {
      if (navigator.onLine) hint(`Suggestions couldn't be loaded: ${error.message}.`);
      if (!gotData) { gotData = true; start(); }
    });
    backend.onUser((user) => {
      const before = suggest.me;
      suggest.me = user;
      if (!gotUser) { gotUser = true; return start(); }
      if (!suggest.ready || (before?.id ?? null) === (user?.id ?? null)) return updateBar();
      setSaveStatus("All changes saved");
      $(".spot-pop")?.remove();
      $(".sel-tools")?.remove();
      suggest.outbox = readOutbox();
      suggest.restoreLater = true;
      drawEverything();
      renderProposals();
      sendOutbox();
      if (user) {
        scrollTo({ top: 0, behavior: "instant" });
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
      [button("Download", at(`latest/${FILE}`), { download: FILE }), copyButton(), rawToggle(), secondary("History", at("history/"))]);
    renderMarkdown(markdown);
    $("#after").replaceChildren(draftNote(), communityNote(cfg) || "", fingerprintNote(release) || "");
    setCanonical(at(`versions/v${cfg.latest}/`));
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
      [secondary("Download", at(DRAFT_PATH), { download: FILE }), copyButton(), secondary("History", at("history/"))]);
    $(".file-bar").after(h("div", { id: "suggest-slot", hidden: true }, suggestBar()));
    renderMarkdown(markdown);
    const proposals = h("section", { class: "versions proposals", id: "proposals" }, h("h2", { text: "Suggestions" }), h("p", { class: "loading", text: "Loading suggestions…" }));
    $("#after").replaceChildren(proposals, maintainersNote(governance), communityNote(cfg) || "");
    setCanonical(at("draft/"));
    await setupSuggesting(cfg, governance, ledger, markdown);
    highlightTarget(true);
    updateProgress();
  }

  async function showRevision(cfg, sha) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("That revision id doesn't look right.");
    html.classList.add("is-history");
    document.body.dataset.old = "";
    const markdown = await fetchText(`https://raw.githubusercontent.com/${cfg.repo}/${sha}/${DRAFT_PATH}`);
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "An earlier version of the text" }),
      h("p", { class: "lede" }, `This is how AGENTS.md looked after change ${sha.slice(0, 7)}. Nothing is ever lost: `,
        "to bring back words from it, suggest the change on the Suggest Edits page (strike out the current words and type the earlier ones), or ask a maintainer to restore the whole text."),
      h("p", {}, button("Back to Suggest Edits", at("draft/")), " ", secondary("History", at("history/")), " ",
        secondary("What changed in this edit", `https://github.com/${cfg.repo}/commit/${sha}`, newTab))));
    fileBar(
      [h("span", { class: "badge badge-old", text: `Change ${sha.slice(0, 7)}` }), ` ${fileStats(markdown)}`],
      [action("Copy this text", (event) => copyText(markdown, event.currentTarget)), rawToggle()]);
    renderMarkdown(markdown);
  }

  // ---------- History ----------
  // Every published version, and what changed in each: one version's text, with the changes from the version before
  // it marked where they are (labeled, old words struck out, new words underlined), and the list of versions beside
  // it. The past is shown in sepia, so it's never mistaken for the current text.

  const versionTexts = new Map();
  function versionText(version) {
    if (!versionTexts.has(version)) {
      versionTexts.set(version, fetchText(at(`versions/v${version}/${FILE}`)).catch((error) => {
        versionTexts.delete(version);
        throw error;
      }));
    }
    return versionTexts.get(version);
  }

  // A version's lines that aren't blank; each is one block of the rendered text (CLAUDE.md: one rule or paragraph per
  // line). Lines are compared without their list numbers, so a renumbered rule isn't a change, and line 3, the
  // version line, which differs in every version, never is.
  function textLines(markdown) {
    return markdown.replace(/\r/g, "").split("\n")
      .map((text, i) => ({ text, key: i === 2 ? "\0version line" : squash(text.replace(/^\s*\d+\.\s+/, "1. ")) }))
      .filter((line) => line.text.trim());
  }

  // How alike two lines are, from 0 to 1: the share of their characters in the words they have in common.
  function likeness(a, b) {
    const words = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    const x = words(a), y = words(b);
    if ([...x].filter((word) => y.has(word)).length * 3 < Math.min(x.size, y.size)) return 0;  // not worth a closer look
    const ops = diffLists(tokens(a), tokens(b));
    if (!ops) return 0;
    const same = ops.reduce((n, [op, piece]) => n + (op === "same" ? piece.replace(/\s/g, "").length : 0), 0);
    return (2 * same) / ((a.replace(/\s/g, "").length + b.replace(/\s/g, "").length) || 1);
  }

  // Which lines of the new version are lines of the old one (unchanged, or with some words changed) and which were
  // added; and which old lines were removed.
  function lineChanges(oldLines, newLines) {
    const ops = diffLists(oldLines.map((line) => line.key), newLines.map((line) => line.key));
    if (!ops) return null;
    const oldTo = oldLines.map(() => null), newFrom = newLines.map(() => null), changed = new Set();
    let i = 0, j = 0, removed = [], added = [];
    // Where lines were removed and others added, a removed line and an added one that are mostly the same words are
    // one line with some words changed. Pairs keep their order.
    const pair = () => {
      let from = 0;
      for (const d of removed) {
        let best = -1, score = 0.5;
        for (let k = from; k < added.length; k++) {
          const s = likeness(oldLines[d].text, newLines[added[k]].text);
          if (s > score) { best = k; score = s; }
        }
        if (best < 0) continue;
        oldTo[d] = added[best];
        newFrom[added[best]] = d;
        changed.add(added[best]);
        from = best + 1;
      }
      removed = [];
      added = [];
    };
    for (const [op] of ops) {
      if (op === "same") { pair(); oldTo[i] = j; newFrom[j] = i; i++; j++; }
      else if (op === "del") removed.push(i++);
      else added.push(j++);
    }
    pair();
    return { oldTo, newFrom, changed };
  }

  // One line of Markdown as the block it renders to: a paragraph, a list item (keeping its number), or a heading.
  function blockFor(line) {
    const box = h("div");
    box.innerHTML = DOMPurify.sanitize(marked.parse(line));
    const block = leafBlocks(box)[0] || h("p", { text: line });
    const number = line.match(/^\s*(\d+)\.\s/);
    if (number && block.tagName === "LI") block.value = Number(number[1]);
    return block;
  }

  // A block's characters, each as [text node, offset], leaving out old words already put back beside new ones.
  function charsOf(block) {
    const chars = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT,
      { acceptNode: (node) => (node.parentElement.closest(".h-old") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    while (walker.nextNode()) for (let k = 0; k < walker.currentNode.length; k++) chars.push([walker.currentNode, k]);
    return chars;
  }

  // Wraps a block's characters from a up to b in elements made by make(): one for each text node they're in, so bold
  // words and links keep their formatting.
  function wrapChars(block, a, b, make) {
    const chars = charsOf(block);
    let k = Math.min(b, chars.length);
    while (k > a) {
      const [node] = chars[k - 1];
      let start = k - 1;
      while (start > a && chars[start - 1][0] === node) start--;
      const from = chars[start][1], to = chars[k - 1][1] + 1;
      const piece = from > 0 ? node.splitText(from) : node;
      if (to - from < piece.length) piece.splitText(to - from);
      const wrap = make();
      piece.replaceWith(wrap);
      wrap.append(piece);
      k = start;  // the characters before this node are where they were
    }
  }

  // Puts nodes into a block just before its character at position p, or at its end.
  function insertAtChar(block, p, ...nodes) {
    const chars = charsOf(block);
    if (!chars.length) return block.append(...nodes);
    if (p >= chars.length) return chars[chars.length - 1][0].after(...nodes);
    const [node, offset] = chars[p];
    (offset > 0 ? node.splitText(offset) : node).before(...nodes);
  }

  // The words changed in a block since its old line: each old word struck out just before the new words that
  // replaced it, which are underlined. Returns whether any words changed (not just formatting).
  function markWords(block, oldLine) {
    const segments = changeSegments(blockFor(oldLine).textContent, block.textContent);
    const edits = [];
    let pos = 0;
    for (const segment of segments) {
      if (segment.same !== undefined) { pos += segment.same.length; continue; }
      edits.push({ pos, old: segment.old, new: segment.new });
      pos += segment.new.length;
    }
    for (const edit of edits.reverse()) {  // from the end, so the positions before each edit stay put
      const oldCore = edit.old.trim(), newCore = edit.new.trim();
      const lead = edit.new.length - edit.new.trimStart().length, trail = edit.new.length - edit.new.trimEnd().length;
      if (newCore) {
        if (oldCore) insertAtChar(block, edit.pos + lead, h("span", { class: "h-old" }, h("del", { text: oldCore }), " "));
        wrapChars(block, edit.pos + lead, edit.pos + edit.new.length - trail, () => h("ins"));
      } else if (oldCore) {
        const space = (text) => (/\s/.test(text) ? " " : "");
        insertAtChar(block, edit.pos, h("span", { class: "h-old" },
          space(edit.old.charAt(0)), h("del", { text: oldCore }), space(edit.old.slice(-1))));
      }
    }
    return edits.length > 0;
  }

  const topBlock = (node, article) => { while (node.parentElement !== article) node = node.parentElement; return node; };

  // Puts a removed block back where it was: just after the block it followed, in the same list if it was a rule.
  function putBack(article, block, anchor, numbered) {
    const list = numbered ? "OL" : "UL";
    if (anchor?.parentElement?.tagName === "LI") anchor = anchor.parentElement;  // a rule in a list spaced out with blank lines
    if (block.tagName !== "LI") return anchor ? topBlock(anchor, article).after(block) : article.prepend(block);
    if (anchor?.tagName === "LI" && anchor.parentElement.tagName === list) return anchor.after(block);
    const next = anchor ? topBlock(anchor, article).nextElementSibling : article.firstElementChild;
    if (next?.tagName === list) return next.prepend(block);
    const wrap = h(list.toLowerCase(), {}, block);
    return anchor ? topBlock(anchor, article).after(wrap) : article.prepend(wrap);
  }

  const CHANGE_LABELS = { changed: "Changed", formatted: "Formatting changed", added: "Added", removed: "Removed" };

  // Marks, in a version's rendered text, everything that changed since the version before it: each changed, added,
  // or removed block is labeled, and removed ones are put back where they were, struck out. Returns the marked
  // blocks in order, or null if the changes couldn't be worked out.
  function markChanges(article, oldMarkdown, newMarkdown, version) {
    const oldLines = textLines(oldMarkdown), newLines = textLines(newMarkdown);
    let blocks = leafBlocks(article);
    if (blocks.length !== newLines.length) {
      // Not one block per line: show each line as its own block, so the changes can still be marked.
      article.replaceChildren(...newLines.map((line) => blockFor(line.text)));
      markHeadings(article);
      blocks = leafBlocks(article);
    }
    const diff = lineChanges(oldLines, newLines);
    if (!diff) return null;
    // Numbered rules keep their numbers when removed ones are put back among them.
    for (const list of $$("ol", article)) {
      [...list.children].forEach((item, n) => { item.value = (Number(list.getAttribute("start")) || 1) + n; });
    }
    const wrapAll = (block, tag) => { const wrap = h(tag); wrap.append(...block.childNodes); block.append(wrap); };
    const mark = (block, kind) => {
      block.classList.add("h-mark", `h-${kind}`);
      block.prepend(h("span", { class: "h-label", text: `${CHANGE_LABELS[kind]} in version ${version}` }));
    };
    newLines.forEach((line, j) => {
      if (diff.newFrom[j] === null) { wrapAll(blocks[j], "ins"); mark(blocks[j], "added"); }
      else if (diff.changed.has(j)) mark(blocks[j], markWords(blocks[j], oldLines[diff.newFrom[j]].text) ? "changed" : "formatted");
    });
    let anchor = null;
    oldLines.forEach((line, i) => {
      if (diff.oldTo[i] !== null) { anchor = blocks[diff.oldTo[i]]; return; }
      const block = blockFor(line.text);
      wrapAll(block, "del");
      mark(block, "removed");
      putBack(article, block, anchor, /^\s*\d+\.\s/.test(line.text));
      anchor = block;
    });
    return $$(".h-mark", article);
  }

  // The section a block is in: the heading before it.
  function sectionOf(block, article) {
    if (/^H\d$/.test(block.tagName)) return "";
    for (let node = topBlock(block, article); node; node = node.previousElementSibling) {
      if (node.tagName === "H2") return plainText(node);
    }
    return "";
  }

  // What changed in a version, in a few words each, with links to the places in the text.
  function changeList(marks, older, article) {
    if (!older) return h("p", { class: "history-count", text: "The first version: there's nothing earlier to compare it with." });
    if (!marks) return h("p", { class: "history-count", text: `The changes from version ${older.version} couldn't be worked out on this page.` });
    if (!marks.length) return h("p", { class: "history-count", text: `The same words as version ${older.version}; only the version line differs.` });
    const kinds = ["changed", "formatted", "added", "removed"];
    const kindOf = (block) => kinds.find((kind) => block.classList.contains(`h-${kind}`));
    const counts = kinds.map((kind) => [kind, marks.filter((block) => kindOf(block) === kind).length]).filter(([, n]) => n);
    const words = (block) => {
      const all = plainText(block).split(" ");
      return all.length > 10 ? `${all.slice(0, 10).join(" ")}…` : all.join(" ");
    };
    const shown = marks.slice(0, 8);
    return h("div", { class: "history-changes" },
      h("p", { class: "history-count" }, `Compared with version ${older.version}: `,
        counts.map(([kind, n]) => `${n} ${CHANGE_LABELS[kind].toLowerCase()}`).join(", "), "."),
      h("ul", {}, ...shown.map((block) => {
        const section = sectionOf(block, article);
        return h("li", {}, h("span", { class: `h-key h-key-${kindOf(block)}`, text: CHANGE_LABELS[kindOf(block)] }), " ",
          h("a", { href: `#${block.id}`, text: words(block) }), section ? h("span", { class: "muted", text: ` · ${section}` }) : null);
      })),
      marks.length > shown.length ? h("p", { class: "muted", text: `And ${marks.length - shown.length} more, marked in the text below.` }) : null);
  }

  // Every edit to the text on GitHub, newest first. It's loaded only when opened: GitHub answers 60 such requests an
  // hour from one computer.
  function editLog(cfg) {
    const title = h("summary", {}, h("h2", { text: "Every edit to the file" }));
    const box = h("details", { class: "how edit-log", id: "edits" }, title, h("p", { class: "loading", text: "Loading the list from GitHub…" }));
    box.addEventListener("toggle", async () => {
      if (!box.open || box.dataset.loaded) return;
      box.dataset.loaded = "yes";
      try {
        const commits = await draftEdits(cfg, 100);
        box.replaceChildren(title,
          h("p", { class: "muted", text: `${commits.length === 100 ? "The 100 most recent edits" : plural(commits.length, "edit")} to the text, from GitHub, newest first. Open one to read the text as it was after it.` }),
          h("div", { class: "table-wrap" }, h("table", { class: "log" },
            h("thead", {}, h("tr", {}, ...["When", "Who", "What", ""].map((t) => h("th", { text: t })))),
            h("tbody", {}, ...commits.map((c) => {
              const who = c.author?.login ?? c.commit.author.name;
              return h("tr", {},
                h("td", { text: new Date(c.commit.author.date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) }),
                h("td", {}, c.author?.html_url ? external(who, c.author.html_url) : who),
                h("td", { text: c.commit.message.split("\n")[0] }),
                h("td", { class: "actions" }, h("a", { href: at(`draft/?rev=${c.sha}`), text: "Open" }), " · ", external("Changes", c.html_url)));
            })))));
      } catch (error) {
        box.replaceChildren(title, h("p", { class: "muted" }, `The list couldn't be loaded from GitHub (${error.message}). `,
          isLocal ? "That's expected in a local preview. " : "",
          "It's always on GitHub: ", external("every edit to the text", `https://github.com/${cfg.repo}/commits/${cfg.branch}/${DRAFT_PATH}`), "."));
      }
    });
    return box;
  }

  const CHANGE_KINDS = { delete: "removed", replace: "changed", insert: "added", rule: "added", section: "added" };

  // History has two views. Without ?v=, every published change, newest first and by day, each with what changed
  // marked; with ?v=0.0.9, that version's text with its changes marked in place, and the versions beside it.
  async function showHistory(cfg) {
    html.classList.add("is-history");
    const versions = cfg.versions || [];  // newest first
    if (!versions.length) {
      $("#doc").replaceChildren(h("p", { text: "Nothing has been published yet." }));
      return;
    }
    const ledger = await loadRecord(cfg, LEDGER_PATH);
    const records = ledger?.proposals || [];
    const adopted = new Map(records.filter((r) => r.status === "adopted" && r.version).map((r) => [r.version, r]));
    const requested = () => {
      const version = new URLSearchParams(location.search).get("v");
      return versions.some((r) => r.version === version) ? version : null;
    };
    // Choosing a change, a version, or the list: shown at once, unless it's to open in a new tab or window.
    const choose = (version) => (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (version) show(version, true);
      else showAll(true);
    };
    const peopleLine = (record) => {
      const approvers = (record.votes || []).filter((v) => v.vote === "approve").map((v) => v.name);
      return [`Suggested by ${record.proposer?.email || record.proposer?.name || "someone"}`,
        approvers.length ? `approved by ${approvers.join(", ")}` : null];
    };
    $("#intro").replaceChildren(h("section", { class: "intro" },
      h("h1", { text: "History" }),
      h("p", { class: "lede", text: "Every change to AGENTS.md, newest first. Choose one to read that version, with what changed marked in the text." }),
      h("p", { class: "history-key" },
        h("span", { class: "h-key h-key-changed", text: "Changed" }), " ", h("span", { class: "h-key h-key-added", text: "Added" }), " ",
        h("span", { class: "h-key h-key-removed", text: "Removed" }), " Old words are ", h("del", { text: "struck out" }),
        "; new words are ", h("ins", { text: "underlined" }), ".")));

    // Every change, newest first and by day.
    const all = h("section", { class: "history-all", id: "all-changes", "aria-label": "Every change" });
    const changeRow = (r, i) => {
      const record = adopted.get(r.version);
      const kind = CHANGE_KINDS[record?.kind];
      return h("li", {}, h("a", { class: "change-row", href: `?v=${r.version}`, onclick: choose(r.version) },
        h("span", { class: "change-row-head" },
          h("span", { class: "badge badge-old", text: `Version ${r.version}` }),
          kind ? h("span", { class: `h-key h-key-${kind}`, text: CHANGE_LABELS[kind] }) : null,
          i === 0 ? h("span", { class: "history-now", text: "current" }) : null),
        h("span", { class: "change-row-what", text: r.summary }),
        record ? changeView(record) : null,
        record ? h("span", { class: "change-row-who", text: peopleLine(record).filter(Boolean).join(" · ") }) : null));
    };
    const fillAll = (limit = 30) => {
      const when = (r) => toTime(adopted.get(r.version)?.decided) || toTime(r.date) || 0;
      const days = new Map();
      versions.slice(0, limit).forEach((r, i) => {
        const day = formatDate(r.date);
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(changeRow(r, i));
      });
      all.replaceChildren(
        statsRow([
          { n: versions.length, label: versions.length === 1 ? "version published" : "versions published", kind: "done" },
          { n: versions.filter((r) => Date.now() - when(r) < WEEK).length, label: "published in the past week", kind: "done" },
          { n: records.filter((r) => !FINAL.includes(r.status)).length, label: "waiting for approval", href: at("draft/#waiting"), kind: "waiting" },
          { n: records.filter((r) => FINAL.includes(r.status) && r.status !== "adopted").length, label: "on the Declined page", href: at("declined/"), kind: "declined" },
        ]),
        ...[...days].flatMap(([day, rows]) => [h("h3", { text: day }), h("ol", { class: "change-rows" }, ...rows)]),
        versions.length > limit
          ? h("p", { class: "history-more" }, action(`Show ${plural(versions.length - limit, "earlier version")}`, () => fillAll(Infinity)))
          : null);
    };

    // One version: the versions beside the text on wide screens, and above it, folded, on narrow ones.
    const links = new Map();
    const list = h("ol", { class: "history-list" }, ...versions.map((r, i) => {
      const record = adopted.get(r.version);
      const link = h("a", { href: `?v=${r.version}`, onclick: choose(r.version) },
        h("span", { class: "history-version" }, `Version ${r.version}`, i === 0 ? h("span", { class: "history-now", text: "current" }) : null),
        h("span", { class: "history-date", text: formatDate(r.date) }),
        h("span", { class: "history-line", text: r.summary }),
        record?.proposer ? h("span", { class: "history-who", text: `Suggested by ${record.proposer.email || record.proposer.name}` }) : null);
      links.set(r.version, link);
      return h("li", {}, link);
    }));
    const wide = matchMedia("(min-width: 1100px)");
    const panel = h("details", { class: "history-versions", open: wide.matches }, h("summary", { text: `All versions (${versions.length})` }), list);
    const aside = h("aside", { class: "history-panel", "aria-label": "Versions" }, panel);
    const summary = h("section", { class: "history-summary", id: "history-summary", "aria-live": "polite" });
    $(".file").before(all, summary);
    const place = () => {
      if (wide.matches) $(".layout").insertBefore(aside, $("#main"));
      else summary.before(aside);
      panel.open = wide.matches;
    };
    wide.addEventListener?.("change", place);
    place();
    const log = editLog(cfg);
    let current = null, hideChanges = false;  // current: the version shown, or "all"

    function showAll(chosen = false) {
      show.ticket = (show.ticket || 0) + 1;  // a version still loading isn't shown after all
      if (chosen) history.pushState(null, "", location.pathname);
      current = "all";
      html.classList.add("history-list-mode");
      if (!all.childElementCount) fillAll();
      for (const link of links.values()) link.removeAttribute("aria-current");
      $("#after").replaceChildren(log);
      document.title = `History · ${cfg.name}`;
      setCanonical("./");
      if (chosen) scrollTo({ top: 0, behavior: "instant" });
      updateProgress();
    }

    async function show(version, chosen = false) {
      const index = versions.findIndex((r) => r.version === version);
      const release = versions[index], older = versions[index + 1], newer = versions[index - 1];
      const ticket = (show.ticket = (show.ticket || 0) + 1);
      if (chosen) history.pushState(null, "", `?v=${release.version}`);
      current = release.version;
      html.classList.remove("history-list-mode");
      for (const [v, link] of links) {
        if (v === release.version) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
      let text, before;
      try {
        [text, before] = await Promise.all([versionText(release.version), older ? versionText(older.version) : null]);
      } catch (error) {
        if (ticket === show.ticket) showError(error);
        return;
      }
      if (ticket !== show.ticket) return;  // something else was chosen meanwhile

      const article = $("#doc");
      fillDoc(article, text);
      const marks = before ? markChanges(article, before, text, release.version) : [];
      marks?.forEach((block, n) => { block.id = `change-${n + 1}`; });
      article.classList.toggle("hide-changes", hideChanges);
      buildOutline(article);

      const toggle = action(hideChanges ? "Show the changes" : "Hide the changes", () => {
        hideChanges = !hideChanges;
        article.classList.toggle("hide-changes", hideChanges);
        toggle.textContent = hideChanges ? "Show the changes" : "Hide the changes";
      });
      fileBar(
        [h("span", { class: "badge badge-old", text: versionLabel(release.version) }),
          ` Published ${formatDate(release.date)}${older ? ` · changes since ${older.version} marked` : ""}`],
        [marks?.length ? toggle : null, secondary("Open this version", at(`versions/v${release.version}/`)), copyButton()]);

      const record = adopted.get(release.version);
      const step = (label, target) => h("a", { class: "button secondary small", href: `?v=${target.version}`, text: label, onclick: choose(target.version) });
      summary.replaceChildren(
        h("div", { class: "history-head" },
          h("p", { class: "history-eyebrow" }, `Version ${release.version} · ${formatDate(release.date)} `,
            h("span", { class: "badge badge-old", text: index === 0 ? "current version" : "old version" })),
          h("p", { class: "history-steps" },
            h("a", { class: "button secondary small", href: "./", text: "All changes", onclick: choose(null) }), " ",
            older ? step("← Older", older) : null, " ", newer ? step("Newer →", newer) : null)),
        h("p", { class: "history-what", text: release.summary }),
        record ? h("p", { class: "history-people" }, ...joined([
          `${peopleLine(record)[0]}${record.created ? `, ${formatDate(record.created)}` : ""}`,
          peopleLine(record)[1] ? `${peopleLine(record)[1]}${record.decided ? `, ${formatDate(record.decided)}` : ""}` : null,
          record.reason ? `“${record.reason}”` : null,
        ].filter(Boolean))) : null,
        changeList(marks, older, article));
      $("#after").replaceChildren(fingerprintNote(release) || "", log);

      document.title = `Version ${release.version} · History · ${cfg.name}`;
      setCanonical(`?v=${release.version}`);
      if (chosen) {
        if (!wide.matches) panel.open = false;
        summary.scrollIntoView({ block: "start", behavior: "instant" });
      }
      updateProgress();
    }

    addEventListener("popstate", () => {
      const next = requested() || "all";
      if (next === current) return;  // only the #change-N part changed
      if (next === "all") showAll();
      else show(next);
    });
    const first = requested();
    if (first) await show(first);
    else showAll();
    highlightTarget(true);
  }

  async function showArchive(cfg) {
    const release = cfg.versions.find((r) => r.version === pageVersion) || {};
    const markdown = await fetchText(`./${FILE}`);
    const old = pageVersion !== cfg.latest;
    const newer = old ? [" · ", h("a", { href: at(""), text: `newer version: ${cfg.latest}` })] : [" · the current version"];
    if (old) {
      html.classList.add("is-history");
      document.body.dataset.old = "";
      $("#intro").replaceChildren(h("aside", { class: "note old-note" },
        h("p", {}, h("strong", { text: `This is an old version, ${pageVersion}. ` }), `The current version is ${cfg.latest}.`),
        h("p", {}, button("Read the current version", at("")), " ", secondary("See what changed in this version", at(`history/?v=${pageVersion}`)))));
    }
    fileBar(
      [h("span", { class: old ? "badge badge-old" : "badge", text: versionLabel(pageVersion) }), ` Published ${formatDate(release.date)}`, ...newer, ` · ${fileStats(markdown)}`],
      [button("Download", `./${FILE}`, { download: FILE }), copyButton(), rawToggle(), secondary("History", at(`history/?v=${pageVersion}`))]);
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
    const { closed } = sortProposals(ledger?.proposals || []);
    list.replaceChildren(...(closed.length ? closed.map((p) => proposalCard(p, cfg, governance?.rules || {}))
      : [h("p", { class: "empty", text: "Nothing has been declined yet." })]),
      h("p", { class: "muted" }, h("a", { href: at("draft/"), text: "Back to Suggest Edits" }), "."));
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
    const views = { published: showPublished, drafter: showDrafter, history: showHistory, archive: showArchive, check: showCheck,
      join: showJoin, maintainers: showMaintainers, declined: showDeclined };
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
