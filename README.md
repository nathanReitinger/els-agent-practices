# AGENTS.md for Empirical Legal Scholars

One file: **AGENTS.md**, standing instructions for AI agents (Claude Code, Codex, Cursor, and similar tools) working with empirical legal scholars. It's a general workflow file: it assumes no folder layout and needs no filling in. Save it in your project folder as `AGENTS.md`, or rename it `CLAUDE.md` for Claude Code.

It's a comment draft (version 0.0.x): nothing is final, and it grows out of proposals from the people who use it.

- **Read or download it:** https://nathanreitinger.github.io/els-agent-practices/
- **Raw file:** https://nathanreitinger.github.io/els-agent-practices/latest/AGENTS.md
- **Drafter (comment, or propose a change):** https://nathanreitinger.github.io/els-agent-practices/draft/
- **Maintainers (who decides, and their sign-in to approve or disapprove):** https://nathanreitinger.github.io/els-agent-practices/maintainers/
- **Check a copy:** https://nathanreitinger.github.io/els-agent-practices/check/
- **Talk with others who use it:** join the Google group agentselsmd (https://nathanreitinger.github.io/els-agent-practices/join/), by sending any email to agentselsmd+subscribe@googlegroups.com

## How it works

- **Anyone can propose a change** in the Drafter, with no GitHub account: select words, choose Annotate (Hypothesis; free account), and start the note with `Delete`, `Replace with:`, `Add after:`, or `Add rule:`.
- **Maintainers decide.** They sign in on the Maintainers page and approve or disapprove each proposal. One maintainer's approval adopts a proposal, unless at least as many maintainers disapprove it. Disapproved proposals move to the Declined page.
- **Approved changes are published automatically.** A robot (`scripts/proposals.py`, run every 15 minutes by `.github/workflows/proposals.yml`) applies each approved proposal, publishes it as the next version, and records who proposed and approved it.
- **Every version has a fingerprint**, the Argon2id hash of its file without line 3, so anyone can check that a copy is exact.
- **Nothing is lost.** Every proposal, vote, and version is kept, and force-pushes to `main` are blocked, so the history can't be rewritten.

The rules are in [GOVERNANCE.md](GOVERNANCE.md); how to take part is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

| Path | What it is |
|---|---|
| `draft/AGENTS.md` | The text, always identical to the newest version |
| `versions/vX.Y.Z/` | Published versions (never edited) |
| `latest/AGENTS.md` | The newest version, at a stable URL |
| `versions.json` | Every version, with its fingerprint |
| `CHANGELOG.md` | What changed in each version, and who proposed and approved it |
| `governance/maintainers.json` | The maintainers, who approve changes, and the rules for deciding |
| `governance/proposals.json` | Every proposal, vote, and outcome (written by the robot) |
| `scripts/proposals.py` | The robot that counts votes and publishes approved changes |
| `scripts/edits.py`, `scripts/commands.py` | How a proposal becomes an exact edit, and how comments are read |
| `scripts/release.py`, `scripts/fingerprint.py` | Publishing a version, and computing fingerprints |
| `scripts/pages.py` | Writes the site's HTML pages |
| `scripts/tests/` | Tests, run before every robot run |
| `assets/`, `index.html`, `draft/`, `maintainers/`, `declined/`, `check/`, `join/` | The website (GitHub Pages, no build step) |
| `docs/` | How AGENTS.md was drafted and tested |

Versions 0.0.0 and 0.0.1 also included a companion guide. It's preserved in those versions' folders and in the git history.

To preview the site locally, run `python3 -m http.server 8765` in this folder and open http://localhost:8765/.
