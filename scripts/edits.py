"""Turn a proposal made on the rendered page into an exact edit of the Markdown source.

A proposal quotes the words someone selected on the page, as the browser shows them
(without Markdown symbols), with up to 32 characters before and after. This module
maps the rendered text back to the source, finds the one place the quote refers to,
and makes the change there:

    delete    remove the selected words (or whole rules)
    replace   put new words in place of the selected words
    insert    add words right after the selected words
    rule      add a new rule (a new line) after the one holding the selection

It refuses anything it can't do exactly, and checks every edit it makes: the
rendered text afterward must be the rendered text before, with only the selected
words changed. Matching ignores spaces and line breaks, because the page and the
source break lines differently.
"""

from __future__ import annotations

import difflib
import html
import re
import unicodedata
from bisect import bisect_right
from dataclasses import dataclass, field

KINDS = ("delete", "replace", "insert", "rule")

# Plain-English reasons a proposal can't be applied, shown to the proposer and the maintainers.
REASONS = {
    "not-found": "The selected words aren't in the current version of AGENTS.md. They may have changed since the "
                 "proposal was made, or they were selected outside the text of AGENTS.md.",
    "ambiguous": "The selected words appear more than once with the same words around them, so it isn't clear "
                 "which place to change. Make a new proposal that selects a few more words.",
    "context-changed": "The text around the selected words has changed since the proposal was made, so it isn't "
                       "certain the change still fits. Make a new proposal on the current version.",
    "version-line": "The version line is written automatically, so a proposal can't change it.",
    "code": "A proposal can't change text inside a code block. Ask a maintainer instead.",
    "formatting": "The selection starts or ends in the middle of formatted words (bold, italics, a link, or code). "
                  "Make a new proposal that selects all of the formatted words or none of them.",
    "partial-lines": "The selection runs across more than one rule or paragraph without covering them completely. "
                     "Select words within one rule, or whole rules.",
    "structure": "This change would move the title or the version line at the top of the file, which must stay "
                 "in place. Choose a different place for it.",
    "no-change": "The new words are the same as the selected words.",
    "unchecked": "The change couldn't be made exactly as proposed. A maintainer will make it by hand if it's approved.",
}


class Refused(Exception):
    """The proposal can't be applied to the current text."""

    def __init__(self, code: str):
        super().__init__(REASONS[code])
        self.code = code


@dataclass(frozen=True)
class Run:
    """Formatting around rendered text: delimiters at [open_start, content_start) and [content_end, close_end)."""
    kind: str  # strong, em, code, link, autolink, escape, entity, image
    open_start: int
    content_start: int
    content_end: int
    close_end: int


@dataclass
class Inline:
    chars: list[tuple[str, int]]  # each rendered character and its offset in the source
    runs: list[Run]


@dataclass
class Line:
    number: int
    start: int
    end: int
    kind: str  # blank, heading, bullet, ordered, paragraph, quote, code, fence, rule, stamp
    indent: str = ""
    marker: str = ""
    content_start: int = 0
    content_end: int = 0
    chars: list[tuple[str, int]] = field(default_factory=list)
    runs: list[Run] = field(default_factory=list)

    @property
    def plain(self) -> str:
        return " ".join("".join(ch for ch, _ in self.chars).split())


@dataclass
class Edit:
    source: str
    section: str
    before: list[str]  # the affected lines as rendered text, before
    after: list[str]  # and after
    context: str  # the rendered line just above the change, for showing an addition in place
    diff: str


# ---------- Inline Markdown ----------

ASCII_PUNCTUATION = frozenset("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
AUTOLINK = re.compile(r"<(?:[A-Za-z][A-Za-z0-9+.\-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~\-]+@"
                      r"[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*)>")
ENTITY = re.compile(r"&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});")


def is_punctuation(ch: str) -> bool:
    return ch in ASCII_PUNCTUATION or unicodedata.category(ch)[0] in "PS"


@dataclass
class _Delimiter:
    char: str
    left: int  # remaining delimiter characters are [left, right)
    right: int
    length: int
    can_open: bool
    can_close: bool
    active: bool = True


def _run_length(src: str, i: int, end: int, ch: str) -> int:
    n = 0
    while i + n < end and src[i + n] == ch:
        n += 1
    return n


def _find_backticks(src: str, start: int, end: int, n: int) -> int | None:
    k = start
    while k < end:
        if src[k] == "`":
            m = _run_length(src, k, end, "`")
            if m == n:
                return k
            k += m
        else:
            k += 1
    return None


def _skip_spaces(src: str, k: int, end: int) -> int:
    while k < end and src[k] in " \t":
        k += 1
    return k


def _parse_link(src: str, bracket: int, end: int) -> tuple[int, int, int] | None:
    """For an inline link starting at '[': (text start, text end, end of the link), or None."""
    depth, k, close = 0, bracket, None
    while k < end:
        ch = src[k]
        if ch == "\\":
            k += 2
            continue
        if ch == "`":
            n = _run_length(src, k, end, "`")
            j = _find_backticks(src, k + n, end, n)
            k = j + n if j is not None else k + n
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                close = k
                break
        k += 1
    if close is None or close + 1 >= end or src[close + 1] != "(":
        return None
    k = _skip_spaces(src, close + 2, end)
    if k < end and src[k] == "<":
        j = src.find(">", k + 1, end)
        if j < 0:
            return None
        k = j + 1
    else:
        parens = 0
        while k < end and not src[k].isspace():
            if src[k] == "\\":
                k += 2
                continue
            if src[k] == "(":
                parens += 1
            elif src[k] == ")":
                if parens == 0:
                    break
                parens -= 1
            k += 1
    k = _skip_spaces(src, k, end)
    if k < end and src[k] in "\"'(":
        closing = ")" if src[k] == "(" else src[k]
        j = k + 1
        while j < end and src[j] != closing:
            j += 2 if src[j] == "\\" else 1
        if j >= end:
            return None
        k = _skip_spaces(src, j + 1, end)
    if k < end and src[k] == ")":
        return bracket + 1, close, k + 1
    return None


def _process_emphasis(delimiters: list[_Delimiter], runs: list[Run]) -> None:
    """Pair * and _ delimiters into emphasis and strong emphasis, following CommonMark's rules."""
    i = 0
    while i < len(delimiters):
        closer = delimiters[i]
        if not (closer.active and closer.can_close and closer.right > closer.left):
            i += 1
            continue
        found = None
        for k in range(i - 1, -1, -1):
            opener = delimiters[k]
            if not (opener.active and opener.char == closer.char and opener.can_open and opener.right > opener.left):
                continue
            if ((opener.can_close or closer.can_open) and (opener.length + closer.length) % 3 == 0
                    and not (opener.length % 3 == 0 and closer.length % 3 == 0)):
                continue
            found = k
            break
        if found is None:
            i += 1
            continue
        opener = delimiters[found]
        use = 2 if opener.right - opener.left >= 2 and closer.right - closer.left >= 2 else 1
        opener.right -= use
        close_start = closer.left
        closer.left += use
        runs.append(Run("strong" if use == 2 else "em", opener.right, opener.right + use, close_start, close_start + use))
        for k in range(found + 1, i):
            delimiters[k].active = False
        if closer.right == closer.left:
            i += 1


def parse_inline(src: str, start: int, end: int, outer_start: int | None = None, outer_end: int | None = None) -> Inline:
    """The rendered characters of src[start:end] (each with its source offset) and the formatting around them."""
    outer_start = start if outer_start is None else outer_start
    outer_end = end if outer_end is None else outer_end
    items: list[tuple[str, int] | _Delimiter] = []
    runs: list[Run] = []
    i = start
    while i < end:
        c = src[i]
        if c == "\\" and i + 1 < end and src[i + 1] in ASCII_PUNCTUATION:
            runs.append(Run("escape", i, i + 1, i + 2, i + 2))
            items.append((src[i + 1], i + 1))
            i += 2
            continue
        if c == "`":
            n = _run_length(src, i, end, "`")
            close = _find_backticks(src, i + n, end, n)
            if close is None:
                items.extend(("`", k) for k in range(i, i + n))
                i += n
                continue
            cs, ce = i + n, close
            inner = src[cs:ce]
            if len(inner) >= 2 and inner[0] == " " and inner[-1] == " " and inner.strip(" "):
                cs, ce = cs + 1, ce - 1
            runs.append(Run("code", i, cs, ce, close + n))
            items.extend((src[k], k) for k in range(cs, ce))
            i = close + n
            continue
        if c == "<":
            m = AUTOLINK.match(src, i, end)
            if m:
                runs.append(Run("autolink", i, i + 1, m.end() - 1, m.end()))
                items.extend((src[k], k) for k in range(i + 1, m.end() - 1))
                i = m.end()
                continue
        if c == "&":
            m = ENTITY.match(src, i, end)
            if m and html.unescape(m.group()) != m.group():
                runs.append(Run("entity", i, i, m.end(), m.end()))
                items.extend((ch, i) for ch in html.unescape(m.group()))
                i = m.end()
                continue
        if c == "[" or (c == "!" and i + 1 < end and src[i + 1] == "["):
            link = _parse_link(src, i + (c == "!"), end)
            if link:
                text_start, text_end, link_end = link
                if c == "!":
                    runs.append(Run("image", i, link_end, link_end, link_end))  # an image shows no text
                else:
                    runs.append(Run("link", i, text_start, text_end, link_end))
                    inner = parse_inline(src, text_start, text_end, outer_start, outer_end)
                    items.extend(inner.chars)
                    runs.extend(inner.runs)
                i = link_end
                continue
        if c in "*_":
            n = _run_length(src, i, end, c)
            before = src[i - 1] if i > outer_start else " "
            after = src[i + n] if i + n < outer_end else " "
            space_before, space_after = before.isspace(), after.isspace()
            punct_before, punct_after = is_punctuation(before), is_punctuation(after)
            left = not space_after and (not punct_after or space_before or punct_before)
            right = not space_before and (not punct_before or space_after or punct_after)
            if c == "*":
                can_open, can_close = left, right
            else:
                can_open = left and (not right or punct_before)
                can_close = right and (not left or punct_after)
            items.append(_Delimiter(c, i, i + n, n, can_open, can_close))
            i += n
            continue
        items.append((c, i))
        i += 1
    _process_emphasis([x for x in items if isinstance(x, _Delimiter)], runs)
    chars: list[tuple[str, int]] = []
    for item in items:
        if isinstance(item, _Delimiter):
            chars.extend((item.char, k) for k in range(item.left, item.right))
        else:
            chars.append(item)
    return Inline(chars, runs)


def plain_text(markdown: str) -> str:
    """How a line of inline Markdown reads on the page."""
    return "".join(ch for ch, _ in parse_inline(markdown, 0, len(markdown)).chars)


def squeeze(text: str) -> str:
    """Text without any whitespace: the form used for matching."""
    return "".join(ch for ch in text if not ch.isspace())


# ---------- Blocks ----------

LIST_ITEM = re.compile(r"( {0,3})([-+*]|\d{1,9}[.)])( +|$)")
ORDERED_ITEM = re.compile(r"( {0,3})(\d{1,9})([.)])( +)")
HEADING = re.compile(r"( {0,3})(#{1,6})( +|$)")
FENCE = re.compile(r" {0,3}(`{3,}|~{3,})")
THEMATIC_BREAK = re.compile(r" {0,3}([-*_])(?: *\1){2,} *$")
QUOTE = re.compile(r" {0,3}> ?")
STAMP = re.compile(r"\*Version .*\*")
MARKER_TEXT = re.compile(r"^(?:[-+*]|\d{1,9}[.)])\s+")
STAMP_INDEX = 2  # the version line is line 3


class Doc:
    """A Markdown file as lines, with the rendered text mapped back to source offsets."""

    def __init__(self, source: str):
        self.source = source
        self.lines: list[Line] = []
        offset, fence = 0, None
        for number, text in enumerate(source.split("\n")):
            line = Line(number, offset, offset + len(text), "paragraph")
            offset += len(text) + 1
            fence = self._classify(line, text, fence)
            self.lines.append(line)
        self.starts = [line.start for line in self.lines]
        visible = [(ch, off) for line in self.lines for ch, off in line.chars if not ch.isspace()]
        self.squeezed = "".join(ch for ch, _ in visible)
        self.offsets = [off for _, off in visible]

    def _classify(self, line: Line, text: str, fence: tuple[str, int] | None) -> tuple[str, int] | None:
        src = self.source
        if fence:
            m = FENCE.match(text)
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= fence[1] and not text[m.end():].strip():
                line.kind = "fence"
                return None
            line.kind = "code"
            line.chars = [(src[k], k) for k in range(line.start, line.end)]
            return fence
        if not text.strip():
            line.kind = "blank"
            return None
        m = FENCE.match(text)
        if m:
            line.kind = "fence"
            return m.group(1)[0], len(m.group(1))
        if line.number == STAMP_INDEX and STAMP.fullmatch(text):
            line.kind, line.content_start, line.content_end = "stamp", line.start, line.end
        elif THEMATIC_BREAK.match(text):
            line.kind = "rule"
            return None
        elif m := HEADING.match(text):
            body = text[m.end():]
            trimmed = re.sub(r"(?:[ \t]+#+)?[ \t]*$", "", body)
            if re.fullmatch(r"#+", trimmed):
                trimmed = ""
            line.kind, line.indent, line.marker = "heading", m.group(1), m.group(2)
            line.content_start, line.content_end = line.start + m.end(), line.start + m.end() + len(trimmed)
        elif m := LIST_ITEM.match(text):
            line.kind = "bullet" if m.group(2) in "-+*" else "ordered"
            line.indent, line.marker = m.group(1), m.group(2)
            line.content_start, line.content_end = line.start + m.end(), line.start + len(text.rstrip())
        elif m := QUOTE.match(text):
            line.kind = "quote"
            line.content_start, line.content_end = line.start + m.end(), line.start + len(text.rstrip())
        else:
            line.content_start = line.start + len(text) - len(text.lstrip(" \t"))
            line.content_end = line.start + len(text.rstrip())
        inline = parse_inline(src, line.content_start, line.content_end)
        line.chars, line.runs = inline.chars, inline.runs
        return None

    def line_at(self, offset: int) -> Line:
        return self.lines[bisect_right(self.starts, offset) - 1]

    def section(self, line: Line) -> str:
        for candidate in reversed(self.lines[:line.number + 1]):
            if candidate.kind == "heading" and len(candidate.marker) >= 2:
                return candidate.plain
        return ""


# ---------- Finding the selection ----------

LONG_QUOTE = 25  # a quote this long (ignoring spaces) is trusted even if the words around it changed


def locate(doc: Doc, exact: str, prefix: str = "", suffix: str = "") -> tuple[int, int]:
    """The selection as a range [a, b) of doc.squeezed, using the words around it to choose among repeats."""
    key, before, after = squeeze(exact), squeeze(prefix), squeeze(suffix)
    if not key:
        raise Refused("not-found")
    text = doc.squeezed
    hits, i = [], text.find(key)
    while i >= 0:
        hits.append(i)
        i = text.find(key, i + 1)
    if not hits:
        raise Refused("not-found")

    def fits(i: int) -> bool:
        # Compare only as much context as the document has: a selection near the top or bottom of the
        # file has page text (outside AGENTS.md) in its context, which isn't in the source.
        seen_before, seen_after = text[:i], text[i + len(key):]
        n, m = min(len(before), len(seen_before)), min(len(after), len(seen_after))
        return (n == 0 or seen_before[-n:] == before[-n:]) and seen_after[:m] == after[:m]

    def one_side_fits(i: int) -> bool:
        seen_before, seen_after = text[:i], text[i + len(key):]
        n, m = min(len(before), len(seen_before)), min(len(after), len(seen_after))
        return (n > 0 and seen_before[-n:] == before[-n:]) or (m > 0 and seen_after[:m] == after[:m])

    good = [i for i in hits if fits(i)]
    if len(good) == 1:
        return good[0], good[0] + len(key)
    if len(good) > 1:
        raise Refused("ambiguous")
    # The words on one side changed (say, another approved change nearby): a single match is still trusted if
    # the words on its other side match, or if the quote is long.
    if len(hits) == 1 and (len(key) >= LONG_QUOTE or one_side_fits(hits[0])):
        return hits[0], hits[0] + len(key)
    raise Refused("context-changed" if len(hits) == 1 else "ambiguous")


# ---------- Making the change ----------

ATOMIC = ("escape", "entity", "image")


def _fit_to_formatting(runs: list[Run], s: int, e: int, kind: str) -> tuple[int, int]:
    """Widen [s, e) to whole formatted runs it covers; refuse a span that cuts one in half.

    A selection inside formatted words keeps the formatting (replacing a bold word gives a bold
    word), except that deleting all of a run's words removes its symbols too.
    """
    changed = True
    while changed:
        changed = False
        for run in runs:
            if e <= run.open_start or s >= run.close_end:
                continue
            if run.kind in ATOMIC:
                if s > run.open_start or e < run.close_end:
                    s, e, changed = min(s, run.open_start), max(e, run.close_end), True
                continue
            inside = run.content_start <= s and e <= run.content_end
            exact = s == run.content_start and e == run.content_end
            if inside and not (exact and kind == "delete"):
                continue
            if s <= run.content_start and e >= run.content_end:
                if s > run.open_start or e < run.close_end:
                    s, e, changed = min(s, run.open_start), max(e, run.close_end), True
                continue
            raise Refused("formatting")
    return s, e


def _insertion_point(runs: list[Run], p: int) -> int:
    """Words added after a selection go outside any formatting that ends exactly where the selection ends."""
    moved = True
    while moved:
        moved = False
        for run in runs:
            if run.content_end == p and run.close_end > p and run.kind not in ATOMIC:
                p, moved = run.close_end, True
    return p


def _clean_new(text: str, strip_marker: bool) -> str:
    text = " ".join(text.split())
    return MARKER_TEXT.sub("", text) if strip_marker else text


def _ordered_list_bounds(lines: list[str], index: int) -> tuple[int, int] | None:
    """The first and last line of the ordered list holding line `index`, allowing blank lines between items."""
    def item(k: int) -> re.Match | None:
        return ORDERED_ITEM.match(lines[k]) if 0 <= k < len(lines) else None
    anchor = next((k for k in (index, index - 1, index + 1) if item(k)), None)
    if anchor is None:
        return None
    indent = item(anchor).group(1)
    first = last = anchor
    k = anchor - 1
    while k >= 0:
        if item(k) and item(k).group(1) == indent:
            first = k
        elif lines[k].strip() or not (item(k - 1) and item(k - 1).group(1) == indent):
            break
        k -= 1
    k = anchor + 1
    while k < len(lines):
        if item(k) and item(k).group(1) == indent:
            last = k
        elif lines[k].strip() or not (item(k + 1) and item(k + 1).group(1) == indent):
            break
        k += 1
    return first, last


def _renumber(lines: list[str], index: int, start: int) -> None:
    bounds = _ordered_list_bounds(lines, index)
    if not bounds:
        return
    number = start
    for k in range(bounds[0], bounds[1] + 1):
        m = ORDERED_ITEM.match(lines[k])
        if m:
            lines[k] = f"{m.group(1)}{number}{m.group(3)}{m.group(4)}{lines[k][m.end():]}"
            number += 1


def _first_number(lines: list[str], index: int) -> int:
    """The number the ordered list holding item `index` starts from."""
    bounds = _ordered_list_bounds(lines, index)
    return int(ORDERED_ITEM.match(lines[bounds[0]]).group(2))


def _remove_lines(lines: list[str], first: int, last: int) -> int:
    """Delete lines first..last, leaving no doubled blank line behind. Returns where they were."""
    del lines[first:last + 1]
    if 0 < first < len(lines) and not lines[first - 1].strip() and not lines[first].strip():
        del lines[first]
    return first


def _tidy_deletion(text: str, s: int, e: int, content_start: int, content_end: int) -> str:
    """The line with [s, e) removed and the spaces around the gap tidied."""
    left, right = text[:s], text[e:]
    if s <= content_start:
        right = right.lstrip(" \t")
    elif e >= content_end:
        left = left.rstrip(" \t")
    elif left[-1:].isspace() and right[:1].isspace():
        right = right.lstrip(" \t")
    elif left[-1:].isspace() and right[:1] in tuple(",.;:!?)"):
        left = left.rstrip(" \t")
    elif left[-1:] == "(" and right[:1].isspace():
        right = right.lstrip(" \t")
    return left + right


def _new_rule(doc: Doc, lines: list[str], anchor: Line, text: str) -> tuple[int, list[str], int]:
    """Where a new rule goes after `anchor`: the line to insert at, the lines to insert, and which of them is the rule."""
    count = len(doc.lines)

    def next_content(k: int) -> int | None:
        while k < count and doc.lines[k].kind == "blank":
            k += 1
        return k if k < count else None

    if anchor.kind in ("bullet", "ordered"):
        column = anchor.content_start - anchor.start
        k = anchor.number + 1
        while k < count:  # skip the rule's own continuation lines and nested items
            line = doc.lines[k]
            if line.kind == "paragraph" or (line.kind in ("bullet", "ordered") and len(line.indent) >= column):
                k += 1
                continue
            break
        loose = (k + 1 < count and doc.lines[k].kind == "blank" and doc.lines[k + 1].kind == anchor.kind
                 and doc.lines[k + 1].indent == anchor.indent)
        marker = anchor.marker if anchor.kind == "bullet" else f"{int(anchor.marker[:-1]) + 1}{anchor.marker[-1]}"
        new_line = f"{anchor.indent}{marker} {text}"
        return (k, ["", new_line], 1) if loose else (k, [new_line], 0)
    if anchor.kind in ("heading", "paragraph"):
        k = next_content(anchor.number + 1)
        follows = doc.lines[k] if k is not None else None
        # A heading, or an introductory paragraph, followed by a list: the new rule is the list's first item.
        if follows and follows.kind in ("bullet", "ordered") and (
                anchor.kind == "heading" or k == anchor.number + 2):
            return k, [f"{follows.indent}{follows.marker} {text}"], 0
        insert_at = anchor.number + 1
        tail = [""] if insert_at < len(lines) and lines[insert_at].strip() else []
        return insert_at, ["", text] + tail, 1
    if anchor.kind == "quote":
        return anchor.number + 1, ["", text], 1
    raise Refused("code")


def _check_structure(original: str, updated: str) -> None:
    old, new = original.split("\n"), updated.split("\n")
    if (len(new) <= STAMP_INDEX or not new[0].startswith("# ") or new[1] != "" or new[STAMP_INDEX] != old[STAMP_INDEX]
            or original.endswith("\n") != updated.endswith("\n")):
        raise Refused("structure")
    if any(STAMP.fullmatch(line) for k, line in enumerate(new) if k != STAMP_INDEX):
        raise Refused("structure")


def _preview(old: Doc, new: Doc) -> tuple[list[str], list[str], str]:
    old_lines = [line.plain for line in old.lines if line.chars and line.kind != "stamp"]
    new_lines = [line.plain for line in new.lines if line.chars and line.kind != "stamp"]
    changes = [op for op in difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False).get_opcodes()
               if op[0] != "equal"]
    if not changes:
        return [], [], ""
    i1, j1 = changes[0][1], changes[0][3]
    i2, j2 = changes[-1][2], changes[-1][4]
    return old_lines[i1:i2], new_lines[j1:j2], old_lines[i1 - 1] if i1 > 0 else ""


def apply(source: str, kind: str, exact: str, prefix: str = "", suffix: str = "", new_text: str = "") -> Edit:
    """Make one proposed change to `source`, or raise Refused."""
    if kind not in KINDS:
        raise ValueError(f"unknown kind of change: {kind}")
    doc = Doc(source)
    a, b = locate(doc, exact, prefix, suffix)
    s, e = doc.offsets[a], doc.offsets[b - 1] + 1
    first, last = doc.line_at(s), doc.line_at(e - 1)
    touched = doc.lines[first.number:last.number + 1]
    if any(line.kind == "stamp" for line in touched):
        raise Refused("version-line")
    if any(line.kind in ("code", "fence") for line in touched):
        raise Refused("code")

    lines = source.split("\n")
    renumber: tuple[int, int] | None = None  # (a line in the edited ordered list, the number it starts from)
    expected_new = ""

    if kind in ("delete", "replace"):
        ordered = next((line for line in touched if line.kind == "ordered"), None)
        list_start = _first_number(lines, ordered.number) if ordered else None
        if first is last:
            s, e = _fit_to_formatting(first.runs, s, e, kind)
            text, base = lines[first.number], first.start
            if kind == "delete":
                updated = _tidy_deletion(text, s - base, e - base, first.content_start - base, first.content_end - base)
                if updated[first.content_start - base:].strip():
                    lines[first.number] = updated
                else:
                    at = _remove_lines(lines, first.number, first.number)
                    renumber = (at, list_start) if ordered else None
            else:
                expected_new = _clean_new(new_text, strip_marker=s <= first.content_start)
                if not expected_new:
                    raise Refused("unchecked")
                if squeeze(plain_text(expected_new)) == doc.squeezed[a:b]:
                    raise Refused("no-change")
                lines[first.number] = text[:s - base] + expected_new + text[e - base:]
        else:
            if (any(off < s and not ch.isspace() for ch, off in first.chars)
                    or any(off >= e and not ch.isspace() for ch, off in last.chars)):
                raise Refused("partial-lines")
            if kind == "delete":
                at = _remove_lines(lines, first.number, last.number)
            else:
                expected_new = _clean_new(new_text, strip_marker=True)
                if not expected_new:
                    raise Refused("unchecked")
                lines[first.number:last.number + 1] = [source[first.start:first.content_start] + expected_new]
                at = first.number
            renumber = (at, list_start) if ordered else None
        expected = doc.squeezed[:a] + squeeze(plain_text(expected_new)) + doc.squeezed[b:]

    elif kind == "insert":
        expected_new = _clean_new(new_text, strip_marker=False)
        if not expected_new:
            raise Refused("unchecked")
        p = _insertion_point(last.runs, e)
        text, base = lines[last.number], last.start
        left, right = text[:p - base], text[p - base:]
        lead = "" if (not left or left[-1].isspace() or expected_new[0] in ",.;:!?)") else " "
        trail = " " if right and (right[0].isalnum() or right[0] in "([\"'“‘") else ""
        lines[last.number] = left + lead + expected_new + trail + right
        expected = doc.squeezed[:b] + squeeze(plain_text(expected_new)) + doc.squeezed[b:]

    else:  # rule
        expected_new = _clean_new(new_text, strip_marker=True)
        if not expected_new:
            raise Refused("unchecked")
        insert_at, new_lines, which = _new_rule(doc, lines, last, expected_new)
        if ORDERED_ITEM.match(new_lines[which]):
            neighbor = insert_at if insert_at < len(doc.lines) and doc.lines[insert_at].kind == "ordered" else last.number
            renumber = (insert_at + which, _first_number(lines, neighbor))
        lines[insert_at:insert_at] = new_lines
        cut_at = doc.lines[insert_at].start if insert_at < len(doc.lines) else len(source)
        cut = sum(1 for off in doc.offsets if off < cut_at)
        expected = doc.squeezed[:cut] + squeeze(plain_text(expected_new)) + doc.squeezed[cut:]

    if renumber:
        _renumber(lines, *renumber)
    updated = "\n".join(lines)
    _check_structure(source, updated)
    new_doc = Doc(updated)
    if new_doc.squeezed != expected:
        raise Refused("unchecked")
    before, after, context = _preview(doc, new_doc)
    diff = "\n".join(difflib.unified_diff(source.split("\n"), lines, "AGENTS.md (before)", "AGENTS.md (after)",
                                          n=0, lineterm=""))
    return Edit(updated, doc.section(first), before, after, context, diff)
