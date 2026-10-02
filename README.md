# AGENTS.md for Empirical Legal Scholars

One file: **AGENTS.md**, standing instructions for AI agents (Claude Code, Codex, Cursor, and similar tools) working with empirical legal scholars. It's a general workflow file: it assumes no folder layout and needs no filling in. Save it in your project folder as `AGENTS.md`, or rename it `CLAUDE.md` for Claude Code.

It's a comment draft (version 0.0.x): nothing is final, and anyone can comment or make a new version.

- **Read or download it:** https://nathanreitinger.github.io/els-agent-practices/
- **Raw file:** https://nathanreitinger.github.io/els-agent-practices/latest/AGENTS.md
- **Drafter (comment, or make a new version):** https://nathanreitinger.github.io/els-agent-practices/draft/

## How it works

- **Anyone can comment** in the Drafter, and comments appear right away (Hypothesis; free account).
- **Anyone can make a new version.** A pull request that changes only the draft is merged automatically by `.github/workflows/merge-draft-edits.yml`.
- **Every version is kept.** The git history is the edit log; the Drafter lists every edit and lets anyone read or restore any of them. Force-pushes to `main` are blocked, so the history can't be rewritten.
- **Published versions are frozen snapshots.** A maintainer reviews the edits since the last release, then publishes a numbered version with `scripts/release.py`.

## Layout

| Path | What it is |
|---|---|
| `draft/AGENTS.md` | The working draft: the file to edit |
| `versions/vX.Y.Z/` | Published versions (never edited) |
| `latest/AGENTS.md` | The newest published version, at a stable URL |
| `versions.json` | The list of versions the site reads |
| `CHANGELOG.md` | What changed in each version |
| `scripts/release.py` | Publishes the draft as a new version |
| `scripts/pages.py` | Writes the site's HTML pages |
| `assets/`, `index.html`, `draft/index.html` | The website (GitHub Pages, no build step) |
| `docs/` | How AGENTS.md was drafted and tested |

Versions 0.0.0 and 0.0.1 also included a companion guide. It's preserved in those versions' folders and in the git history.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to comment, make a new version, and how version numbers work.

To preview the site locally, run `python3 -m http.server 8765` in this folder and open http://localhost:8765/.
