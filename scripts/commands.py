"""How a comment in the Drafter becomes a proposal, and how a reply becomes a vote.

A proposal is a comment on selected words whose first line is a command:

    Delete                       strike out the selected words
    Replace with: new words      put new words in their place
    Add after: new words         add words right after them
    Add rule: a new rule         add a new rule below the one they're in

Anything else is an ordinary comment. Later lines are the reason, optionally
starting with "Why:". A vote is a reply whose first word is Approve or Reject.

assets/commands.js does the same in the browser, for the Drafter's preview.
Keep the two identical: scripts/tests/commands.json checks both.
"""

from __future__ import annotations

import html
import re

KINDS = ("delete", "replace", "insert", "rule")

_DELETE = re.compile(r"(?:delete|strike(?: out)?|cross out|remove|cut)"
                     r"(?: (?:this|it|that|these words|this rule|this sentence|this line|this part))?[.!]?", re.I)
_PATTERNS = {
    "replace": re.compile(r"(?:replace(?: (?:this|it|that|these words))?(?: with)?|change(?: (?:this|it|that))? to"
                          r"|reword(?: (?:this|it|that))?(?: as)?|rewrite(?: (?:this|it|that))?(?: as)?)", re.I),
    "insert": re.compile(r"(?:add|insert)(?: (?:this|these words))? after(?: (?:this|it|that|these words))?", re.I),
    "rule": re.compile(r"(?:(?:add|insert) (?:a )?(?:new )?|new )(?:rule|bullet|item|point|line|paragraph)"
                       r"(?: (?:after|below)(?: (?:this|it|that|this one))?)?", re.I),
}
_DECORATION = re.compile(r"[*_`~>#\"“”'‘’]")
_DASH = re.compile(r"^(.*?)\s+[—–-]+\s+(.*)$")
_LEADING_EMPHASIS = re.compile(r"^(?:\*\*|__|\*|_)\s*")
_REASON_LABEL = re.compile(r"^(?:why|reason|because)\s*:\s*", re.I)
_MENTION_TAG = re.compile(r"</?a\b[^>]*>", re.I)
_HTML_TAG = re.compile(r"<(?!https?://)[A-Za-z!/?][^>]*>")
_VOTE = re.compile(r"^[^A-Za-z0-9]*(approve|approved|approves|reject|rejected|rejects)\b", re.I)
_QUOTES = ('""', "“”", "''", "‘’")

MAX_NEW = 1500
MAX_REASON = 1000

PROBLEMS = {
    "missing-new": "Write the new words after the colon, for example “Replace with: the new words.”",
    "html": "The new words can't contain HTML tags.",
    "too-long": "The new words are too long. Propose a shorter change, or split it into several proposals.",
}


def clean(text: str) -> str:
    """Comment text without the links Hypothesis writes for @mentions, and without carriage returns."""
    return html.unescape(_MENTION_TAG.sub("", text or "")).replace("\r", "")


def _squash(text: str) -> str:
    return " ".join(text.split())


def _unquote(text: str, exact: str) -> str:
    if len(text) >= 2 and text[0] + text[-1] in _QUOTES and not (exact.strip()[:1] in "\"“'‘" and exact.strip()):
        return text[1:-1].strip()
    return text


def parse_command(text: str, exact: str = "") -> dict | None:
    """{kind, new, reason, problems} for a proposal, or None for an ordinary comment."""
    lines = [line.strip() for line in clean(text).split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    if not lines:
        return None
    head, colon, tail = lines[0].partition(":")
    dash = None if colon else _DASH.match(lines[0])
    if dash and _DELETE.fullmatch(_squash(_DECORATION.sub("", dash.group(1)))):
        head, tail = dash.group(1), dash.group(2)  # "Delete - it repeats rule 3"
    head = _squash(_DECORATION.sub("", head))
    tail = tail.strip()
    rest = lines[1:]
    if _DELETE.fullmatch(head) and not (tail and head[-1:] in (".", "!")):
        kind, new = "delete", ""
        reason_lines = ([tail] if tail else []) + rest
    else:
        kind = next((k for k, pattern in _PATTERNS.items() if colon and pattern.fullmatch(head)), None)
        if kind is None:
            return None
        new = _LEADING_EMPHASIS.sub("", tail).strip()
        if not new:
            while rest and not rest[0]:
                rest.pop(0)
            if rest:
                new, rest = rest[0], rest[1:]
        new = _unquote(_squash(new), exact)
        reason_lines = rest
    reason = _REASON_LABEL.sub("", _squash(" ".join(reason_lines)))
    if len(reason) > MAX_REASON:
        reason = reason[:MAX_REASON - 1].rstrip() + "…"
    problems = []
    if kind != "delete" and not new:
        problems.append("missing-new")
    if _HTML_TAG.search(new):
        problems.append("html")
    if len(new) > MAX_NEW:
        problems.append("too-long")
    return {"kind": kind, "new": new, "reason": reason, "problems": problems}


def vote_of(text: str) -> str | None:
    """'approve' or 'reject' if the reply starts with that word, otherwise None."""
    match = _VOTE.match(clean(text).strip())
    if not match:
        return None
    return "approve" if match.group(1).lower().startswith("approv") else "reject"
