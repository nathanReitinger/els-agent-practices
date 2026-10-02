# Contributing

This project has two files: **AGENTS.md**, the instruction file researchers drop into their projects, and **the guide**, which explains the reasons behind each rule. Both are comment drafts, and both are open to everyone.

## Comment on anything

On any page of the site, select a passage and choose **Annotate**. Comments appear right away for everyone. They use [Hypothesis](https://web.hypothes.is/start), which asks for a free account. Existing comments are highlighted; open the panel on the right to read them.

## Edit the draft

Anyone with a free GitHub account can edit the draft, and every edit is recorded, so nothing is ever lost.

1. Open the draft of [the guide](https://nathanreitinger.github.io/els-agent-practices/draft/) or [AGENTS.md](https://nathanreitinger.github.io/els-agent-practices/draft/agents.html) and click **Edit**.
2. Sign in to GitHub if asked. GitHub will say you're proposing a change to a project you don't have write access to. That's expected.
3. Make your edit.
4. Click **Commit changes…**, write one line saying what you changed (for example, "Add PACER fee warning to C9"), then click **Propose changes** and **Create pull request**.
5. That's it. An edit that changes only files in `draft/` is merged automatically within a minute or two and appears on the draft pages right away. Changes to anything outside `draft/` wait for a maintainer.

## See or undo edits

The draft's **Edit history** page lists every edit: who made it, when, and what changed. Click **Guide** or **AGENTS.md** to read that file as it was after the edit. To restore it, click **Copy this revision's text**, open the editor, replace everything, and propose the change. The restore is logged like any other edit.

Maintainers can also undo an edit with `git revert`. History is never rewritten: force-pushes to `main` are blocked.

## Report something or propose a practice

[Open an issue](../../issues/new/choose). There are short forms for a new practice, a field note (something that went wrong), and an error.

## Style

- **The guide:** each practice is a bold one-sentence rule, then one or two sentences on why or how. Cite only sources you've read, by author and year, and add them to Further reading.
- **AGENTS.md:** each rule is one bullet, written to the agent, ending with the guide practice it comes from, like (C4). Keep it short; agents follow a page of specific rules better than ten pages of general ones. Don't add facts to AGENTS.md that aren't in the guide.
- Specific beats general: name the dataset, the tool, the failure.
- Plain Markdown, one paragraph per line, no raw HTML.
- Practice IDs (A1, D3, ...) keep their meaning once published. Add a new practice at the end of its section with the next free number. If you think a practice should go, mark it "(Proposed for retirement)" and say why, rather than deleting it.
- Don't edit the "*Version ...*" line at the top of either file; the release script manages it.

## Versions

Each published version is a frozen snapshot with a permanent link, so links and comments always point to the same text. The draft carries the next version number with a "-draft" suffix (for example, 0.0.1-draft).

- **0.0.x: comment drafts.** Nothing is final. Each new comment draft adds one to the last number: 0.0.0, 0.0.1, 0.0.2, and so on.
- **1.0.0** will be the first version the contributors are ready to recommend as a standard.
- **After 1.0**, numbers are MAJOR.MINOR.PATCH: a patch (1.0.1) fixes wording, typos, links, and references; a minor version (1.1.0) adds practices without contradicting earlier advice; a major version (2.0.0) removes or reverses a practice, so someone following the earlier version would need to change what they do.

Because anyone can edit the draft, a maintainer reads every edit since the last release before publishing a new version.

## Releasing (maintainers)

1. Pull the latest edits: `git pull`.
2. Review what changed since the last release: `git log vX.Y.Z..HEAD -- draft/` (or the edit-history page).
3. Run `python3 scripts/release.py X.Y.Z "One-line summary"`.
4. Check the result, then commit, tag, and push using the commands the script prints.
