# Contributing

This project is one file, **AGENTS.md**: standing instructions for AI agents working with empirical legal scholars. It's a comment draft, and it changes through proposals that members vote on. [GOVERNANCE.md](GOVERNANCE.md) has the rules.

## Comment or propose a change (no GitHub needed)

1. Open the [Drafter](https://nathanreitinger.github.io/els-agent-practices/draft/).
2. Select the words you want to comment on or change, and choose **Annotate**. Comments use [Hypothesis](https://web.hypothes.is/start), which asks for a free account.
3. For a comment, write anything. For a proposal, start your note with `Delete`, `Replace with:`, `Add after:`, or `Add rule:` (the Drafter shows examples), and add a line that starts with `Why:` to explain.

When a member approves your proposal, it's published as a new version automatically. You can follow it in the Drafter's list of proposals.

## Talk with others

People who use and shape AGENTS.md talk with each other in a Google group, agentselsmd. To join, send any email to `agentselsmd+subscribe@googlegroups.com` and reply to the confirmation Google sends (no Google account needed), or join on [Google Groups](https://groups.google.com/g/agentselsmd). The site's [Join](https://nathanreitinger.github.io/els-agent-practices/join/) page explains both. Once you've joined, write to everyone at `agentselsmd@googlegroups.com`.

## Vote (members)

Reply **Approve** or **Reject** to a proposal in the Drafter, or comment `/approve` or `/reject` on its GitHub issue. Replying to GitHub's notification email works too.

## Check a copy

Every version has a fingerprint, an Argon2id hash of its text. [Check a copy](https://nathanreitinger.github.io/els-agent-practices/check/) tells you whether a file is exactly a published version and, if it isn't, what changed.

## For GitHub users

A pull request that changes `draft/AGENTS.md` waits for a maintainer. When one is merged, it's published as a new version, like any direct change. Most changes are simpler as a proposal in the Drafter, where members vote on them.

## Style

- One rule per bullet, written to the agent, in plain English.
- Keep it general. Don't assume a folder layout, file names, or a particular dataset unless the rule says so explicitly ("If the project uses…").
- Keep it short: agents follow a page of specific rules better than ten pages of general ones.
- Add no facts from memory. Check anything you add against its source.
- Plain Markdown, one rule or paragraph per line, no raw HTML.
- Line 3, the version line, is written automatically.

## Versions

Each published version is a frozen snapshot with a permanent link and a fingerprint. The Drafter always shows the newest version.

- **0.0.x: comment drafts.** Nothing is final. Each adopted proposal adds one to the last number.
- **1.0.0** will be the first version the contributors are ready to recommend as a standard. A maintainer publishes it.
- **After 1.0**, each adopted proposal adds one to the middle number (1.1.0, 1.2.0, ...), and a maintainer decides when a change is big enough for a new first number (2.0.0).

## Maintainers

- **Members and rules** are in `governance/members.json`. To add a member, add their name, role, and the Hypothesis and GitHub usernames they'll vote with. Changes take effect at the robot's next run.
- **The robot** runs every 15 minutes (on GitHub: Actions, then Proposals). To run it now, choose **Run workflow** there; tick "Only say what would happen" for a dry run. On your own computer: `python3 scripts/proposals.py --dry-run`.
- **Tests:** `python3 -m unittest discover -s scripts/tests -t scripts/tests`. They also run before every robot run.
- **A version that doesn't come from a proposal**, such as 1.0.0: `python3 scripts/release.py 1.0.0 "One-line summary"`, then the commit, tag, and push commands it prints.
- **If GitHub switches the schedule off** (it can after 60 days without activity), turn it back on under Actions, then Proposals.
