#!/usr/bin/env python3
"""Publish the text in draft/AGENTS.md as a numbered, frozen version.

Approved proposals are published automatically by scripts/proposals.py, which
calls publish() below. Run this by hand only for a version that doesn't come
from a proposal, such as 1.0.0:

    python3 scripts/release.py 1.0.0 "One-line summary of this version"

Publishing a version:
- stamps line 3 of the file with the version, the date, the fingerprint, and
  the version's permanent link (the fingerprint is the SHA-256 hash of the file
  without line 3; see scripts/fingerprint.py);
- writes versions/vX.Y.Z/ (the frozen copy and its page) and makes latest/ an
  exact copy of it;
- records the version and its fingerprint in versions.json and CHANGELOG.md;
- gives draft/AGENTS.md the same version line, so the draft is always the
  newest version, word for word.

Before 1.0 every version is a comment draft and the next one adds one to the
last number (0.0.3, 0.0.4, ...). From 1.0 on, the next one adds one to the
middle number. The rules are in CONTRIBUTING.md.

Run by hand, it doesn't commit, tag, or push; it prints those commands so you
can review the result first.
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
from fingerprint import STAMP_LINE, fingerprint  # noqa: E402
from pages import archive_pages  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
AGENTS = "AGENTS.md"
MANIFEST = ROOT / "versions.json"
CHANGELOG = ROOT / "CHANGELOG.md"
CHANGELOG_MARKER = "<!-- releases -->"

SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
STAMP = re.compile(r"^\*Version [^\n]*\*$")


class ReleaseError(Exception):
    pass


def die(message: str) -> NoReturn:
    sys.exit(f"release: {message}")


def parse_version(text: str) -> tuple[int, int, int]:
    match = SEMVER.match(text)
    if not match:
        raise ReleaseError(f"'{text}' isn't a version number like 0.0.2")
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def next_version(latest: str) -> str:
    """The number for the next version: 0.0.2 -> 0.0.3 before 1.0, then 1.0.0 -> 1.1.0."""
    major, minor, patch = parse_version(latest)
    if major == 0 and minor == 0:
        return f"0.0.{patch + 1}"
    return f"{major}.{minor + 1}.0"


def comment_label(version: str) -> str:
    return " (comment draft; not final)" if version.startswith("0.") else ""


def stamp(version: str, today: str, site: str, sha256: str) -> str:
    return (f"*Version {version}{comment_label(version)} · Published {today} · "
            f"SHA-256 fingerprint of this file without this line: {sha256} · "
            f"Permanent link: <{site}versions/v{version}/{AGENTS}>*")


def with_stamp(text: str, line: str) -> str:
    lines = text.split("\n")
    if len(lines) <= STAMP_LINE or not STAMP.match(lines[STAMP_LINE]):
        raise ReleaseError(f"line {STAMP_LINE + 1} of draft/{AGENTS} must be its '*Version ...*' line")
    lines[STAMP_LINE] = line
    return "\n".join(lines)


def git(*args: str) -> str | None:
    """Run git in the repository; None if git or the repository isn't available."""
    try:
        result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip()


def sync_draft() -> bool:
    """Give the draft the newest version's line 3, if its text is that version's. True if it changed."""
    draft_path, latest_path = ROOT / "draft" / AGENTS, ROOT / "latest" / AGENTS
    draft, latest = draft_path.read_text(), latest_path.read_text()
    if draft == latest or fingerprint(draft) != fingerprint(latest):
        return False
    draft_path.write_text(latest)
    return True


def publish(version: str, summary: str, details: list[str] | tuple[str, ...] = (), today: str | None = None) -> dict:
    """Publish draft/AGENTS.md as `version`. Returns the new entry in versions.json."""
    manifest = json.loads(MANIFEST.read_text())
    previous = manifest.get("latest")
    if previous and parse_version(version) <= parse_version(previous):
        raise ReleaseError(f"{version} must be greater than the latest version, {previous}")
    out_dir = ROOT / "versions" / f"v{version}"
    if out_dir.exists():
        raise ReleaseError(f"versions/v{version}/ already exists; published versions are never overwritten")

    draft_path = ROOT / "draft" / AGENTS
    draft = draft_path.read_text()
    sha256 = fingerprint(draft)
    newest = next((r for r in manifest["versions"] if r["version"] == previous), {})
    if newest.get("sha256") == sha256:
        raise ReleaseError(f"the text hasn't changed since version {previous}; there's nothing new to publish")

    today = today or dt.date.today().isoformat()
    site = manifest["site"]
    text = with_stamp(draft, stamp(version, today, site, sha256))
    assert fingerprint(text) == sha256

    out_dir.mkdir(parents=True)
    (out_dir / AGENTS).write_text(text)
    for page, html in archive_pages(version).items():
        (out_dir / page).write_text(html)
    latest = ROOT / "latest"
    shutil.rmtree(latest, ignore_errors=True)
    latest.mkdir()
    shutil.copyfile(out_dir / AGENTS, latest / AGENTS)
    draft_path.write_text(text)

    entry = {"version": version, "date": today, "summary": summary, "sha256": sha256, "files": [AGENTS]}
    manifest["latest"] = version
    manifest.pop("draft", None)
    manifest["versions"].insert(0, entry)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    block = f"## [{version}] - {today}\n\n{summary}\n"
    if details:
        block += "\n" + "\n".join(details) + "\n"
    block += f"\nSHA-256 fingerprint: `{sha256}`\n"
    changelog = CHANGELOG.read_text()
    if CHANGELOG_MARKER not in changelog:
        raise ReleaseError(f"CHANGELOG.md is missing the '{CHANGELOG_MARKER}' line")
    CHANGELOG.write_text(changelog.replace(CHANGELOG_MARKER, f"{CHANGELOG_MARKER}\n\n{block}", 1))
    return entry


def check_repo_is_current() -> None:
    """Refuse to release if changes are missing from this copy."""
    if git("rev-parse", "--is-inside-work-tree") != "true":
        return
    if git("status", "--porcelain", "--", "draft/"):
        die("draft/ has uncommitted changes; commit them first so they're in the history")
    if git("rev-parse", "--abbrev-ref", "@{upstream}") is None:
        return
    git("fetch", "--quiet")
    behind = git("rev-list", "--count", "HEAD..@{upstream}")
    if behind and behind != "0":
        die(f"this copy is {behind} commit(s) behind GitHub; run 'git pull' first")


def main() -> None:
    if len(sys.argv) != 3 or not sys.argv[2].strip():
        die('usage: python3 scripts/release.py X.Y.Z "One-line summary"')
    version, summary = sys.argv[1], sys.argv[2].strip()
    check_repo_is_current()
    previous = json.loads(MANIFEST.read_text()).get("latest")
    since = [f"v{previous}..HEAD"] if previous and git("rev-parse", "--verify", "--quiet", f"v{previous}") else []
    edits = git("log", "--reverse", "--format=- %s (%an, %as)", *since, "--", f"draft/{AGENTS}") or ""
    try:
        entry = publish(version, summary, ["Changes to the text:", "", *edits.splitlines()] if edits else ())
    except ReleaseError as error:
        die(str(error))
    print(f"Published version {version} to versions/v{version}/ and latest/ (fingerprint {entry['sha256']}).")
    print("Review the changes, then run:")
    print(f'  git add -A && git commit -m "Version {version}" && '
          f'git tag -a v{version} -m "Version {version}" -m "SHA-256 fingerprint: {entry["sha256"]}" '
          f"&& git push --follow-tags")


if __name__ == "__main__":
    main()
