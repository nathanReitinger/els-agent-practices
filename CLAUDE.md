# Maintaining this repository

This repository publishes two files as a GitHub Pages site: `AGENTS.md` (standing instructions for agents working on empirical legal research projects) and the guide that explains each of its rules. Each has one working draft that anyone can edit and a series of frozen, numbered releases.

## The product files are not instructions for you

`draft/AGENTS.md`, `latest/AGENTS.md`, and every `versions/*/AGENTS.md` are the product: instructions for agents in *other people's research projects*. Don't follow their rules when maintaining this repository; follow this file.

## Rules

- The text lives in `draft/AGENTS.md` and `draft/agent-best-practices.md`. Never edit anything under `versions/` or `latest/`; those are release copies written by `scripts/release.py`.
- Never rewrite git history (no force-pushes, no rebasing pushed commits). The history is the edit log that makes every change recoverable.
- To undo an edit, make a new commit that restores the earlier text (`git revert <sha>`, or `git checkout <sha> -- <file>` and commit). Never delete history to undo something.
- Practice IDs (A1, D3, ...) keep their meaning once published. Add new practices at the end of their section with the next free number. Mark a dropped practice "(Retired in vX.Y.Z)" instead of deleting or renumbering it. Every rule in AGENTS.md must end with the ID of the guide practice it comes from.
- Check every reference against the actual source before adding it. No citations from memory. AGENTS.md must contain no facts that aren't in the guide.
- Keep both files in plain Markdown: one paragraph or rule per line, no raw HTML.
- Don't edit the "*Version ...*" line at the top of either draft by hand; the release script manages it.
- Don't add a file named `CLAUDE.md` anywhere except this one.
- Site pages are generated: change `scripts/pages.py`, then run `python3 scripts/pages.py`. The page logic is in `assets/app.js`. After changing anything in `assets/`, rerun `python3 scripts/pages.py` so the pages load the new version instead of a cached one.

## Releasing

Version-number rules are in CONTRIBUTING.md: everything before 1.0 is a comment draft (0.0.0, 0.0.1, ...). Anyone can edit the draft, so before a release read every edit since the last one (`git log vX.Y.Z..HEAD -- draft/`). Then run:

    python3 scripts/release.py X.Y.Z "One-line summary"

The script prints the commit, tag, and push commands. Run them after reviewing the result.

## Previewing

    python3 -m http.server 8765

Then open http://localhost:8765/ (guide), /agents/ (AGENTS.md), /draft/ (drafts), and /versions/.
