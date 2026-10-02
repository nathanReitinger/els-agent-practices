# How AGENTS.md changes

*AGENTS.md for Empirical Legal Scholars* grows out of proposals from the people who use it. Anyone can propose a change, members vote on it, and an approved change is published right away as a new, numbered version with a fingerprint. As in the Linux kernel's process, anyone can send a change, designated people decide whether it goes in, and every change is attributed and kept. Unlike that process, no one needs to code or use GitHub: everything happens in the comments on the Drafter.

## Who does what

- **Anyone** can comment on the text and propose changes in the [Drafter](https://nathanreitinger.github.io/els-agent-practices/draft/). Comments use [Hypothesis](https://web.hypothes.is/start), which needs a free account. No GitHub account is needed.
- **Members** vote on proposals. They're listed in [governance/members.json](governance/members.json) and on the Drafter page.
- **Maintainers** keep the members list and the rules, look after the site, and can change the text directly (for example, to restructure it). Today the maintainer is Nathan Reitinger.

## Proposing a change

Select the words you want to change in the Drafter, choose **Annotate**, and start your note with one of these:

| Start your note with | What happens |
|---|---|
| `Delete` | The selected words are struck out. Select a whole rule to remove it. |
| `Replace with:` and the new words | The new words take the place of the selected ones. |
| `Add after:` and the new words | The new words are added right after the selected ones. |
| `Add rule:` and a new rule | A new rule is added below the one you selected in. |

Add a line that starts with `Why:` to give your reason. A note that starts any other way is an ordinary comment. Keep each proposal to one change: select words within one rule, or whole rules.

Each proposal is checked against the current text. If it can't be applied exactly (for example, because an earlier proposal changed its words, or because the selection cuts through bold text), it's closed with an explanation, and you can propose it again. If only the wording of your note needs fixing, edit the note.

## Voting

- A member votes by replying **Approve** or **Reject** to the proposal in the Drafter (the reply must start with that word), or by commenting `/approve` or `/reject` on the proposal's GitHub issue. Replying to GitHub's notification email works too.
- Only a member's latest vote counts.
- A vote cast before the proposal was last edited doesn't count, so a proposal can't be changed after it's approved.
- Readers who aren't members can reply Approve too. Their support is shown, but it doesn't decide anything.

## Decisions

- **Adopted:** at least one member approves, and more members approve than reject.
- **Declined:** at least one member rejects, and more members reject than approve.
- Otherwise the proposal stays open.
- Members may approve their own proposals.

These rules are set in [governance/members.json](governance/members.json): `approvals_needed` (now 1), `members_may_approve_their_own_proposals` (now yes), and `hours_open_before_adoption`, a waiting period before adoption (now 0). Changing them is a maintainer's decision, and the change is kept in the history like everything else. Proposals count from the time in `proposals_count_from`; comments written before then are ordinary comments unless they're edited afterward.

## When a proposal is adopted

Within about 15 minutes of the deciding vote (a vote on GitHub is counted within a minute or two), the robot, `scripts/proposals.py`, which `.github/workflows/proposals.yml` runs:

1. makes the change in the text;
2. publishes it as the next version (0.0.3, 0.0.4, and so on), one version for each adopted proposal;
3. stamps line 3 of the file with the version number, the date, and the fingerprint;
4. records who proposed it, who approved it, and why, in [CHANGELOG.md](CHANGELOG.md), in the version's git commit and tag, and in [governance/proposals.json](governance/proposals.json);
5. closes the proposal's GitHub issue with the outcome.

The site shows the new version within a few minutes.

## Fingerprints

Every version has a fingerprint: the SHA-256 hash of its file without line 3, the version line, which states the fingerprint. Changing a single character anywhere else changes the fingerprint. Anyone can check a copy on the site's [Check a copy](https://nathanreitinger.github.io/els-agent-practices/check/) page, or in a terminal on a Mac or Linux:

    tr -d '\r' < AGENTS.md | sed 3d | shasum -a 256

Each fingerprint is recorded in the file itself, in [versions.json](versions.json), in the change log, and in the version's git tag. The robot refuses to run if any published version no longer matches its fingerprint. Versions 0.0.0 to 0.0.2 came before fingerprints; theirs were computed afterward from the frozen files.

## Records, and undoing a change

- Nothing is deleted. Proposals and votes stay in Hypothesis, on GitHub, and in governance/proposals.json. Every version stays at its permanent link, and the git history can't be rewritten.
- To undo an adopted change, propose the reverse change. A maintainer can also restore earlier text directly, which is published as a new version too.

## Members

- Maintainers add members: typically people who have contributed proposals or comments and who agree to these rules. To become a member, ask a maintainer, for example in the community's Google group, [agentselsmd](https://nathanreitinger.github.io/els-agent-practices/join/), in a comment in the Drafter, or in an issue on GitHub.
- Each member is listed with the Hypothesis and GitHub usernames they vote with. The list is public, and every change to it is kept in the history.
- Maintainers can list accounts to ignore, such as spam, under `ignored_accounts` in governance/members.json.

## Changes made directly

Maintainers can change the text directly in the repository, for example to restructure it. A direct change is published as a new version like any other, and the change log says who made it. Version 1.0.0, the first version recommended as a standard, will be published by a maintainer.
