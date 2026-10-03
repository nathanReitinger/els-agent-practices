-- Supabase starts the robot, so it runs for years without anyone looking after it.
--
-- The robot (scripts/proposals.py) publishes approved changes. GitHub runs it on a schedule, but GitHub says
-- scheduled runs can be late, or skipped when it's busy. So Supabase starts it too: within a minute of any vote,
-- and every ten minutes. Each run also reads this database, which keeps Supabase from pausing the project.
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

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Kept out of the API: nobody but the project's owner can see or run anything here.
create schema if not exists robot;
revoke all on schema robot from public, anon, authenticated;

-- When the robot was last started, so a burst of votes starts it at most once a minute.
create table if not exists robot.state (
  id int primary key default 1 check (id = 1),
  last_start timestamptz
);
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

-- Ask GitHub to run the robot now. (GitHub runs one at a time and keeps one more waiting.)
create or replace function robot.start() returns void
language plpgsql security definer set search_path = '' as $$
declare
  token text;
begin
  update robot.state set last_start = now()
    where id = 1 and (last_start is null or last_start < now() - interval '1 minute');
  if not found then
    return;  -- started less than a minute ago
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

drop trigger if exists start_robot on public.votes;
create trigger start_robot after insert or update on public.votes
  for each statement execute function robot.start_after_vote();

revoke all on all functions in schema robot from public, anon, authenticated;
revoke all on all tables in schema robot from public, anon, authenticated;

-- Every ten minutes, start the robot. Once a day, forget the timer's history from more than two weeks ago, so it
-- doesn't grow for years. (Scheduling a job again under the same name replaces it.)
select cron.schedule('start-the-robot', '*/10 * * * *', $$ select robot.start(); $$);
select cron.schedule('tidy-the-timer', '17 4 * * *', $$ delete from cron.job_run_details where end_time < now() - interval '14 days'; $$);
