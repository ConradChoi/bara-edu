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

create table if not exists auth.rate_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_bucket_key_created_idx on auth.rate_events (bucket, key, created_at);

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
