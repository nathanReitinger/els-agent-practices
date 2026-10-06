# Setting up sign-in for Suggest Edits

Suggest Edits keeps everyone's suggestions and votes in a free [Supabase](https://supabase.com) project. Readers sign in with a code that Supabase emails them, and their email address is their name on the site. This is a one-time setup for the lead maintainer; it takes about fifteen minutes.

Nothing secret goes into this repository. The two values the site needs, the project's address and its publishable key, are public by design: the key lets visitors do only what [schema.sql](schema.sql) allows (read everything; change only their own suggestions and votes). The email account's password goes only into Supabase's settings.

## 1. Create the project

1. Sign in at [supabase.com](https://supabase.com/dashboard) and choose **New project**. The free plan is enough.
2. Name it (for example, `els-agent-practices`), choose a strong database password (you won't need it again for this), and pick a region near most readers.

## 2. Create the tables

1. Open the project's **SQL Editor**, and choose **New query**.
2. Paste the whole of [schema.sql](schema.sql), and choose **Run**. It should say "Success. No rows returned."

Running it again is safe: it adds what's new and leaves the rest as it is. Once step 7 is done, you never need to run it again: the database runs each new version of it by itself.

## 3. Send the codes from your own email account

Supabase's built-in email sends only to the project's own team, two messages an hour, so readers need your account instead.

1. Open the project's [SMTP settings](https://supabase.com/dashboard/project/_/auth/smtp) (Authentication, then Emails, then SMTP Settings) and switch on **Enable custom SMTP**.
2. For a Gmail account, fill in:
   - **Sender email:** the Gmail address
   - **Sender name:** `AGENTS.md for Empirical Legal Scholars`
   - **Host:** `smtp.gmail.com`
   - **Port:** `587`
   - **Username:** the Gmail address
   - **Password:** an [app password](https://myaccount.google.com/apppasswords) for that account (Google offers these once 2-Step Verification is on). Never put it in this repository or on the site.
3. Save. Supabase then allows 30 emails an hour; you can raise that under [Rate Limits](https://supabase.com/dashboard/project/_/auth/rate-limits).

## 4. Send a code, not a link

By default Supabase emails a sign-in link. The site asks for the code instead.

1. Open the [email templates](https://supabase.com/dashboard/project/_/auth/templates).
2. In **Magic link or OTP**, set the subject to `Your sign-in code for AGENTS.md for Empirical Legal Scholars` and replace the message with:

   ```html
   <p>Enter this code on the Suggest Edits page to verify your email address and start editing:</p>
   <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px">{{ .Token }}</p>
   <p>It works once, within an hour. If you didn't ask for it, you can ignore this email.</p>
   ```

3. Do the same in **Confirm sign up**, which Supabase sends the first time someone signs in.

## 5. Connect the site

On the project's home page, choose **Connect** (or open Project Settings, then API Keys), and copy:

- the **Project URL**, which looks like `https://abcdefghijklmnop.supabase.co`, and
- the **publishable key** (it starts with `sb_publishable_`), or, in older projects, the `anon` `public` key.

Put both in `versions.json`, under `"supabase"`:

```json
"supabase": {
  "url": "https://abcdefghijklmnop.supabase.co",
  "key": "sb_publishable_..."
}
```

Commit and push. Within a few minutes, Suggest Edits asks visitors to verify an email address, and the robot starts reading suggestions and votes at its next run.

## 6. Make yourself a maintainer

A maintainer's votes count when they sign in with the email address listed for them in [governance/maintainers.json](../governance/maintainers.json) (`"email"`). Sign in once on Suggest Edits with that address: the bar says "maintainer" next to your name, and every suggestion gets **Approve** and **Disapprove** buttons.

To add other maintainers, open the site's **Maintainers** page while signed in as the lead maintainer: give their name and the email address they'll sign in with, and choose **Add**. The robot adds them to governance/maintainers.json within a few minutes, and their votes count from then. **Remove**, beside a maintainer's name, takes them off the list the same way.

## 7. Let Supabase start the robot

The robot publishes approved changes. GitHub runs it on a schedule, but GitHub runs scheduled jobs late, or skips them, when it's busy. So Supabase starts it too: within a minute of every vote, and every ten minutes, for as long as the project exists. For that, Supabase needs a GitHub token that can do one thing: start this repository's workflows.

1. [Create the token](https://github.com/settings/personal-access-tokens/new?name=Start+the+ELS+robot&description=Lets+Supabase+start+the+proposals+robot+%28supabase%2Frobot.sql%29&target_name=nathanReitinger&expires_in=none&actions=write) on GitHub. The link fills in its name, "No expiration," and its one permission (Actions: read and write). Under **Repository access**, choose **Only select repositories** and pick **els-agent-practices**. Then choose **Generate token** and copy it. Don't put it anywhere else.
2. In the project's **SQL Editor**, choose **New query**, paste the whole of [robot.sql](robot.sql), and choose **Run**.
3. In another new query, run this, with your token between the quotes:

   ```sql
   select robot.set_token('github_pat_...');
   ```

   It answers "Saved." The token is kept encrypted in Supabase's Vault. To replace it later, run the same line with the new token.

Within ten minutes, GitHub's list of the robot's runs (the repository's **Actions** tab, then **Proposals**) shows runs started by "workflow_dispatch." Then set `"starts_robot": true` under `"supabase"` in versions.json, so the robot reports it if these starts ever stop.

robot.sql also keeps the database up to date by itself. Every ten minutes Supabase fetches [schema.sql](schema.sql) and robot.sql from GitHub and runs whichever has changed since it last ran it, schema.sql first. So a change to either file reaches the database within about ten minutes, and nobody has to paste it again. Each file runs all or nothing: if one fails, the database keeps its previous version, and the robot opens an issue with the error. Because whatever these two files say on GitHub runs with the database owner's rights, review changes to them as carefully as changes to the robot.

## 8. Turn on the AI check of new rules (optional)

When someone adds a rule or a section on Suggest Edits, or changes what a rule says, the page checks whether the change repeats or contradicts another rule. Without this step, it compares words. With it, an AI model (Anthropic's Claude Opus 5.5) reads the rule as published and as changed, with the whole file and the other open suggestions, and judges what the change means: moving words around, rephrasing, or narrowing a rule isn't flagged, and a contradiction in different words is. The person making the change sees what it found, with the model's reasons, and decides whether to keep the change; the maintainers see the same note on the suggestion. The database fetches the published AGENTS.md from GitHub itself every ten minutes and checks against that copy, and it writes each answer onto the suggestion it's about, so nobody can have a made-up file checked or put a made-up answer on a suggestion. Moving words within a rule, fixing a typo, or changing one word (unless it's one like "never," "only," or a number) isn't sent at all.

Each check is billed to the Anthropic account whose key you use. With the file at its current length, a check costs roughly 5 to 30 cents at Anthropic's [prices](https://platform.claude.com/docs/en/about-claude/pricing) when this was written ($4 per million input tokens and $20 per million output tokens for Claude Opus 5.5), more when the model thinks longer; the Console's Usage page shows the actual cost. To keep it down, the same question is never sent twice, each person can ask 10 times an hour and 25 times a day, and everyone together 80 times a day. Past those limits, the page uses its word check. Anyone who verifies an email address can use the check, so set a monthly spend limit for the key's account (step 1).

1. Sign in to the [Claude Console](https://platform.claude.com/), create an API key, and copy it. Set a monthly spend limit for the account under [Settings > Billing](https://platform.claude.com/settings/billing) (the check stops working, and the page uses its word check, once it's reached).
2. In the project's **SQL Editor**, in a new query, run this, with the key between the quotes:

   ```sql
   select robot.set_anthropic_key('sk-ant-...');
   ```

   It answers "Saved." The key is kept encrypted in Supabase's Vault, like the GitHub token: don't put it anywhere else. To replace it, run the same line with the new key. To turn the check off, run `select robot.set_anthropic_key('off');`.

The model, how hard it thinks, and the instructions it follows are in robot.sql (`robot.rule_check_body`); the limits are in `public.start_rule_check`.

## 9. Email the maintainers about new suggestions and comments (optional)

With this step, each maintainer gets an email when someone suggests a change or comments on Suggest Edits: who wrote what, and a link straight to it on the page. A maintainer gets at most one email an hour, listing everything new since their last one; on the site's Maintainers page, each maintainer can choose at most one a day instead, or none. A suggestion is sent once nobody has changed it for ten minutes, so half-typed ones aren't. If it's changed after the maintainers heard about it, they hear again, and a maintainer whose vote was on the earlier wording is told that it no longer counts. Nobody is sent what they wrote themselves, or anything from an account in `ignored_accounts`.

The database writes the emails ([robot.sql](robot.sql)), and a small Supabase Edge Function, [functions/email-maintainers/index.ts](functions/email-maintainers/index.ts), sends them from a Gmail account (or any email account whose SMTP server takes TLS on port 465). The function takes no message from whoever calls it. The database gives it a one-time key, and with that key it collects the emails waiting in the database, so nobody can use it to send anything else.

Send them from a Gmail account that isn't any maintainer's own address. Gmail never puts mail an account sends to itself in that account's inbox, only in its Sent folder, so a maintainer whose address sends the emails wouldn't see theirs. If the sign-in codes come from a separate account, use that one; otherwise make a free Gmail account for the project.

1. **An app password.** Signed in to Google as the sending account, turn on [2-Step Verification](https://myaccount.google.com/signinoptions/twosv) if it isn't on, then open [App passwords](https://myaccount.google.com/apppasswords), name one `Supabase emails to the maintainers`, choose **Create**, and copy the 16 letters it shows (spaces and all is fine). A separate one from the sign-in codes' lets you replace either without the other.
2. **The secrets.** Open the project's [Edge Function secrets](https://supabase.com/dashboard/project/_/functions/secrets). Add a secret with **Key** `SMTP_USER` and **Value** the sending Gmail address, and another with **Key** `SMTP_PASSWORD` and **Value** the app password, then choose **Save**. (For an account that isn't Gmail, add `SMTP_HOST` too, and `SMTP_PORT` if it isn't 465: Supabase doesn't let functions use ports 25 or 587, so the port must be one that uses TLS from the start.) Never put the password in this repository.
3. **The function.** Open the project's [Edge Functions](https://supabase.com/dashboard/project/_/functions), choose **Deploy a new function**, then **Via Editor**. Delete everything in the editor. Open [the function's code](https://raw.githubusercontent.com/nathanReitinger/els-agent-practices/main/supabase/functions/email-maintainers/index.ts), select all of it, copy it, and paste it into the editor. Set the function's name to exactly `email-maintainers`, and choose **Deploy function**.
4. **Calls without a sign-in.** On the function's page, open the **Details** tab, turn off **Verify JWT with legacy secret** (older dashboards call it **Enforce JWT Verification**), and save. The database calls the function without anyone's sign-in, and the function checks each call itself. Supabase can turn this back on when the function is deployed again, so check it after any redeploy.
5. **On.** In the **SQL Editor**, in a new query, run:

   ```sql
   select robot.set_mail('on');
   ```

   It answers "On." Within a minute or two each maintainer gets an email titled "AGENTS.md for Empirical Legal Scholars: emails to the maintainers are on." Look in Spam (and Gmail's Updates tab) if it isn't in the inbox.

If it doesn't come, run `select public.mail_status();` in a new query. `call_status` 404 means the function isn't there under that name (step 3); 401, that step 4 isn't done; a `call_error` about `SMTP_USER` means the secrets are missing (step 2); a `last_error` with `535` means Gmail refused the address and app password (steps 1 and 2); `sent_today` above 0 means it went out, so look in Spam, or, if it went to the sending account's own address, in Sent. Whatever's wrong, the robot also opens a GitHub issue about it within an hour or so.

To turn the emails off, run `select robot.set_mail('off');`. A Gmail account can send about 500 emails a day, so these stop at 100 a day; anything new then waits for the next email. Unlike the two SQL files, the function doesn't update itself: if a newer index.ts is ever committed, deploy it again (step 3, choosing the function and replacing its code), then check step 4. The robot opens an issue if the database expects a newer version than the one deployed.

## If something stops working

The robot watches for five problems it can't fix itself. For each, it opens a GitHub issue that mentions the lead maintainer, so GitHub emails them, and it closes the issue by itself once things work again:

- **"The Suggest Edits database isn't answering."** Usually Supabase paused the project. Restore it from the dashboard.
- **"Supabase isn't starting the robot."** Usually the token was deleted. The issue says how to make a new one.
- **"The database hasn't taken the latest supabase/ files."** Either a new version of schema.sql or robot.sql failed to run (the issue quotes the error; fix the file on GitHub, and the database tries again within ten minutes), or the database doesn't update itself (run robot.sql in the SQL Editor once more).
- **"The AI check of new rules needs attention."** Its checks keep failing (usually the key's account is out of credit, or the key was deleted), it reached its daily limit, or the database hasn't been able to fetch the published AGENTS.md from GitHub. Meanwhile the page uses its word check. The issue says what to do.
- **"The emails to the maintainers aren't going out."** The function that sends them isn't there, Supabase turns away the database's calls to it (JWT verification is on), or sending keeps failing (usually the app password was revoked, or the account reached its daily limit). Meanwhile the emails wait, for a few hours at most, and everything is still on the site. The issue says what to do.

One problem the robot can't see, because the sign-in codes go out from Supabase's own email settings: if Suggest Edits says **"The email couldn't be sent,"** open the project's [Auth logs](https://supabase.com/dashboard/project/_/logs/auth-logs) and find the error at that time.

- **"535 5.7.8 Username and Password not accepted"** means Gmail refused the login in the [SMTP settings](https://supabase.com/dashboard/project/_/auth/smtp). The username, password, and sender email must all belong to one Gmail account, and the password must be a current [app password](https://myaccount.google.com/apppasswords) for it, typed without spaces. Changing that account's password, or turning off its 2-Step Verification, cancels its app passwords: make a new one, and save it in Supabase again. (Supabase hides the saved password, so retype it whenever you save that form.)
- **An email with a link instead of a code** means the template for that email (first-time addresses get **Confirm sign up**; returning ones get **Magic link or OTP**) is missing `{{ .Token }}`.

The robot also keeps GitHub from switching off its schedule: GitHub does that after 60 days with no activity in a public repository, so after a month with no commits, the robot makes an empty one ("Robot: still running").

## Good to know

- **Free projects pause after a week without use.** The robot reads the database every time it runs, which counts as use. If the project is ever paused, restore it from the Supabase dashboard; nothing is lost.
- **Who can see what.** Suggestions, votes, comments, and highlights are public, with the email address of the person who made them, as the site says when someone signs in. With step 9, the maintainers also get suggestions and comments by email, with the same address. Readers' sign-ins are in the project's Authentication page, which only you can see.
- **Removing someone's suggestions.** Add their email address to `ignored_accounts.site` in governance/maintainers.json: the robot then ignores everything from it, its open suggestions are withdrawn, and the site hides its comments and highlights.
