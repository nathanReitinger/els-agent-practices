# Contributing

This project is one file: **AGENTS.md**, standing instructions for AI agents working with empirical legal scholars. It's a comment draft, and anyone can help shape it in the [Drafter](https://nathanreitinger.github.io/els-agent-practices/draft/).

## Comment

In the Drafter, select any passage and choose **Annotate**. Comments appear right away for everyone. They use [Hypothesis](https://web.hypothes.is/start), which asks for a free account.

## Make a new version

Anyone with a free GitHub account can edit the draft, and every edit is saved as a new version, so nothing is ever lost.

1. In the Drafter, click **Make a new version**.
2. Sign in to GitHub if asked. GitHub will say you're proposing a change to a project you don't have write access to. That's expected.
3. Make your edit.
4. Click **Commit changes…**, write one line saying what you changed, then click **Propose changes** and **Create pull request**.
5. That's it. An edit that changes only the draft is merged automatically within a minute or two and appears in the Drafter right away. Changes to anything else wait for a maintainer.

## Go back to any version

The Drafter lists every edit to the draft. Open one to read the draft as it was. To restore it, copy its text, open the editor, replace everything, and propose the change; the restore is saved like any other version.

Maintainers can also undo an edit with `git revert`. History is never rewritten: force-pushes to `main` are blocked.

## Style

- One rule per bullet, written to the agent, in plain English.
- Keep it general. Don't assume a folder layout, file names, or a particular dataset unless the rule says so explicitly ("If the project uses…").
- Keep it short: agents follow a page of specific rules better than ten pages of general ones.
- Add no facts from memory. Check anything you add against its source.
- Plain Markdown, one rule or paragraph per line, no raw HTML.
- Don't edit the "*Version ...*" line at the top; the release script manages it.

## Versions

Each published version is a frozen snapshot with a permanent link. The draft carries the next version number with a "-draft" suffix (for example, 0.0.3-draft).

- **0.0.x: comment drafts.** Nothing is final. Each new comment draft adds one to the last number.
- **1.0.0** will be the first version the contributors are ready to recommend as a standard.
- **After 1.0**, numbers are MAJOR.MINOR.PATCH: a patch (1.0.1) fixes wording; a minor version (1.1.0) adds rules without contradicting earlier ones; a major version (2.0.0) removes or reverses a rule.

Because anyone can edit the draft, a maintainer reads every edit since the last release before publishing a new version.

## Releasing (maintainers)

1. Pull the latest edits: `git pull`.
2. Review what changed since the last release: `git log vX.Y.Z..HEAD -- draft/AGENTS.md`.
3. Run `python3 scripts/release.py X.Y.Z "One-line summary"`.
4. Check the result, then commit, tag, and push using the commands the script prints.
