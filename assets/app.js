/* AGENTS.md for Empirical Legal Scholars: shows one Markdown file, AGENTS.md, rendered for reading;
   the Drafter, where anyone can propose a change and members vote on it; and a page that checks
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
  const MEMBERS_PATH = "governance/members.json";
  const HYPOTHESIS_SEARCH = "https://api.hypothes.is/api/search";
  const CHECK_EVERY = "15 minutes";
  const FINAL = ["adopted", "declined", "withdrawn", "cannot-apply"];
  const KIND_LABELS = { delete: "Delete", replace: "Replace", insert: "Add words", rule: "Add a rule" };
  const COMMAND = "tr -d '\\r' < AGENTS.md | sed 3d | shasum -a 256";
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
  // A version's fingerprint is the SHA-256 hash of its file without line 3, the version line
  // (which states the fingerprint). Carriage returns are removed first, so line endings don't matter.
  // scripts/fingerprint.py computes the same thing.

  function canonicalLines(text) {
    const lines = String(text).replace(/^﻿/, "").replace(/\r/g, "").split("\n");
    if (lines.length < 3) return null;
    lines.splice(2, 1);
    return lines;
  }

  async function fingerprintOf(text) {
    const lines = canonicalLines(text);
    if (!lines) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lines.join("\n")));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function fingerprintLine(sha256, label = "SHA-256 fingerprint") {
    if (!sha256) return null;
    return h("div", { class: "fingerprint" }, h("span", { class: "muted", text: `${label} ` }),
      h("code", { text: sha256 }), " ", action("Copy", (event) => copyText(sha256, event.currentTarget), "copy-inline"));
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

  // The robot's files (the members, and every proposal and vote) are read from GitHub too, for the same reason.
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
      ? "One member's approval adopts a proposal, unless at least as many members reject it."
      : `A proposal is adopted once ${n} members approve it, as long as more members approve than reject it.`;
    if (rules.hours_open_before_adoption) text += ` It stays open for at least ${rules.hours_open_before_adoption} hours first.`;
    if (rules.members_may_approve_their_own_proposals === false) text += " Members can't approve their own proposals.";
    return text;
  }

  // ---------- Proposals ----------

  function proposalStatus(p, rules = {}) {
    const need = rules.approvals_needed ?? 1;
    const approvals = (p.votes || []).filter((v) => v.vote === "approve").length;
    return {
      new: ["New", `Received. New proposals are checked every ${CHECK_EVERY}.`],
      open: ["Open for votes", `${approvals} of ${plural(need, "member approval")} so far`],
      "needs-fix": ["Needs a fix", p.note],
      adopted: ["Adopted", `In version ${p.version}${p.decided ? `, ${formatDate(p.decided)}` : ""}`],
      declined: ["Declined", p.decided ? formatDate(p.decided) : ""],
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
    if (names("reject")) parts.push(h("span", {}, h("strong", { text: "Rejected by " }), names("reject")));
    if (p.support) parts.push(h("span", { text: `${plural(p.support, "reader")} in favor` }));
    if (p.stale_votes) parts.push(h("span", { text: `${plural(p.stale_votes, "member")} voted before the proposal was last edited and must vote again` }));
    return parts.length ? h("p", { class: "votes" }, ...joined(parts)) : null;
  }

  function proposalCard(p, cfg, rules, replies) {
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
        external(open ? (count ? `Vote or discuss (${plural(count, "reply", "replies")})` : "Vote or discuss") :
          (count ? `Read the discussion (${plural(count, "reply", "replies")})` : "Read the proposal"), p.link),
        p.issue ? external(`GitHub issue #${p.issue}`, `https://github.com/${cfg.repo}/issues/${p.issue}`) : null,
      ].filter(Boolean))));
  }

  async function showProposals(cfg, governance, ledger, section) {
    const rules = governance?.rules || {};
    const records = ledger?.proposals || [];
    const rows = await liveComments(cfg);
    const replies = new Map();
    for (const row of rows) if (row.references) replies.set(row.references[0], (replies.get(row.references[0]) || 0) + 1);
    const fresh = newProposals(rows, new Set(records.map((r) => r.id)), governance);
    const newest = (a, b) => (b.created || "").localeCompare(a.created || "");
    const open = [...fresh, ...records.filter((r) => !FINAL.includes(r.status))].sort(newest);
    const decided = records.filter((r) => FINAL.includes(r.status))
      .sort((a, b) => (b.decided || b.created || "").localeCompare(a.decided || a.created || ""));

    section.replaceChildren(
      h("h2", { text: "Proposals" }),
      h("p", { text: `${ruleSentence(rules)} The robot that counts votes runs every ${CHECK_EVERY}; a vote on a proposal's GitHub issue is counted within a minute or two.` }));
    if (!open.length) section.append(h("p", { class: "empty" }, "No proposals are open right now. ", h("a", { href: "#propose", text: "Make one" }), "."));
    else section.append(h("h3", { text: `Open (${open.length})` }), ...open.map((p) => proposalCard(p, cfg, rules, replies)));
    if (decided.length) {
      const shown = decided.slice(0, 8), rest = decided.slice(8);
      section.append(h("h3", { text: `Decided (${decided.length})` }), ...shown.map((p) => proposalCard(p, cfg, rules, replies)));
      if (rest.length) section.append(h("details", { class: "more" }, h("summary", { text: `Show ${plural(rest.length, "earlier decision")}` }),
        ...rest.map((p) => proposalCard(p, cfg, rules, replies))));
    }
    section.append(h("p", { class: "muted" }, "Every proposal, vote, and outcome is recorded in ",
      external(LEDGER_PATH, repoFile(cfg, LEDGER_PATH)), " and kept in the history."));

    const count = $("#proposal-count");
    if (count) {
      count.replaceChildren(open.length
        ? h("a", { href: "#proposals" }, `${plural(open.length, "proposal is", "proposals are")} open for votes. See ${open.length === 1 ? "it" : "them"} below the text.`)
        : decided.length ? h("a", { href: "#proposals", text: "No proposals are open right now. See past decisions below the text." })
          : h("span", { text: "No proposals yet. Yours could be the first." }));
    }
  }

  function membersView(cfg, governance) {
    const members = governance?.members || [];
    const how = (m) => [m.hypothesis && `${m.hypothesis} on Hypothesis`, m.github && `${m.github} on GitHub`].filter(Boolean).join(" or ");
    return h("section", { class: "versions", id: "members" },
      h("h2", { text: "Members" }),
      h("p", { text: `Members vote on proposals: they reply Approve or Reject to a proposal in the comments, or comment /approve or /reject on its GitHub issue. ${ruleSentence(governance?.rules)} Only a member's latest vote counts.` }),
      h("ul", { class: "member-list" }, ...members.map((m) => h("li", {},
        h("strong", { text: m.name }),
        m.role === "maintainer" ? h("span", { class: "badge badge-soft", text: "maintainer" }) : null,
        h("span", { class: "muted", text: ` · votes as ${how(m)}${m.since ? ` · since ${formatDate(m.since)}` : ""}` })))),
      h("p", { class: "muted" }, "Maintainers add members and set the rules in ", external(MEMBERS_PATH, repoFile(cfg, MEMBERS_PATH)),
        ", and every change to that list is public. To become a member, ask a maintainer", cfg.community ? [" (for example, in the ",
          h("a", { href: at("join/"), text: "community's Google group" }), ")"] : "", ". The whole process is described in ",
        external("GOVERNANCE.md", repoFile(cfg, "GOVERNANCE.md")), "."));
  }

  // ---------- Pages ----------

  function draftNote() {
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Nothing here is final. " }),
        "This is a comment draft. Anyone can propose a change in the ", h("a", { href: at("draft/"), text: "Drafter" }),
        ". Members vote, and each approved change is published as a new version, with its own number and fingerprint."),
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
    if (!release?.sha256) return null;
    return h("aside", { class: "note" },
      h("p", {}, h("strong", { text: "Is a copy exactly this version? " }),
        `Every version has a fingerprint: a SHA-256 hash of its file without the version line. Change one character and the fingerprint changes. Version ${release.version}'s is:`),
      fingerprintLine(release.sha256, ""),
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
    return h("section", { class: "commands", id: "propose", "aria-labelledby": "propose-title" },
      h("h2", { id: "propose-title", text: "How to write a proposal" }),
      h("p", {}, "Select the words you want to change in the text below, choose ", h("em", { text: "Annotate" }),
        ", and start your note with one of these:"),
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
      h("p", { class: "lede", text: "Anyone can propose a change to AGENTS.md here. Members vote on each proposal, and every approved change is published right away as a new version." }),
      h("ol", { class: "steps" },
        h("li", {}, h("strong", { text: "Propose. " }), "Select words in the text, choose ", h("em", { text: "Annotate" }),
          ", and write one of the commands below. It uses ", external("Hypothesis", "https://web.hypothes.is/start"),
          ", which asks for a free account. You don't need GitHub."),
        h("li", {}, h("strong", { text: "Members vote. " }), "A member replies ", h("em", { text: "Approve" }), " or ",
          h("em", { text: "Reject" }), " to your proposal. ", ruleSentence(governance?.rules)),
        h("li", {}, h("strong", { text: "It's published. " }), `Within about ${CHECK_EVERY} of approval, the change is made and published as a new version with its own number and fingerprint. Every proposal, vote, and version is kept, so nothing is ever lost.`)),
      commandGuide(),
      h("p", { class: "proposal-count", id: "proposal-count" }));
  }

  async function showDrafter(cfg) {
    if (rev) return showRevision(cfg, rev);
    const [governance, ledger, { markdown, commit }] = await Promise.all([
      loadRecord(cfg, MEMBERS_PATH), loadRecord(cfg, LEDGER_PATH), loadDraft(cfg)]);
    $("#intro").replaceChildren(drafterIntro(governance));
    const version = stampedVersion(markdown) || cfg.latest;
    const changed = commit
      ? ` Last changed ${formatDate(commit.commit.author.date)} by ${commit.author?.login ?? commit.commit.author.name} · ` : " ";
    fileBar(
      [h("span", { class: "badge", text: versionLabel(version) }), `${changed}${fileStats(markdown)}`],
      [button("Propose a change", "#propose"), secondary("Download", at(DRAFT_PATH), { download: FILE }), copyButton(), rawToggle()]);
    renderMarkdown(markdown);
    const proposals = h("section", { class: "versions proposals", id: "proposals" }, h("h2", { text: "Proposals" }), h("p", { class: "loading", text: "Loading proposals…" }));
    $("#after").replaceChildren(proposals, membersView(cfg, governance), communityNote(cfg) || "");
    setCanonical(at("draft/"));
    loadHypothesis();
    await Promise.all([showProposals(cfg, governance, ledger, proposals), showEveryVersion(cfg)]);
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
        fingerprintLine(r.sha256),
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
    const asFingerprint = trimmed.toLowerCase().replace(/^sha256:/, "");
    if (/^[0-9a-f]{64}$/.test(asFingerprint)) {
      const found = cfg.versions.filter((r) => r.sha256 === asFingerprint);
      return found.length
        ? checkResult("good", `That's the fingerprint of version ${found.map((r) => r.version).join(" and ")}.`,
          h("p", {}, h("a", { href: at(`versions/v${found[0].version}/`), text: `Read version ${found[0].version}` }), ` (published ${formatDate(found[0].date)}).`))
        : checkResult("bad", "That fingerprint doesn't belong to any published version.");
    }
    if (!trimmed) return checkResult("bad", "There's nothing to check yet. Choose a file, or paste its text.");
    const text = pasted && !raw.endsWith("\n") ? `${raw}\n` : raw; // pasting usually drops the final line break
    const sha = await fingerprintOf(text);
    if (!sha) return checkResult("bad", "This isn't AGENTS.md: it's shorter than three lines, so it has no version line.");
    const stamp = text.replace(/\r/g, "").split("\n")[2] || "";
    const claimed = stamp.match(/^\*Version (\S+)/)?.[1];
    const stated = stamp.match(/fingerprint[^:]*:\s*([0-9a-f]{64})/i)?.[1];
    const matches = cfg.versions.filter((r) => r.sha256 === sha);
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
        h("p", { text: "A fingerprint is a SHA-256 hash: a 64-character code computed from the text. If even one character changes, the fingerprint changes, and no one can write a different text with the same fingerprint." }),
        h("p", { text: "Each version's fingerprint covers its whole file except line 3, the version line, because that line states the fingerprint. Line endings (Windows or Mac) don't matter. The fingerprint is recorded when the version is published: in the version line of the file itself, in the change log, and in the list below." }),
        h("p", { text: "To compute it yourself on a Mac or Linux, open a terminal in the folder with the file and run:" }),
        command,
        h("p", { class: "muted" }, "On Windows, use this page. The robot that publishes versions computes it the same way (",
          external("scripts/fingerprint.py", repoFile(cfg, "scripts/fingerprint.py")), ").")),
      h("section", { class: "versions", id: "fingerprints" },
        h("h2", { text: "Every version's fingerprint" }),
        h("div", { class: "table-wrap" }, h("table", { class: "log fingerprints" },
          h("thead", {}, h("tr", {}, ...["Version", "Published", "SHA-256 fingerprint"].map((t) => h("th", { text: t })))),
          h("tbody", {}, ...cfg.versions.map((r) => h("tr", {},
            h("td", {}, h("a", { href: at(`versions/v${r.version}/`), text: r.version })),
            h("td", { text: formatDate(r.date) }),
            h("td", {}, h("code", { text: r.sha256 || "" }))))))),
        h("p", { class: "muted", text: "Versions 0.0.0 to 0.0.2 were published before fingerprints existed; theirs were computed afterward from the frozen files, which have never changed." })));
    addCopyButtons($("#after"));
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
          h("a", { href: at("draft/"), text: "Drafter" }), ", where members vote on it."))));
  }

  function showFooter(cfg) {
    $("#footer")?.replaceChildren(
      h("p", {}, h("span", { class: "brand-file", text: "AGENTS.md" }), " ", h("em", { text: "for Empirical Legal Scholars" })),
      h("p", {}, ...joined([
        external("Source on GitHub", `https://github.com/${cfg.repo}`),
        external("Changelog", repoFile(cfg, "CHANGELOG.md")),
        external("How decisions are made", repoFile(cfg, "GOVERNANCE.md")),
        cfg.community ? h("a", { href: at("join/"), text: "Join the group" }) : null,
        h("a", { href: at("check/"), text: "Check a copy" }),
        h("a", { href: at("llms.txt"), text: "llms.txt" }),
      ].filter(Boolean))));
  }

  async function main() {
    setupReaderControls();
    const views = { published: showPublished, drafter: showDrafter, archive: showArchive, check: showCheck, join: showJoin };
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
