# How AGENTS.md changes

*AGENTS.md for Empirical Legal Scholars* grows out of comments from the people who use it. Anyone can suggest a change; the maintainers approve or disapprove each suggestion; and an approved change is published right away as a new, numbered version with a fingerprint. As in the Linux kernel's process, anyone can send a change, designated people decide whether it goes in, and every change is attributed and kept. Unlike that process, readers don't need to code or use GitHub: everything they do happens on the [Suggest Edits](https://nathanreitinger.github.io/els-agent-practices/draft/) page.

## Who does what

- **Readers** suggest changes on [Suggest Edits](https://nathanreitinger.github.io/els-agent-practices/draft/), signed in with their email address, and can comment there too. They can't change the text themselves. No GitHub account is needed.
- **Maintainers** approve or disapprove suggestions on Suggest Edits, signed in with the email address listed for them in [governance/maintainers.json](governance/maintainers.json). They make changes themselves by suggesting and approving them. They're listed on the site's [Maintainers](https://nathanreitinger.github.io/els-agent-practices/maintainers/) page.
- **The lead maintainer** keeps the list of maintainers and the rules, looks after the site, and can also edit the text directly. Today that's Nathan Reitinger.

## Suggesting a change

On Suggest Edits, edit the text directly, as in a shared document with track changes on:

- Select words and press Delete to strike them out; they stay visible, struck through, until a maintainer decides.
- Type to add words; they appear in blue, labeled with your email address.
- To add a new rule, put the cursor at the end of a rule and press Enter.

To save your changes, sign in with your email address: the site emails you a 6-digit code to type in. Your email address is your name on the site: it's shown with your suggestions, and it's recorded with every change that's adopted. Each change you make is saved as one suggestion as you make it, so maintainers can approve some and disapprove others. Change it again, and the suggestion is updated; undo it, and it's withdrawn. Changes you make before signing in stay in your browser and are saved once you sign in. You can add a reason to each suggestion in the list below the text.

Everyone sees everyone's suggestions in the text: your own in blue, other people's in orange, each with the suggester's email address. Clicking one shows the details. Readers' suggestions and votes are kept in the site's database (see [supabase/README.md](supabase/README.md)), which anyone can read.

### Or, in a comment

Choose **Commenting** above the text, select the words you want to change, choose **Annotate**, and start your comment with one of these. Comments use a free [Hypothesis](https://web.hypothes.is/start) account.

| Start your note with | What happens |
|---|---|
| `Delete` | The selected words are struck out. Select a whole rule to remove it. |
| `Replace with:` and the new words | The new words take the place of the selected ones. |
| `Add after:` and the new words | The new words are added right after the selected ones. |
| `Add rule:` and a new rule | A new rule is added below the one you selected in. |

Add a line that starts with `Why:` to give your reason. A note that starts any other way is an ordinary comment. Keep each proposal to one change: select words within one rule, or whole rules.

Each suggestion and proposal is checked against the current text. If it can't be applied exactly (for example, because an earlier change altered its words), it's closed with an explanation, and you can suggest it again.

## Deciding

- A maintainer signs in on Suggest Edits with their listed email address. Each waiting suggestion then has **Approve** and **Disapprove** buttons: click the suggestion in the text, or use the list below it. The robot acts on the vote at its next check, every five minutes (GitHub sometimes runs it late).
- Maintainers can also vote on a suggestion's GitHub issue: comment `/approve` or `/reject` (replying to GitHub's notification email works too). For a proposal made in a comment, they can also reply **Approve** or **Reject** to that comment.
- Only a maintainer's latest vote counts. A vote cast before the suggestion was last changed doesn't count, so a suggestion can't be changed after it's approved.
- Readers can approve too. Their support is shown, but it doesn't decide anything.

## The rules for a decision

- **Adopted:** at least one maintainer approves, and more maintainers approve than disapprove.
- **Disapproved:** at least one maintainer disapproves, and more maintainers disapprove than approve.
- Otherwise the proposal keeps waiting.
- Maintainers may approve their own proposals.

These rules are set in [governance/maintainers.json](governance/maintainers.json): `approvals_needed` (now 1), `maintainers_may_approve_their_own_proposals` (now yes), and `hours_open_before_adoption`, a waiting period before adoption (now 0). Changing them is the lead maintainer's decision, and the change is kept in the history like everything else. Proposals count from the time in `proposals_count_from`; comments written before then are ordinary comments unless they're edited afterward.

## When a suggestion is approved

The robot, `scripts/proposals.py`, which `.github/workflows/proposals.yml` runs every five minutes:

1. makes the change in the text;
2. publishes it as the next version (0.0.3, 0.0.4, and so on), one version for each adopted proposal;
3. stamps line 3 of the file with the version number, the date, and the fingerprint;
4. records who suggested it, who approved it, and why, in [CHANGELOG.md](CHANGELOG.md), in the version's git commit and tag, and in [governance/proposals.json](governance/proposals.json); a suggestion's commit is in the suggester's name;
5. closes the suggestion's GitHub issue with the outcome. (Each suggestion gets an issue, so people watching the repository get an email, once it has been left unchanged for ten minutes.)

The site shows the new version within a few minutes.

## When a suggestion is disapproved

It leaves the text and the list on Suggest Edits, and moves to the [Declined](https://nathanreitinger.github.io/els-agent-practices/declined/) page, with the name of the maintainer who disapproved it. Its GitHub issue is closed. Suggestions that are withdrawn or can't be applied go there too. A proposal made in a comment belongs to the person who wrote it, so the comment can still appear in the comment sidebar.

## Fingerprints

Every version has a fingerprint: the Argon2id hash ([RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html)) of its file without line 3, the version line, which states the fingerprint. Changing a single character anywhere else changes the fingerprint. The settings are fixed and public, so anyone gets the same result: the salt `AGENTS.md-ELS-v1`, 3 passes, 4 lanes, 64 MiB of memory, and a 32-byte result (RFC 9106's second recommended settings). Anyone can check a copy on the site's [Check a copy](https://nathanreitinger.github.io/els-agent-practices/check/) page, or in a terminal on a Mac or Linux, after installing the package once with `python3 -m pip install argon2-cffi`:

    tr -d '\r' < AGENTS.md | sed 3d | python3 -c "import sys; from argon2.low_level import hash_secret_raw, Type; print(hash_secret_raw(sys.stdin.buffer.read(), b'AGENTS.md-ELS-v1', 3, 65536, 4, 32, Type.ID).hex())"

Each fingerprint is recorded in the file itself, in [versions.json](versions.json), in the change log, and in the version's git tag. The robot refuses to run if any published version no longer matches its fingerprint. Versions 0.0.0 to 0.0.2 came before fingerprints; theirs were computed afterward from the frozen files.

## Records, and undoing a change

- Nothing is deleted. Suggestions and votes stay in the site's database, in Hypothesis, on GitHub, and in governance/proposals.json. Every version stays at its permanent link, and the git history can't be rewritten.
- To undo an adopted change, suggest the reverse change. The lead maintainer can also restore earlier text directly, which is published as a new version too.

## Becoming a maintainer

- The lead maintainer adds maintainers: typically people who have contributed suggestions or comments and who agree to these rules. To become one, ask the lead maintainer, for example in the community's Google group, [agentselsmd](https://nathanreitinger.github.io/els-agent-practices/join/), in a comment on Suggest Edits, or in an issue on GitHub.
- Each maintainer is listed with the email address they sign in with, and the GitHub and Hypothesis usernames they vote with. The list is public, and every change to it is kept in the history.
- The lead maintainer can list accounts to ignore, such as spam, under `ignored_accounts` in governance/maintainers.json: email addresses under `site`, and usernames under `hypothesis` and `github`.

## Changes made directly

The lead maintainer can change the text directly in the repository, for example to restructure it. A direct change is published as a new version like any other, and the change log says who made it. Version 1.0.0, the first version recommended as a standard, will be published by the lead maintainer.
