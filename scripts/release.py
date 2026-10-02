#!/usr/bin/env python3
"""Publish the current draft as a numbered, frozen version.

    python3 scripts/release.py 0.0.2 "One-line summary of this release"

Copies draft/AGENTS.md to versions/vX.Y.Z/, stamping
each with its version, date, and permanent link; writes that version's pages;
makes latest/ an exact copy of the new version; records the release in
versions.json and CHANGELOG.md; and moves the draft on to the next version.

Before 1.0, every version is a comment draft (0.0.1, 0.0.2, ...), and the draft
moves to the next patch number. From 1.0 on, the draft moves to the next minor
version. The rules are in CONTRIBUTING.md.

It never commits, tags, or pushes. It prints those commands so you can review
the result first.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pages import archive_pages  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
AGENTS = "AGENTS.md"
FILES = (AGENTS,)  # the one file the project publishes
MANIFEST = ROOT / "versions.json"
CHANGELOG = ROOT / "CHANGELOG.md"
CHANGELOG_MARKER = "<!-- releases -->"

SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
VERSION_LINE = re.compile(r"^\*Version [^\n]*\*$", re.MULTILINE)


def die(message: str) -> NoReturn:
    sys.exit(f"release: {message}")


def parse_version(text: str) -> tuple[int, int, int]:
    match = SEMVER.match(text)
    if not match:
        die(f"'{text}' isn't a version number like 0.0.2")
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def next_draft(number: tuple[int, int, int]) -> str:
    major, minor, patch = number
    if major == 0 and minor == 0:
        return f"0.0.{patch + 1}-draft"
    return f"{major}.{minor + 1}.0-draft"


def comment_label(version: str) -> str:
    return " (comment draft; not final)" if version.startswith("0.") else ""


def published_line(name: str, version: str, today: str, site: str) -> str:
    base = f"{site}versions/v{version}/"
    if name == AGENTS:
        return f"*Version {version}{comment_label(version)} · Published {today} · Permanent link: <{base}{AGENTS}>*"
    return f"*Version {version}{comment_label(version)} · Published {today} · Permanent link: <{base}>*"


def draft_line(name: str, version: str, site: str) -> str:
    latest = f"{site}latest/{AGENTS}" if name == AGENTS else site
    return (f"*Version {version} · Working draft: anyone can edit it, and every edit is logged · "
            f"Latest published version: <{latest}>*")


def git(*args: str) -> str | None:
    """Run git in the repository; None if git or the repository isn't available."""
    try:
        result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip()


def check_repo_is_current() -> None:
    """Refuse to release if merged edits are missing from this copy."""
    if git("rev-parse", "--is-inside-work-tree") != "true":
        return
    if git("status", "--porcelain", "--", "draft/"):
        die("draft/ has uncommitted changes; commit them first so they're in the edit log")
    if git("rev-parse", "--abbrev-ref", "@{upstream}") is None:
        return
    git("fetch", "--quiet")
    behind = git("rev-list", "--count", "HEAD..@{upstream}")
    if behind and behind != "0":
        die(f"this copy is {behind} commit(s) behind GitHub; run 'git pull' first so the release includes every edit")


def main() -> None:
    if len(sys.argv) != 3 or not sys.argv[2].strip():
        die('usage: python3 scripts/release.py X.Y.Z "One-line summary"')
    version, summary = sys.argv[1], sys.argv[2].strip()
    number = parse_version(version)

    manifest = json.loads(MANIFEST.read_text())
    previous = manifest.get("latest")
    if previous and number <= parse_version(previous):
        die(f"{version} must be greater than the latest release, {previous}")
    out_dir = ROOT / "versions" / f"v{version}"
    if out_dir.exists():
        die(f"versions/v{version}/ already exists; published versions are never overwritten")
    check_repo_is_current()

    drafts = {name: (ROOT / "draft" / name).read_text() for name in FILES if (ROOT / "draft" / name).exists()}
    if AGENTS not in drafts:
        die(f"draft/{AGENTS} is missing")
    for name, text in drafts.items():
        if not VERSION_LINE.search(text):
            die(f"draft/{name} is missing its '*Version ...*' line near the top")

    today = dt.date.today().isoformat()
    site = manifest["site"]
    following = next_draft(number)

    out_dir.mkdir(parents=True)
    for name, text in drafts.items():
        (out_dir / name).write_text(VERSION_LINE.sub(published_line(name, version, today, site), text, count=1))
        (ROOT / "draft" / name).write_text(VERSION_LINE.sub(draft_line(name, following, site), text, count=1))
    for page, html in archive_pages(version).items():
        (out_dir / page).write_text(html)

    # latest/ is an exact copy of the newest version's files.
    latest = ROOT / "latest"
    shutil.rmtree(latest, ignore_errors=True)
    latest.mkdir()
    for name in drafts:
        shutil.copyfile(out_dir / name, latest / name)

    manifest.update(latest=version, draft=following)
    manifest["versions"].insert(0, {"version": version, "date": today, "summary": summary, "files": list(drafts)})
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    # The changelog gets the summary plus a line for every edit to the draft since the last release.
    since = [f"v{previous}..HEAD"] if previous and git("rev-parse", "--verify", "--quiet", f"v{previous}") else []
    edits = git("log", "--reverse", "--format=- %s (%an, %as)", *since, "--", *(f"draft/{name}" for name in FILES)) or ""
    entry = f"## [{version}] - {today}\n\n{summary}\n"
    if edits:
        entry += f"\nEdits to the draft in this release:\n\n{edits}\n"
    changelog = CHANGELOG.read_text()
    if CHANGELOG_MARKER not in changelog:
        die(f"CHANGELOG.md is missing the '{CHANGELOG_MARKER}' line")
    CHANGELOG.write_text(changelog.replace(CHANGELOG_MARKER, f"{CHANGELOG_MARKER}\n\n{entry}", 1))

    print(f"Published version {version} ({', '.join(drafts)}) to versions/v{version}/ and latest/. "
          f"The draft is now {following}.")
    print("Review the changes, then run:")
    print(f'  git add -A && git commit -m "Release v{version}" && git tag -a v{version} -m "Version {version}" '
          f"&& git push --follow-tags")


if __name__ == "__main__":
    main()
