-- 운영 DB 패치: 가입 인증 때 비밀번호 확인 (2026-11-25) — 가입 시도 테이블, 토큰 연결 컬럼, 정리 함수 교체, 기존 미인증 계정 이행
--
-- 변경
--   1. auth.signup_attempts 테이블 + 인덱스 (api/db/01-auth.sql과 같은 정의)
--   2. auth.email_tokens.attempt_id 컬럼(+ 인덱스 2개)
--   3. public.purge_unverified_signups() 교체: 만료된 가입 시도도 함께 삭제 (api/db/02-schema.sql의 같은 정의와 동일)
--   4. 이행: 배포 시점의 미인증 계정은 비밀번호를 비우고(encrypted_password = NULL), 옛 방식의 미사용 confirm 토큰을 삭제한다.
--      그 계정들은 다시 가입해야 한다(대표 결정 4, 운영 미인증 계정 0건 확인 2026-11-25).
-- 성격: 멱등(여러 번 실행해도 같은 결과). 기존 컬럼·데이터는 지우지 않는다(위 4번의 대상만 변경). `npm run db:migrate`는 쓰지 않는다.
-- 적용: 한 트랜잭션 안에서 스키마 소유자 역할로 전환한 뒤 실행한다(파일에는 역할 전환을 넣지 않는다 — 패치 형식 테스트).
--       begin; set local role bara_edu_service; <이 파일>; commit;
-- 배포 순서: 이 패치 -> API -> 앱 (이 패치는 옛 API·옛 앱과도 호환된다: 새 테이블과 nullable 컬럼만 추가)
--       패치와 API 배포 사이에 옛 API가 받은 가입(비밀번호가 users에 있고 토큰에 attempt_id가 없음)은 이 패치의 이행 문장(4번)으로만 정리된다.
--       그래서 API 배포 직후 이 파일을 한 번 더 적용한다(멱등이라 안전, 새 방식의 시도·토큰·인증된 회원은 건드리지 않는다).

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

create or replace function public.purge_unverified_signups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  -- 가입 시도(이름·연락처·비밀번호 해시)는 만료(생성 후 7일)되면 계정과 무관하게 지운다. 연결된 토큰 행은 남고 attempt_id만 비워진다.
  delete from auth.signup_attempts where expires_at < now();

  with target as (
    select p.id
    from profiles p
    where p.role = 'learner'
      and p.created_at < now() - interval '7 days'
      and not exists (
        select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null
      )
  )
  delete from auth.users where id in (select id from target);
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

update auth.users set encrypted_password = null, updated_at = now()
 where email_confirmed_at is null and encrypted_password is not null;

delete from auth.email_tokens
 where purpose = 'confirm' and attempt_id is null and used_at is null
   and user_id in (select id from auth.users where email_confirmed_at is null);
