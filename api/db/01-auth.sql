create schema if not exists auth authorization bara_edu_service;

set role bara_edu_service;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists users_email_lower_key on auth.users (lower(email));

create table if not exists auth.sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists auth.email_tokens (
  token_hash text primary key,
  user_id uuid references auth.users on delete cascade,
  purpose text check (purpose in ('confirm', 'recovery')),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- 가입 시도: 가입 요청 1건 = 1행. 인증 링크(email_tokens.attempt_id)는 시도 하나에 묶이고, 비밀번호는 그 시도의 것으로만 확인한다.
-- 미인증 계정의 auth.users.encrypted_password는 비워 둔다. 확정(complete)되면 그 계정의 시도는 모두 지운다.
-- 이름·연락처·비밀번호 해시를 필요한 기간(7일)만 보관한다 — purge_unverified_signups가 만료분을 지운다.
create table if not exists auth.signup_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  password_hash text not null,
  name text not null,
  phone text,
  fail_count integer not null default 0 check (fail_count >= 0),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists signup_attempts_user_created_idx on auth.signup_attempts (user_id, created_at);
create index if not exists signup_attempts_expires_idx on auth.signup_attempts (expires_at);

-- 시도가 지워져도 토큰 행은 남긴다(used_at이 채워진 토큰은 check에서 'done'으로 보이게). 새 방식의 confirm 토큰만 attempt_id를 가진다.
alter table auth.email_tokens add column if not exists attempt_id uuid references auth.signup_attempts on delete set null;
create index if not exists email_tokens_attempt_idx on auth.email_tokens (attempt_id);
create index if not exists email_tokens_user_idx on auth.email_tokens (user_id);

create table if not exists auth.rate_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_bucket_key_created_idx on auth.rate_events (bucket, key, created_at);
create index if not exists rate_events_created_idx on auth.rate_events (created_at);

create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.user_id', true), '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select case when auth.uid() is null then 'anon' else 'authenticated' end $$;

revoke all on function auth.uid(), auth.role() from public;
grant usage on schema auth to bara_edu_anon, bara_edu_authenticated, bara_edu_app;
grant execute on function auth.uid(), auth.role() to bara_edu_anon, bara_edu_authenticated, bara_edu_app;

reset role;
