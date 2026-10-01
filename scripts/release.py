#!/usr/bin/env python3
"""Publish the current draft as a numbered, frozen version of the guide.

    python3 scripts/release.py 0.2.0 "One-line summary of this release"

Copies draft/agent-best-practices.md to versions/vX.Y.Z/ (stamped with its
version, date, and permanent link), extracts the starter instruction file from
Appendix A, refreshes latest/, records the release in versions.json and
CHANGELOG.md, and moves the draft on to the next "-draft" version.

It never commits, tags, or pushes. It prints those commands so you can review
the result first. The version-number rules are in CONTRIBUTING.md.
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

ROOT = Path(__file__).resolve().parent.parent
GUIDE = "agent-best-practices.md"
STARTER = "starter-CLAUDE.md"
DRAFT = ROOT / "draft" / GUIDE
MANIFEST = ROOT / "versions.json"
CHANGELOG = ROOT / "CHANGELOG.md"
PAGE_TEMPLATE = ROOT / "assets" / "version-page.html"
CHANGELOG_MARKER = "<!-- releases -->"

SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
VERSION_LINE = re.compile(r"^\*Version [^\n]*\*$", re.MULTILINE)


def die(message: str) -> NoReturn:
    sys.exit(f"release: {message}")


def parse_version(text: str) -> tuple[int, int, int]:
    match = SEMVER.match(text)
    if not match:
        die(f"'{text}' isn't a version number like 0.2.0")
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def git(*args: str) -> str | None:
    """Run git in the repository; None if git or the repository isn't available."""
    try:
        result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip()


def starter_file(markdown: str) -> str:
    """The first fenced code block after the 'Appendix A' heading."""
    heading = re.search(r"^## Appendix A\b.*$", markdown, re.MULTILINE)
    if not heading:
        die("couldn't find the '## Appendix A' heading in the draft")
    block = re.search(r"^```[^\n]*\n(.*?)^```", markdown[heading.end():], re.MULTILINE | re.DOTALL)
    if not block:
        die("couldn't find the starter file's code block under Appendix A")
    return block.group(1)


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

    draft = DRAFT.read_text()
    if not VERSION_LINE.search(draft):
        die("the draft is missing its '*Version ...*' line near the top")
    today = dt.date.today().isoformat()
    site = manifest["site"]

    published = VERSION_LINE.sub(
        f"*Version {version} · Published {today} · Permanent link: <{site}versions/v{version}/>*", draft, count=1)
    out_dir.mkdir(parents=True)
    (out_dir / GUIDE).write_text(published)
    (out_dir / STARTER).write_text(starter_file(published))
    (out_dir / "index.html").write_text(PAGE_TEMPLATE.read_text().replace("{{VERSION}}", version))

    latest = ROOT / "latest"
    latest.mkdir(exist_ok=True)
    for name in (GUIDE, STARTER):
        shutil.copyfile(out_dir / name, latest / name)

    next_draft = f"{number[0]}.{number[1] + 1}.0-draft"
    DRAFT.write_text(VERSION_LINE.sub(
        f"*Version {next_draft} · Working draft: anyone can edit it, and every edit is logged · "
        f"Latest published version: <{site}>*", draft, count=1))

    manifest.update(latest=version, draft=next_draft)
    manifest["versions"].insert(0, {"version": version, "date": today, "summary": summary})
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    # The changelog gets the summary plus a line for every edit to the draft since the last release.
    since = [f"v{previous}..HEAD"] if previous and git("rev-parse", "--verify", "--quiet", f"v{previous}") else []
    edits = git("log", "--reverse", "--format=- %s (%an, %as)", *since, "--", "draft/") or ""
    entry = f"## [{version}] - {today}\n\n{summary}\n"
    if edits:
        entry += f"\nEdits to the draft in this release:\n\n{edits}\n"
    changelog = CHANGELOG.read_text()
    if CHANGELOG_MARKER not in changelog:
        die(f"CHANGELOG.md is missing the '{CHANGELOG_MARKER}' line")
    CHANGELOG.write_text(changelog.replace(CHANGELOG_MARKER, f"{CHANGELOG_MARKER}\n\n{entry}", 1))

    print(f"Published version {version}: versions/v{version}/ and latest/. The draft is now {next_draft}.")
    print("Review the changes, then run:")
    print(f'  git add -A && git commit -m "Release v{version}" && git tag v{version} && git push --follow-tags')


if __name__ == "__main__":
    main()
