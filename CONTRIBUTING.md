# Contributing

Anyone with a free GitHub account can edit the draft of this guide. Every edit is recorded, so nothing is ever lost: any earlier version of the text can be viewed and restored.

## Edit the draft

1. Open the draft at https://nathanreitinger.github.io/els-agent-practices/draft/ and click **Edit this draft**.
2. Sign in to GitHub if asked. GitHub will say you're proposing a change to a project you don't have write access to. That's expected.
3. Make your edit.
4. Click **Commit changes…**, write one line saying what you changed (for example, "Add PACER fee warning to C7"), then click **Propose changes** and **Create pull request**.
5. That's it. An edit that changes only the draft is merged automatically within a minute or two and appears on the draft page right away. Changes to anything outside `draft/` wait for a maintainer.

## Comment instead of editing

On the draft page, highlight any passage to comment on it. Comments use [Hypothesis](https://web.hypothes.is/), which needs a free account. Comments are public.

## See or undo edits

The draft's **Edit history** page lists every edit: who made it, when, and what changed. Click **View** to read the draft as it was after that edit. To restore it, click **Copy this revision's text**, open the editor, replace everything, and propose the change. The restore is logged like any other edit.

Maintainers can also undo an edit with `git revert`. History is never rewritten: force-pushes to `main` are blocked.

## Report something or propose a practice

[Open an issue](../../issues/new/choose). There are short forms for a new practice, a field note (something that went wrong), and an error.

## Style

- Each practice is a bold one-sentence rule, then one or two sentences on why or how.
- Specific beats general: name the dataset, the tool, the failure.
- Cite only sources you've read, with a link. References are checked again before each release.
- Plain Markdown, one paragraph per line, no raw HTML.
- Practice IDs (A1, D3, ...) are permanent once published. Add a new practice at the end of its section with the next free number. If you think a practice should go, mark it "(Proposed for retirement)" and say why, rather than deleting it.
- Don't edit the "*Version ...*" line at the top of the draft; the release script manages it.

## Versions

Published versions never change, so each can be cited by its number and permanent link. The draft carries the next version number with a "-draft" suffix (for example, 0.2.0-draft).

Version numbers are MAJOR.MINOR.PATCH, adapted for a document:

- **PATCH** (0.1.0 → 0.1.1): wording, typos, links, and reference fixes. What the guide recommends doesn't change.
- **MINOR** (0.1.0 → 0.2.0): new practices or substantive additions that don't contradict earlier advice.
- **MAJOR** (1.0.0 → 2.0.0): a practice is removed or reversed, so someone following the previous version would need to change what they do.
- Versions below 1.0 are community drafts. 1.0.0 will be the first version the contributors are ready to recommend as a standard.

Because anyone can edit the draft, a maintainer reads every edit since the last release before publishing a new version.

## Releasing (maintainers)

1. Pull the latest edits: `git pull`.
2. Review what changed since the last release: `git log vX.Y.Z..HEAD -- draft/` (or the edit-history page).
3. Run `python3 scripts/release.py X.Y.Z "One-line summary"`.
4. Check the result, then commit, tag, and push using the commands the script prints.
