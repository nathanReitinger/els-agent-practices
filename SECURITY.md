# Security

## Reporting a problem

If you find a security problem in this site, its database, or the robot that publishes versions, please tell the lead maintainer privately rather than in a public issue: use **Report a vulnerability** on the repository's Security tab if it's there, or email the lead maintainer at the address listed in [governance/maintainers.json](governance/maintainers.json). Include enough detail to reproduce it. You'll get an answer, and credit once it's fixed if you'd like it.

## What's protected, and how

- **The text.** Only maintainers' votes publish a change, and every published version has a fingerprint (an Argon2id hash); the robot stops if a published file no longer matches its fingerprint. New words that a reader couldn't see on the page but an AI agent reading the file would (invisible characters, HTML, images, link definitions, link titles) are refused, by the robot and by the database.
- **Votes.** A vote counts only from a listed maintainer, only if cast after they became one, and only for the version of the suggestion they saw: after an edit, the robot shows the new version on the suggestion's GitHub issue, and earlier votes don't count.
- **Maintainers.** Only a lead maintainer can add or remove maintainers on the site, and every change is announced to the lead maintainers in a GitHub issue that mentions them.
- **The database.** Anyone can read suggestions, votes, and comments; each signed-in reader can write only their own, within daily limits. The GitHub token and the Anthropic key are kept only in Supabase's Vault, never in this repository. The AI check runs on the database's own copy of the published file, and only the database writes its answers.
- **The pages.** A Content-Security-Policy limits what the pages load and connect to; readers' text is always shown as text; Markdown is sanitized with a strict allowlist; the libraries are pinned, with integrity hashes.
- **The robot.** Its workflow's actions are pinned to commits, its one Python dependency is installed by hash, and it trusts only the issues it opened itself.
- **Emails to the maintainers.** The email account's app password is a secret of the Supabase Edge Function that sends them (supabase/functions/email-maintainers), never in this repository. The function sends only what the database wrote for the maintainers, collected with a one-time key from the database, so nobody can use it to send anything else. Readers' words go out as plain text on single lines, cut to length, with no way to add a header or a recipient; each maintainer gets at most one email an hour, and all of them together at most 100 a day.

## Worth knowing

- The email address a reader signs in with is public, and it stays in the git history, which is never rewritten. The emails to the maintainers show it too, beside what that reader suggested or wrote.
- Whoever can push to this repository's main branch can change what runs in the database: supabase/schema.sql and supabase/robot.sql run there with the database owner's rights. Keep two-factor authentication on, and give write access only to people you'd trust with the database.
