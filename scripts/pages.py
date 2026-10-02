#!/usr/bin/env python3
"""Write the site's HTML pages. Every page is the same shell; assets/app.js fills it in.

    python3 scripts/pages.py

scripts/release.py also uses render() for each version's pages.
"""

from __future__ import annotations

from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
        "%3Crect width='32' height='32' rx='7' fill='%23{color}'/%3E%3Ctext x='16' y='23' font-size='20' "
        "text-anchor='middle' fill='white' font-family='Georgia,serif'%3E%C2%A7%3C/text%3E%3C/svg%3E")

SHELL = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <link rel="icon" href="{icon}">
  <link rel="stylesheet" href="{root}/assets/style.css">
</head>
<body data-mode="{mode}" data-file="{file}" data-root="{root}"{version_attr}>
  <header class="site-header">
    <a class="brand" href="{root}/">ELS Agent Practices</a>
    <nav class="site-nav" aria-label="Site">
      <a href="{root}/agents/" data-nav="agents">AGENTS.md</a>
      <a href="{root}/" data-nav="guide">Guide</a>
      <a href="{root}/draft/" data-nav="draft">Draft</a>
      <a href="{root}/versions/" data-nav="versions">Versions</a>
      <a href="https://github.com/" data-repo-link>GitHub</a>
    </nav>
  </header>
  <div class="layout">
    <div id="banner" class="banner" hidden></div>
    <nav id="toc" class="toc" aria-label="Contents" hidden></nav>
    <main id="main"><article id="doc" class="doc"><p class="loading">Loading…</p></article></main>
  </div>
  <footer id="footer" class="site-footer"></footer>
{scripts}</body>
</html>
"""

RENDERERS = """  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>
"""

GUIDE_TITLE = "Best Practices for Working with AI Agents in Empirical Legal Research"


def render(mode: str, file: str, root: str, title: str, description: str, version: str | None = None) -> str:
    needs_markdown = mode not in ("history", "versions")
    color = "8a5300" if mode in ("draft", "history") else "1f4e79"
    return SHELL.format(
        title=escape(title),
        description=escape(description),
        icon=ICON.format(color=color),
        root=root,
        mode=mode,
        file=file,
        version_attr=f' data-version="{escape(version)}"' if version else "",
        scripts=(RENDERERS if needs_markdown else "") + f'  <script src="{root}/assets/app.js"></script>\n',
    )


def archive_pages(version: str, with_agents: bool) -> dict[str, str]:
    """The pages for one published version, keyed by file name."""
    pages = {"index.html": render("archive", "guide", "../..", f"Version {version} · Guide · ELS Agent Practices",
                                  f"Version {version} of {GUIDE_TITLE}.", version)}
    if with_agents:
        pages["agents.html"] = render("archive", "agents", "../..", f"Version {version} · AGENTS.md · ELS Agent Practices",
                                      f"Version {version} of AGENTS.md for empirical legal research projects.", version)
    return pages


FIXED = {
    "index.html": ("published", "guide", ".", "ELS Agent Practices",
                   f"{GUIDE_TITLE}, with an AGENTS.md for empirical legal research projects. Comment on any passage."),
    "agents/index.html": ("published", "agents", "..", "AGENTS.md · ELS Agent Practices",
                          "AGENTS.md: standing instructions for AI agents working on empirical legal research projects."),
    "draft/index.html": ("draft", "guide", "..", "Draft guide · ELS Agent Practices",
                         "Working draft of the guide. Anyone can edit it, and every edit is logged."),
    "draft/agents.html": ("draft", "agents", "..", "Draft AGENTS.md · ELS Agent Practices",
                          "Working draft of AGENTS.md. Anyone can edit it, and every edit is logged."),
    "draft/history.html": ("history", "guide", "..", "Edit history · ELS Agent Practices",
                           "Every edit to the draft guide and AGENTS.md, with links to view or restore any revision."),
    "versions/index.html": ("versions", "guide", "..", "All versions · ELS Agent Practices",
                            f"Every published version of {GUIDE_TITLE} and AGENTS.md."),
}


def main() -> None:
    for path, (mode, file, root, title, description) in FIXED.items():
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(render(mode, file, root, title, description))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
