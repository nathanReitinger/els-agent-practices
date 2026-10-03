#!/usr/bin/env python3
"""Write the site's HTML pages. Each page is the same shell; assets/app.js fills it in.

    python3 scripts/pages.py

The site shows one file, AGENTS.md: the latest published version at the root,
Suggest Edits (draft/), where readers who verify their email address suggest
changes, the history of the text with each version's changes marked (history/),
each frozen version under versions/vX.Y.Z/, a page that checks a copy's
fingerprint (check/), how to join the community's Google group (join/), the
maintainers (maintainers/), and the declined proposals (declined/). Addresses
from earlier layouts redirect to these pages.
The frozen Markdown files are never touched. scripts/release.py also uses
archive_pages() for each new version.
"""

from __future__ import annotations

import hashlib
import json
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_NAME = "AGENTS.md for Empirical Legal Scholars"

FONTS = ("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500"
         "&family=IBM+Plex+Sans:wght@400;500;600;700"
         "&family=Playfair:ital,opsz,wght@0,5..1200,300..900;1,5..1200,300..900&display=swap")

ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
        "%3Crect width='32' height='32' rx='7' fill='%23{color}'/%3E%3Ctext x='16' y='22' font-size='15' "
        "text-anchor='middle' fill='white' font-family='Menlo,monospace' font-weight='700'%3EMD%3C/text%3E%3C/svg%3E")

FILE_ICON = ('<svg class="file-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" '
             'stroke-width="1.6" stroke-linejoin="round" d="M6 2.8h8.2L19 7.6v13.6H6z"/><path fill="none" '
             'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M14 2.8v5h5"/></svg>')

MOON = ('<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" '
        'd="M20.6 14.6A8.6 8.6 0 0 1 9.4 3.4a.6.6 0 0 0-.8-.7A9.6 9.6 0 1 0 21.3 15.4a.6.6 0 0 0-.7-.8z"/></svg>')
GITHUB = ('<svg class="icon-github" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0c4.42 0 '
          '8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 '
          '1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27'
          '-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 '
          '3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 '
          '1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>')
SUN = ('<svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/>'
       '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2'
       'M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>')

# Applies the reader's saved theme and text size before the page paints.
PREFS = ('<script>try{var d=document.documentElement,t=localStorage.getItem("els-theme"),'
         's=localStorage.getItem("els-size");if(t==="light"||t==="dark")d.dataset.theme=t;'
         'if(s&&!isNaN(+s))d.style.setProperty("--reading-scale",s)}catch(e){}</script>')

SHELL = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="{site_name}">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="{icon}">
  {prefs}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="{fonts}">
  <link rel="stylesheet" href="{root}/assets/style.css?v={asset}">
</head>
<body data-mode="{mode}" data-root="{root}"{version_attr}>
  <div class="progress" aria-hidden="true"><span></span></div>
  <header class="site-header">
    <a class="brand" href="{root}/"><span class="brand-file">AGENTS.md</span> <span class="brand-for">for Empirical Legal Scholars</span></a>
    <nav class="site-nav" aria-label="Site">
      <a href="{root}/" data-nav="file">AGENTS.md</a>
      <a href="{root}/draft/" data-nav="drafter">Suggest Edits</a>
      <a href="{root}/history/" data-nav="history">History</a>
      <a href="{root}/maintainers/" data-nav="maintainers">Maintainers</a>
      <a href="{root}/join/" data-nav="join">Join</a>
      <a href="{root}/check/" data-nav="check">Check a copy</a>
      <a href="https://github.com/" class="nav-icon" data-repo-link aria-label="Source on GitHub" title="Source on GitHub">{github}</a>
    </nav>
    <div class="reader-controls" role="group" aria-label="Reading settings">
      <button type="button" class="control" data-size="down" aria-label="Smaller text" title="Smaller text"><span class="a-small" aria-hidden="true">A&minus;</span></button>
      <button type="button" class="control" data-size="up" aria-label="Larger text" title="Larger text"><span class="a-large" aria-hidden="true">A+</span></button>
      <button type="button" class="control theme-toggle" data-theme-toggle aria-label="Switch to dark mode" title="Switch to dark mode">{moon}{sun}</button>
    </div>
  </header>
  <div class="layout">
    <nav id="toc" class="toc" aria-label="Outline" hidden></nav>
    <main id="main">
      <div id="intro"></div>
      <section class="file" aria-label="AGENTS.md">
        <div class="file-bar">
          <span class="file-name">{file_icon}AGENTS.md</span>
          <span class="file-meta" id="file-meta"></span>
          <span class="file-actions" id="file-actions"></span>
        </div>
        <article id="doc" class="doc"><p class="loading">Loading…</p></article>
      </section>
      <div id="after"></div>
    </main>
  </div>
  <footer id="footer" class="site-footer"></footer>
  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" integrity="sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js" integrity="sha384-+VfUPEb0PdtChMwmBcBmykRMDd+v6D/oFmB3rZM/puCMDYcIvF968OimRh4KQY9a" crossorigin="anonymous"></script>
  <script src="{root}/assets/app.js?v={asset}"></script>
</body>
</html>
"""

REDIRECT = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Moved · {site_name}</title>
  <meta http-equiv="refresh" content="0; url={target}">
  <link rel="canonical" href="{target}">
  <script>var t="{target}",i=t.indexOf("#");location.replace((i<0?t:t.slice(0,i))+location.search+(location.hash||(i<0?"":t.slice(i))))</script>
</head>
<body><p>This page moved: <a href="{target}">{site_name}</a>.</p></body>
</html>
"""


def asset_version() -> str:
    """A short hash of the site's CSS and JS, so browsers fetch new copies whenever they change."""
    digest = hashlib.sha1()
    for name in ("style.css", "app.js"):
        digest.update((ROOT / "assets" / name).read_bytes())
    return digest.hexdigest()[:8]


def render(mode: str, root: str, title: str, description: str, version: str | None = None) -> str:
    return SHELL.format(
        title=escape(title),
        description=escape(description),
        site_name=escape(SITE_NAME),
        icon=ICON.format(color={"drafter": "8a5300", "history": "6e5332", "check": "1f6f43", "join": "2f4f8a",
                                "maintainers": "4a3a7a", "declined": "6f6a72"}.get(mode, "8a2432")),
        prefs=PREFS,
        fonts=FONTS,
        root=root,
        asset=asset_version(),
        mode=mode,
        version_attr=f' data-version="{escape(version)}"' if version else "",
        file_icon=FILE_ICON,
        github=GITHUB,
        moon=MOON,
        sun=SUN,
    )


def redirect(target: str) -> str:
    return REDIRECT.format(target=escape(target), site_name=escape(SITE_NAME))


def archive_pages(version: str) -> dict[str, str]:
    """The pages for one published version, keyed by file name."""
    return {
        "index.html": render("archive", "../..", f"Version {version} · {SITE_NAME}",
                             f"Version {version} of AGENTS.md for empirical legal research. Published versions never change.",
                             version),
        "agents.html": redirect("./"),  # an address from an earlier layout
    }


FIXED = {
    "index.html": render("published", ".", SITE_NAME,
                         "AGENTS.md: standing instructions for AI agents working with empirical legal scholars. Download it, or propose a change."),
    "draft/index.html": render("drafter", "..", f"Suggest Edits · {SITE_NAME}",
                               "Edit AGENTS.md directly, with track changes on. Your suggestions carry your name, and the maintainers approve or disapprove each one."),
    "history/index.html": render("history", "..", f"History · {SITE_NAME}",
                                 "Every published version of AGENTS.md, with exactly what changed in each one marked in the text."),
    "maintainers/index.html": render("maintainers", "..", f"Maintainers · {SITE_NAME}",
                                     "The maintainers of AGENTS.md for Empirical Legal Scholars, and how they decide which suggested changes go in."),
    "declined/index.html": render("declined", "..", f"Declined proposals · {SITE_NAME}",
                                  "Proposed changes to AGENTS.md that maintainers disapproved, or that were withdrawn or couldn't be applied. Kept for the record."),
    "join/index.html": render("join", "..", f"Join · {SITE_NAME}",
                              "Join the Google group where people who use and shape AGENTS.md talk with each other."),
    "check/index.html": render("check", "..", f"Check a copy · {SITE_NAME}",
                               "Check whether a copy of AGENTS.md is exactly a published version, using its Argon2id fingerprint."),
    # Addresses from earlier layouts.
    "agents/index.html": redirect("../"),
    "draft/agents.html": redirect("./"),
    "draft/history.html": redirect("../history/"),
    "versions/index.html": redirect("../history/"),
}


def main() -> None:
    for path, html in FIXED.items():
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html)
        print(f"wrote {path}")
    manifest = json.loads((ROOT / "versions.json").read_text())
    for release in manifest.get("versions", []):
        folder = ROOT / "versions" / f"v{release['version']}"
        for name, html in archive_pages(release["version"]).items():
            (folder / name).write_text(html)
            print(f"wrote versions/v{release['version']}/{name}")


if __name__ == "__main__":
    main()
