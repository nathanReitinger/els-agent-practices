# Maintaining this repository

This repository publishes *AGENTS.md for Empirical Legal Scholars*: one Markdown file, `AGENTS.md`, on a GitHub Pages site. The root page shows the latest published version, the Drafter (`draft/`) shows the working draft that anyone can comment on or edit, and `versions/` holds frozen, numbered releases.

## The product file is not instructions for you

`draft/AGENTS.md`, `latest/AGENTS.md`, and every `versions/*/AGENTS.md` are the product: instructions for agents in *other people's research projects*. Don't follow their rules when maintaining this repository; follow this file.

## Rules

- The text lives in `draft/AGENTS.md`. Never edit anything under `versions/` or `latest/` except the HTML page shells that `scripts/pages.py` regenerates; the Markdown there is a frozen release copy written by `scripts/release.py`.
- Keep AGENTS.md general: it must not assume a folder layout, file names, or tools the reader may not have, and it needs no filling in. Rules about specific datasets or services must be explicitly conditional ("If the project uses…").
- Never rewrite git history (no force-pushes, no rebasing pushed commits). The history is the edit log that makes every version recoverable.
- To undo an edit, make a new commit that restores the earlier text (`git revert <sha>`, or `git checkout <sha> -- draft/AGENTS.md` and commit). Never delete history to undo something.
- Check every fact against its source before adding it. No citations or facts from memory.
- Keep the file in plain Markdown: one rule or paragraph per line, no raw HTML.
- Don't edit the "*Version ...*" line at the top of the draft by hand; the release script manages it.
- Don't add a file named `CLAUDE.md` anywhere except this one.
- Site pages are generated: change `scripts/pages.py`, then run `python3 scripts/pages.py`. The page logic is in `assets/app.js`. After changing anything in `assets/`, rerun `python3 scripts/pages.py` so the pages load the new version instead of a cached one.
- The site is for human readers: a white page, Playfair body text (justified), bold IBM Plex Sans headings, no blur or gradients, and light/dark and text-size controls.

## Releasing

Version-number rules are in CONTRIBUTING.md: everything before 1.0 is a comment draft (0.0.0, 0.0.1, ...). Anyone can edit the draft, so before a release read every edit since the last one (`git log vX.Y.Z..HEAD -- draft/AGENTS.md`). Then run:

    python3 scripts/release.py X.Y.Z "One-line summary"

The script prints the commit, tag, and push commands. Run them after reviewing the result.

## Previewing

    python3 -m http.server 8765

Then open http://localhost:8765/ (the published file), /draft/ (the Drafter), and /versions/vX.Y.Z/.
