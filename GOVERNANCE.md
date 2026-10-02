# How AGENTS.md changes

*AGENTS.md for Empirical Legal Scholars* grows out of comments from the people who use it. Anyone can comment and propose a change; the maintainers approve or disapprove each proposal; and an approved change is published right away as a new, numbered version with a fingerprint. As in the Linux kernel's process, anyone can send a change, designated people decide whether it goes in, and every change is attributed and kept. Unlike that process, readers don't need to code or use GitHub: everything they do happens in the comments on the Drafter.

## Who does what

- **Readers** comment on the text in the [Drafter](https://nathanreitinger.github.io/els-agent-practices/draft/), and can propose changes there. They can't change the text themselves. Comments use [Hypothesis](https://web.hypothes.is/start), which needs a free account; no GitHub account is needed.
- **Maintainers** approve or disapprove proposals on the site's [Maintainers](https://nathanreitinger.github.io/els-agent-practices/maintainers/) page, and can make changes themselves by proposing and approving them. They're listed there and in [governance/maintainers.json](governance/maintainers.json).
- **The lead maintainer** keeps the list of maintainers and the rules, looks after the site, and can also edit the text directly. Today that's Nathan Reitinger.

## Proposing a change

Select the words you want to change in the Drafter, choose **Annotate**, and start your note with one of these:

| Start your note with | What happens |
|---|---|
| `Delete` | The selected words are struck out. Select a whole rule to remove it. |
| `Replace with:` and the new words | The new words take the place of the selected ones. |
| `Add after:` and the new words | The new words are added right after the selected ones. |
| `Add rule:` and a new rule | A new rule is added below the one you selected in. |

Add a line that starts with `Why:` to give your reason. A note that starts any other way is an ordinary comment. Keep each proposal to one change: select words within one rule, or whole rules.

Each proposal is checked against the current text. If it can't be applied exactly (for example, because an earlier change altered its words, or because the selection cuts through bold text), it's closed with an explanation, and you can propose it again. If only the wording of your note needs fixing, edit the note.

## Deciding

- A maintainer signs in on the [Maintainers](https://nathanreitinger.github.io/els-agent-practices/maintainers/) page with a key from GitHub (a personal access token; the page explains how to make one). The key stays in that browser and is sent only to GitHub.
- Each waiting proposal has **Approve** and **Disapprove** buttons. A vote is posted on the proposal's GitHub issue under the maintainer's name, and the robot acts on it, usually within a minute or two.
- Maintainers can also vote without the page: reply **Approve** or **Reject** to the proposal in the Drafter, or comment `/approve` or `/reject` on its GitHub issue (replying to GitHub's notification email works too).
- Only a maintainer's latest vote counts. A vote cast before the proposal was last edited doesn't count, so a proposal can't be changed after it's approved.
- Readers can reply Approve too. Their support is shown, but it doesn't decide anything.

## The rules for a decision

- **Adopted:** at least one maintainer approves, and more maintainers approve than disapprove.
- **Disapproved:** at least one maintainer disapproves, and more maintainers disapprove than approve.
- Otherwise the proposal keeps waiting.
- Maintainers may approve their own proposals.

These rules are set in [governance/maintainers.json](governance/maintainers.json): `approvals_needed` (now 1), `maintainers_may_approve_their_own_proposals` (now yes), and `hours_open_before_adoption`, a waiting period before adoption (now 0). Changing them is the lead maintainer's decision, and the change is kept in the history like everything else. Proposals count from the time in `proposals_count_from`; comments written before then are ordinary comments unless they're edited afterward.

## When a proposal is approved

The robot, `scripts/proposals.py`, which `.github/workflows/proposals.yml` runs:

1. makes the change in the text;
2. publishes it as the next version (0.0.3, 0.0.4, and so on), one version for each adopted proposal;
3. stamps line 3 of the file with the version number, the date, and the fingerprint;
4. records who proposed it, who approved it, and why, in [CHANGELOG.md](CHANGELOG.md), in the version's git commit and tag, and in [governance/proposals.json](governance/proposals.json);
5. closes the proposal's GitHub issue with the outcome.

The site shows the new version within a few minutes.

## When a proposal is disapproved

It leaves the Drafter's list of proposals and moves to the [Declined](https://nathanreitinger.github.io/els-agent-practices/declined/) page, with the name of the maintainer who disapproved it. Its GitHub issue is closed. Proposals that are withdrawn or can't be applied go there too. The comment itself belongs to the person who wrote it, so it can still appear in the Drafter's comment sidebar.

## Fingerprints

Every version has a fingerprint: the Argon2id hash ([RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)) of its file without line 3, the version line, which states the fingerprint. Changing a single character anywhere else changes the fingerprint. The settings are fixed and public, so anyone gets the same result: the salt `AGENTS.md-ELS-v1`, 3 passes, 4 lanes, 64 MiB of memory, and a 32-byte result (RFC 9106's second recommended settings). Anyone can check a copy on the site's [Check a copy](https://nathanreitinger.github.io/els-agent-practices/check/) page, or in a terminal on a Mac or Linux, after installing the package once with `python3 -m pip install argon2-cffi`:

    tr -d '\r' < AGENTS.md | sed 3d | python3 -c "import sys; from argon2.low_level import hash_secret_raw, Type; print(hash_secret_raw(sys.stdin.buffer.read(), b'AGENTS.md-ELS-v1', 3, 65536, 4, 32, Type.ID).hex())"

Each fingerprint is recorded in the file itself, in [versions.json](versions.json), in the change log, and in the version's git tag. The robot refuses to run if any published version no longer matches its fingerprint. Versions 0.0.0 to 0.0.2 came before fingerprints; theirs were computed afterward from the frozen files.

## Records, and undoing a change

- Nothing is deleted. Proposals and votes stay in Hypothesis, on GitHub, and in governance/proposals.json. Every version stays at its permanent link, and the git history can't be rewritten.
- To undo an adopted change, propose the reverse change. The lead maintainer can also restore earlier text directly, which is published as a new version too.

## Becoming a maintainer

- The lead maintainer adds maintainers: typically people who have contributed comments or proposals and who agree to these rules. To become one, ask the lead maintainer, for example in the community's Google group, [agentselsmd](https://nathanreitinger.github.io/els-agent-practices/join/), in a comment in the Drafter, or in an issue on GitHub.
- Each maintainer is listed with the GitHub and Hypothesis usernames they vote with. The list is public, and every change to it is kept in the history.
- The lead maintainer can list accounts to ignore, such as spam, under `ignored_accounts` in governance/maintainers.json.

## Changes made directly

The lead maintainer can change the text directly in the repository, for example to restructure it. A direct change is published as a new version like any other, and the change log says who made it. Version 1.0.0, the first version recommended as a standard, will be published by the lead maintainer.
