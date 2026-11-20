do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bara_edu_service') then
    create role bara_edu_service nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'bara_edu_anon') then
    create role bara_edu_anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'bara_edu_authenticated') then
    create role bara_edu_authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'bara_edu_app') then
    create role bara_edu_app login noinherit;
  end if;
end
$$;

alter role bara_edu_app login noinherit connection limit 20;
alter role bara_edu_app set statement_timeout = '15s';

grant bara_edu_service, bara_edu_anon, bara_edu_authenticated to bara_edu_app with inherit false, set true;
grant bara_edu_service to current_user with inherit false, set true;

-- shared cluster: other login roles must not reach this database, its schema or its functions via PUBLIC
do $$
begin
  execute format('revoke all on database %I from public', current_database());
  execute format('grant connect on database %I to bara_edu_app', current_database());
  execute format('grant create on database %I to bara_edu_service', current_database());
end
$$;
revoke all on schema public from public;
grant usage, create on schema public to bara_edu_service;
grant usage on schema public to bara_edu_anon, bara_edu_authenticated;
-- per-schema default privileges cannot remove the built-in PUBLIC EXECUTE, so this must be global
alter default privileges for role bara_edu_service revoke execute on functions from public;
