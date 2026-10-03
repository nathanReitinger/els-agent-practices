/* How a comment on Suggest Edits becomes a proposal, and how a reply becomes a vote.
   The robot that counts votes (scripts/commands.py) uses the same rules; keep the two identical.
   scripts/tests/commands.json checks both. Works in the browser (window.ELSCommands) and in Node. */
(function (root) {
  "use strict";

  const DELETE = /^(?:delete|strike(?: out)?|cross out|remove|cut)(?: (?:this|it|that|these words|this rule|this sentence|this line|this part))?[.!]?$/i;
  const PATTERNS = {
    replace: /^(?:replace(?: (?:this|it|that|these words))?(?: with)?|change(?: (?:this|it|that))? to|reword(?: (?:this|it|that))?(?: as)?|rewrite(?: (?:this|it|that))?(?: as)?)$/i,
    insert: /^(?:add|insert)(?: (?:this|these words))? after(?: (?:this|it|that|these words))?$/i,
    rule: /^(?:(?:add|insert) (?:a )?(?:new )?|new )(?:rule|bullet|item|point|line|paragraph)(?: (?:after|below)(?: (?:this|it|that|this one))?)?$/i,
  };
  const DECORATION = /[*_`~>#"“”'‘’]/g;
  const DASH = /^(.*?)\s+[—–-]+\s+(.*)$/;
  const LEADING_EMPHASIS = /^(?:\*\*|__|\*|_)\s*/;
  const REASON_LABEL = /^(?:why|reason|because)\s*:\s*/i;
  const MENTION_TAG = /<\/?a\b[^>]*>/gi;
  const HTML_TAG = /<(?!https?:\/\/)[A-Za-z!/?][^>]*>/;
  const VOTE = /^[^A-Za-z0-9]*(approve|approved|approves|reject|rejected|rejects)\b/i;
  const QUOTES = ['""', "“”", "''", "‘’"];
  const MAX_NEW = 1500;
  const MAX_REASON = 1000;

  const PROBLEMS = {
    "missing-new": "Write the new words after the colon, for example “Replace with: the new words.”",
    html: "The new words can't contain HTML tags.",
    "too-long": "The new words are too long. Propose a shorter change, or split it into several proposals.",
  };

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  function decode(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    });
  }

  // Comment text without the links Hypothesis writes for @mentions, and without carriage returns.
  const clean = (text) => decode(String(text || "").replace(MENTION_TAG, "")).replace(/\r/g, "");
  const squash = (text) => text.split(/\s+/).filter(Boolean).join(" ");

  function unquote(text, exact) {
    const quoted = exact.trim() && "\"“'‘".includes(exact.trim()[0]);
    if (text.length >= 2 && QUOTES.includes(text[0] + text[text.length - 1]) && !quoted) return text.slice(1, -1).trim();
    return text;
  }

  // {kind, new, reason, problems} for a proposal, or null for an ordinary comment.
  function parseCommand(text, exact = "") {
    const lines = clean(text).split("\n").map((line) => line.trim());
    while (lines.length && !lines[0]) lines.shift();
    if (!lines.length) return null;
    const first = lines[0];
    const at = first.indexOf(":");
    const colon = at >= 0;
    let head = colon ? first.slice(0, at) : first;
    let tail = colon ? first.slice(at + 1) : "";
    const dash = colon ? null : first.match(DASH);
    if (dash && DELETE.test(squash(dash[1].replace(DECORATION, "")))) [head, tail] = [dash[1], dash[2]];
    head = squash(head.replace(DECORATION, ""));
    tail = tail.trim();
    let rest = lines.slice(1);
    let kind, value, reasonLines;
    if (DELETE.test(head) && !(tail && [".", "!"].includes(head.slice(-1)))) {
      kind = "delete";
      value = "";
      reasonLines = (tail ? [tail] : []).concat(rest);
    } else {
      kind = colon ? Object.keys(PATTERNS).find((k) => PATTERNS[k].test(head)) : undefined;
      if (!kind) return null;
      value = tail.replace(LEADING_EMPHASIS, "").trim();
      if (!value) {
        while (rest.length && !rest[0]) rest.shift();
        if (rest.length) { value = rest[0]; rest = rest.slice(1); }
      }
      value = unquote(squash(value), exact);
      reasonLines = rest;
    }
    let reason = squash(reasonLines.join(" ")).replace(REASON_LABEL, "");
    if (reason.length > MAX_REASON) reason = reason.slice(0, MAX_REASON - 1).trimEnd() + "…";
    const problems = [];
    if (kind !== "delete" && !value) problems.push("missing-new");
    if (HTML_TAG.test(value)) problems.push("html");
    if (value.length > MAX_NEW) problems.push("too-long");
    return { kind, new: value, reason, problems };
  }

  // "approve" or "reject" if the reply starts with that word, otherwise null.
  function voteOf(text) {
    const match = clean(text).trim().match(VOTE);
    if (!match) return null;
    return match[1].toLowerCase().startsWith("approv") ? "approve" : "reject";
  }

  const api = { parseCommand, voteOf, clean, PROBLEMS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ELSCommands = api;
})(typeof self !== "undefined" ? self : this);
