-- The database behind Suggest Edits, for AGENTS.md for Empirical Legal Scholars.
--
-- Paste this whole file into your Supabase project's SQL Editor and choose Run (supabase/README.md has
-- every step). Running it again is safe: it changes nothing that's already set up.
--
-- Three tables. Anyone can read them, because suggestions, votes, and comments are public.
--   suggestions  one row for each change a signed-in reader suggests on the Suggest Edits page
--   votes        one row for each person's vote on a suggestion: approve or reject
--   comments     one row for each comment, reply, or highlight
-- Readers sign in with a one-time code sent to their email address, and that address is their name on the
-- site. Each reader can add, change, and withdraw only their own rows. The robot (scripts/proposals.py) reads
-- the suggestions and votes with the project's public key, counts the maintainers' votes, and publishes each
-- approved change as a new version. Comments and highlights never change the text.

-- ---------- Suggestions ----------

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text not null default (auth.jwt() ->> 'email'),
  kind text not null,
  exact text not null check (char_length(exact) between 1 and 2000),   -- the words in the text now
  prefix text not null default '' check (char_length(prefix) <= 200),  -- the words just before them
  suffix text not null default '' check (char_length(suffix) <= 200),  -- the words just after them
  new_text text not null default '',
  reason text not null default '' check (char_length(reason) <= 1000),
  base text not null default '' check (char_length(base) <= 40),       -- the version it was made on
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

-- The kinds of change, and how long new words can be. A "section" is a new heading with its rules: new_text holds
-- the heading on its first line and one rule on each line after it. (Set apart from the table, so running this
-- file again updates a table made by an earlier version of it.)
alter table public.suggestions drop constraint if exists suggestions_kind_check;
alter table public.suggestions add constraint suggestions_kind_check
  check (kind in ('delete', 'replace', 'insert', 'rule', 'section'));
alter table public.suggestions drop constraint if exists suggestions_new_text_check;
alter table public.suggestions add constraint suggestions_new_text_check check (char_length(new_text) <= 6000);

-- A different change suggested for the same words as someone else's suggestion: "sb-" and that suggestion's id.
alter table public.suggestions add column if not exists builds_on text
  check (builds_on is null or char_length(builds_on) between 1 and 100);

-- New words a reader can see: no invisible characters (zero-width, direction controls, tags, private use, variation
-- selectors, fillers, or controls other than a line break). The robot refuses them too, and HTML and hidden link
-- parts (scripts/edits.py), so nothing goes into AGENTS.md that its readers can't see but an agent reading it would.
-- (Rows saved before this rule aren't checked again.)
alter table public.suggestions drop constraint if exists suggestions_new_text_visible;
alter table public.suggestions add constraint suggestions_new_text_visible check (new_text !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\ue000-\uf8ff\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff\U000f0000-\U0010ffff]') not valid;

-- What the AI check found about a suggestion (supabase/robot.sql), saved by its author's page so the maintainers
-- see it too: { "verdict": "fine" | "problem", "findings": [{ "kind", "rule", "where", "explanation" }, ...] }, at most
-- five findings, each an object. Anything else is refused, so a malformed note can't break the list of suggestions.
alter table public.suggestions add column if not exists ai_check jsonb;
create or replace function public.valid_ai_check(c jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select c is null or coalesce(
    jsonb_typeof(c) = 'object' and length(c::text) <= 20000
    and c ->> 'verdict' in ('fine', 'problem')
    and jsonb_typeof(c -> 'findings') = 'array' and jsonb_array_length(c -> 'findings') <= 5
    and not exists (select 1 from jsonb_array_elements(c -> 'findings') f
                    where jsonb_typeof(f) <> 'object'
                       or exists (select 1 from jsonb_each(f) e where jsonb_typeof(e.value) not in ('string', 'null'))),
    false)
$$;
alter table public.suggestions drop constraint if exists suggestions_ai_check_check;
alter table public.suggestions add constraint suggestions_ai_check_check check (public.valid_ai_check(ai_check)) not valid;

-- The database, not the reader's browser, sets who wrote a suggestion and when, and keeps it that way. Saving the AI
-- check's note isn't an edit: it doesn't move "updated" (so votes already cast still count). An edit to the change
-- itself clears the note, since it was about the old wording.
create or replace function public.stamp_suggestion() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created := now();
    new.updated := now();
    return new;
  end if;
  new.id := old.id;
  new.author_id := old.author_id;
  new.author_email := old.author_email;
  new.created := old.created;
  if (new.kind, new.exact, new.prefix, new.suffix, new.new_text, new.reason, new.base, new.builds_on)
     is not distinct from (old.kind, old.exact, old.prefix, old.suffix, old.new_text, old.reason, old.base, old.builds_on) then
    new.updated := old.updated;
  else
    new.updated := now();
    if (new.kind, new.exact, new.new_text) is distinct from (old.kind, old.exact, old.new_text)
       and new.ai_check is not distinct from old.ai_check then
      new.ai_check := null;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists stamp_suggestion on public.suggestions;
create trigger stamp_suggestion before insert or update on public.suggestions
  for each row execute function public.stamp_suggestion();

alter table public.suggestions enable row level security;

drop policy if exists "Anyone can read suggestions" on public.suggestions;
create policy "Anyone can read suggestions" on public.suggestions
  for select using (true);

-- At most 500 suggestions per reader, to stop runaway scripts; nobody should come close.
drop policy if exists "Signed-in readers add suggestions as themselves" on public.suggestions;
create policy "Signed-in readers add suggestions as themselves" on public.suggestions
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and author_email = (select auth.jwt() ->> 'email')
    and (select count(*) from public.suggestions s where s.author_id = (select auth.uid())) < 500
  );

drop policy if exists "Authors change their own suggestions" on public.suggestions;
create policy "Authors change their own suggestions" on public.suggestions
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists "Authors withdraw their own suggestions" on public.suggestions;
create policy "Authors withdraw their own suggestions" on public.suggestions
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- ---------- Votes ----------
-- `suggestion` is the id the robot gives a suggestion: "sb-" and the suggestion's id.
-- Only maintainers' votes decide anything; the robot counts other readers' approvals as support.

create table if not exists public.votes (
  suggestion text not null check (char_length(suggestion) between 1 and 100),
  voter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  voter_email text not null default (auth.jwt() ->> 'email'),
  vote text not null check (vote in ('approve', 'reject')),
  at timestamptz not null default now(),
  primary key (suggestion, voter_id)
);

-- Which version of the suggestion the voter saw: its "updated" time on their page. Once a suggestion has been
-- edited, a vote counts only for the version it was cast on, so nobody can change a suggestion under an approval.
alter table public.votes add column if not exists seen timestamptz;

-- For an approval, which number of the version goes up if it adopts the suggestion: the last (patch, the default),
-- the middle (minor), or the first (major). Added after the first release of this file, so it's added separately.
alter table public.votes add column if not exists version_step text not null default 'patch'
  check (version_step in ('patch', 'minor', 'major'));

create or replace function public.stamp_vote() returns trigger
language plpgsql set search_path = '' as $$
declare
  there boolean;
begin
  -- A vote on a suggestion made on the site must be on one that exists.
  if tg_op = 'INSERT' and new.suggestion like 'sb-%' then
    begin
      there := exists (select 1 from public.suggestions s where s.id = substr(new.suggestion, 4)::uuid);
    exception when invalid_text_representation then
      there := false;
    end;
    if not there then
      raise exception 'There''s no suggestion %.', new.suggestion using errcode = 'foreign_key_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.suggestion := old.suggestion;
    new.voter_id := old.voter_id;
    new.voter_email := old.voter_email;
  end if;
  new.at := now();
  return new;
end
$$;

drop trigger if exists stamp_vote on public.votes;
create trigger stamp_vote before insert or update on public.votes
  for each row execute function public.stamp_vote();

alter table public.votes enable row level security;

drop policy if exists "Anyone can read votes" on public.votes;
create policy "Anyone can read votes" on public.votes
  for select using (true);

drop policy if exists "Signed-in readers vote as themselves" on public.votes;
create policy "Signed-in readers vote as themselves" on public.votes
  for insert to authenticated
  with check (voter_id = (select auth.uid()) and voter_email = (select auth.jwt() ->> 'email'));

drop policy if exists "Voters change their own votes" on public.votes;
create policy "Voters change their own votes" on public.votes
  for update to authenticated
  using (voter_id = (select auth.uid()))
  with check (voter_id = (select auth.uid()));

drop policy if exists "Voters withdraw their own votes" on public.votes;
create policy "Voters withdraw their own votes" on public.votes
  for delete to authenticated
  using (voter_id = (select auth.uid()));

-- ---------- Comments and highlights ----------
-- A comment or a highlight on some words of the text (the words, with the words around them, as a suggestion
-- has), a comment on a suggestion, or a reply to a comment. They never change the text. Each reader adds,
-- changes, and deletes only their own; anyone signed in can mark a comment resolved, or open it again.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text not null default (auth.jwt() ->> 'email'),
  kind text not null default 'comment' check (kind in ('comment', 'highlight')),
  body text not null default '' check (char_length(body) <= 4000),
  exact text not null default '' check (char_length(exact) <= 2000),   -- the words it's on
  prefix text not null default '' check (char_length(prefix) <= 200),
  suffix text not null default '' check (char_length(suffix) <= 200),
  suggestion text check (suggestion is null or char_length(suggestion) between 1 and 100),  -- or the suggestion it's on
  parent uuid references public.comments (id) on delete cascade,      -- or the comment it replies to
  base text not null default '' check (char_length(base) <= 40),      -- the version it was made on
  resolved boolean not null default false,
  resolved_by text not null default '',
  created timestamptz not null default now(),
  updated timestamptz not null default now(),
  constraint comments_on_something check (parent is not null or suggestion is not null or exact <> ''),
  constraint comments_highlight_on_words check (kind = 'comment' or (exact <> '' and parent is null and suggestion is null)),
  constraint comments_say_something check (kind = 'highlight' or char_length(btrim(body)) > 0)
);

-- Who wrote it, when, and what it's on are set by the database and kept. Only resolve_comment, below, marks a
-- comment resolved or open.
create or replace function public.stamp_comment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created := now();
    new.resolved := false;
    new.resolved_by := '';
  else
    new.id := old.id;
    new.author_id := old.author_id;
    new.author_email := old.author_email;
    new.kind := old.kind;
    new.exact := old.exact;
    new.prefix := old.prefix;
    new.suffix := old.suffix;
    new.suggestion := old.suggestion;
    new.parent := old.parent;
    new.base := old.base;
    new.created := old.created;
    if coalesce(current_setting('app.resolving', true), '') <> 'on' then
      new.resolved := old.resolved;
      new.resolved_by := old.resolved_by;
    end if;
  end if;
  new.updated := now();
  return new;
end
$$;

drop trigger if exists stamp_comment on public.comments;
create trigger stamp_comment before insert or update on public.comments
  for each row execute function public.stamp_comment();

alter table public.comments enable row level security;

drop policy if exists "Anyone can read comments" on public.comments;
create policy "Anyone can read comments" on public.comments
  for select using (true);

-- At most 2,000 comments and highlights per reader, to stop runaway scripts.
drop policy if exists "Signed-in readers comment as themselves" on public.comments;
create policy "Signed-in readers comment as themselves" on public.comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and author_email = (select auth.jwt() ->> 'email')
    and (select count(*) from public.comments c where c.author_id = (select auth.uid())) < 2000
  );

drop policy if exists "Authors change their own comments" on public.comments;
create policy "Authors change their own comments" on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists "Authors delete their own comments" on public.comments;
create policy "Authors delete their own comments" on public.comments
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- Anyone signed in can mark a comment (not a reply) resolved, or open it again.
create or replace function public.resolve_comment(comment_id uuid, done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to resolve a comment.';
  end if;
  perform set_config('app.resolving', 'on', true);
  update public.comments
    set resolved = done, resolved_by = case when done then coalesce((select auth.jwt() ->> 'email'), '') else '' end
    where id = comment_id and parent is null and kind = 'comment';
  perform set_config('app.resolving', 'off', true);
end
$$;
revoke all on function public.resolve_comment(uuid, boolean) from public, anon;
grant execute on function public.resolve_comment(uuid, boolean) to authenticated;

-- ---------- Changes to the list of maintainers ----------
-- The lead maintainer adds and removes maintainers on the site's Maintainers page. Each request is kept here, and
-- the robot (scripts/proposals.py) carries out those made by a lead maintainer, in governance/maintainers.json,
-- where every change is kept in the history. Anyone else's requests are ignored. Anyone may read them, as anyone
-- may read the maintainers' addresses on that page.

create table if not exists public.maintainer_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requested_email text not null default (auth.jwt() ->> 'email'),
  action text not null check (action in ('add', 'remove')),
  name text not null default '' check (char_length(name) <= 100),
  email text not null check (char_length(email) <= 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  github text not null default '' check (github ~ '^([A-Za-z0-9][A-Za-z0-9-]{0,38})?$'),
  created timestamptz not null default now()
);

create or replace function public.stamp_maintainer_request() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created := now();
  new.email := lower(trim(new.email));
  new.name := trim(regexp_replace(new.name, '[[:cntrl:]]', ' ', 'g'));
  new.github := trim(new.github);
  return new;
end
$$;

drop trigger if exists stamp_maintainer_request on public.maintainer_requests;
create trigger stamp_maintainer_request before insert on public.maintainer_requests
  for each row execute function public.stamp_maintainer_request();

alter table public.maintainer_requests enable row level security;

drop policy if exists "Anyone can read requests to change the maintainers" on public.maintainer_requests;
create policy "Anyone can read requests to change the maintainers" on public.maintainer_requests
  for select using (true);

-- At most 200 requests per reader, to stop runaway scripts.
drop policy if exists "Signed-in readers make requests as themselves" on public.maintainer_requests;
create policy "Signed-in readers make requests as themselves" on public.maintainer_requests
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and requested_email = (select auth.jwt() ->> 'email')
    and (select count(*) from public.maintainer_requests r where r.requested_by = (select auth.uid())) < 200
  );

-- ---------- Limits on what one reader can write ----------
-- Each signed-in reader can add at most so many rows a day to each table, counted as they're added (deleting a row
-- doesn't give it back, and many rows sent at once count one by one), so nobody can fill the database, the robot's
-- record, or everyone's page. The counts are kept here, out of the site's reach. Every row needs a signed-in address.

create table if not exists public.daily_writes (
  author uuid not null,
  day date not null,
  what text not null,
  n integer not null default 0,
  primary key (author, day, what)
);
alter table public.daily_writes enable row level security;  -- no policies: the site can't read or write it
revoke all on public.daily_writes from anon, authenticated;

create or replace function public.count_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  used integer;
begin
  if me is null then
    return new;  -- the database's owner (setting up, or keeping itself up to date) isn't counted
  end if;
  insert into public.daily_writes as d (author, day, what, n) values (me, current_date, tg_table_name, 1)
    on conflict (author, day, what) do update set n = d.n + 1
    returning d.n into used;
  if used > tg_argv[0]::integer then
    raise exception 'That''s more % than one person can add in a day (%). Try again tomorrow.',
      replace(tg_table_name, '_', ' '), tg_argv[0] using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.count_write() from public, anon, authenticated;

do $$
declare
  t record;
begin
  for t in select * from (values ('suggestions', 1000, 'author_email'), ('votes', 1000, 'voter_email'),
                                 ('comments', 2000, 'author_email'), ('maintainer_requests', 50, 'requested_email')) v(name, cap, email) loop
    execute format('drop trigger if exists count_write on public.%I', t.name);
    execute format('create trigger count_write before insert on public.%I for each row execute function public.count_write(%L)', t.name, t.cap);
    execute format('alter table public.%I drop constraint if exists %I', t.name, t.name || '_email_given');
    execute format('alter table public.%I add constraint %I check (%I <> %L) not valid', t.name, t.name || '_email_given', t.email, '');
  end loop;
end
$$;

-- ---------- Who may do what ----------
-- Anyone may read; only signed-in readers may write, and the policies above limit them to their own rows.

grant select on public.suggestions, public.votes, public.comments to anon, authenticated;
grant insert, update, delete on public.suggestions, public.votes, public.comments to authenticated;
revoke insert, update, delete, truncate on public.suggestions, public.votes, public.comments from anon;
revoke all on public.maintainer_requests from anon, authenticated;
grant select on public.maintainer_requests to anon, authenticated;
grant insert on public.maintainer_requests to authenticated;

-- ---------- Live updates ----------
-- The page hears about new and changed suggestions right away, so everyone sees everyone's.

do $$
declare
  t text;
begin
  foreach t in array array['suggestions', 'votes', 'comments'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;  -- already added
    end;
  end loop;
end
$$;
