# Maintaining this repository

This repository publishes "Best Practices for Working with AI Agents in Empirical Legal Research" as a GitHub Pages site: one working draft that anyone can edit, and a series of frozen, numbered releases.

## Rules

- The guide's text lives in `draft/agent-best-practices.md`. Never edit anything under `versions/` or `latest/`; those are release copies written by `scripts/release.py`.
- Never rewrite git history (no force-pushes, no rebasing pushed commits). The history is the edit log that makes every change recoverable.
- To undo an edit, make a new commit that restores the earlier text (`git revert <sha>`, or `git checkout <sha> -- draft/agent-best-practices.md` and commit). Never delete history to undo something.
- Practice IDs (A1, D3, ...) are permanent once published. Add new practices at the end of their section with the next free number. Mark a dropped practice "(Retired in vX.Y.Z)" instead of deleting or renumbering it.
- Check every reference against the actual source before adding it. No citations from memory.
- Keep the guide in plain Markdown: one paragraph per line, no raw HTML.
- Don't edit the "*Version ...*" line at the top of the draft by hand; the release script manages it.
- The starter instruction file is the code block under "Appendix A" in the guide. The release script extracts it to `starter-CLAUDE.md`. Don't add a file named `CLAUDE.md` anywhere except this one.

## Releasing

Version-number rules are in CONTRIBUTING.md. Anyone can edit the draft, so before a release read every edit since the last one (`git log vX.Y.Z..HEAD -- draft/`). Then run:

    python3 scripts/release.py X.Y.Z "One-line summary"

The script prints the commit, tag, and push commands. Run them after reviewing the result.

## Previewing

    python3 -m http.server 8765

Then open http://localhost:8765/ (published), /draft/ (draft), and /versions/.
