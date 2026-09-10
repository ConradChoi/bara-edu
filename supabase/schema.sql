-- bara-edu-lms schema
-- Supabase SQL Editor에서 그대로 실행하세요. 여러 번 다시 실행해도 안전합니다(idempotent).
-- 근거: docs/02-design/features/bara-edu-lms.design.md 3절 Data Model

-- ===================== Enums =====================
-- Postgres는 CREATE TYPE IF NOT EXISTS를 지원하지 않아 예외 처리로 우회한다.
do $$ begin
  create type user_role as enum ('learner', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type profile_status as enum ('active', 'withdrawn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type course_status as enum ('active', 'upcoming', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type enrollment_status as enum ('pending', 'approved', 'rejected', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type assignment_status as enum ('submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type legal_doc_type as enum ('terms', 'privacy', 'refund_policy', 'etc');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lesson_mode as enum ('video', 'online', 'offline');
exception when duplicate_object then null; end $$;

do $$ begin
  create type course_schedule_type as enum ('weekday', 'weekend', 'both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type course_material_kind as enum ('main', 'supplementary');
exception when duplicate_object then null; end $$;

-- ===================== Tables =====================

-- 회원 프로필 (auth.users 1:1)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  role user_role not null default 'learner',
  status profile_status not null default 'active',
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);

-- 카테고리 (최대 3Depth, self-referencing)
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references categories(id) on delete restrict,
  depth smallint not null check (depth between 1 and 3),
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists categories_parent_id_idx on categories(parent_id);

-- 강좌
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category_id uuid references categories(id),
  description text,
  instructor text,
  fee integer not null default 0,
  seats integer not null default 0,
  government_support boolean not null default false,
  status course_status not null default 'upcoming',
  created_at timestamptz not null default now()
);
create index if not exists courses_category_id_idx on courses(category_id);

-- slug 컬럼: /courses/[slug] 라우트용 (2026-08-06 추가, 기존 실행분과 호환되도록 alter 방식)
alter table courses add column if not exists slug text;
update courses set slug = id::text where slug is null;
alter table courses alter column slug set not null;
create unique index if not exists courses_slug_key on courses(slug);

-- 강의 (강좌 내 커리큘럼 항목, 링크형 영상)
create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  video_url text,
  "order" integer not null default 0,
  has_quiz boolean not null default false,
  has_assignment boolean not null default false
);
create index if not exists lessons_course_id_idx on lessons(course_id);

-- 수강 신청 (무통장입금)
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id),
  status enrollment_status not null default 'pending',
  payment_method text not null default 'bank_transfer',
  payment_due_at timestamptz not null default (now() + interval '3 days'), -- flows.md Q2: 입금기한 3일
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);
create index if not exists enrollments_user_id_idx on enrollments(user_id);
create index if not exists enrollments_course_id_idx on enrollments(course_id);

-- 진도 (강의 단위 완료 체크 — 사용자가 "학습 완료로 표시" 클릭 시 기록, flows.md 2.3)
create table if not exists progress (
  user_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  completed_at timestamptz,
  primary key (user_id, lesson_id)
);

-- 퀴즈 응시 (재응시 무제한, flows.md Q5)
create table if not exists quiz_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  score integer not null,
  attempt_no integer not null default 1,
  submitted_at timestamptz not null default now()
);
create index if not exists quiz_submissions_user_lesson_idx on quiz_submissions(user_id, lesson_id);

-- 과제 제출 (기한 초과해도 제출 가능, 감점 없음 — flows.md Q6)
create table if not exists assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  content text not null,
  status assignment_status not null default 'submitted',
  is_late boolean not null default false,
  submitted_at timestamptz not null default now()
);
create index if not exists assignment_submissions_user_lesson_idx on assignment_submissions(user_id, lesson_id);

-- 수료증 (진도 100% + 과제 승인, 또는 Admin 수동 처리 — flows.md Q7/Q9)
create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id),
  issued_at timestamptz not null default now(),
  file_url text,
  is_manual_override boolean not null default false,
  unique (user_id, course_id)
);

-- 약관/정책 CMS (버전 관리)
create table if not exists legal_documents (
  id uuid primary key default gen_random_uuid(),
  type legal_doc_type not null,
  slug text not null,
  title text not null,
  content text not null,
  version integer not null default 1,
  is_published boolean not null default false,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists legal_documents_slug_idx on legal_documents(slug);

-- ===================== Helper: is_admin() =====================
-- search_path를 고정하지 않으면 호출 세션의 search_path에 따라 SECURITY DEFINER 함수가
-- 의도하지 않은 스키마의 동명 객체를 참조할 수 있다(고전적 search_path hijacking 패턴).
-- 이 함수는 거의 모든 RLS 정책·트리거가 의존하는 인가 판정의 근간이라 특히 고정이 중요하다
-- (security-officer 점검, 2026-08-08 — module-lms-6 검토 중 발견).
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ===================== Helper: is_active_learner() =====================
-- withdraw()는 profiles.status를 'withdrawn'으로 바꾸고 progress/quiz_submissions/
-- assignment_submissions를 삭제하지만, refresh token만 무효화될 뿐 이미 발급된
-- access_token(JWT)은 자연 만료 전까지 유효하다. 그 창(최대 수십분) 동안 탈퇴 직전
-- 토큰을 들고 있으면 여전히 approved 상태로 남은 enrollments를 통해 강의실/퀴즈/수료증
-- 발급 RPC를 그대로 호출할 수 있었다 — "탈퇴 시 즉시 학습이력 파기" 보장과 어긋난다
-- (security-officer 점검, 2026-08-09). 학습자 자기서비스 접근이 걸린 정책/RPC에는
-- is_admin() 대신(또는 함께) 이 함수로 profiles.status='active'까지 재확인한다.
create or replace function is_active_learner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and status = 'active'
  );
$$;

-- ===================== Trigger: auth.users → profiles 자동 생성 =====================
-- Supabase Auth로 가입/생성된 계정은 profiles 테이블에 행이 없으면 role/status 판단이 불가능하다.
-- 회원가입(Server Action) 시 name/phone을 auth 메타데이터(raw_user_meta_data)로 함께 넘기면 여기서 반영된다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, phone, role, status, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    'learner',
    'active',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===================== Trigger: profiles 권한 컬럼 보호 =====================
-- profiles_self_update 정책은 "본인 행"이라는 조건만 걸려 있어, 로그인한 학습자가 PostgREST를
-- 직접 호출해 자기 role을 'admin'으로 바꾸거나 status를 임의로 되돌릴 수 있는 권한상승 허점이 있었다.
-- (module-lms-4 회원탈퇴 self-update 구현 중 발견, 2026-08-06). 관리자가 아닌 요청은 role을 항상
-- 기존값으로 되돌리고, status는 'active'→'withdrawn' 전환만 허용한다.
-- email 보호: profiles.email은 auth.users.email의 read-only 복제본으로 관리자 회원
-- 검색(module-lms-6)이 신뢰하는 값이다. profiles_self_update 정책은 "본인 행"만
-- 검사하고 컬럼 제한이 없어, 이 보호가 없으면 학습자가 REST API로 자기 email을 임의
-- 문자열(타인 이메일 사칭 등)로 바꿔 관리자 검색 결과를 오염시킬 수 있었다
-- (security-officer 점검, 2026-08-08).
-- 단, withdraw()(app/actions/account.ts)는 관리자 권한 없이 "본인 행"으로
-- status를 active→withdrawn으로 바꾸면서 email도 함께 익명화하므로, 그 특정
-- 전환 한 번만 email 변경을 허용한다(그 외의 모든 자기 업데이트는 email을 되돌린다).
-- photo_path 보호: profiles_self_update 정책은 "본인 행"만 확인하고 컬럼 값의 형식은
-- 확인하지 않는다. applyToCourse()가 "photo_path는 본인이 업로드한 {auth.uid()}/photo
-- 경로만 가리킨다"고 가정하고 그 값을 그대로 서명 URL 발급(관리자 회원상세)에 쓰는데,
-- DB가 이 가정을 강제하지 않으면 학습자가 PostgREST로 자기 photo_path를 다른 회원의
-- uuid 경로로 바꿔치기해 관리자가 엉뚱한(타인의) 얼굴 사진을 보게 만들 수 있었다
-- (member_photos_read storage 정책이 admin에게 버킷 내 모든 객체 read를 허용하므로,
-- 경로 문자열만 알면 어떤 사진이든 가리킬 수 있었음 — security-officer 점검, 2026-08-28).
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not is_admin() then
    new.role := old.role;
    if old.status = 'active' and new.status = 'withdrawn' then
      -- 탈퇴 전환: withdraw()가 name/phone/email을 익명화 값으로 바꾸는 것을 허용한다.
      null;
    else
      new.status := old.status;
      new.withdrawn_at := old.withdrawn_at;
      new.email := old.email;
    end if;

    if new.photo_path is not null and new.photo_path <> (auth.uid()::text || '/photo') then
      new.photo_path := old.photo_path;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on profiles;
create trigger protect_profile_privileged_columns
  before update on profiles
  for each row execute function public.protect_profile_privileged_columns();

-- ===================== Trigger: enrollments 재신청 시 course_id 고정 =====================
-- enrollments_self_reapply 정책의 WITH CHECK는 status만 고정하고 course_id는 그대로 두어,
-- 반려/만료된 신청 건을 API로 직접 UPDATE하면서 다른 강좌로 바꿔치기할 수 있는 허점이 있었다
-- (security-officer 점검, 2026-08-06). 관리자가 아닌 요청은 course_id를 항상 기존 값으로 고정한다.
create or replace function public.protect_enrollment_course_id()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not is_admin() then
    new.course_id := old.course_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_enrollment_course_id on enrollments;
create trigger protect_enrollment_course_id
  before update on enrollments
  for each row execute function public.protect_enrollment_course_id();

-- ===================== RLS =====================
-- 근거: design.md 3.2 RLS 정책 개요
-- CREATE POLICY는 IF NOT EXISTS를 지원하지 않으므로 매번 DROP POLICY IF EXISTS 후 재생성한다.

alter table profiles enable row level security;
alter table categories enable row level security;
alter table courses enable row level security;
alter table lessons enable row level security;
alter table enrollments enable row level security;
alter table progress enable row level security;
alter table quiz_submissions enable row level security;
alter table assignment_submissions enable row level security;
alter table certificates enable row level security;
alter table legal_documents enable row level security;

-- profiles: 본인 read/update, 관리자 전체 read
drop policy if exists "profiles_self_select" on profiles;
create policy "profiles_self_select" on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles for update using (id = auth.uid());
drop policy if exists "profiles_admin_all" on profiles;
create policy "profiles_admin_all" on profiles for all using (is_admin());

-- categories: 전체 read, 관리자만 write
drop policy if exists "categories_public_select" on categories;
create policy "categories_public_select" on categories for select using (true);
drop policy if exists "categories_admin_write" on categories;
create policy "categories_admin_write" on categories for insert with check (is_admin());
drop policy if exists "categories_admin_update" on categories;
create policy "categories_admin_update" on categories for update using (is_admin());
drop policy if exists "categories_admin_delete" on categories;
create policy "categories_admin_delete" on categories for delete using (is_admin());

-- courses: active/upcoming는 전체 공개, 관리자는 전체 read/write
drop policy if exists "courses_public_select" on courses;
create policy "courses_public_select" on courses for select using (status in ('active', 'upcoming') or is_admin());
drop policy if exists "courses_admin_write" on courses;
create policy "courses_admin_write" on courses for insert with check (is_admin());
drop policy if exists "courses_admin_update" on courses;
create policy "courses_admin_update" on courses for update using (is_admin());
drop policy if exists "courses_admin_delete" on courses;
create policy "courses_admin_delete" on courses for delete using (is_admin());

-- lessons: courses와 동일 기준(공개 강좌의 커리큘럼은 공개), 관리자 전체
drop policy if exists "lessons_public_select" on lessons;
create policy "lessons_public_select" on lessons for select using (
  is_admin() or exists (select 1 from courses c where c.id = lessons.course_id and c.status in ('active','upcoming'))
);
drop policy if exists "lessons_admin_write" on lessons;
create policy "lessons_admin_write" on lessons for insert with check (is_admin());
drop policy if exists "lessons_admin_update" on lessons;
create policy "lessons_admin_update" on lessons for update using (is_admin());
drop policy if exists "lessons_admin_delete" on lessons;
create policy "lessons_admin_delete" on lessons for delete using (is_admin());

-- enrollments: 본인 read/insert, 관리자 전체 read/update
-- WITH CHECK에 status='pending'이 없으면 학습자가 PostgREST를 직접 호출해 입금 없이
-- status='approved' 신청 레코드를 만들 수 있다(관리자 승인 절차 완전 우회). 승인은
-- enrollments_admin_update 정책을 통해 관리자만 할 수 있어야 한다(security-officer 점검, 2026-08-06).
drop policy if exists "enrollments_self_select" on enrollments;
create policy "enrollments_self_select" on enrollments for select using (user_id = auth.uid() or is_admin());
drop policy if exists "enrollments_self_insert" on enrollments;
create policy "enrollments_self_insert" on enrollments for insert with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "enrollments_admin_update" on enrollments;
create policy "enrollments_admin_update" on enrollments for update using (is_admin());

-- 반려/만료(입금기한초과) 건에 한해 본인이 재신청(status→pending)할 수 있도록 허용
-- (flows.md Q2: "입금기한 3일, 초과 시 자동 만료(재신청 가능)". 'expired' enum 값은 아직 자동 기록되지
--  않으므로 payment_due_at 초과한 pending 건을 만료로 간주해 재신청을 허용한다. 2026-08-06)
drop policy if exists "enrollments_self_reapply" on enrollments;
create policy "enrollments_self_reapply" on enrollments for update
  using (
    user_id = auth.uid()
    and (status = 'rejected' or (status = 'pending' and payment_due_at < now()))
  )
  with check (user_id = auth.uid() and status = 'pending');

-- progress / quiz_submissions: 본인 read/write, 관리자 read
-- with check에 is_active_learner()를 추가해, 탈퇴 직후(토큰이 아직 만료 전인 창) 삭제된
-- 학습 기록을 본인이 다시 써넣는 것을 막는다(security-officer 점검, 2026-08-09).
drop policy if exists "progress_self_all" on progress;
create policy "progress_self_all" on progress for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() and is_active_learner());
drop policy if exists "quiz_submissions_self_all" on quiz_submissions;
create policy "quiz_submissions_self_all" on quiz_submissions for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() and is_active_learner());

-- assignment_submissions: 본인 read/insert, 관리자 read + status update
drop policy if exists "assignment_submissions_self_select" on assignment_submissions;
create policy "assignment_submissions_self_select" on assignment_submissions for select using (user_id = auth.uid() or is_admin());
drop policy if exists "assignment_submissions_self_insert" on assignment_submissions;
create policy "assignment_submissions_self_insert" on assignment_submissions for insert with check (user_id = auth.uid() and is_active_learner());
drop policy if exists "assignment_submissions_admin_update" on assignment_submissions;
create policy "assignment_submissions_admin_update" on assignment_submissions for update using (is_admin());

-- certificates: 본인 read, 관리자 전체 read/write
drop policy if exists "certificates_self_select" on certificates;
create policy "certificates_self_select" on certificates for select using (user_id = auth.uid() or is_admin());
drop policy if exists "certificates_admin_write" on certificates;
create policy "certificates_admin_write" on certificates for insert with check (is_admin());
drop policy if exists "certificates_admin_update" on certificates;
create policy "certificates_admin_update" on certificates for update using (is_admin());

-- legal_documents: published만 공개, 관리자 전체
drop policy if exists "legal_documents_public_select" on legal_documents;
create policy "legal_documents_public_select" on legal_documents for select using (is_published = true or is_admin());
drop policy if exists "legal_documents_admin_write" on legal_documents;
create policy "legal_documents_admin_write" on legal_documents for insert with check (is_admin());
drop policy if exists "legal_documents_admin_update" on legal_documents;
create policy "legal_documents_admin_update" on legal_documents for update using (is_admin());
drop policy if exists "legal_documents_admin_delete" on legal_documents;
create policy "legal_documents_admin_delete" on legal_documents for delete using (is_admin());

-- ===================== 최초 Admin 계정 (flows.md Q8) =====================
-- 개발 단계에서는 Supabase 콘솔 → Authentication에서 계정 생성 후,
-- 아래를 SQL Editor에서 실행해 admin으로 지정한다.
-- (트리거가 이 스키마 실행 "이후"의 신규 가입자에게만 적용되므로,
--  스키마 실행 전에 이미 만든 계정은 upsert로 처리한다)
-- insert into profiles (id, name, role, status)
-- values ('<user-uuid>', '관리자', 'admin', 'active')
-- on conflict (id) do update set role = 'admin';

-- ===================== module-lms-6: Admin 콘솔 스키마 추가 (2026-08-06) =====================

-- categories.is_active: 삭제 대신 비활성화 지원 (F-ADMCAT-3). 공개 조회는 활성 카테고리만,
-- 관리자는 전체 조회(is_admin() 우회)한다.
alter table categories add column if not exists is_active boolean not null default true;

drop policy if exists "categories_public_select" on categories;
create policy "categories_public_select" on categories for select using (is_active = true or is_admin());

-- profiles.email: auth.users.email의 read-only 복제본. profiles에는 원래 이메일 컬럼이
-- 없어 관리자가 "이름/이메일"로 회원을 검색할 방법이 없었다(F-ADMM-1). 신규가입은 위
-- handle_new_user()가 채우고, 탈퇴 시 app/actions/account.ts의 withdraw()가 함께
-- 익명화해야 한다(그러지 않으면 이 복제본만 탈퇴 전 이메일로 남아 익명화가 무의미해진다).
alter table profiles add column if not exists email text;
create index if not exists profiles_email_idx on profiles(email);

update profiles set email = u.email
from auth.users u
where u.id = profiles.id and profiles.email is null;

-- enrollments.rejection_reason: 반려/승인취소 사유. 기존 스키마에는 이 값을 저장할 컬럼이
-- 전혀 없었다(F-ADME-3 "반려 시 사유 입력 필수, 학습자에게 사유 노출"이 구현 불가능했음).
-- enrollments.approved_at: F-ADM-1 대시보드 "오늘 승인" 카드 계산용 — 승인 시각을 알 수
-- 있는 컬럼이 없었다(created_at은 "신청" 시각).
alter table enrollments add column if not exists rejection_reason text;
alter table enrollments add column if not exists approved_at timestamptz;
create index if not exists enrollments_status_idx on enrollments(status);

-- certificates.note: 수동 수료 처리 사유 기록 (F-ADMCE-3 "오프라인 보강 등 사유 기록").
alter table certificates add column if not exists note text;

-- legal_documents: (slug, version) 유일성 보장 — "수정 시 새 버전 행 생성 + 이전 이력
-- 보존" 방식(F-CMS-2)의 데이터 무결성을 위해 필요하다.
create unique index if not exists legal_documents_slug_version_key on legal_documents(slug, version);

-- 특정 문서를 게시하면서 같은 slug의 다른 버전은 원자적으로 게시 해제하는 함수.
-- PostgREST는 클라이언트에서 여러 UPDATE를 하나의 트랜잭션으로 묶을 수 없으므로,
-- "게시 시 한 slug에 published가 하나만 존재"하는 불변식을 DB 함수 안에서 보장한다.
create or replace function public.publish_legal_document(doc_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_slug text;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  select slug into target_slug from legal_documents where id = doc_id;
  if target_slug is null then
    raise exception 'document not found';
  end if;

  update legal_documents set is_published = false where slug = target_slug and id <> doc_id;
  update legal_documents set is_published = true where id = doc_id;
end;
$$;

-- ===================== module-lms-5: 강의실(진도·퀴즈·과제·수료증) 스키마 추가 (2026-08-09) =====================

-- lessons.assignment_due_at: 과제 마감기한. null이면 마감 없음(항상 정시로 간주) — Q6 정책상
-- 마감 초과 제출도 허용하되 "기한 초과" 표시만 하므로, 감점이 아니라 표시 목적의 컬럼이다.
alter table lessons add column if not exists assignment_due_at timestamptz;

-- 퀴즈 문항/선택지 (단일 정답 객관식). is_correct는 학습자에게 절대 노출하지 않는다 —
-- 아래 RLS로 관리자 외 직접 select 자체를 막고, 학습자는 get_quiz_for_lesson()/
-- submit_quiz_attempt() RPC로만 접근한다(정답 유출·채점 조작 방지).
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  question text not null,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists quiz_questions_lesson_id_idx on quiz_questions(lesson_id);

create table if not exists quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references quiz_questions(id) on delete cascade,
  label text not null,
  is_correct boolean not null default false,
  "order" integer not null default 0
);
create index if not exists quiz_options_question_id_idx on quiz_options(question_id);

-- 문항당 정답은 최대 1개만 존재해야 한다 — DB 레벨에서 강제한다(qa-reviewer 점검,
-- 2026-08-09: 정답 설정이 원자적이지 않으면 한 문항에 정답이 0개 또는 2개 남아
-- submit_quiz_attempt()의 INNER JOIN 채점 로직이 조용히 틀어질 수 있었다).
create unique index if not exists quiz_options_one_correct_per_question
  on quiz_options(question_id) where is_correct;

alter table quiz_questions enable row level security;
alter table quiz_options enable row level security;

drop policy if exists "quiz_questions_admin_select" on quiz_questions;
create policy "quiz_questions_admin_select" on quiz_questions for select using (is_admin());
drop policy if exists "quiz_questions_admin_write" on quiz_questions;
create policy "quiz_questions_admin_write" on quiz_questions for insert with check (is_admin());
drop policy if exists "quiz_questions_admin_update" on quiz_questions;
create policy "quiz_questions_admin_update" on quiz_questions for update using (is_admin());
drop policy if exists "quiz_questions_admin_delete" on quiz_questions;
create policy "quiz_questions_admin_delete" on quiz_questions for delete using (is_admin());

drop policy if exists "quiz_options_admin_select" on quiz_options;
create policy "quiz_options_admin_select" on quiz_options for select using (is_admin());
drop policy if exists "quiz_options_admin_write" on quiz_options;
create policy "quiz_options_admin_write" on quiz_options for insert with check (is_admin());
drop policy if exists "quiz_options_admin_update" on quiz_options;
create policy "quiz_options_admin_update" on quiz_options for update using (is_admin());
drop policy if exists "quiz_options_admin_delete" on quiz_options;
create policy "quiz_options_admin_delete" on quiz_options for delete using (is_admin());

-- courses/lessons: 기존 courses_public_select/lessons_public_select는 course.status가
-- active/upcoming일 때만 비관리자에게 노출한다. 강좌가 closed로 바뀌면 이미 승인된 학습자도
-- 강의실 자체에 접근할 수 없게 되는 허점이 있었다(module-lms-5 설계 중 발견, 2026-08-09).
-- permissive 정책은 기존 정책과 OR로 합쳐지므로, 승인된 신청자는 강좌 상태와 무관하게
-- 계속 접근 가능하도록 추가만 한다(기존 정책은 건드리지 않음).
drop policy if exists "courses_enrolled_select" on courses;
create policy "courses_enrolled_select" on courses for select using (
  is_active_learner() and exists (
    select 1 from enrollments e
    where e.course_id = courses.id and e.user_id = auth.uid() and e.status = 'approved'
  )
);

drop policy if exists "lessons_enrolled_select" on lessons;
create policy "lessons_enrolled_select" on lessons for select using (
  is_active_learner() and exists (
    select 1 from enrollments e
    where e.course_id = lessons.course_id and e.user_id = auth.uid() and e.status = 'approved'
  )
);

-- ===================== RPC: 문항 정답 설정 (원자적) =====================
-- admin-quiz.ts의 setCorrectOption()이 원래 "전체 false → 대상 true" 두 번의 순차 update로
-- 구현돼 있었는데, 두 번째 update가 실패하면 그 문항의 정답이 0개로 남아 submit_quiz_attempt()
-- 채점에서 조용히 제외되는 문제가 있었다(qa-reviewer 점검, 2026-08-09). 하나의 함수(=하나의
-- 트랜잭션)로 묶어 원자성을 보장하고, 위 unique index로 "정답 2개" 상태도 DB가 막는다.
create or replace function public.set_quiz_correct_option(p_question_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  update quiz_options set is_correct = false where question_id = p_question_id and is_correct = true;

  update quiz_options set is_correct = true where id = p_option_id and question_id = p_question_id;
  -- p_option_id가 p_question_id 소속이 아니면 위 update가 0행에 적용되어, 첫 번째 update로
  -- 지워진 기존 정답만 남고 해당 문항의 정답이 조용히 0개가 될 수 있었다 — 명시적으로 에러를
  -- 낸다(security-officer 점검, 2026-08-09).
  if not found then
    raise exception 'option does not belong to question';
  end if;
end;
$$;

-- ===================== RPC: 퀴즈 조회 (정답 비공개) =====================
-- security-officer 점검(2026-08-09)에서 발견: 최초 구현은 auth.uid() is null만 확인하고
-- 수강 승인 여부를 재검증하지 않아, active/upcoming 강좌는 lesson_id만 알면(커리큘럼
-- 자체가 공개라 미승인/미가입자도 확인 가능) 로그인만 한 계정으로 퀴즈 문제를 그대로
-- 열람할 수 있었다. issue_certificate_self()와 동일하게 enrollments.status='approved'를
-- 재검증한다.
create or replace function public.get_quiz_for_lesson(p_lesson_id uuid)
returns table (
  question_id uuid,
  question text,
  question_order integer,
  option_id uuid,
  option_label text,
  option_order integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from lessons l
    join enrollments e on e.course_id = l.course_id
    where l.id = p_lesson_id and e.user_id = v_user_id and e.status = 'approved'
  ) then
    raise exception 'not enrolled or not approved';
  end if;

  return query
    select q.id, q.question, q."order", o.id, o.label, o."order"
    from quiz_questions q
    join quiz_options o on o.question_id = q.id
    where q.lesson_id = p_lesson_id
    order by q."order", o."order";
end;
$$;

-- ===================== RPC: 퀴즈 제출·즉시 채점 =====================
-- p_selected_option_ids: 문항당 최대 1개(단일 정답 객관식)씩 고른 option id 배열.
-- auth.uid()를 내부에서만 사용해 타인 명의 제출을 원천 차단한다.
-- security-officer 점검(2026-08-09)에서 발견한 2건을 함께 수정한다:
--   1) results jsonb에 correctOptionId를 그대로 담아 반환해, REST로 이 RPC를 직접 호출하면
--      정답을 그대로 확인할 수 있었다 — isCorrect 불리언만 남기고 정답 id는 제거한다.
--   2) get_quiz_for_lesson()과 마찬가지로 수강 승인 여부를 재검증하지 않았다 — 추가한다.
create or replace function public.submit_quiz_attempt(p_lesson_id uuid, p_selected_option_ids uuid[])
returns table (
  attempt_no integer,
  score integer,
  correct_count integer,
  total_questions integer,
  results jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_total_questions integer;
  v_correct_count integer;
  v_score integer;
  v_next_attempt integer;
  v_results jsonb;
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from lessons l
    join enrollments e on e.course_id = l.course_id
    where l.id = p_lesson_id and e.user_id = v_user_id and e.status = 'approved'
  ) then
    raise exception 'not enrolled or not approved';
  end if;

  select count(*) into v_total_questions from quiz_questions where lesson_id = p_lesson_id;
  if v_total_questions = 0 then
    raise exception 'quiz not found for lesson';
  end if;

  select
    jsonb_agg(jsonb_build_object(
      'questionId', q.id,
      'selectedOptionId', sel.option_id,
      'isCorrect', (sel.option_id is not null and sel.option_id = correct_opt.id)
    ) order by q."order"),
    count(*) filter (where sel.option_id is not null and sel.option_id = correct_opt.id)
  into v_results, v_correct_count
  from quiz_questions q
  join quiz_options correct_opt on correct_opt.question_id = q.id and correct_opt.is_correct = true
  left join lateral (
    select o.id as option_id
    from quiz_options o
    where o.question_id = q.id and o.id = any(p_selected_option_ids)
    limit 1
  ) sel on true
  where q.lesson_id = p_lesson_id;

  v_score := round(100.0 * v_correct_count / v_total_questions);

  select coalesce(max(qs.attempt_no), 0) + 1 into v_next_attempt
  from quiz_submissions qs
  where qs.user_id = v_user_id and qs.lesson_id = p_lesson_id;

  insert into quiz_submissions (user_id, lesson_id, score, attempt_no)
  values (v_user_id, p_lesson_id, v_score, v_next_attempt);

  return query select v_next_attempt, v_score, v_correct_count, v_total_questions, v_results;
end;
$$;

-- ===================== RPC: 수료증 자가 발급 =====================
-- certificates INSERT는 RLS상 is_admin() 전용이라 학습자가 직접 insert할 수 없다.
-- 이 함수가 서버에서 조건을 재검증한 뒤 SECURITY DEFINER로 insert한다 — 클라이언트가
-- "나는 자격 있음"이라 보내는 값은 절대 신뢰하지 않는다.
create or replace function public.issue_certificate_self(p_course_id uuid)
returns table (certificate_id uuid, issued_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_enrollment_status enrollment_status;
  v_total_lessons integer;
  v_completed_lessons integer;
  v_missing_assignments integer;
  v_cert_id uuid;
  v_issued_at timestamptz;
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  select status into v_enrollment_status
  from enrollments
  where user_id = v_user_id and course_id = p_course_id;

  if v_enrollment_status is distinct from 'approved' then
    raise exception 'not enrolled or not approved';
  end if;

  select count(*) into v_total_lessons from lessons where course_id = p_course_id;
  if v_total_lessons = 0 then
    raise exception 'course has no lessons';
  end if;

  select count(*) into v_completed_lessons
  from lessons l
  join progress p on p.lesson_id = l.id and p.user_id = v_user_id and p.completed_at is not null
  where l.course_id = p_course_id;

  if v_completed_lessons < v_total_lessons then
    raise exception 'progress incomplete';
  end if;

  -- 과제 있는 강의는 "가장 최근 제출"이 approved여야 함(재제출 시 이전 rejected 행은 무시)
  select count(*) into v_missing_assignments
  from lessons l
  where l.course_id = p_course_id
    and l.has_assignment = true
    and coalesce((
      select a.status::text
      from assignment_submissions a
      where a.lesson_id = l.id and a.user_id = v_user_id
      order by a.submitted_at desc
      limit 1
    ), '') <> 'approved';

  if v_missing_assignments > 0 then
    raise exception 'assignment not approved';
  end if;

  insert into certificates (user_id, course_id)
  values (v_user_id, p_course_id)
  on conflict (user_id, course_id) do nothing
  returning id, issued_at into v_cert_id, v_issued_at;

  if v_cert_id is null then
    select id, issued_at into v_cert_id, v_issued_at
    from certificates where user_id = v_user_id and course_id = p_course_id;
  end if;

  return query select v_cert_id, v_issued_at;
end;
$$;

-- assignment_submissions.review_note: 반려 사유(flows.md §2.4 "반려 사유와 함께 재제출
-- 유도"). 원래 스키마에 이 값을 저장할 컬럼이 없었다(module-lms-5 Phase 4.5 설계 중 발견,
-- 2026-08-09) — enrollments.rejection_reason과 동일한 패턴으로 추가한다.
alter table assignment_submissions add column if not exists review_note text;

-- courses.total_hours: 총 강좌 시간(단위: 시간). 강좌 등록 시 선택 입력 — 기존 강좌는
-- null(미입력)로 남고, 공개 화면(/courses, /courses/[slug])은 null이면 표시를 생략한다.
-- 음수 방지는 fee/seats와 동일하게 앱 레벨(admin-courses.ts readCourseFields)에서 검증한다
-- — 이 스키마 전체가 재실행 가능(idempotent)해야 하는데 check 제약은 그렇게 걸기 번거롭다
-- (관리자 요청, 2026-08-17).
alter table courses add column if not exists total_hours integer;

-- lessons.lesson_mode: 강의 방식(영상 링크/온라인 수업/오프라인 수업). 기존 강의는 전부
-- 'video'(기존 동작 그대로)로 마이그레이션된다. online/offline 전용 필드는 앱 레벨에서
-- 모드에 맞게만 채우도록 검증한다(admin-courses.ts) — video_url처럼 전부 nullable로 두고
-- DB check 제약은 스키마 재실행 편의를 위해 걸지 않는다(관리자 요청, 2026-08-25).
alter table lessons add column if not exists lesson_mode lesson_mode not null default 'video';
alter table lessons add column if not exists online_meeting_url text;
alter table lessons add column if not exists online_scheduled_at timestamptz;
alter table lessons add column if not exists offline_location_name text;
alter table lessons add column if not exists offline_address text;

-- courses.start_date: 강좌 시작 년월일(달력 날짜, 시간 없음). total_hours와 동일하게
-- 선택 입력 — 기존 강좌는 null(미입력)로 남고, 공개 화면은 null이면 표시를 생략한다
-- (관리자 요청, 2026-08-26).
alter table courses add column if not exists start_date date;

-- courses.end_date/schedule_type: 종료일과 평일반/주말반/평일+주말반 구분. start_date와
-- 동일하게 둘 다 선택 입력 — 값이 없으면 공개 화면에서 표시를 생략한다(관리자 요청, 2026-08-28).
alter table courses add column if not exists end_date date;
alter table courses add column if not exists schedule_type course_schedule_type;

-- ===================== module: 입금 계좌 관리 + 수강신청 추가정보(주소/사진) (2026-08-28) =====================

-- 입금 계좌(무통장입금 안내용). 이전에는 환경변수(NEXT_PUBLIC_BANK_NAME 등)로 계좌 1개만
-- 하드코딩했는데 실제로는 한 번도 설정된 적이 없어 항상 "계좌 정보를 준비 중이에요"만
-- 노출되고 있었다 — Admin에서 관리하는 정식 다중 계좌(최대 3개)로 교체한다.
create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_number text not null,
  account_holder text not null,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);

alter table bank_accounts enable row level security;

-- 계좌번호·예금주 실명이 결합된 정보라 비로그인 상태의 완전 공개는 두지 않는다 — 신청
-- 확인 화면은 어차피 로그인해야 도달하므로 UX 손실 없이 로그인 회원으로만 제한한다
-- (security-officer 점검 후 대표 확인, 2026-08-28).
-- 정책 이름을 bank_accounts_public_select에서 바꾸면서 새 이름 쪽 drop을 빠뜨려
-- 재실행 시 "policy already exists" 에러가 났다(idempotent 원칙 위반, 2026-08-29
-- 사용자 리포트로 발견). 두 이름 다 drop해 이전 실행 상태와 무관하게 항상 재실행 가능하게 한다.
drop policy if exists "bank_accounts_public_select" on bank_accounts;
drop policy if exists "bank_accounts_authenticated_select" on bank_accounts;
create policy "bank_accounts_authenticated_select" on bank_accounts for select using (auth.role() = 'authenticated');
drop policy if exists "bank_accounts_admin_write" on bank_accounts;
create policy "bank_accounts_admin_write" on bank_accounts for insert with check (is_admin());
drop policy if exists "bank_accounts_admin_update" on bank_accounts;
create policy "bank_accounts_admin_update" on bank_accounts for update using (is_admin());
drop policy if exists "bank_accounts_admin_delete" on bank_accounts;
create policy "bank_accounts_admin_delete" on bank_accounts for delete using (is_admin());

-- 최대 3개 제한을 app 레벨(count 확인 후 insert)로만 두면 동시 요청(빠른 연속 클릭,
-- 다중 탭)에서 count 확인과 insert 사이 경쟁으로 4개 이상 생성될 수 있다 — 이 프로젝트가
-- quiz_options_one_correct_per_question(유니크 인덱스)·enrollments 낙관적 동시성 갱신에서
-- 이미 겪은 것과 같은 유형의 TOCTOU다. advisory lock으로 같은 트랜잭션 안에서 insert를
-- 직렬화한 뒤 개수를 재확인해 원자적으로 강제한다(qa-reviewer 점검, 2026-08-28).
create or replace function public.enforce_bank_accounts_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('bank_accounts_limit'));
  if (select count(*) from bank_accounts) >= 3 then
    raise exception 'bank account limit reached (max 3)';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_bank_accounts_limit on bank_accounts;
create trigger enforce_bank_accounts_limit
  before insert on bank_accounts
  for each row execute function public.enforce_bank_accounts_limit();

-- profiles.address/photo_path: 수강신청 확인 화면에서 회원당 1회 입력받아 재사용한다
-- (자격증 발급에 필요, 관리자 요청). photo_path는 공개 URL이 아니라 private 스토리지
-- 버킷(member-photos) 안의 객체 경로("{user_id}/photo")만 저장한다 — 사람 얼굴이 담긴
-- 민감한 개인정보라 어디서든 URL만 알면 볼 수 있는 공개 URL로 두지 않는다. Admin이 볼
-- 때는 매번 짧은 만료시간의 서명 URL을 새로 발급한다(lib/supabase/admin-queries.ts).
alter table profiles add column if not exists address text;
alter table profiles add column if not exists photo_path text;

insert into storage.buckets (id, name, public)
values ('member-photos', 'member-photos', false)
on conflict (id) do nothing;

-- 본인 폴더({auth.uid()}/...)에만 read/write 가능, 관리자는 전체 read 가능.
-- storage.foldername()은 경로를 '/'로 분리한 배열을 반환한다 — 첫 세그먼트가 업로더의 uid다.
drop policy if exists "member_photos_owner_write" on storage.objects;
create policy "member_photos_owner_write" on storage.objects for insert
  with check (bucket_id = 'member-photos' and (storage.foldername(name))[1] = auth.uid()::text);
-- with check도 함께 둬서 "수정 후에도 본인 경로"까지 대칭적으로 강제한다 — using만 있으면
-- 변경 전 소유권만 확인하고 변경 후 값(name 등)은 검사하지 않는다(security-officer 점검, 2026-08-28).
drop policy if exists "member_photos_owner_update" on storage.objects;
create policy "member_photos_owner_update" on storage.objects for update
  using (bucket_id = 'member-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'member-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "member_photos_read" on storage.objects;
create policy "member_photos_read" on storage.objects for select
  using (bucket_id = 'member-photos' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
drop policy if exists "member_photos_owner_delete" on storage.objects;
create policy "member_photos_owner_delete" on storage.objects for delete
  using (bucket_id = 'member-photos' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- courses.requires_certificate_info: 강좌마다 자격증 발급용 추가정보(주소/사진)가
-- 필요한지가 다르다 — 자격과정이 아닌 보수교육·일반교육은 필요 없다(관리자 요청,
-- 2026-08-29). 기존 강좌는 지금까지 무조건 필수였던 동작을 그대로 유지하도록
-- true로 마이그레이션하고, 관리자가 강좌별로 끌 수 있게 한다.
alter table courses add column if not exists requires_certificate_info boolean not null default true;

-- ===================== 강좌 교재(주교재/보조교재) (2026-08-30) =====================
-- 주교재는 강좌당 1개, 보조교재(유인물·PPT 등 다양한 자료 포함)는 여러 개 등록 가능
-- (관리자 요청). lessons와 동일하게 별도 테이블로 두고 RLS도 courses_public_select/
-- courses_enrolled_select와 동일한 기준(공개 강좌는 전체 공개, 승인된 학습자는 강좌
-- 상태 무관 접근)을 그대로 재사용한다. 셋 다 선택 입력이라 title 외에는 nullable이다.
create table if not exists course_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  kind course_material_kind not null,
  title text not null,
  publisher text,
  purchase_url text,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists course_materials_course_id_idx on course_materials(course_id);

-- 주교재는 강좌당 1개만 — app 레벨에서도 UI로 막지만(있으면 "추가" 폼 대신 수정 폼만
-- 보여줌), DB 레벨에서도 부분 유니크 인덱스로 강제한다(quiz_options_one_correct_per_question과
-- 동일 패턴).
create unique index if not exists course_materials_one_main_per_course
  on course_materials(course_id) where kind = 'main';

alter table course_materials enable row level security;

drop policy if exists "course_materials_public_select" on course_materials;
create policy "course_materials_public_select" on course_materials for select using (
  is_admin() or exists (select 1 from courses c where c.id = course_materials.course_id and c.status in ('active','upcoming'))
);
drop policy if exists "course_materials_enrolled_select" on course_materials;
create policy "course_materials_enrolled_select" on course_materials for select using (
  is_active_learner() and exists (
    select 1 from enrollments e
    where e.course_id = course_materials.course_id and e.user_id = auth.uid() and e.status = 'approved'
  )
);
drop policy if exists "course_materials_admin_write" on course_materials;
create policy "course_materials_admin_write" on course_materials for insert with check (is_admin());
drop policy if exists "course_materials_admin_update" on course_materials;
create policy "course_materials_admin_update" on course_materials for update using (is_admin());
drop policy if exists "course_materials_admin_delete" on course_materials;
create policy "course_materials_admin_delete" on course_materials for delete using (is_admin());

-- ===================== module: 자격시험(Course Exam) (2026-09-09) =====================
-- 1Depth 카테고리가 "자격증"인 강좌는 교육 이수 후 시험을 볼 수도 있다(강좌별 선택).
-- 강의 퀴즈(quiz_questions 등)와는 완전히 분리된 테이블로 둔다 — 퀴즈는 "무제한 재응시,
-- 수료 조건과 무관"이고 이 시험은 "횟수 제한, 합격이 수료증 발급 조건"이라 정반대 규칙이라
-- 한 테이블에 섞으면 무제한 재응시 로직이 곧 수료 게이팅 우회 경로가 된다(product-manager
-- 확정, menu-features.md F-ADMC-7~9 제약).

-- categories.is_certification: 1Depth 카테고리 중 "이 카테고리는 자격증 과정"임을 표시하는
-- 플래그. 카테고리 이름 문자열("자격증")로 판정하면 관리자가 이름을 바꾸는 순간 기능이
-- 조용히 사라지므로 별도 컬럼으로 둔다(product-manager 지적). depth 2/3에서는 항상 false.
alter table categories add column if not exists is_certification boolean not null default false;

-- courses.requires_exam/exam_pass_score/exam_max_attempts: 강좌별 시험 설정. requires_exam이
-- false면 나머지 둘은 null로 유지된다(app 레벨에서 카테고리가 자격증이 아니면 항상
-- false로 정규화 — admin-courses.ts readCourseFields 참고).
alter table courses add column if not exists requires_exam boolean not null default false;
alter table courses add column if not exists exam_pass_score integer;
alter table courses add column if not exists exam_max_attempts integer;

-- 시험 문항/선택지 — quiz_questions/quiz_options와 동일한 "정답 비노출" 원칙을 그대로
-- 적용한다. 관리자만 직접 select 가능, 학습자는 get_course_exam()/submit_course_exam()
-- RPC로만 접근한다.
create table if not exists course_exam_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  question text not null,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists course_exam_questions_course_id_idx on course_exam_questions(course_id);

create table if not exists course_exam_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references course_exam_questions(id) on delete cascade,
  label text not null,
  is_correct boolean not null default false,
  "order" integer not null default 0
);
create index if not exists course_exam_options_question_id_idx on course_exam_options(question_id);

-- quiz_options_one_correct_per_question과 동일한 이유(정답 설정이 원자적이지 않으면
-- 문항당 정답이 0개/2개로 남을 수 있음) — DB 레벨로 강제한다.
create unique index if not exists course_exam_options_one_correct_per_question
  on course_exam_options(question_id) where is_correct;

-- 응시 기록. passed는 응시 시점 exam_pass_score 기준 스냅샷으로, 이후 합격 기준이
-- 바뀌어도 재계산하지 않는다(지난 합격이 나중에 뒤집히면 안 됨 — product-manager 확정).
-- attempt_no는 "가장 최근 리셋 이후" 1부터 재기산한다(잔여 응시 횟수 계산 기준).
create table if not exists course_exam_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  score integer not null,
  passed boolean not null,
  attempt_no integer not null,
  submitted_at timestamptz not null default now()
);
create index if not exists course_exam_submissions_user_course_idx on course_exam_submissions(user_id, course_id);

-- submit_course_exam()의 잔여횟수 계산(SELECT count → INSERT)은 두 단계 사이에 잠금이
-- 없으면 동시에 여러 요청이 들어왔을 때 전부 count=0을 읽어 재응시 제한을 우회할 수
-- 있다(qa-reviewer 지적, 2026-09-09) — 앱 레벨 advisory lock(아래 RPC 참고)과 별개로,
-- 최종 방어선을 DB 유니크 제약으로 둔다. attempt_no가 같은 (user,course) 쌍은 동시에
-- 두 행이 성립할 수 없어, 레이스가 나더라도 한쪽은 반드시 unique violation으로 실패한다.
create unique index if not exists course_exam_submissions_user_course_attempt
  on course_exam_submissions(user_id, course_id, attempt_no);

-- 관리자가 응시 횟수를 리셋해줄 때의 사유 기록(F-ADMCE-4, 사유 필수). 기존 응시 기록은
-- 삭제하지 않고, "잔여 횟수"는 exam_max_attempts − (가장 최근 리셋 시각 이후 제출 수)로 계산한다.
create table if not exists course_exam_attempt_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  reason text not null,
  reset_at timestamptz not null default now(),
  reset_by uuid not null references profiles(id)
);
create index if not exists course_exam_attempt_resets_user_course_idx on course_exam_attempt_resets(user_id, course_id);

alter table course_exam_questions enable row level security;
alter table course_exam_options enable row level security;
alter table course_exam_submissions enable row level security;
alter table course_exam_attempt_resets enable row level security;

drop policy if exists "course_exam_questions_admin_select" on course_exam_questions;
create policy "course_exam_questions_admin_select" on course_exam_questions for select using (is_admin());
drop policy if exists "course_exam_questions_admin_write" on course_exam_questions;
create policy "course_exam_questions_admin_write" on course_exam_questions for insert with check (is_admin());
drop policy if exists "course_exam_questions_admin_update" on course_exam_questions;
create policy "course_exam_questions_admin_update" on course_exam_questions for update using (is_admin());
drop policy if exists "course_exam_questions_admin_delete" on course_exam_questions;
create policy "course_exam_questions_admin_delete" on course_exam_questions for delete using (is_admin());

drop policy if exists "course_exam_options_admin_select" on course_exam_options;
create policy "course_exam_options_admin_select" on course_exam_options for select using (is_admin());
drop policy if exists "course_exam_options_admin_write" on course_exam_options;
create policy "course_exam_options_admin_write" on course_exam_options for insert with check (is_admin());
drop policy if exists "course_exam_options_admin_update" on course_exam_options;
create policy "course_exam_options_admin_update" on course_exam_options for update using (is_admin());
drop policy if exists "course_exam_options_admin_delete" on course_exam_options;
create policy "course_exam_options_admin_delete" on course_exam_options for delete using (is_admin());

-- course_exam_submissions: 본인+관리자 select만 허용하고 insert/update/delete 정책은
-- 아예 두지 않는다 — quiz_submissions(무제한 재응시, 수료와 무관)와 달리 이 테이블은
-- 합격 여부가 수료증 발급을 게이팅하므로, 학습자가 REST로 직접 유리한 점수를 꽂아 넣는
-- 경로를 원천 차단한다. 쓰기는 오직 submit_course_exam() RPC(SECURITY DEFINER, RLS 우회)로만.
drop policy if exists "course_exam_submissions_self_select" on course_exam_submissions;
create policy "course_exam_submissions_self_select" on course_exam_submissions for select using (
  user_id = auth.uid() or is_admin()
);

drop policy if exists "course_exam_attempt_resets_admin_select" on course_exam_attempt_resets;
create policy "course_exam_attempt_resets_admin_select" on course_exam_attempt_resets for select using (is_admin());
-- reset_by는 서버 액션이 자기 자신의 id로만 채우지만, is_admin()만 확인하는 with check는
-- 이론상 다른 관리자 명의로 감사기록을 남기는 걸 막지 못한다 — reset_by=auth.uid()까지
-- 요구해 위조를 원천 차단한다(privacy-security-officer 지적, 2026-09-09).
drop policy if exists "course_exam_attempt_resets_admin_write" on course_exam_attempt_resets;
create policy "course_exam_attempt_resets_admin_write" on course_exam_attempt_resets for insert with check (
  is_admin() and reset_by = auth.uid()
);

-- ===================== RPC: 시험 문항 정답 설정 (원자적) =====================
-- set_quiz_correct_option()과 동일한 이유로 하나의 트랜잭션에 묶는다.
create or replace function public.set_course_exam_correct_option(p_question_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  update course_exam_options set is_correct = false where question_id = p_question_id and is_correct = true;

  update course_exam_options set is_correct = true where id = p_option_id and question_id = p_question_id;
  if not found then
    raise exception 'option does not belong to question';
  end if;
end;
$$;

-- ===================== RPC: 시험 조회 (정답 비공개) =====================
-- get_quiz_for_lesson()은 강의 하나만 걸려 있어 열람 자체를 막지 않아도 유출 비용이
-- 낮지만, 자격시험 문항은 재작성 비용이 커 진도100%+과제승인(LOCKED 게이트)까지 통과한
-- 학습자에게만 열람을 허용한다(privacy-security-officer 지적, 2026-09-09) — 제출 게이팅
-- (submit_course_exam)과 동일한 조건을 열람에도 적용.
create or replace function public.get_course_exam(p_course_id uuid)
returns table (
  question_id uuid,
  question text,
  question_order integer,
  option_id uuid,
  option_label text,
  option_order integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_total_lessons integer;
  v_completed_lessons integer;
  v_missing_assignments integer;
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from enrollments e
    where e.course_id = p_course_id and e.user_id = v_user_id and e.status = 'approved'
  ) then
    raise exception 'not enrolled or not approved';
  end if;

  select count(*) into v_total_lessons from lessons where course_id = p_course_id;
  select count(*) into v_completed_lessons
  from lessons l
  join progress p on p.lesson_id = l.id and p.user_id = v_user_id and p.completed_at is not null
  where l.course_id = p_course_id;

  if v_total_lessons = 0 or v_completed_lessons < v_total_lessons then
    raise exception 'progress incomplete';
  end if;

  select count(*) into v_missing_assignments
  from lessons l
  where l.course_id = p_course_id
    and l.has_assignment = true
    and coalesce((
      select a.status::text
      from assignment_submissions a
      where a.lesson_id = l.id and a.user_id = v_user_id
      order by a.submitted_at desc
      limit 1
    ), '') <> 'approved';

  if v_missing_assignments > 0 then
    raise exception 'assignment not approved';
  end if;

  return query
    select q.id, q.question, q."order", o.id, o.label, o."order"
    from course_exam_questions q
    join course_exam_options o on o.question_id = q.id
    where q.course_id = p_course_id
    order by q."order", o."order";
end;
$$;

-- 로그인한 본인의 "가장 최근 응시횟수 리셋 시각"만 반환한다. course_exam_attempt_resets는
-- 관리자 전용 select 정책이라(reason에 관리자 내부 메모가 담길 수 있어 학습자에게 그대로
-- 노출하지 않는다) 일반 세션으로는 0행만 보여 getCourseExamState()의 잔여횟수 계산이
-- "리셋 없음"으로 잘못 고정되는 문제가 있었다(qa-reviewer/privacy-security-officer 공통 지적,
-- 2026-09-09) — reset_at 시각 하나만 SECURITY DEFINER로 우회해 내려준다.
create or replace function public.get_my_exam_reset_at(p_course_id uuid)
returns timestamptz
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reset_at timestamptz;
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  select max(reset_at) into v_reset_at
  from course_exam_attempt_resets
  where user_id = v_user_id and course_id = p_course_id;

  return v_reset_at;
end;
$$;

-- ===================== RPC: 시험 제출·즉시 채점 =====================
-- issue_certificate_self()와 동일한 진도100%+과제승인 재검증에 더해, 문항 존재/잔여
-- 응시횟수/기합격 여부까지 서버에서 재검증한다. auth.uid()를 내부에서만 사용해 타인 명의
-- 제출을 차단하고, 응답에는 correct_option_id를 절대 포함하지 않는다(submit_quiz_attempt
-- 정답 유출 수정 이력과 동일 원칙).
create or replace function public.submit_course_exam(p_course_id uuid, p_selected_option_ids uuid[])
returns table (score integer, passed boolean, attempt_no integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_enrollment_status enrollment_status;
  v_total_lessons integer;
  v_completed_lessons integer;
  v_missing_assignments integer;
  v_pass_score integer;
  v_max_attempts integer;
  v_total_questions integer;
  v_unresolved_questions integer;
  v_duplicate_question_count integer;
  v_correct_count integer;
  v_score integer;
  v_passed boolean;
  v_already_passed boolean;
  v_last_reset_at timestamptz;
  v_attempts_since_reset integer;
  v_next_attempt integer;
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  -- 잔여횟수 계산(SELECT)과 제출(INSERT) 사이에 잠금이 없으면 동시 요청이 전부 같은
  -- "잔여 N회"를 읽어 max_attempts를 넘겨 제출할 수 있었다(privacy-security-officer +
  -- qa-reviewer 공통 지적, 2026-09-09 — 병렬 20건 전송 시 전부 성공하는 걸로 확인됨).
  -- 이 함수 안에서는 항상 사용자×강좌 단위로 직렬화한다. 아래 unique index는 그래도
  -- 남는 이론적 허점(예: 잠금 해시 충돌)에 대비한 최종 방어선이다.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_course_id::text, 0));

  select status into v_enrollment_status from enrollments where user_id = v_user_id and course_id = p_course_id;
  if v_enrollment_status is distinct from 'approved' then
    raise exception 'not enrolled or not approved';
  end if;

  select count(*) into v_total_lessons from lessons where course_id = p_course_id;
  if v_total_lessons = 0 then
    raise exception 'course has no lessons';
  end if;

  select count(*) into v_completed_lessons
  from lessons l
  join progress p on p.lesson_id = l.id and p.user_id = v_user_id and p.completed_at is not null
  where l.course_id = p_course_id;

  if v_completed_lessons < v_total_lessons then
    raise exception 'progress incomplete';
  end if;

  select count(*) into v_missing_assignments
  from lessons l
  where l.course_id = p_course_id
    and l.has_assignment = true
    and coalesce((
      select a.status::text
      from assignment_submissions a
      where a.lesson_id = l.id and a.user_id = v_user_id
      order by a.submitted_at desc
      limit 1
    ), '') <> 'approved';

  if v_missing_assignments > 0 then
    raise exception 'assignment not approved';
  end if;

  select exam_pass_score, exam_max_attempts into v_pass_score, v_max_attempts
  from courses where id = p_course_id and requires_exam = true;

  if v_pass_score is null or v_max_attempts is null then
    raise exception 'exam not configured for course';
  end if;

  select count(*) into v_total_questions from course_exam_questions where course_id = p_course_id;
  if v_total_questions = 0 then
    raise exception 'exam not found for course';
  end if;

  -- 정답이 하나도 설정되지 않은 문항이 있으면 그 문항은 항상 오답 처리돼(아래 grading의
  -- inner join에서 분자 대상에서 빠짐) 100% 합격이 구조적으로 불가능해진다 — 관리자
  -- 실수로 학습자가 응시 횟수만 소모하지 않도록, 응시 자체를 막는다(횟수 미소모).
  -- 관리자 화면(admin/courses/[id]/exam)의 경고 배너와 동일한 조건이다(qa-reviewer 지적, 2026-09-09).
  select count(*) into v_unresolved_questions
  from course_exam_questions q
  where q.course_id = p_course_id
    and not exists (select 1 from course_exam_options o where o.question_id = q.id and o.is_correct = true);
  if v_unresolved_questions > 0 then
    raise exception 'exam not ready';
  end if;

  -- 문항당 선택지를 2개 이상 제출하면 채점 쿼리의 lateral join이 어떤 걸 고를지 순서가
  -- 보장되지 않는다(privacy-security-officer 지적, 2026-09-09) — 라디오 그룹은 UI 제약일
  -- 뿐이라 REST로 직접 호출하면 우회 가능하므로 서버에서 명시적으로 거부한다.
  select count(*) into v_duplicate_question_count
  from (
    select o.question_id
    from course_exam_options o
    where o.id = any(p_selected_option_ids)
      and o.question_id in (select id from course_exam_questions where course_id = p_course_id)
    group by o.question_id
    having count(*) > 1
  ) dup;
  if v_duplicate_question_count > 0 then
    raise exception 'invalid submission: multiple options selected for a question';
  end if;

  select exists(
    select 1 from course_exam_submissions where user_id = v_user_id and course_id = p_course_id and passed = true
  ) into v_already_passed;
  if v_already_passed then
    raise exception 'already passed';
  end if;

  select max(reset_at) into v_last_reset_at
  from course_exam_attempt_resets
  where user_id = v_user_id and course_id = p_course_id;

  select count(*) into v_attempts_since_reset
  from course_exam_submissions
  where user_id = v_user_id and course_id = p_course_id
    and (v_last_reset_at is null or submitted_at > v_last_reset_at);

  if v_attempts_since_reset >= v_max_attempts then
    raise exception 'attempts exhausted';
  end if;

  select count(*) filter (where sel.option_id is not null and sel.option_id = correct_opt.id)
  into v_correct_count
  from course_exam_questions q
  join course_exam_options correct_opt on correct_opt.question_id = q.id and correct_opt.is_correct = true
  left join lateral (
    select o.id as option_id
    from course_exam_options o
    where o.question_id = q.id and o.id = any(p_selected_option_ids)
    limit 1
  ) sel on true
  where q.course_id = p_course_id;

  v_score := round(100.0 * v_correct_count / v_total_questions);
  v_passed := v_score >= v_pass_score;
  v_next_attempt := v_attempts_since_reset + 1;

  insert into course_exam_submissions (user_id, course_id, score, passed, attempt_no)
  values (v_user_id, p_course_id, v_score, v_passed, v_next_attempt);

  return query select v_score, v_passed, v_next_attempt;
end;
$$;

-- ===================== issue_certificate_self() 갱신: 시험 합격 조건 추가 (F-LRN-9) =====================
-- 기존 함수를 그대로 두고 마지막 insert 직전에 시험 조건만 추가한다(진도100%+과제승인은
-- 기존 로직 그대로). create or replace로 전체를 다시 정의한다.
create or replace function public.issue_certificate_self(p_course_id uuid)
returns table (certificate_id uuid, issued_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_enrollment_status enrollment_status;
  v_total_lessons integer;
  v_completed_lessons integer;
  v_missing_assignments integer;
  v_requires_exam boolean;
  v_exam_passed boolean;
  v_cert_id uuid;
  v_issued_at timestamptz;
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  select status into v_enrollment_status
  from enrollments
  where user_id = v_user_id and course_id = p_course_id;

  if v_enrollment_status is distinct from 'approved' then
    raise exception 'not enrolled or not approved';
  end if;

  select count(*) into v_total_lessons from lessons where course_id = p_course_id;
  if v_total_lessons = 0 then
    raise exception 'course has no lessons';
  end if;

  select count(*) into v_completed_lessons
  from lessons l
  join progress p on p.lesson_id = l.id and p.user_id = v_user_id and p.completed_at is not null
  where l.course_id = p_course_id;

  if v_completed_lessons < v_total_lessons then
    raise exception 'progress incomplete';
  end if;

  select count(*) into v_missing_assignments
  from lessons l
  where l.course_id = p_course_id
    and l.has_assignment = true
    and coalesce((
      select a.status::text
      from assignment_submissions a
      where a.lesson_id = l.id and a.user_id = v_user_id
      order by a.submitted_at desc
      limit 1
    ), '') <> 'approved';

  if v_missing_assignments > 0 then
    raise exception 'assignment not approved';
  end if;

  select requires_exam into v_requires_exam from courses where id = p_course_id;
  if v_requires_exam then
    select exists(
      select 1 from course_exam_submissions
      where user_id = v_user_id and course_id = p_course_id and passed = true
    ) into v_exam_passed;

    if not v_exam_passed then
      raise exception 'exam not passed';
    end if;
  end if;

  insert into certificates (user_id, course_id)
  values (v_user_id, p_course_id)
  on conflict (user_id, course_id) do nothing
  returning id, issued_at into v_cert_id, v_issued_at;

  if v_cert_id is null then
    select id, issued_at into v_cert_id, v_issued_at
    from certificates where user_id = v_user_id and course_id = p_course_id;
  end if;

  return query select v_cert_id, v_issued_at;
end;
$$;

-- ===================== module: 미인증 계정 자동 파기 + 관리자 접속기록 (2026-09-10) =====================
-- 관리자 결정(2026-09-10): (1) 이메일 미인증 가입은 가입일로부터 7일 경과 시 행 자체를
-- 완전 삭제(사전 안내 없음), (2) 개인정보처리시스템 접속기록(제8조 5항)은 최대 1년 보관.
-- 둘 다 앱 서버 없이도 항상 실행되도록 pg_cron으로 DB 안에서 직접 스케줄링한다(Amplify는
-- 상시 구동 서버가 아니라 앱 코드의 setInterval 등으로는 스케줄을 보장할 수 없다).
do $$ begin
  create extension if not exists pg_cron;
exception when insufficient_privilege then
  raise notice 'pg_cron 확장 설치 권한이 없습니다 — Supabase 대시보드 Database > Extensions에서 pg_cron을 먼저 켜주세요.';
end $$;

-- 개인정보처리시스템 접속기록. 위변조 방지를 위해 update/delete 정책을 두지 않는다 —
-- 유일한 삭제 경로는 아래 purge_old_admin_access_logs()(1년 경과분만, SECURITY DEFINER)뿐이다.
create table if not exists admin_access_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id),
  target_user_id uuid references profiles(id) on delete set null,
  action text not null, -- '조회' | '수정' | '삭제' | '다운로드' 등 수행업무
  detail text,
  ip_address text,
  created_at timestamptz not null default now()
);
create index if not exists admin_access_logs_admin_id_idx on admin_access_logs(admin_id);
create index if not exists admin_access_logs_target_user_id_idx on admin_access_logs(target_user_id);
create index if not exists admin_access_logs_created_at_idx on admin_access_logs(created_at);

alter table admin_access_logs enable row level security;

drop policy if exists "admin_access_logs_admin_select" on admin_access_logs;
create policy "admin_access_logs_admin_select" on admin_access_logs for select using (is_admin());
drop policy if exists "admin_access_logs_admin_insert" on admin_access_logs;
create policy "admin_access_logs_admin_insert" on admin_access_logs for insert with check (
  is_admin() and admin_id = auth.uid()
);

-- ===================== RPC: 미인증 계정 자동 파기 =====================
-- auth.users를 직접 delete하면 profiles.id의 on delete cascade로 profiles 행도 함께 삭제된다
-- (사전 안내 없음, 관리자 결정). role='admin'은 절대 대상이 아니다.
create or replace function public.purge_unverified_signups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
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

-- ===================== RPC: 관리자 접속기록 보관기간(1년) 초과분 파기 =====================
create or replace function public.purge_old_admin_access_logs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  delete from admin_access_logs where created_at < now() - interval '1 year';
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

-- 두 함수 모두 PostgREST/RPC로 호출될 이유가 없다(pg_cron이 DB 내부에서만 실행) — 클라이언트
-- 노출을 차단한다(anon/authenticated에게 EXECUTE 권한 자체를 주지 않음).
revoke execute on function public.purge_unverified_signups() from public, anon, authenticated;
revoke execute on function public.purge_old_admin_access_logs() from public, anon, authenticated;

-- 매일 새벽 3시(KST) = 18:00 UTC에 실행. cron.schedule은 동일 job_name이 이미 있으면
-- 스케줄을 갱신하므로(신규 생성이 아님) 재실행해도 안전(idempotent)하다.
do $$ begin
  perform cron.schedule('purge-unverified-signups-daily', '0 18 * * *', $cron$select public.purge_unverified_signups();$cron$);
  perform cron.schedule('purge-old-admin-access-logs-daily', '10 18 * * *', $cron$select public.purge_old_admin_access_logs();$cron$);
exception when undefined_table or undefined_function then
  raise notice 'pg_cron이 아직 활성화되지 않았습니다 — Supabase 대시보드 Database > Extensions에서 pg_cron을 켠 뒤 이 스키마를 다시 실행해주세요.';
end $$;
