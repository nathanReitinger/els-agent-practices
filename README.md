# AGENTS.md for Empirical Legal Scholars

**AGENTS.md for empirical legal research**: standing instructions for AI agents (Claude Code, Codex, Cursor, and similar tools) working on empirical legal research projects, plus **the guide** that explains the reason behind every rule: *Best Practices for Working with AI Agents in Empirical Legal Research*.

Both are comment drafts (version 0.0.x): nothing is final, and anyone can comment or edit.

- **Get AGENTS.md:** https://nathanreitinger.github.io/els-agent-practices/agents/ (raw file: https://nathanreitinger.github.io/els-agent-practices/latest/AGENTS.md)
- **Read the guide:** https://nathanreitinger.github.io/els-agent-practices/
- **Comment:** select any passage on the site and choose Annotate ([Hypothesis](https://web.hypothes.is/start); free account).
- **Edit the draft:** https://nathanreitinger.github.io/els-agent-practices/draft/

## How it works

- **Anyone can comment** on any page, and comments appear right away.
- **Anyone can edit the draft.** A pull request that changes only `draft/` is merged automatically by `.github/workflows/merge-draft-edits.yml`.
- **Every edit is logged and recoverable.** The git history is the edit log. The site's edit-history page shows it and lets anyone view or restore any earlier revision. Force-pushes to `main` are blocked, so the history can't be rewritten.
- **Published versions are frozen snapshots.** A maintainer reviews the edits since the last release, then publishes a numbered version with `scripts/release.py`. Each version has a permanent link.

## Layout

| Path | What it is |
|---|---|
| `draft/AGENTS.md`, `draft/agent-best-practices.md` | The working drafts: the files to edit |
| `versions/vX.Y.Z/` | Published versions (never edited) |
| `latest/` | The newest published version, at stable URLs |
| `versions.json` | The list of versions the site reads |
| `CHANGELOG.md` | What changed in each version |
| `scripts/release.py` | Publishes the draft as a new version |
| `scripts/pages.py` | Writes the site's HTML pages |
| `assets/`, `index.html`, `agents/`, `draft/*.html`, `versions/index.html` | The website (GitHub Pages, no build step) |
| `docs/` | How AGENTS.md was drafted and tested |

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to comment and edit, and how version numbers work.

To preview the site locally, run `python3 -m http.server 8765` in this folder and open http://localhost:8765/.
