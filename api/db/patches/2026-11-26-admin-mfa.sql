-- 운영 DB 패치: 관리자 2단계 인증(인증 앱 OTP) (2026-11-26)
--
-- 기획: docs/02-design/features/bara-edu-lms.admin-totp.md 2.11 (보안 점검 I-1·I-2·I-5·M-3·M-4·M-6·M-8 반영)
-- 변경
--   1. auth.sessions에 mfa_at·mfa_method·last_seen_at 컬럼, mfa_method 검사 제약, user_id 인덱스
--   2. auth 스키마 새 테이블 8개: mfa_challenges, mfa_factors, mfa_enrollments, mfa_recovery_codes, mfa_enroll_tickets,
--      mfa_account_state, mfa_key_check, mfa_runtime (+ 인덱스)
--   3. public.purge_expired_mfa_rows() 신규(매일 정리 작업, API scheduler가 호출) + anon·authenticated 실행 권한 회수
-- 성격: 멱등(if not exists / 예외 처리 / create or replace). 기존 데이터는 바꾸지 않는다(새 컬럼은 null 또는 now() 기본값).
--       auth 스키마 테이블에는 grant를 주지 않는다(API의 bara_edu_service만 쓴다. 관리자 쿼리 API·RLS 경로로는 읽을 수 없다).
-- 블록 1·2는 api/db/01-auth.sql, 블록 3은 api/db/02-schema.sql과 글자 그대로 같다(test/patch-admin-mfa.test.ts).
-- 적용: 한 트랜잭션 안에서 스키마 소유자 역할로 전환한 뒤 실행한다(파일에는 역할 전환을 넣지 않는다 — 패치 형식 테스트).
--       begin; set local role bara_edu_service; <이 파일>; commit;
-- 배포 순서(기획서 7.1): 앱 -> 이 패치 -> API(ADMIN_MFA_MODE=optional). 이 패치는 옛 API와도 호환된다(추가만 함).
--       새 API가 처음 optional로 시작하면 mfa_runtime이 비어 있어 모드 변경으로 보고 비밀번호만의 관리자 세션을 모두 지운다(보안 점검 I-2).
-- 롤백: 지우지 않는다(옛 API는 새 컬럼·테이블을 쓰지 않는다. 기획서 7.3 "스키마 롤백").

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


create or replace function public.purge_expired_mfa_rows()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollments integer;
  v_challenges integer;
  v_tickets integer;
begin
  delete from auth.mfa_enrollments where expires_at < now();
  get diagnostics v_enrollments = row_count;
  delete from auth.mfa_challenges where expires_at < now() - interval '1 day';
  get diagnostics v_challenges = row_count;
  delete from auth.mfa_enroll_tickets
   where expires_at < now() - interval '1 day' or used_at < now() - interval '1 day';
  get diagnostics v_tickets = row_count;
  return v_enrollments + v_challenges + v_tickets;
end;
$$;

revoke execute on function public.purge_expired_mfa_rows() from public, bara_edu_anon, bara_edu_authenticated;
