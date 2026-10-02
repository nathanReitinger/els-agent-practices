#!/usr/bin/env python3
"""The fingerprint of a copy of AGENTS.md: a SHA-256 hash anyone can reproduce.

    python3 scripts/fingerprint.py AGENTS.md     # fingerprint a copy and say which version it is
    python3 scripts/fingerprint.py --verify      # check every published version against versions.json

Line 3 of the file is its version line, which states the fingerprint, so the
fingerprint covers everything except that line. The rule, in full:

1. Remove every carriage return (so Windows line endings don't matter) and a
   leading byte-order mark, if there is one.
2. Remove line 3.
3. Hash what remains, encoded as UTF-8, with SHA-256.

The same steps in a terminal (macOS or Linux):

    tr -d '\\r' < AGENTS.md | sed 3d | shasum -a 256

Changing a single character anywhere else in the file changes the fingerprint.
The site's "Check a copy" page (check/) runs the same steps in the browser.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAMP_LINE = 2  # zero-based index of the version line (line 3)
COMMAND = "tr -d '\\r' < AGENTS.md | sed 3d | shasum -a 256"


def canonical(text: str) -> str:
    """The text the fingerprint covers: the file without carriage returns and without line 3."""
    lines = text.removeprefix("﻿").replace("\r", "").split("\n")
    if len(lines) <= STAMP_LINE:
        raise ValueError("too short to be AGENTS.md: it has no version line (line 3)")
    del lines[STAMP_LINE]
    return "\n".join(lines)


def fingerprint(text: str) -> str:
    return hashlib.sha256(canonical(text).encode("utf-8")).hexdigest()


def stamp_line(text: str) -> str:
    """Line 3, the version line."""
    lines = text.removeprefix("﻿").replace("\r", "").split("\n")
    return lines[STAMP_LINE] if len(lines) > STAMP_LINE else ""


def verify_published() -> list[str]:
    """Problems with the published versions: a frozen file whose fingerprint isn't the one recorded."""
    manifest = json.loads((ROOT / "versions.json").read_text())
    problems = []
    for release in manifest["versions"]:
        path = ROOT / "versions" / f"v{release['version']}" / "AGENTS.md"
        recorded = release.get("sha256")
        if not path.exists():
            problems.append(f"{path.relative_to(ROOT)} is missing")
        elif not recorded:
            problems.append(f"versions.json has no fingerprint for {release['version']}")
        elif fingerprint(path.read_text()) != recorded:
            problems.append(f"{path.relative_to(ROOT)} no longer matches its recorded fingerprint")
    latest = ROOT / "latest" / "AGENTS.md"
    frozen = ROOT / "versions" / f"v{manifest['latest']}" / "AGENTS.md"
    if latest.exists() and frozen.exists() and latest.read_bytes() != frozen.read_bytes():
        problems.append("latest/AGENTS.md isn't an exact copy of the newest version")
    return problems


def main() -> None:
    if sys.argv[1:] == ["--verify"]:
        problems = verify_published()
        for problem in problems:
            print(f"fingerprint: {problem}", file=sys.stderr)
        if problems:
            sys.exit(1)
        print("Every published version matches its recorded fingerprint.")
        return
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/fingerprint.py AGENTS.md   (or --verify)")
    value = fingerprint(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(value)
    manifest = json.loads((ROOT / "versions.json").read_text())
    match = next((r for r in manifest["versions"] if r.get("sha256") == value), None)
    print(f"This is version {match['version']}, published {match['date']}." if match
          else "This doesn't match any published version.")


if __name__ == "__main__":
    main()
