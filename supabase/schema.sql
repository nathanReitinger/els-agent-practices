-- The database behind Suggest Edits, for AGENTS.md for Empirical Legal Scholars.
--
-- Paste this whole file into your Supabase project's SQL Editor and choose Run (supabase/README.md has
-- every step). Running it again is safe: it changes nothing that's already set up.
--
-- Two tables. Anyone can read both, because suggestions and votes are public.
--   suggestions  one row for each change a signed-in reader suggests on the Suggest Edits page
--   votes        one row for each person's vote on a suggestion: approve or reject
-- Readers sign in with a one-time code sent to their email address, and that address is their name on the
-- site. Each reader can add, change, and withdraw only their own suggestions and votes. The robot
-- (scripts/proposals.py) reads both tables with the project's public key, counts the maintainers' votes, and
-- publishes each approved change as a new version.

-- ---------- Suggestions ----------

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text not null default (auth.jwt() ->> 'email'),
  kind text not null check (kind in ('delete', 'replace', 'insert', 'rule')),
  exact text not null check (char_length(exact) between 1 and 2000),   -- the words in the text now
  prefix text not null default '' check (char_length(prefix) <= 200),  -- the words just before them
  suffix text not null default '' check (char_length(suffix) <= 200),  -- the words just after them
  new_text text not null default '' check (char_length(new_text) <= 2000),
  reason text not null default '' check (char_length(reason) <= 1000),
  base text not null default '' check (char_length(base) <= 40),       -- the version it was made on
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);

-- The database, not the reader's browser, sets who wrote a suggestion and when, and keeps it that way.
create or replace function public.stamp_suggestion() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created := now();
  else
    new.id := old.id;
    new.author_id := old.author_id;
    new.author_email := old.author_email;
    new.created := old.created;
  end if;
  new.updated := now();
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
-- `suggestion` is the id the robot gives a proposal: "sb-" and a suggestion's id, or a Hypothesis comment's id.
-- Only maintainers' votes decide anything; the robot counts other readers' approvals as support.

create table if not exists public.votes (
  suggestion text not null check (char_length(suggestion) between 1 and 100),
  voter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  voter_email text not null default (auth.jwt() ->> 'email'),
  vote text not null check (vote in ('approve', 'reject')),
  at timestamptz not null default now(),
  primary key (suggestion, voter_id)
);

-- For an approval, which number of the version goes up if it adopts the suggestion: the last (patch, the default),
-- the middle (minor), or the first (major). Added after the first release of this file, so it's added separately.
alter table public.votes add column if not exists version_step text not null default 'patch'
  check (version_step in ('patch', 'minor', 'major'));

create or replace function public.stamp_vote() returns trigger
language plpgsql set search_path = '' as $$
begin
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

-- ---------- Who may do what ----------
-- Anyone may read; only signed-in readers may write, and the policies above limit them to their own rows.

grant select on public.suggestions, public.votes to anon, authenticated;
grant insert, update, delete on public.suggestions, public.votes to authenticated;
revoke insert, update, delete, truncate on public.suggestions, public.votes from anon;

-- ---------- Live updates ----------
-- The page hears about new and changed suggestions right away, so everyone sees everyone's.

do $$
declare
  t text;
begin
  foreach t in array array['suggestions', 'votes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;  -- already added
    end;
  end loop;
end
$$;
