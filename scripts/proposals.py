#!/usr/bin/env python3
"""The proposals robot: counts maintainers' votes on proposed changes and publishes the approved ones.

    python3 scripts/proposals.py --dry-run   # say what would happen, and change nothing
    python3 scripts/proposals.py             # make the changes and commit them in this copy
    python3 scripts/proposals.py --push      # ...then push them and update GitHub issues

.github/workflows/proposals.yml runs it with --push: Supabase starts it after every vote
and every ten minutes (supabase/robot.sql), GitHub's schedule is a backup, and it runs
right away when someone comments on a suggestion's GitHub issue or a maintainer changes
the text. Each run:

1. Checks that every published version still matches its recorded fingerprint.
2. Publishes a maintainer's direct edit to draft/AGENTS.md as a new version.
3. Reads the suggestions and votes made on the Suggest Edits page, from the site's
   Supabase database (supabase/README.md), with the public key in versions.json.
   Each suggestion is a proposal; each vote is approve or reject.
4. Checks each open suggestion against the current text (scripts/edits.py) and counts
   the votes of the maintainers in governance/maintainers.json. Maintainers can also vote by
   commenting /approve or /reject on the suggestion's GitHub issue.
5. Applies each approved suggestion and publishes it as the next version
   (scripts/release.py), one version per suggestion, each with its own commit and tag.
6. Records every suggestion, vote, and outcome in governance/proposals.json, opens a
   GitHub issue for each new suggestion (so people watching the repository get an
   email), and closes it with the outcome.
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import edits  # noqa: E402
import release  # noqa: E402
from fingerprint import fingerprint, stamp_line, verify_published  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DRAFT = ROOT / "draft" / "AGENTS.md"
LATEST = ROOT / "latest" / "AGENTS.md"
MANIFEST = ROOT / "versions.json"
MAINTAINERS = ROOT / "governance" / "maintainers.json"
LEDGER = ROOT / "governance" / "proposals.json"
WRITTEN = ["draft/AGENTS.md", "latest", "versions", "versions.json", "CHANGELOG.md", "governance/proposals.json"]

BOT_NAME = "github-actions[bot]"
BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"
# The robot's identity for every commit and tag it makes, so it never depends on git's settings where it runs.
BOT_IDENTITY = {"GIT_COMMITTER_NAME": BOT_NAME, "GIT_COMMITTER_EMAIL": BOT_EMAIL,
                "GIT_AUTHOR_NAME": BOT_NAME, "GIT_AUTHOR_EMAIL": BOT_EMAIL}
FINAL = ("adopted", "declined", "withdrawn", "cannot-apply")
NEW_ISSUES_PER_RUN = 10
# A suggestion on Suggest Edits is saved while it's typed, so its GitHub issue waits until it has been left alone
# this long. (Votes on it count right away.)
SETTLE_MINUTES = 10
SITE = "Suggest Edits"
WORKFLOW = "proposals.yml"
# GitHub switches off a public repository's scheduled workflows after 60 days without activity, so after this many
# days without a commit the robot makes an empty one.
HEARTBEAT_DAYS = 30
# Supabase starts the robot every ten minutes (supabase/robot.sql); this long without a start means something's wrong.
WAKE_STALE_HOURS = 6
# Waits between tries when the database doesn't answer (a brief outage is common).
RETRY_SECONDS = tuple(float(s) for s in os.environ.get("ROBOT_RETRY_SECONDS", "5,20").split(",") if s.strip())
# Problems the robot reports as GitHub issues (which email the lead maintainer), and closes once they're fixed.
ALERTS = {
    "database": "The Suggest Edits database isn't answering",
    "wake": "Supabase isn't starting the robot",
}
LEDGER_ABOUT = ("Every suggestion made on the Suggest Edits page, its votes, and its outcome. "
                "Written by scripts/proposals.py; don't edit it by hand.")
# Why a suggestion can't be voted on yet.
PROBLEMS = {"missing-new": "Type the new words: this change replaces or adds words, but none were given."}
_VOTE = re.compile(r"^[^A-Za-z0-9]*(approve|approved|approves|reject|rejected|rejects)\b", re.I)


class PushRejected(Exception):
    pass


# ---------- Small helpers ----------

def parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def short(text: str, limit: int = 60) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def md(text: str) -> str:
    """User text made safe to show in GitHub Markdown: no formatting, no HTML, no @mentions."""
    text = " ".join((text or "").split()).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"([\\`*_\[\]|~#])", r"\\\1", text)
    return text.replace("@", "@⁠")


def md_keep_spaces(text: str) -> str:
    """Like md(), but keeps the spaces at either end, for showing a piece of a line."""
    core = text.strip()
    if not core:
        return text
    start, end = text.index(core[0]), len(text.rstrip())
    return text[:start] + md(core) + text[end:]


# Words, spaces, and punctuation marks, so a change to "control (git)," shows only " (git)" struck out.
TOKENS = re.compile(r"\s+|[\w'’-]+|[^\s\w]")


def vote_of(text: str) -> str | None:
    """'approve' or 'reject' if a comment on a suggestion's GitHub issue starts with that word (/approve, Approve,
    /reject...), otherwise None."""
    match = _VOTE.match(html.unescape(text or "").replace("\r", "").strip())
    if not match:
        return None
    return "approve" if match.group(1).lower().startswith("approv") else "reject"


def get_json(url: str, headers: dict | None = None):
    request = urllib.request.Request(url, headers={"User-Agent": "els-agent-practices-proposals", **(headers or {})})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def git(*args: str, env: dict | None = None) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True,
                            env={**os.environ, **(env or {})})
    if result.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def commit(message: str, author: str | None = None) -> None:
    git("add", "-A", "--", *[path for path in WRITTEN if (ROOT / path).exists()])
    git("commit", "--quiet", "-m", message, *(["--author", author] if author else []), env=BOT_IDENTITY)


# ---------- Maintainers and rules ----------

@dataclass(frozen=True)
class Maintainer:
    name: str
    role: str
    email: str
    github: str


class Governance:
    def __init__(self, data: dict):
        try:
            rules = data["rules"]
            self.approvals_needed = int(rules["approvals_needed"])
            self.self_approval = bool(rules["maintainers_may_approve_their_own_proposals"])
            self.hours_open = float(rules.get("hours_open_before_adoption", 0))
            self.maintainers = [Maintainer(m["name"], m.get("role", "maintainer"), m.get("email") or "",
                                           m.get("github") or "") for m in data["maintainers"]]
            ignored = data.get("ignored_accounts", {})
            self.ignored_site = {u.lower() for u in ignored.get("site", [])}
            self.ignored_github = {u.lower() for u in ignored.get("github", [])}
        except (KeyError, TypeError, ValueError) as error:
            raise SystemExit(f"governance/maintainers.json isn't in the expected form ({error!r}); see GOVERNANCE.md")
        if self.approvals_needed < 1 or not self.maintainers:
            raise SystemExit("governance/maintainers.json needs at least one maintainer and approvals_needed of at least 1")
        if any(not (m.email or m.github) for m in self.maintainers):
            raise SystemExit("every maintainer in governance/maintainers.json needs an email address or a GitHub username")

    def by_github(self, login: str) -> Maintainer | None:
        return next((m for m in self.maintainers if m.github and m.github.lower() == (login or "").lower()), None)

    def by_email(self, email: str) -> Maintainer | None:
        return next((m for m in self.maintainers if m.email and m.email.lower() == (email or "").lower()), None)

    def rule_sentence(self) -> str:
        n = self.approvals_needed
        text = ("One maintainer's approval adopts a proposal, unless at least as many maintainers disapprove it." if n == 1
                else f"A proposal is adopted once {n} maintainers approve it, as long as more approve than disapprove it.")
        if self.hours_open:
            text += f" It stays open for at least {self.hours_open:g} hours first."
        return text


# ---------- Votes ----------

@dataclass
class Vote:
    maintainer: Maintainer
    vote: str
    when: dt.datetime
    via: str
    link: str
    step: str = "patch"  # for an approval: which number of the version goes up (release.STEPS)

    def record(self) -> dict:
        return {"name": self.maintainer.name, "vote": self.vote, "when": self.when.isoformat(), "via": self.via,
                "link": self.link, **({"step": self.step} if self.step != "patch" else {})}


def step_of(votes: list[Vote]) -> str:
    """The version step for an adopted proposal: the biggest any approving maintainer chose (the last number, unless
    one chose the middle or first)."""
    steps = [v.step for v in votes if v.vote == "approve"] or ["patch"]
    return max(steps, key=release.STEPS.index)


def is_proposer(maintainer: Maintainer, proposer: dict) -> bool:
    email = (proposer.get("email") or "").lower()
    return bool(email) and maintainer.email.lower() == email


def count_votes(record: dict, comments: list[dict], gov: Governance,
                site_votes: list[dict] = ()) -> tuple[list[Vote], int, int]:
    """Each maintainer's latest vote cast since the suggestion was last edited; others in favor; votes made stale by an edit.

    Votes come from the Suggest Edits page (rows of the database's votes table) and from comments on the suggestion's
    GitHub issue."""
    since = parse_time(record["updated"])
    latest: dict[str, Vote] = {}
    stale: set[str] = set()
    support: set[str] = set()

    def consider(maintainer: Maintainer | None, vote: str, when: dt.datetime, via: str, link: str, voter: str,
                 step: str = "patch") -> None:
        if maintainer is None:
            if vote == "approve":
                support.add(voter)
            return
        if when < since:
            stale.add(maintainer.name)
            return
        if vote == "approve" and not gov.self_approval and is_proposer(maintainer, record["proposer"]):
            return
        if maintainer.name not in latest or when > latest[maintainer.name].when:
            latest[maintainer.name] = Vote(maintainer, vote, when, via, link, step)

    for comment in comments:
        login = (comment.get("user") or {}).get("login", "")
        if (comment.get("user") or {}).get("type") == "Bot" or login.lower() in gov.ignored_github:
            continue
        vote = vote_of(comment.get("body", ""))
        if vote:
            consider(gov.by_github(login), vote, parse_time(comment.get("updated_at") or comment["created_at"]),
                     "GitHub", comment.get("html_url", ""), f"github:{login}")
    for row in site_votes:
        email = row.get("voter_email") or ""
        if row.get("vote") in ("approve", "reject") and email.lower() not in gov.ignored_site:
            step = row.get("version_step") if row.get("version_step") in release.STEPS else "patch"
            consider(gov.by_email(email), row["vote"], parse_time(row["at"]), SITE, "", f"site:{email.lower()}", step)
    votes = sorted(latest.values(), key=lambda v: v.when)
    return votes, len(support), len(stale - set(latest))


def decide(record: dict, votes: list[Vote], gov: Governance, now: dt.datetime) -> str:
    approvals = sum(v.vote == "approve" for v in votes)
    rejections = sum(v.vote == "reject" for v in votes)
    if approvals >= gov.approvals_needed and approvals > rejections:
        waited = (now - parse_time(record["updated"])).total_seconds() / 3600
        return "adopt" if waited >= gov.hours_open else "wait"
    if rejections >= gov.approvals_needed and rejections > approvals:
        return "decline"
    return "wait"


# ---------- Suggest Edits (Supabase) ----------

def site_headers(key: str) -> dict:
    """Supabase takes a project key in the apikey header. A legacy "anon" key is a JWT, and goes in both."""
    headers = {"apikey": key, "Accept": "application/json"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def fetch_site(url: str, key: str) -> dict[str, list[dict]]:
    """Every suggestion and vote made on Suggest Edits. Anyone may read them (supabase/schema.sql), so the public key
    in versions.json is all this needs."""
    def table(name: str, order: str) -> list[dict]:
        rows: list[dict] = []
        while True:  # the database sends at most 1,000 rows at a time
            query = urllib.parse.urlencode({"select": "*", "order": order, "limit": 1000, "offset": len(rows)})
            batch = get_json(f"{url.rstrip('/')}/rest/v1/{name}?{query}", site_headers(key))
            rows.extend(batch)
            if len(batch) < 1000:
                return rows
    return {"suggestions": table("suggestions", "created.asc,id.asc"), "votes": table("votes", "at.asc")}


def site_proposer(email: str) -> dict:
    return {"name": email, "email": email}


def proposer_parts(who: dict) -> tuple[str, str]:
    """Who suggested it, and where, in Markdown: ("jane@example.org", "Suggest Edits")."""
    return md(who.get("email") or who["name"]), SITE


def proposer_line(who: dict) -> str:
    name, via = proposer_parts(who)
    return f"{name} ({via})"


def alert_body(kind: str, detail: str, repo: str, leads: list[str]) -> str:
    """The issue that reports a problem the robot can't fix itself. It mentions the lead maintainers, so GitHub
    emails them."""
    hello = " ".join(f"@{name}" for name in leads)
    owner = repo.split("/")[0]
    if kind == "database":
        lines = [
            f"{hello} The robot couldn't read the suggestions and votes on Suggest Edits from the Supabase database, "
            f"after trying three times. The error: `{md(detail)}`",
            "",
            "Until it can, new suggestions and votes wait. Nothing is lost.",
            "",
            "What to check:",
            "",
            "1. Open the project in the [Supabase dashboard](https://supabase.com/dashboard/projects). If it says the project "
            "is paused, choose **Restore**. (Supabase pauses a free project after a week without use; the robot's reads "
            "normally prevent that.)",
            "2. If the project is running, check [Supabase's status page](https://status.supabase.com).",
        ]
    else:
        token = (f"https://github.com/settings/personal-access-tokens/new?name=Start+the+ELS+robot"
                 f"&description=Lets+Supabase+start+the+proposals+robot+%28supabase%2Frobot.sql%29"
                 f"&target_name={owner}&expires_in=none&actions=write")
        lines = [
            f"{hello} Supabase hasn't started the robot for more than {WAKE_STALE_HOURS} hours. {md(detail)} "
            "The robot still runs on GitHub's own schedule, but GitHub runs those late, or skips them when it's busy, "
            "so approved changes can take hours to be published.",
            "",
            "Most likely the GitHub token stored in Supabase was deleted or expired. To replace it:",
            "",
            f"1. [Create a new token]({token}). Under **Repository access**, choose **Only select repositories** and pick "
            f"**{repo.split('/')[1]}**. The one permission it needs (Actions: read and write) is already filled in, and it "
            "doesn't expire. Choose **Generate token**, and copy it.",
            "2. In your Supabase project's **SQL Editor**, run `select robot.set_token('the new token');` with the "
            "token between the quotes.",
        ]
    lines += ["", "The robot closes this issue by itself once this works again. (supabase/README.md has more.)",
              "", f"<!-- alert:{kind} -->"]
    return "\n".join(lines)


# ---------- GitHub ----------

class GitHub:
    """The few GitHub calls the robot makes. Without `write`, it reads but only reports what it would change."""

    def __init__(self, repo: str, token: str, write: bool, log):
        self.repo, self.token, self.write, self.log = repo, token, write, log

    def call(self, method: str, path: str, body: dict | None = None):
        if method != "GET" and not self.write:
            self.log(f"(would {method} {path})")
            return None
        url = f"{os.environ.get('GITHUB_API_URL', 'https://api.github.com')}/repos/{self.repo}{path}"
        request = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None, headers={
            "Accept": "application/vnd.github+json", "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "els-agent-practices-proposals"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        return json.loads(data) if data else None

    def pages(self, path: str) -> list:
        items, page = [], 1
        while True:
            batch = self.call("GET", f"{path}{'&' if '?' in path else '?'}per_page=100&page={page}") or []
            items.extend(batch)
            if len(batch) < 100:
                return items
            page += 1

    def proposal_issues(self) -> dict[str, dict]:
        """Every issue for a proposal, found by the marker in its text. The robot opens them, but anyone can open
        one with the marker (earlier versions of the Maintainers page did), and it counts the same."""
        found: dict[str, dict] = {}
        self.duplicates: list[tuple[dict, dict]] = []
        for issue in sorted(self.pages("/issues?state=all"), key=lambda i: i["number"]):
            match = re.search(r"<!-- proposal:([\w-]+) -->", issue.get("body") or "")
            if not match or "pull_request" in issue:
                continue
            if match.group(1) in found:  # two filed at once: keep the first
                self.duplicates.append((issue, found[match.group(1)]))
            else:
                found[match.group(1)] = issue
        return found

    def ensure_label(self) -> None:
        try:
            self.call("GET", "/labels/proposal")
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            self.call("POST", "/labels", {"name": "proposal", "color": "8a2432",
                                          "description": "A change suggested on Suggest Edits, waiting for the maintainers"})


# ---------- Showing a proposal ----------

PHRASES = {
    "delete": ("Delete “{old}”", "Deleted “{old}”"),
    "replace": ("Replace “{old}” with “{new}”", "Replaced “{old}” with “{new}”"),
    "insert": ("Add “{new}” after “{old}”", "Added “{new}” after “{old}”"),
    "rule": ("Add a rule: “{new}”", "Added a rule: “{new}”"),
    "section": ("Add a section: “{new}”", "Added a section: “{new}”"),
}


def phrase(record: dict, past: bool = False, limit: int = 60) -> str:
    template = PHRASES[record["kind"]][past]
    new = record["new"].split("\n")[0] if record["kind"] == "section" else record["new"]  # a section by its heading
    return template.format(old=short(record["old"], limit), new=short(new, limit))


def summary_of(record: dict) -> str:
    section = record.get("section")
    where = f" (after {section})" if record["kind"] == "section" else f" ({section})"
    return f"{phrase(record, past=True, limit=80)}{where if section else ''}."


def change_segments(before: str, after: str) -> list[tuple[str | None, str, str]]:
    """A line's changes as (unchanged text, None, None) or (None, old words, new words). Changes separated
    only by a space, or by a punctuation mark or two, are joined, so "null, weak, and" -> "null and" is one change.
    assets/app.js does the same."""
    old, new = TOKENS.findall(before), TOKENS.findall(after)
    segments: list[list] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if op == "equal":
            segments.append(["".join(old[i1:i2]), None, None])
        elif segments and segments[-1][0] is None:
            segments[-1][1] += "".join(old[i1:i2])
            segments[-1][2] += "".join(new[j1:j2])
        else:
            segments.append([None, "".join(old[i1:i2]), "".join(new[j1:j2])])
    i = len(segments) - 2
    while i > 0:
        a, gap, b = segments[i - 1], segments[i], segments[i + 1]
        slight = gap[0] is not None and (not gap[0].strip() or (len(gap[0]) <= 3 and not re.search(r"[^\W_]", gap[0])))
        if slight and a[0] is None and b[0] is None:
            segments[i - 1:i + 2] = [[None, a[1] + gap[0] + b[1], a[2] + gap[0] + b[2]]]
        i -= 1
    return [tuple(segment) for segment in segments]


def track_changes(preview: dict) -> list[str]:
    """The affected lines in GitHub Markdown, with deletions struck through and additions underlined."""
    before, after = preview.get("before", []), preview.get("after", [])
    if len(before) == 1 and len(after) == 1:
        parts = []
        for same, old, new in change_segments(before[0], after[0]):
            if same is not None:
                parts.append(md_keep_spaces(same))
                continue
            old_core, new_core = old.strip(), new.strip()
            if not old_core and not new_core:
                parts.append(new)
                continue
            lead = re.match(r"\s*", old if old_core else new).group()
            trail = re.search(r"\s*$", new if new_core else old).group()
            parts.append(lead + (f"<del>{md(old_core)}</del>" if old_core else "") + (" " if old_core and new_core else "")
                         + (f"<ins>{md(new_core)}</ins>" if new_core else "") + trail)
        return ["".join(parts)]
    lines = [md(preview["context"])] if not before and preview.get("context") else []
    return lines + [f"<del>{md(line)}</del>" for line in before] + [f"<ins>{md(line)}</ins>" for line in after]


def status_sentence(record: dict, gov: Governance) -> str:
    status = record["status"]
    if status == "open":
        approvals = sum(v["vote"] == "approve" for v in record.get("votes", []))
        rejections = sum(v["vote"] == "reject" for v in record.get("votes", []))
        need = gov.approvals_needed
        text = f"open for votes: {approvals} of {need} approval{'s' if need != 1 else ''} needed"
        return text + (f", {rejections} rejection{'s' if rejections != 1 else ''}." if rejections else ".")
    if status == "needs-fix":
        return f"needs a fix before maintainers can adopt it. {record.get('note', '')}"
    if status == "adopted":
        return f"adopted in version {record['version']}."
    return {"declined": "declined.", "withdrawn": "withdrawn.", "cannot-apply": "closed: it can't be applied."}[status]


def issue_title(record: dict) -> str:
    return f"Proposal: {phrase(record, limit=48)}"


def issue_body(record: dict, gov: Governance, site: str) -> str:
    who = record["proposer"]
    preview = record.get("preview") or {}
    name, via = proposer_parts(who)
    lines = [
        f"**{name}** ({via}) proposes a change"
        f"{' to **' + md(record['section']) + '**' if record.get('section') else ''} on "
        f"[{SITE}]({site}draft/#proposals):",
        "",
        f"**{md(phrase(record, limit=200))}**",
        "",
    ]
    if preview.get("before") or preview.get("after"):
        lines += ["How it would read:", ""] + [f"> {line}" for line in track_changes(preview)] + [""]
    lines += [
        f"**Why:** {md(record['reason']) if record.get('reason') else '(no reason given)'}",
        "",
        f"**Status:** {md(status_sentence(record, gov))}",
        "",
        "---",
        "",
        f"**Maintainers:** approve or disapprove it on [{SITE}]({site}draft/#proposals), signed in with your email; "
        "or reply `/approve` or `/reject` here (replying to the notification email works too). "
        f"{gov.rule_sentence()} "
        "Only a maintainer's latest vote counts, and votes cast before the proposal was last edited don't count.",
        "",
        f"<!-- proposal:{record['id']} -->",
    ]
    return "\n".join(lines)


def outcome_comment(record: dict, site: str) -> tuple[str, str]:
    """The comment that closes a proposal's issue, and GitHub's reason for closing it."""
    status = record["status"]
    marker = f"<!-- outcome:{status} -->"
    names = ", ".join(v["name"] for v in record.get("votes", []) if v["vote"] == ("reject" if status == "declined" else "approve"))
    if status == "adopted":
        text = (f"**Adopted.** It's in [version {record['version']}]({site}versions/v{record['version']}/), "
                f"published with Argon2id fingerprint `{record['fingerprint']}`. Approved by {md(names)}.")
        return f"{text}\n\n{marker}", "completed"
    if status == "declined":
        return f"**Declined.** Rejected by {md(names)}.\n\n{marker}", "not_planned"
    if status == "withdrawn":
        return f"**Withdrawn.** {md(record.get('note', ''))}\n\n{marker}", "not_planned"
    return f"**Closed: this proposal can't be applied.** {md(record.get('note', ''))}\n\n{marker}", "not_planned"


# ---------- The run ----------

@dataclass
class Options:
    dry_run: bool = False
    push: bool = False
    offline: bool = False
    now: dt.datetime | None = None
    site_data: Path | None = None


class Robot:
    def __init__(self, options: Options):
        self.o = options
        self.events: list[str] = []
        self.tags: list[str] = []
        self.health: dict[str, str | None] = {}  # alert -> what's wrong, or None if it's fine
        self.gov = Governance(json.loads(MAINTAINERS.read_text()))
        self.manifest = json.loads(MANIFEST.read_text())
        self.site = self.manifest["site"]
        self.now = options.now or now_utc()
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        repo = os.environ.get("REPO") or os.environ.get("GITHUB_REPOSITORY") or self.manifest["repo"]
        use_github = token and not options.offline
        self.github = GitHub(repo, token, options.push and not options.dry_run, self.say) if use_github else None
        self.repo = repo

    def say(self, message: str) -> None:
        self.events.append(message)
        print(message)

    # --- versions ---

    def next_version(self, step: str = "patch") -> str:
        return release.next_version(self.manifest["latest"], step)

    def publish(self, summary: str, details: list[str], message: str, author: str | None = None,
                step: str = "patch") -> dict:
        version = self.next_version(step)
        entry = release.publish(version, summary, details, today=self.now.date().isoformat())
        commit(message.replace("{version}", version).replace("{fingerprint}", entry["fingerprint"]), author)
        git("tag", "-a", f"v{version}", "-m", f"Version {version}", "-m", f"Argon2id fingerprint: {entry['fingerprint']}",
            "-m", summary, env=BOT_IDENTITY)
        self.tags.append(f"v{version}")
        self.manifest = json.loads(MANIFEST.read_text())
        return entry

    def text_changes(self) -> list[tuple[str, str, str]]:
        """(author, subject, message) for each commit since the newest version that changed the text itself,
        not just its version line (line 3), oldest first."""
        latest = self.manifest["latest"]
        changes = []
        for sha in git("rev-list", "--reverse", f"v{latest}..HEAD", "--", "draft/AGENTS.md").split():
            after = git("show", f"{sha}:draft/AGENTS.md")
            try:
                before = git("show", f"{sha}^:draft/AGENTS.md")
            except RuntimeError:
                before = ""
            if not before or fingerprint(before) != fingerprint(after):
                author, subject, message = git("show", "-s", "--format=%an%x00%s%x00%B", sha).split("\0", 2)
                changes.append((author, subject, message))
        return changes

    def publish_direct_edit(self) -> None:
        """A maintainer changed draft/AGENTS.md directly: publish it as the next version.

        A commit message can give the version's summary with a line "Version-summary: ...", and a bigger version
        step with "Version-step: minor" (the middle number) or "Version-step: major" (the first); otherwise the
        summary says who edited the text, and the last number goes up."""
        changes = self.text_changes()
        authors = sorted({author for author, _, _ in changes} - {BOT_NAME}) or ["a maintainer"]
        subjects = [subject for _, subject, _ in changes]
        given = [m.group(1).strip() for _, _, message in changes
                 for m in [re.search(r"^Version-summary:[ \t]*(.+)$", message, re.M)] if m]
        steps = [m.group(1).lower() for _, _, message in changes
                 for m in [re.search(r"^Version-step:[ \t]*(patch|minor|major)\b", message, re.M | re.I)] if m]
        step = max(steps, key=release.STEPS.index) if steps else "patch"
        summary = given[-1] if given else (
            f"Edited directly by {', '.join(authors)}" + (f": {subjects[0]}" if len(subjects) == 1 else "."))
        if self.o.dry_run:
            self.say(f"Would publish a direct edit to the draft as version {self.next_version(step)}: {summary}")
            return
        details = (["Changes to the text, by " + ", ".join(authors) + ":", ""] + [f"- {s}" for s in subjects]) if subjects else []
        entry = self.publish(summary, details, "Version {version}: " + summary + "\n\nFingerprint (Argon2id): {fingerprint}",
                             step=step)
        self.say(f"Published a direct edit to the draft as version {entry['version']}.")

    # --- proposals ---

    def load_ledger(self) -> dict[str, dict]:
        if not LEDGER.exists():
            return {}
        return {r["id"]: r for r in json.loads(LEDGER.read_text()).get("proposals", [])}

    def ledger_text(self, records: dict[str, dict]) -> str:
        data = {"about": LEDGER_ABOUT, "proposals": sorted(records.values(), key=lambda r: (r["created"], r["id"]))}
        return json.dumps(data, indent=2, ensure_ascii=False) + "\n"

    def site_data(self) -> dict[str, list[dict]] | None:
        """Suggest Edits' suggestions and votes; None if they couldn't be read (so nothing is withdrawn by mistake)."""
        if self.o.site_data:
            return json.loads(self.o.site_data.read_text())
        config = self.manifest.get("supabase") or {}
        if not (config.get("url") and config.get("key")):  # not set up yet
            return {"suggestions": [], "votes": []}
        error: Exception | None = None
        for wait in (0, *RETRY_SECONDS):
            time.sleep(wait)
            try:
                data = fetch_site(config["url"], config["key"])
                self.health["database"] = None
                return data
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as caught:
                error = caught
        self.health["database"] = str(error)
        self.say(f"Couldn't read the suggestions from {SITE} ({error}); they weren't checked.")
        return None

    def gather_site(self, rows: list[dict], records: dict[str, dict]) -> None:
        """Bring the ledger up to date with the suggestions made on Suggest Edits."""
        seen = set()
        for row in sorted(rows, key=lambda r: (r["created"], r["id"])):
            rid = f"sb-{row['id']}"
            email = row.get("author_email") or ""
            record = records.get(rid)
            if email.lower() in self.gov.ignored_site:
                if record and record["status"] not in FINAL:
                    record.update(status="withdrawn", note="The proposer's account is ignored.", decided=self.now.isoformat())
                continue
            seen.add(rid)
            if record and record["status"] in FINAL:
                continue
            if record is None:
                record = records[rid] = {"id": rid, "status": "new", "based_on": self.manifest["latest"], "issue": None}
                self.say(f"New suggestion {rid} from {email}: {row['kind']}.")
            lines = [" ".join(line.split()) for line in (row.get("new_text") or "").split("\n")]
            # A new section keeps its lines: the heading, then one rule a line.
            new = "\n".join(line for line in lines if line) if row["kind"] == "section" else " ".join(" ".join(lines).split())
            problems = [] if row["kind"] == "delete" or new else ["missing-new"]
            record.update({
                "kind": row["kind"], "old": row["exact"], "new": new, "before": row.get("prefix") or "",
                "after": row.get("suffix") or "", "reason": " ".join((row.get("reason") or "").split()),
                "problems": problems, "proposer": site_proposer(email), "created": row["created"], "updated": row["updated"],
                "link": f"{self.site}draft/#proposals",
            })
        for record in records.values():
            if record["id"].startswith("sb-") and record["status"] not in FINAL and record["id"] not in seen:
                record.update(status="withdrawn", note="The proposer withdrew it.", decided=self.now.isoformat())
                self.say(f"Suggestion {record['id']} was withdrawn.")

    def evaluate(self, record: dict, text: str) -> edits.Edit | None:
        """Check a proposal against the current text, and set its status, note, and preview."""
        problems = record.get("problems") or []
        if problems:
            record.update(status="needs-fix", note=" ".join(PROBLEMS[p] for p in problems), preview=None)
            return None
        try:
            edit = edits.apply(text, record["kind"], record["old"], record["before"], record["after"], record["new"])
        except edits.Refused as refused:
            if refused.code == "no-change":  # the proposer can fix this by editing the comment
                record.update(status="needs-fix", note=str(refused), preview=None)
            else:
                if record.get("status") != "cannot-apply":
                    self.say(f"Proposal {record['id']} can't be applied ({refused.code}).")
                record.update(status="cannot-apply", note=str(refused), preview=None, decided=self.now.isoformat())
            return None
        record.update(status="open", note="", section=edit.section,
                      preview={"before": edit.before, "after": edit.after, "context": edit.context})
        return edit

    def adopt(self, record: dict, edit: edits.Edit, votes: list[Vote]) -> None:
        approvals = [v for v in votes if v.vote == "approve"]
        step = step_of(votes)
        if self.o.dry_run:
            self.say(f"Would adopt proposal {record['id']} as version {self.next_version(step)}: {summary_of(record)}")
            self.manifest = {**self.manifest, "latest": self.next_version(step)}
            record.update(status="adopted")
            return
        DRAFT.write_text(edit.source)
        who = record["proposer"]
        issue = f" · Discussion: <https://github.com/{self.repo}/issues/{record['issue']}>" if record.get("issue") else ""
        details = [
            f"- Proposed by {proposer_line(who)} on {record['created'][:10]}"
            + (f": “{md(short(record['reason'], 300))}”" if record.get("reason") else ""),
            "- Approved by " + ", ".join(f"{md(v.maintainer.name)} ({v.via}, {v.when.date().isoformat()})" for v in approvals),
            f"- Proposal: <{record['link']}>{issue}",
        ]
        # On Suggest Edits, the suggester's email address is their name.
        email = re.sub(r"[<>\s]", "", who.get("email") or "") or "proposer@suggest-edits.invalid"
        author, suggested = f"{email} <{email}>", f"{email} ({SITE})"
        message = "\n".join([
            f"Version {{version}}: {summary_of(record)}", "",
            f"Suggestion: {record['link']}",
            f"Suggested-by: {suggested}",
            *[f"Approved-by: {v.maintainer.name} ({v.via})" for v in approvals],
            "Fingerprint (Argon2id): {fingerprint}",
        ])
        entry = self.publish(summary_of(record), details, message, author, step)
        record.update(status="adopted", decided=self.now.isoformat(), version=entry["version"],
                      fingerprint=entry["fingerprint"], diff=edit.diff)
        self.say(f"Adopted proposal {record['id']} as version {entry['version']}: {summary_of(record)}")

    def run(self) -> None:
        problems = verify_published()
        if problems:
            raise SystemExit("A published version no longer matches its fingerprint, so nothing was done:\n  "
                             + "\n  ".join(problems))
        draft, latest = DRAFT.read_text(), LATEST.read_text()
        if fingerprint(draft) != fingerprint(latest):
            self.publish_direct_edit()
        elif stamp_line(draft) != stamp_line(latest) and not self.o.dry_run:
            release.sync_draft()
            commit(f"Give the draft the version line of version {self.manifest['latest']}")
            self.say("Gave the draft the newest version's version line.")

        records = self.load_ledger()
        before = LEDGER.read_text() if LEDGER.exists() else ""
        site = self.site_data()
        if site is None:
            return self.finish(records, before)
        self.gather_site(site.get("suggestions") or [], records)
        site_votes: dict[str, list[dict]] = {}
        for vote in site.get("votes") or []:
            site_votes.setdefault(vote["suggestion"], []).append(vote)

        issues = self.github.proposal_issues() if self.github else {}
        for record in records.values():
            if not record.get("issue") and record["id"] in issues:
                record["issue"] = issues[record["id"]]["number"]

        text = DRAFT.read_text() if not self.o.dry_run else draft
        pending = sorted((r for r in records.values() if r["status"] not in FINAL), key=lambda r: (r["created"], r["id"]))
        adopted = False
        for record in pending:  # oldest first, each against the text as the earlier ones left it
            edit = self.evaluate(record, text)
            comments = self.github.pages(f"/issues/{record['issue']}/comments") if self.github and record.get("issue") else []
            votes, support, stale = count_votes(record, comments, self.gov, site_votes.get(record["id"], []))
            record.update(votes=[v.record() for v in votes], support=support, stale_votes=stale)
            if record["status"] in FINAL:  # it can't be applied any more
                continue
            decision = decide(record, votes, self.gov, self.now)
            if decision == "decline":  # a proposal that still needs a fix can be disapproved too
                record.update(status="declined", decided=self.now.isoformat())
                self.say(f"Declined proposal {record['id']}: {phrase(record)}")
            elif decision == "adopt" and edit is not None:
                self.adopt(record, edit, votes)
                text = DRAFT.read_text() if not self.o.dry_run else edit.source
                adopted = True
        if adopted:  # the text changed: bring the other proposals' status and preview up to date with it
            for record in pending:
                if record["status"] in ("open", "needs-fix"):
                    self.evaluate(record, text)

        self.open_issues(records, issues)
        self.finish(records, before, issues)

    def open_issues(self, records: dict[str, dict], issues: dict[str, dict]) -> None:
        if not self.github:
            return
        settled = lambda r: (not r["id"].startswith("sb-")
                             or (self.now - parse_time(r["updated"])).total_seconds() >= SETTLE_MINUTES * 60)
        waiting = [r for r in records.values() if not r.get("issue") and r["status"] == "open" and settled(r)]
        if waiting and self.github.write:
            self.github.ensure_label()
        for record in sorted(waiting, key=lambda r: r["created"])[:NEW_ISSUES_PER_RUN]:
            body = issue_body(record, self.gov, self.site)
            made = self.github.call("POST", "/issues", {"title": issue_title(record), "body": body, "labels": ["proposal"]})
            if made:
                record["issue"] = made["number"]
                issues[record["id"]] = made
                self.say(f"Opened issue #{made['number']} for proposal {record['id']}.")

    def finish(self, records: dict[str, dict], before: str, issues: dict[str, dict] | None = None) -> None:
        after = self.ledger_text(records)
        if after != before and not self.o.dry_run:
            LEDGER.parent.mkdir(exist_ok=True)
            LEDGER.write_text(after)
            commit("Proposals: record new proposals, votes, and outcomes" if before else "Proposals: start the record")
            self.say("Recorded the proposals and votes in governance/proposals.json.")
        self.heartbeat()
        if self.o.push and not self.o.dry_run:
            self.push()
        if self.github and issues is not None:
            self.update_issues(records, issues)
        if self.github:
            self.check_starts()
            self.update_alerts()

    def heartbeat(self) -> None:
        """GitHub switches off a public repository's scheduled workflows after 60 days without activity. If nothing
        has been committed for a month, record that the robot is still running, in an empty commit."""
        if self.o.dry_run:
            return
        last = dt.datetime.fromtimestamp(int(git("log", "-1", "--format=%ct")), dt.timezone.utc)
        if (self.now - last).days < HEARTBEAT_DAYS:
            return
        when = self.now.isoformat()
        git("commit", "--quiet", "--allow-empty", "-m", "Robot: still running", "-m",
            f"Nothing else was committed in {HEARTBEAT_DAYS} days. GitHub switches off a public repository's scheduled "
            "workflows after 60 days without activity; this empty commit keeps the robot's schedule on.",
            env={**BOT_IDENTITY, "GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when})
        self.say("Recorded that the robot is still running (an empty commit, so GitHub keeps its schedule on).")

    def check_starts(self) -> None:
        """Once Supabase starts the robot (versions.json: supabase.starts_robot), check that it still does."""
        if not (self.manifest.get("supabase") or {}).get("starts_robot"):
            return
        if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch":  # this run was started that way
            self.health["wake"] = None
            return
        runs = (self.github.call("GET", f"/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=1")
                or {}).get("workflow_runs") or []
        last = parse_time(runs[0]["created_at"]) if runs else None
        if last and (self.now - last).total_seconds() < WAKE_STALE_HOURS * 3600:
            self.health["wake"] = None
        else:
            when = f"{last:%B %d, %Y, at %H:%M} UTC" if last else "never"
            self.health["wake"] = f"The last start was {when}."

    def update_alerts(self) -> None:
        """Open an issue for each problem found in this run, and close the issue for each that's fixed."""
        if not self.health:
            return
        open_issues = [i for i in self.github.pages("/issues?state=open") if "pull_request" not in i]
        leads = [m.github for m in self.gov.maintainers if "lead" in m.role and m.github] or \
            [m.github for m in self.gov.maintainers if m.github]
        for kind, detail in self.health.items():
            marker = f"<!-- alert:{kind} -->"
            existing = next((i for i in open_issues if marker in (i.get("body") or "")), None)
            if detail and not existing:
                made = self.github.call("POST", "/issues", {"title": ALERTS[kind],
                                                          "body": alert_body(kind, detail, self.repo, leads)})
                if made:
                    self.say(f"Opened issue #{made['number']}: {ALERTS[kind]}.")
            elif detail is None and existing:
                self.github.call("POST", f"/issues/{existing['number']}/comments",
                                 {"body": f"Working again as of {self.now:%B %d, %Y, %H:%M} UTC. Closing this."})
                self.github.call("PATCH", f"/issues/{existing['number']}", {"state": "closed", "state_reason": "completed"})
                self.say(f"Closed issue #{existing['number']}: working again.")

    def push(self) -> None:
        if git("rev-list", "--count", "origin/main..HEAD") == "0" and not self.tags:
            return
        result = subprocess.run(["git", "push", "--atomic", "origin", "HEAD:main", *self.tags], cwd=ROOT,
                                capture_output=True, text=True)
        if result.returncode:
            raise PushRejected(result.stderr.strip())
        self.say(f"Pushed to GitHub{' with ' + ', '.join(self.tags) if self.tags else ''}.")

    def update_issues(self, records: dict[str, dict], issues: dict[str, dict]) -> None:
        for duplicate, original in getattr(self.github, "duplicates", []):
            if duplicate.get("state") != "closed":
                self.github.call("POST", f"/issues/{duplicate['number']}/comments",
                                 {"body": f"This is the same proposal as #{original['number']}; votes here are counted there too."})
                self.github.call("PATCH", f"/issues/{duplicate['number']}", {"state": "closed", "state_reason": "not_planned"})
        for record in records.values():
            issue = issues.get(record["id"])
            if not issue or issue.get("state") == "closed":
                continue
            number = issue["number"]
            if record["status"] in FINAL:
                text, reason = outcome_comment(record, self.site)
                marker = text.rsplit("\n", 1)[-1]
                posted = any(marker in (c.get("body") or "") for c in self.github.pages(f"/issues/{number}/comments"))
                if not posted:
                    self.github.call("POST", f"/issues/{number}/comments", {"body": text})
                self.github.call("PATCH", f"/issues/{number}", {"state": "closed", "state_reason": reason,
                                                               "body": issue_body(record, self.gov, self.site)})
                self.say(f"Closed issue #{number}: {record['status']}.")
            else:
                body = issue_body(record, self.gov, self.site)
                labels = [label["name"] if isinstance(label, dict) else label for label in issue.get("labels") or []]
                changes = {"body": body} if body != (issue.get("body") or "") else {}
                if "proposal" not in labels:  # opened on the Maintainers page by someone who can't set labels
                    changes["labels"] = [*labels, "proposal"]
                if changes:
                    self.github.call("PATCH", f"/issues/{number}", changes)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="say what would happen, and change nothing")
    parser.add_argument("--push", action="store_true", help="push the results and update GitHub issues")
    parser.add_argument("--site-data", type=Path,
                        help="read Suggest Edits' suggestions and votes from this file instead of its database (for tests)")
    parser.add_argument("--offline", action="store_true", help="don't use GitHub at all")
    parser.add_argument("--now", help="the current time, for tests (ISO 8601)")
    args = parser.parse_args()
    options = Options(args.dry_run, args.push, args.offline, parse_time(args.now) if args.now else None, args.site_data)
    for attempt in range(3):
        robot = Robot(options)
        try:
            robot.run()
            break
        except PushRejected as rejected:
            print(f"GitHub rejected the push ({rejected}); starting again from GitHub's copy.", file=sys.stderr)
            for tag in robot.tags:
                git("tag", "-d", tag)
            git("fetch", "--quiet", "origin", "main", "--tags")
            git("reset", "--quiet", "--hard", "origin/main")
    else:
        raise SystemExit("GitHub rejected the push three times; the next run will try again.")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("### Proposals\n\n" + ("\n".join(f"- {e}" for e in robot.events) or "- Nothing to do.") + "\n")
    if not robot.events:
        print("Nothing to do.")


if __name__ == "__main__":
    main()
