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

-- ===== 관리자 2단계 인증(인증 앱 OTP) 시작 (2026-11-26) =====
-- 기획: docs/02-design/features/bara-edu-lms.admin-totp.md 2.11. 비밀 값(인증 앱 비밀 키)은 AES-256-GCM 암호문만, 복구 코드·등록 코드는
-- HMAC만 저장한다(원문 없음). 모든 암호문·HMAC에 key_version을 둔다(키 교체 뒤에도 옛 버전으로 검증, 보안 점검 I-5).
-- 락 순서(api/src/auth/tokens.ts): 토큰 -> 가입 시도 -> 사용자 -> mfa_challenges -> mfa_enroll_tickets -> mfa_enrollments
--   -> mfa_factors -> mfa_recovery_codes -> mfa_account_state -> profiles.
-- 이 블록은 api/db/patches/2026-11-26-admin-mfa.sql과 글자 그대로 같다(동기화 테스트).

-- 세션: 2단계 통과 시각·방식, 마지막 "사용" 시각(관리자 1시간 미사용 판정). 관리자 세션은 created_at + 12시간이 최대다.
alter table auth.sessions add column if not exists mfa_at timestamptz;
alter table auth.sessions add column if not exists mfa_method text;
alter table auth.sessions add column if not exists last_seen_at timestamptz not null default now();
do $$ begin
  alter table auth.sessions add constraint sessions_mfa_method_check check (mfa_method in ('totp', 'recovery', 'enroll'));
exception when duplicate_object then null; end $$;
create index if not exists sessions_user_idx on auth.sessions (user_id);

-- 2단계 대기표: 32바이트 무작위 값의 SHA-256만. verify 5분, enroll 15분, 1회용. 만료 1일 뒤 정리(purge_expired_mfa_rows).
create table if not exists auth.mfa_challenges (
  token_hash text primary key,
  user_id uuid not null references auth.users on delete cascade,
  purpose text not null check (purpose in ('verify', 'enroll')),
  fail_count smallint not null default 0 check (fail_count >= 0),
  ip inet,
  ticket_verified_at timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mfa_challenges_user_idx on auth.mfa_challenges (user_id);
create index if not exists mfa_challenges_expires_idx on auth.mfa_challenges (expires_at);

-- 확정된 인증 앱 등록(사용자당 1개). AAD 용도 'factor'. last_used_step = 마지막으로 받아 준 30초 칸(재사용 방지).
create table if not exists auth.mfa_factors (
  user_id uuid primary key references auth.users on delete cascade,
  secret_ciphertext bytea not null,
  secret_iv bytea not null,
  key_version smallint not null,
  confirmed_at timestamptz not null,
  last_used_step bigint not null,
  last_used_at timestamptz not null,
  enrolled_via text not null check (enrolled_via in ('session', 'ticket', 'replace')),
  enrolled_ip inet,
  created_at timestamptz not null default now()
);

-- 등록 대기(10분, 사용자당 1개). AAD 용도 'enrollment'. 입구 B는 대기표에 묶고(challenge_hash), A·C는 세션 사용자에 묶는다.
-- replace_check: 입구 C의 재확인 수단(접속 기록 via=replace;check=…). 확정되면 지운다.
create table if not exists auth.mfa_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  challenge_hash text references auth.mfa_challenges (token_hash) on delete cascade,
  entry text not null check (entry in ('A', 'B', 'C')),
  replace_check text check (replace_check in ('totp', 'recovery')),
  secret_ciphertext bytea not null,
  secret_iv bytea not null,
  key_version smallint not null,
  fail_count smallint not null default 0 check (fail_count >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mfa_enrollments_entry_b_check check ((entry = 'B') = (challenge_hash is not null)),
  constraint mfa_enrollments_entry_c_check check ((entry = 'C') = (replace_check is not null))
);
create index if not exists mfa_enrollments_challenge_idx on auth.mfa_enrollments (challenge_hash);
create index if not exists mfa_enrollments_expires_idx on auth.mfa_enrollments (expires_at);

-- 복구 코드(사용자당 10행, 1회용). HMAC-SHA256(recovery-code 하위 키)만 저장.
create table if not exists auth.mfa_recovery_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  code_hmac bytea not null,
  key_version smallint not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mfa_recovery_codes_user_code_key unique (user_id, code_hmac)
);

-- 등록 코드(8자리, 24시간, 1회용, 사용자당 1개). HMAC-SHA256(enroll-ticket 하위 키)만 저장(보안 점검 M-3).
-- start에서 맞으면 enrollment_id·verified_at, confirm 트랜잭션에서 used_at. 만료·사용 1일 뒤 정리.
create table if not exists auth.mfa_enroll_tickets (
  user_id uuid primary key references auth.users on delete cascade,
  code_hmac bytea not null,
  key_version smallint not null,
  issued_by uuid references auth.users on delete set null,
  fail_count smallint not null default 0 check (fail_count >= 0),
  enrollment_id uuid,
  verified_at timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mfa_enroll_tickets_expires_idx on auth.mfa_enroll_tickets (expires_at);

-- 계정의 2단계 이력(비밀 값 없음). ticket_required_at이 있으면 등록 코드 없이는 등록할 수 없다(모든 모드, 보안 점검 I-1).
-- 강등 때 남기고 탈퇴 때 지운다.
create table if not exists auth.mfa_account_state (
  user_id uuid primary key references auth.users on delete cascade,
  ever_enrolled_at timestamptz,
  ticket_required_at timestamptz,
  reset_at timestamptz,
  recovery_codes_issued_at timestamptz,
  recovery_codes_acked_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 시작 시 키 검증값(버전마다 1행, 보안 점검 M-6). 정해진 평문을 그 버전 키로 암호화해 둔다.
create table if not exists auth.mfa_key_check (
  key_version smallint primary key,
  ciphertext bytea not null,
  iv bytea not null,
  created_at timestamptz not null default now()
);

-- 마지막으로 시작한 운영 모드(ADMIN_MFA_MODE). 바뀌면 시작할 때 비밀번호만의 관리자 세션을 지운다(2.14).
create table if not exists auth.mfa_runtime (
  id smallint primary key check (id = 1),
  mode text not null check (mode in ('off', 'optional', 'enforce')),
  changed_at timestamptz not null
);
-- ===== 관리자 2단계 인증 끝 =====

-- 관리자 2단계 인증 후속(2026-11-27, 패치 2026-11-27-mfa-enroll-session.sql과 같은 줄)
-- 잠금 순서 보충: auth.sessions 삭제(로그아웃·세션 정리)는 이 FK로 mfa_enrollments 삭제까지 잠근다(sessions -> mfa_enrollments).
-- 입구 C 시작은 세션 행을 미리 잠그지 않는다(다른 세션의 확정과 교착 방지, QA I-2). 저장 때 이 FK가 실패하면(시작 도중 로그아웃) 401로 바꾼다(QA Minor 1).
-- 입구 C는 시작한 세션에 묶는다(2026-11-27, 보안 점검 m-1): 같은 사용자의 다른 세션은 등록 대기(새 비밀 키)를 다시 읽거나 확정할 수 없다.
-- 세션이 지워지면(로그아웃·만료 정리) 대기도 함께 지워진다.
alter table auth.mfa_enrollments add column if not exists session_hash text references auth.sessions (token_hash) on delete cascade;
-- 입구 C 대기에는 시작한 세션이 반드시 있다(2026-11-27, 보안 점검 R-3, 패치 2026-11-27-mfa-enroll-c-session-required.sql과 같은 블록).
-- R-3 시작
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'auth.mfa_enrollments'::regclass and conname = 'mfa_enrollments_entry_c_session_check') then
    alter table auth.mfa_enrollments add constraint mfa_enrollments_entry_c_session_check check (entry <> 'C' or session_hash is not null);
  end if;
end $$;
-- R-3 끝

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
