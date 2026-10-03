# Contributing

This project is one file, **AGENTS.md**: standing instructions for AI agents working with empirical legal scholars. It's a comment draft, and it changes through suggestions that the maintainers approve or disapprove. [GOVERNANCE.md](GOVERNANCE.md) has the rules.

## Suggest a change (no GitHub needed)

1. Open [Suggest Edits](https://nathanreitinger.github.io/els-agent-practices/draft/).
2. Verify an email address: enter any address you can check, then the 6-digit code the site emails to it. That address is your name on the site, and everyone can see it.
3. Edit the text as in Word with track changes on: deleted words are struck out, and new words appear in blue under your name. Press Enter at the end of a rule to add a new one. Every change is saved automatically as a suggestion.

To comment instead, choose **Comment instead** above the text, select words, and choose **Annotate** (comments use a free [Hypothesis](https://web.hypothes.is/start) account). A comment that starts with `Delete`, `Replace with:`, `Add after:`, or `Add rule:` is also a proposal.

When a maintainer approves your suggestion, it's published as a new version automatically. You can follow it in the list below the text on Suggest Edits; if it's disapproved, it moves to the [Declined](https://nathanreitinger.github.io/els-agent-practices/declined/) page.

## Talk with others

People who use and shape AGENTS.md talk with each other in a Google group, agentselsmd. To join, send any email to `agentselsmd+subscribe@googlegroups.com` and reply to the confirmation Google sends (no Google account needed), or join on [Google Groups](https://groups.google.com/g/agentselsmd). The site's [Join](https://nathanreitinger.github.io/els-agent-practices/join/) page explains both. Once you've joined, write to everyone at `agentselsmd@googlegroups.com`.

## Approve or disapprove (maintainers)

Verify the email address listed for you in `governance/maintainers.json` on [Suggest Edits](https://nathanreitinger.github.io/els-agent-practices/draft/). Then click a suggestion in the text, or use the list below it, and choose **Approve** or **Disapprove**. You can also comment `/approve` or `/reject` on a suggestion's GitHub issue (replying to GitHub's notification email works too), or reply **Approve** or **Reject** to a proposal made in a comment.

## Check a copy

Every version has a fingerprint, an Argon2id hash of its text. [Check a copy](https://nathanreitinger.github.io/els-agent-practices/check/) tells you whether a file is exactly a published version and, if it isn't, what changed.

## For GitHub users

A pull request that changes `draft/AGENTS.md` waits for a maintainer. When one is merged, it's published as a new version, like any direct change. Most changes are simpler as a suggestion on Suggest Edits, where the maintainers decide on them.

## Style

- One rule per bullet, written to the agent, in plain English.
- Keep it general. Don't assume a folder layout, file names, or a particular dataset unless the rule says so explicitly ("If the project uses…").
- Keep it short: agents follow a page of specific rules better than ten pages of general ones.
- Add no facts from memory. Check anything you add against its source.
- Plain Markdown, one rule or paragraph per line, no raw HTML.
- Line 3, the version line, is written automatically.

## Versions

Each published version is a frozen snapshot with a permanent link and a fingerprint. Suggest Edits always shows the newest version.

- **0.0.x: comment drafts.** Nothing is final. Each adopted suggestion adds one to the last number.
- **1.0.0** will be the first version the contributors are ready to recommend as a standard. A maintainer publishes it.
- **After 1.0**, each adopted suggestion adds one to the middle number (1.1.0, 1.2.0, ...), and a maintainer decides when a change is big enough for a new first number (2.0.0).

## Maintainers

- **Maintainers and rules** are in `governance/maintainers.json`. To add a maintainer, add their name, role, the email address they'll sign in with on Suggest Edits, and any GitHub and Hypothesis usernames they'll vote with. Changes take effect at the robot's next run.
- **Sign-in and the database** are a free Supabase project; [supabase/README.md](supabase/README.md) sets it up.
- **The robot** runs after every vote and every ten minutes (Supabase starts it; GitHub's schedule is a backup). Its runs are on GitHub under Actions, then Proposals. To run it now, choose **Run workflow** there; tick "Only say what would happen" for a dry run. On your own computer: `python3 scripts/proposals.py --dry-run`.
- **If it needs a person**, the robot opens an issue that mentions the lead maintainer: when the database stops answering, or when Supabase stops starting it. It closes the issue itself once that's fixed.
- **Tests:** `python3 -m unittest discover -s scripts/tests -t scripts/tests`. They also run before every robot run.
- **A version that doesn't come from a proposal**, such as 1.0.0: `python3 scripts/release.py 1.0.0 "One-line summary"`, then the commit, tag, and push commands it prints.
- **GitHub's 60-day rule:** GitHub switches off a public repository's schedules after 60 days without activity. The robot re-enables its own daily and makes an empty commit after a month with no others. If it's ever off anyway, turn it back on under Actions, then Proposals.
