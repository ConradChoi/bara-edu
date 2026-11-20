-- GoTrue 전용 역할. psql 변수 :gotrue_pw 로 비밀번호를 받는다(gotrue-database-url 시크릿과 동일 값).
-- GoTrue 마이그레이션은 스키마 미지정으로 객체를 만들기 때문에 search_path=auth가 필수다.
select format('create role supabase_auth_admin login noinherit createrole password %L', :'gotrue_pw')
where not exists (select from pg_roles where rolname = 'supabase_auth_admin') \gexec
alter role supabase_auth_admin with password :'gotrue_pw';
alter role supabase_auth_admin set search_path = auth;

-- 비슈퍼유저인 RDS 마스터가 다른 역할 소유 스키마를 만들려면 그 역할의 멤버여야 한다.
grant supabase_auth_admin to supabase_admin;

-- search_path 없이 돌았던 이전 시도가 남긴 잔여물 정리(신규 환경이면 아무것도 안 함).
drop schema if exists auth cascade;
drop type if exists public.factor_type, public.factor_status, public.aal_level,
  public.code_challenge_method, public.one_time_token_type cascade;
-- GoTrue(pop)의 마이그레이션 기록표. 앱 schema.sql에는 같은 이름이 없다.
drop table if exists public.schema_migrations;

create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, supabase_admin;
grant anon, authenticated, service_role to supabase_auth_admin;
