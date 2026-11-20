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

do $$
begin
  execute format('grant create on database %I to bara_edu_service', current_database());
end
$$;
grant usage, create on schema public to bara_edu_service;
