# ELS Agent Practices

**Best Practices for Working with AI Agents in Empirical Legal Research**: a community guide for empirical legal scholars who use AI agents (Claude Code, Codex, Cursor, and similar tools) in research they plan to publish, plus a starter instruction file (`CLAUDE.md` / `AGENTS.md`) for ELS projects.

- **Published version:** https://nathanreitinger.github.io/els-agent-practices/
- **Draft (anyone can edit):** https://nathanreitinger.github.io/els-agent-practices/draft/
- **Starter CLAUDE.md for your project:** https://nathanreitinger.github.io/els-agent-practices/latest/starter-CLAUDE.md

## How it works

- **Anyone can edit the draft.** A pull request that changes only `draft/` is merged automatically by `.github/workflows/merge-draft-edits.yml`.
- **Every edit is logged and recoverable.** The git history is the edit log. The site's edit-history page shows it and lets anyone view or restore any earlier revision. Force-pushes to `main` are blocked, so the history can't be rewritten.
- **Published versions are frozen.** A maintainer reviews the edits since the last release, then publishes a numbered version with `scripts/release.py`. Each version has a permanent link for citation.

## Layout

| Path | What it is |
|---|---|
| `draft/agent-best-practices.md` | The working draft: the file to edit |
| `versions/vX.Y.Z/` | Published versions (never edited) |
| `latest/` | The newest published version, at stable URLs |
| `versions.json` | The list of versions the site reads |
| `CHANGELOG.md` | What changed in each version |
| `scripts/release.py` | Publishes the draft as a new version |
| `index.html`, `draft/`, `versions/`, `assets/` | The website (GitHub Pages, no build step) |

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to edit and comment, and how version numbers work.

To preview the site locally, run `python3 -m http.server 8765` in this folder and open http://localhost:8765/.
