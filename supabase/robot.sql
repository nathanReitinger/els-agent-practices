-- Supabase starts the robot, so it runs for years without anyone looking after it.
--
-- The robot (scripts/proposals.py) publishes approved changes. GitHub runs it on a schedule, but GitHub says
-- scheduled runs can be late, or skipped when it's busy. So Supabase starts it too: right after any vote (or, if it
-- was started in the last few seconds, a minute later), and every ten minutes. Each run also reads this database,
-- which keeps Supabase from pausing the project.
--
-- Supabase needs a GitHub token that can do one thing: start this repository's workflows (supabase/README.md,
-- step 7). The token is kept encrypted in Supabase's Vault. It's never in the repository.
--
-- Paste this whole file into the SQL Editor and choose Run (running it again is safe). Then, in a new query,
-- store the token:
--
--     select robot.set_token('github_pat_...');
--
-- To replace the token later, run the same line with the new one.
--
-- This file also keeps the database up to date by itself (below): every ten minutes it fetches
-- supabase/schema.sql and this file from GitHub and runs whichever changed. So once this file has been run here,
-- neither file needs pasting again.

-- pg_net (to call GitHub) and pg_cron (the timer), each created only if it isn't there yet: creating one that's
-- already there sets off Supabase's own setup for it again, which isn't needed.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net with schema extensions;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron with schema pg_catalog;
  end if;
end
$$;

-- An earlier version of this file also granted this role rights on pg_cron's tables that Supabase had already given
-- it. Those repeated grants stop Supabase's own setup for pg_cron ("dependent privileges exist"), so they're taken
-- back here. This takes back only grants this role made itself; the rights Supabase gave stay. (A superuser's
-- revoke would take back the owner's grants as well, so a superuser skips this.)
do $$
declare
  t text;
begin
  if (select rolsuper from pg_roles where rolname = current_user) then
    return;
  end if;
  for t in select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'cron' and c.relkind in ('r', 'p') and pg_get_userbyid(c.relowner) <> current_user loop
    execute format('revoke all privileges on table %s from %I', t, current_user);
  end loop;
exception when others then
  null;
end
$$;

-- Kept out of the API: nobody but the project's owner can see or run anything here.
create schema if not exists robot;
revoke all on schema robot from public, anon, authenticated;

-- When the robot was last started, so a burst of votes starts it at most every 20 seconds; and whether a start was
-- held back by that, so the timer makes it a minute later and no vote waits for the next ten-minute start.
create table if not exists robot.state (
  id int primary key default 1 check (id = 1),
  last_start timestamptz
);
alter table robot.state add column if not exists wanted boolean not null default false;
insert into robot.state (id) values (1) on conflict (id) do nothing;

-- Store the GitHub token, or replace it: select robot.set_token('github_pat_...');
create or replace function robot.set_token(token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
begin
  if coalesce(trim(token), '') = '' then
    raise exception 'Paste the token between the quotes.';
  end if;
  select id into existing from vault.secrets where name = 'github_robot_token';
  if existing is null then
    perform vault.create_secret(trim(token), 'github_robot_token', 'Starts the robot (scripts/proposals.py) on GitHub');
  else
    perform vault.update_secret(existing, trim(token));
  end if;
  return 'Saved. Supabase will start the robot within ten minutes.';
end
$$;

-- Ask GitHub to run the robot now. (GitHub runs one at a time and keeps one more waiting, so a run started while
-- another is going runs right after it, and sees everything since.)
create or replace function robot.start() returns void
language plpgsql security definer set search_path = '' as $$
declare
  token text;
begin
  update robot.state set last_start = now(), wanted = false
    where id = 1 and (last_start is null or last_start < now() - interval '20 seconds');
  if not found then
    update robot.state set wanted = true where id = 1;  -- started moments ago: the timer starts it again shortly
    return;
  end if;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_robot_token';
  if coalesce(token, '') = '' then
    return;  -- no token yet
  end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/nathanReitinger/els-agent-practices/actions/workflows/proposals.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'els-agent-practices-supabase',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
end
$$;

-- A vote starts the robot, so an approved change is published within a minute or two. A vote is never lost
-- because the robot couldn't be started.
create or replace function robot.start_after_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform robot.start();
  exception when others then
    null;
  end;
  return null;
end
$$;

-- ---------- Keeping the database up to date by itself ----------
-- Every ten minutes (at :05, :15, and so on) the timer asks GitHub for supabase/schema.sql and this file, and a
-- minute later runs each one that has changed since it last ran it, schema.sql first. So a change to either file
-- reaches the database within about ten minutes. Each file runs all or nothing: if it fails, the database stays as
-- it was, and the error is kept here, where the robot finds it (public.schema_status) and opens a GitHub issue.
-- Both files are safe to run again.
--
-- What these two files say on GitHub runs here with the database owner's rights, so review a change to them as
-- carefully as a change to the robot itself.

create table if not exists robot.schema_files (
  file text primary key,   -- its path in the repository
  run_order int not null,
  request_id bigint,       -- the request to GitHub for it, while it waits for an answer
  applied_md5 text,        -- the MD5 of the version last run
  applied_at timestamptz,
  error text,              -- why the newest version didn't run, if it didn't
  failed_at timestamptz
);
insert into robot.schema_files (file, run_order) values ('supabase/schema.sql', 1), ('supabase/robot.sql', 2)
  on conflict (file) do nothing;

create or replace function robot.keep_schema_current(at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f record;
  answer_status int;
  answer text;
begin
  -- GitHub's answers: run each file that changed, all or nothing, as the SQL Editor would.
  for f in select file, request_id, applied_md5 from robot.schema_files where request_id is not null order by run_order loop
    select r.status_code, r.content into answer_status, answer from net._http_response r where r.id = f.request_id;
    if not found then
      continue;  -- no answer yet
    end if;
    update robot.schema_files set request_id = null where file = f.file;
    if answer_status is distinct from 200 or answer is null or md5(answer) is not distinct from f.applied_md5 then
      continue;  -- unchanged, or GitHub didn't answer properly: asked again in ten minutes
    end if;
    begin
      perform set_config('search_path', '"$user", public, extensions', true);
      execute answer;
      perform set_config('search_path', '', true);
      update robot.schema_files set applied_md5 = md5(answer), applied_at = now(), error = null, failed_at = null
        where file = f.file;
    exception when others then
      perform set_config('search_path', '', true);
      update robot.schema_files set error = sqlerrm, failed_at = now() where file = f.file;
    end;
  end loop;
  if extract(minute from at)::int % 10 = 5 then
    update robot.schema_files set request_id = net.http_get(
      url := 'https://raw.githubusercontent.com/nathanReitinger/els-agent-practices/main/' || file,
      timeout_milliseconds := 15000);
  end if;
end
$$;

-- What the database last ran, and any error, for the robot to check (readable with the public key).
create or replace function public.schema_status()
returns table (file text, applied_md5 text, applied_at timestamptz, error text, failed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.file, s.applied_md5, s.applied_at, s.error, s.failed_at from robot.schema_files s order by s.run_order
$$;
revoke all on function public.schema_status() from public;
grant execute on function public.schema_status() to anon, authenticated;

-- Every minute: start the robot if a start was held back, and every ten minutes in any case; and keep the database
-- up to date. Neither gets in the other's way: if one fails, the other still happens (and the robot reports
-- either failure in a GitHub issue).
create or replace function robot.tick(at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if extract(minute from at)::int % 10 = 0 or exists (select 1 from robot.state where id = 1 and wanted) then
      perform robot.start();
    end if;
  exception when others then
    null;
  end;
  begin
    perform robot.keep_schema_current(at);
  exception when others then
    null;
  end;
end
$$;

drop trigger if exists start_robot on public.votes;
create trigger start_robot after insert or update on public.votes
  for each statement execute function robot.start_after_vote();

revoke all on all functions in schema robot from public, anon, authenticated;
revoke all on all tables in schema robot from public, anon, authenticated;

-- The timer ticks every minute (robot.tick decides whether to start the robot). Once a day, it forgets its history
-- from more than two weeks ago, so that doesn't grow for years. (Scheduling a job again under the same name
-- replaces it.)
select cron.schedule('start-the-robot', '* * * * *', $$ select robot.tick(); $$);
select cron.schedule('tidy-the-timer', '17 4 * * *', $$ delete from cron.job_run_details where end_time < now() - interval '14 days'; $$);
