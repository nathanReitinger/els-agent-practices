# Setting up sign-in for Suggest Edits

Suggest Edits keeps everyone's suggestions and votes in a free [Supabase](https://supabase.com) project. Readers sign in with a 6-digit code that Supabase emails them, and their email address is their name on the site. This is a one-time setup for the lead maintainer; it takes about fifteen minutes.

Nothing secret goes into this repository. The two values the site needs, the project's address and its publishable key, are public by design: the key lets visitors do only what [schema.sql](schema.sql) allows (read everything; change only their own suggestions and votes). The email account's password goes only into Supabase's settings.

## 1. Create the project

1. Sign in at [supabase.com](https://supabase.com/dashboard) and choose **New project**. The free plan is enough.
2. Name it (for example, `els-agent-practices`), choose a strong database password (you won't need it again for this), and pick a region near most readers.

## 2. Create the tables

1. Open the project's **SQL Editor**, and choose **New query**.
2. Paste the whole of [schema.sql](schema.sql), and choose **Run**. It should say "Success. No rows returned."

Running it again later is safe.

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
   <p>Type this code on the Suggest Edits page to sign in:</p>
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

Commit and push. Within a few minutes, Suggest Edits shows the sign-in box, and the robot starts reading suggestions and votes at its next run.

## 6. Make yourself a maintainer

A maintainer's votes count when they sign in with the email address listed for them in [governance/maintainers.json](../governance/maintainers.json) (`"email"`). Sign in once on Suggest Edits with that address: the bar says "maintainer" next to your name, and every suggestion gets **Approve** and **Disapprove** buttons.

## Good to know

- **Free projects pause after a week without use.** The robot reads the database every five minutes, which counts as use. If the project is ever paused, restore it from the Supabase dashboard; nothing is lost.
- **Who can see what.** Suggestions and votes are public, with the email address of the person who made them, as the site says when someone signs in. Readers' sign-ins are in the project's Authentication page, which only you can see.
- **Removing someone's suggestions.** Add their email address to `ignored_accounts.site` in governance/maintainers.json: the robot then ignores everything from it, and its open suggestions are withdrawn.
