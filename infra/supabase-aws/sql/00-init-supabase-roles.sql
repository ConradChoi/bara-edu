-- Supabase 관리형이 자동으로 만들어주던 역할/스키마를 순정 RDS에 준비한다.
-- GoTrue/Storage API의 자체 마이그레이션이 이 전제 위에서 돌아간다. 여러 번 실행해도 안전(idempotent).
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit; end if;
  -- Supabase 마이그레이션 일부가 postgres 역할을 grant 대상으로 참조한다(RDS 마스터는 supabase_admin).
  if not exists (select from pg_roles where rolname = 'postgres') then create role postgres nologin; end if;
end $$;

-- PostgREST/Storage API가 supabase_admin으로 접속한 뒤 JWT role로 SET ROLE 하려면 멤버십이 필요하다.
grant anon, authenticated, service_role to supabase_admin;

create schema if not exists auth authorization supabase_admin;
create schema if not exists storage authorization supabase_admin;
create schema if not exists extensions authorization supabase_admin;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- service_role은 Supabase에서 RLS를 우회(BYPASSRLS)한다. RDS 마스터는 superuser가 아니라
-- PG15에서는 이 속성을 줄 수 없을 수 있다 — 실패해도 나머지는 진행하고 결과를 남긴다.
do $$ begin
  alter role service_role bypassrls;
  raise notice 'service_role BYPASSRLS: OK';
exception when insufficient_privilege then
  raise notice 'service_role BYPASSRLS: NOT PERMITTED on this RDS instance';
end $$;
