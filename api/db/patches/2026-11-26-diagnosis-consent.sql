-- 운영 DB 패치: 도형심리 자가진단 민감정보 별도 동의 (2026-11-26)
--
-- 기획: docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md 9장·"API 계약"(대표 결정 2026-11-26, 질문 1~5 추천안)
-- 변경
--   1. diagnosis_results: sensitive_consent_version(text)·sensitive_consented_at(timestamptz) 컬럼,
--      검사 제약 diagnosis_results_sensitive_consent_required(둘 다 있어야 함) — not valid: 새로 쓰는 행에만 바로 적용,
--      동의 전 기존 행은 정리 스크립트(2026-11-26-diagnosis-consent-cleanup.sql)가 지우고 validate·not null로 굳힌다.
--      diagnosis_leads(result_id) 인덱스.
--   2. submit_diagnosis: 옛 시그니처(인자 12개) drop -> 새 시그니처(인자 14개, p_consent_sensitive·p_consent_sensitive_version) 생성.
--      민감정보 미동의 'sensitive consent required', 허용 목록(sc-v1) 밖 'sensitive consent version mismatch', 동의 버전·서버 시각 저장.
--   3. purge_unclaimed_diagnosis_pii: 이름·연락처 비우기 -> 90일 지난 비회원 결과 행 삭제(이름은 스케줄러 등록명 때문에 유지).
--      2026-11-26-privacy-followups.sql의 같은 함수를 대체한다. 이 패치 뒤에 그 파일을 다시 적용하지 않는다(파기가 이름 비우기로 되돌아간다).
--   4. get_my_diagnosis_results: has_lead 열 추가(반환 형식 변경이라 drop -> create).
--   5. delete_my_diagnosis_result(uuid, boolean) 신규: 회원 본인 결과 삭제(동의 철회).
--   5-1. claim_diagnosis: 귀속 때 이 결과에 연결된 비회원 문의(diagnosis_leads.user_id is null)도 회원에게 묶는다(privacy M-1).
--        이미 귀속된 결과의 문의는 아래 일회성 backfill(update)로 한 번 묶는다. 멱등(두 번째는 0행).
--   5-2. 관리자 select 정책(diagnosis_results_admin_select, diagnosis_answers_admin_select) 제거(privacy R-1):
--        일반 /v1/query로 원문이 읽히지 않게 한다. 관리자 읽기는 API op(가림 + 접속 기록)만 쓴다. 앱의 직접 select는 없음을 확인함.
--   6. 권한: 새로 만든 함수 3개는 PUBLIC 실행 없음(기본 권한) + 아래 grant. 지운 뒤 다시 만든 함수는 grant가 사라지므로 다시 준다.
--      RLS: diagnosis_results·diagnosis_answers의 관리자 select 정책은 제거(5-2), diagnosis_leads는 그대로(관리자 select만). 쓰기·삭제는 security definer 함수로만.
-- 함수·컬럼 블록은 api/db/02-schema.sql과 글자 그대로 같다(test/patch-diagnosis-consent.test.ts).
-- 성격: 멱등(if not exists / 예외 처리 / drop if exists / create or replace). 기존 데이터는 backfill 한 가지만 바꾼다(비회원 문의의 user_id 묶기). 새 컬럼은 null.
-- 적용: 한 트랜잭션 안에서 스키마 소유자 역할로 전환한 뒤 실행한다(파일에는 역할 전환을 넣지 않는다 — 패치 형식 테스트).
--       begin; set local role bara_edu_service; <이 파일>; commit;
--       잠금 대기 제한 set local lock_timeout = '5s'는 이 파일 맨 앞에 있다(트랜잭션 안에서만 유효하므로 위 begin ... commit 래퍼 필수).
-- 배포 순서(정의서 "API 계약" 배포 순서): 처리방침 v10 게시 -> 이 패치 -> API 즉시 재시작(패치 직후, 다른 작업 끼우지 않음) -> 앱 -> 정리 스크립트.
--       이 패치는 옛 API와 호환된다(옛 API의 캐시된 submit_diagnosis 호출만 실패 = 제출 불가 구간, 9.3절이 허용).
--       새 API를 먼저 올리면 RPC 카탈로그가 delete_my_diagnosis_result를 못 찾아 모든 /v1/rpc 호출이 실패한다.
--       패치~정리 스크립트 사이에 변경 전 결과를 연결(claim)하면 제약에 걸려 실패한다(당일 정리로 지워질 행이라 허용).
-- 롤백: 옛 앱·API로 돌릴 때는 02-schema.sql 이전 정의의 submit_diagnosis·get_my_diagnosis_results를 다시 만든다(컬럼·제약은 두어도 된다.
--       단 정리 스크립트 뒤라면 not null 때문에 옛 submit_diagnosis가 실패하므로 not null을 먼저 푼다).

set local lock_timeout = '5s';

-- ----- 자가진단 민감정보 별도 동의: 컬럼·제약 (2026-11-26) 시작
-- 기획: docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md 5장·"API 계약". 이 블록은
-- api/db/patches/2026-11-26-diagnosis-consent.sql과 글자 그대로 같다(test/patch-diagnosis-consent.test.ts).
-- 응답·점수는 민감정보로 보고(대표 결정 2026-11-26), 다른 동의와 따로 받은 민감정보 동의를 결과 행에 남긴다:
-- 화면이 보여 준 동의 문구 버전(data/diagnosis/consent.ts, 예 sc-v1)과 서버 시각. 별도 동의 테이블은 두지 않는다
-- (결과를 지우면 동의 기록도 함께 사라져야 "진단을 했다"는 사실이 남지 않는다).
-- 제약은 not valid로 만든다: 새로 쓰는 행에는 바로 적용되고, 동의 전 기존 행은 정리 스크립트
-- (patches/2026-11-26-diagnosis-consent-cleanup.sql)가 지운 뒤 validate·not null로 굳힌다.
alter table diagnosis_results add column if not exists sensitive_consent_version text;
alter table diagnosis_results add column if not exists sensitive_consented_at timestamptz;
do $$ begin
  alter table diagnosis_results add constraint diagnosis_results_sensitive_consent_required
    check (sensitive_consent_version is not null and sensitive_consented_at is not null) not valid;
exception when duplicate_object then null; end $$;
-- ----- 자가진단 민감정보 별도 동의: 컬럼·제약 끝

create index if not exists diagnosis_leads_result_id_idx on diagnosis_leads(result_id);

drop function if exists public.submit_diagnosis(text, text, text, diagnosis_experience, text, boolean, integer, boolean, jsonb, text, text, text);
create or replace function public.submit_diagnosis(
  p_name text,
  p_phone text,
  p_email text,
  p_learning_experience diagnosis_experience,
  p_certificate_level text,
  p_consent_privacy boolean,
  p_consent_privacy_doc_version integer,
  p_consent_sensitive boolean,
  p_consent_sensitive_version text,
  p_age_confirmed boolean,
  p_answers jsonb,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null
)
returns table (access_token uuid, recommended_tier diagnosis_tier, total_score numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result_id uuid;
  v_access_token uuid := gen_random_uuid();
  v_answer_count integer;
  v_raw integer;
  v_theory integer; v_reading integer; v_analysis integer;
  v_counseling integer; v_case_record integer; v_teaching integer;
  v_overall numeric;
  v_tier diagnosis_tier;
  v_strength text[];
  v_improvement text[];
  area_prefixes text[] := array['A','B','C','D','E','F'];
  v_expected_codes text[];
  v_submitted_codes text[];
  i integer;
begin
  if not coalesce(p_consent_privacy, false) then
    raise exception 'privacy consent required';
  end if;
  -- 민감정보(응답·결과) 처리 동의는 개인정보 동의와 따로 받는다(개인정보 보호법 제23조 제1항 제1호, 대표 결정 2026-11-26).
  -- 버전은 화면이 그린 동의 문구 버전이다. 허용 목록은 data/diagnosis/consent.ts의 CURRENT_SENSITIVE_CONSENT_VERSION과
  -- 같아야 한다(test/diagnosis-consent.test.ts). 오류 문구는 API가 400 validation(field consent / consent_version)으로 바꾼다.
  if not coalesce(p_consent_sensitive, false) then
    raise exception 'sensitive consent required';
  end if;
  if p_consent_sensitive_version is null or not (p_consent_sensitive_version = any (array['sc-v1'])) then
    raise exception 'sensitive consent version mismatch';
  end if;
  -- 만 14세 미만 개인정보 수집은 법정대리인 동의가 별도로 필요하다(PIPA 제22조의2) —
  -- Phase 1은 비회원 직접수집 경로라 회원가입과 달리 이 확인이 없었다
  -- (privacy-security-officer M-5 지적, 대표 결정 2026-09-14). 클라이언트 체크박스와
  -- 별개로 서버에서도 반드시 재검증한다(다른 모든 동의 항목과 동일한 원칙).
  if not coalesce(p_age_confirmed, false) then
    raise exception 'age confirmation required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name required';
  end if;
  -- 연락처는 "휴대전화 또는 이메일 중 최소 1개"만 필수다(최소수집 원칙, M-4 지적 반영—
  -- Phase 1은 리드 상담 연결 외에 연락처를 쓰는 발송 기능 자체가 없어 둘 다 강제할
  -- 근거가 없다). 최소 1개 원칙은 여기서만 검증하고 테이블에는 별도 CHECK를 두지 않는다
  -- (90일 미귀속 파기 시 phone/email을 함께 null로 비우는 purge_unclaimed_diagnosis_pii()와
  -- 충돌하지 않기 위함).
  if (p_phone is null or btrim(p_phone) = '') and (p_email is null or btrim(p_email) = '') then
    raise exception 'phone or email required';
  end if;

  select count(*) into v_answer_count from jsonb_object_keys(p_answers);
  if v_answer_count <> 30 then
    raise exception 'expected exactly 30 answers, got %', v_answer_count;
  end if;
  if exists (
    select 1 from jsonb_each_text(p_answers) e
    where (e.value)::integer < 0 or (e.value)::integer > 4
  ) then
    raise exception 'answer scores must be between 0 and 4';
  end if;

  -- 응답 키 자체가 A1~F5 30개 정확한 문항 코드와 일치하는지 확인한다(qa-reviewer 지적 —
  -- 개수(30)·값 범위(0~4)만 확인하면 X1..X30 같은 엉뚱한 키로도 통과해 조용히 0점 처리될 수 있었다).
  select array_agg(code order by code) into v_expected_codes
  from (select p || n::text as code from unnest(area_prefixes) p, generate_series(1, 5) n) t;
  select array_agg(k order by k) into v_submitted_codes from jsonb_object_keys(p_answers) k;
  if v_submitted_codes is distinct from v_expected_codes then
    raise exception 'answers must contain exactly the 30 canonical item codes';
  end if;

  -- 동일 연락처의 단시간(5분 이내) 반복 제출을 막는다 — 비회원 공개 쓰기 경로라 최소한의
  -- 남용 방지가 필요하다(PM 문서 Q7, "Should" 수준의 최소 방어). phone이 없을 수도 있어
  -- email까지 함께 확인한다.
  if exists (
    select 1 from diagnosis_results
    where created_at > now() - interval '5 minutes'
      and ((p_phone is not null and phone = btrim(p_phone)) or (p_email is not null and email = btrim(p_email)))
  ) then
    raise exception 'duplicate submission too soon';
  end if;

  -- 영역별 원점수(0~20) → 100점 환산. item_code 앞 글자(A~F)로 영역을 판별한다.
  for i in 1..6 loop
    select coalesce(sum((e.value)::integer), 0) into v_raw
    from jsonb_each_text(p_answers) e
    where left(e.key, 1) = area_prefixes[i];

    case i
      when 1 then v_theory := round(v_raw / 20.0 * 100);
      when 2 then v_reading := round(v_raw / 20.0 * 100);
      when 3 then v_analysis := round(v_raw / 20.0 * 100);
      when 4 then v_counseling := round(v_raw / 20.0 * 100);
      when 5 then v_case_record := round(v_raw / 20.0 * 100);
      when 6 then v_teaching := round(v_raw / 20.0 * 100);
    end case;
  end loop;

  v_overall := round((v_theory + v_reading + v_analysis + v_counseling + v_case_record + v_teaching) / 6.0, 2);

  -- 추천 tier 판정(원본 요구사항서 §8.1~8.5, PM 문서 F-DIAG-7 그대로 구현). 경계값 우선순위:
  -- ① 기본 역량 결손 있으면 무조건 2급 ② 그 외 상위 tier부터 역순 평가 ③ 강사후보는 7개
  -- 기준 전부 충족 시에만. elsif가 위에서부터 순서대로 평가되므로 supervision/level1
  -- 조건에는 "상담·사례기록이 아직 부족하다"는 배타 조건을 걸 필요가 없다 — 그보다 상위
  -- tier(instructor_candidate/supervision)는 이미 각자의 elsif에서 먼저 걸러졌기 때문이다.
  -- 원래 이 배타 조건이 있었을 때는 상담·사례기록까지 65~72점대로 고르게 준수한 응답자가
  -- 어떤 분기에도 걸리지 않고 else(level2, "기초부터 다시")로 강등되는 결함이 있었다
  -- (qa-reviewer 재현: theory70/reading70/analysis65/counseling72/case_record72/teaching70).
  if v_theory < 60 or v_reading < 60 or v_overall < 60 then
    v_tier := 'level2';
  elsif v_theory >= 80 and v_reading >= 80 and v_analysis >= 80
        and v_counseling >= 75 and v_case_record >= 75 and v_teaching >= 75 and v_overall >= 80 then
    v_tier := 'instructor_candidate';
  elsif v_theory >= 75 and v_reading >= 75 and v_analysis >= 70 then
    v_tier := 'supervision';
  elsif v_theory >= 65 and v_reading >= 65 and v_analysis >= 60 then
    v_tier := 'level1';
  else
    v_tier := 'level2';
  end if;

  -- 강점/보완 영역(PM 문서 Q4 확정: 동점 시 영역 정의 순서 우선, 최대 2개. 전 영역 동점이면 빈 배열).
  if greatest(v_theory, v_reading, v_analysis, v_counseling, v_case_record, v_teaching)
     = least(v_theory, v_reading, v_analysis, v_counseling, v_case_record, v_teaching) then
    v_strength := '{}';
    v_improvement := '{}';
  else
    with scored as (
      select 'theory' as code, v_theory as score, 1 as idx
      union all select 'reading', v_reading, 2
      union all select 'analysis', v_analysis, 3
      union all select 'counseling', v_counseling, 4
      union all select 'case_record', v_case_record, 5
      union all select 'teaching', v_teaching, 6
    )
    select array_agg(code) into v_strength from (select code from scored order by score desc, idx asc limit 2) s;

    with scored as (
      select 'theory' as code, v_theory as score, 1 as idx
      union all select 'reading', v_reading, 2
      union all select 'analysis', v_analysis, 3
      union all select 'counseling', v_counseling, 4
      union all select 'case_record', v_case_record, 5
      union all select 'teaching', v_teaching, 6
    )
    select array_agg(code) into v_improvement from (select code from scored order by score asc, idx asc limit 2) s;
  end if;

  insert into diagnosis_results (
    access_token, user_id, claimed_at, respondent_name, phone, email, learning_experience, certificate_level,
    age_confirmed, version, score_theory, score_reading, score_analysis, score_counseling, score_case_record, score_teaching,
    total_score, recommended_tier, strength_areas, improvement_areas,
    consent_privacy, consent_privacy_doc_version, sensitive_consent_version, sensitive_consented_at,
    utm_source, utm_medium, utm_campaign
  ) values (
    v_access_token, v_user_id, case when v_user_id is not null then now() else null end,
    btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), p_learning_experience,
    nullif(btrim(coalesce(p_certificate_level, '')), ''),
    true, 'shape-v1', v_theory, v_reading, v_analysis, v_counseling, v_case_record, v_teaching,
    v_overall, v_tier, coalesce(v_strength, '{}'), coalesce(v_improvement, '{}'),
    true, p_consent_privacy_doc_version, p_consent_sensitive_version, now(),
    p_utm_source, p_utm_medium, p_utm_campaign
  )
  returning id into v_result_id;

  insert into diagnosis_answers (result_id, item_code, score)
  select v_result_id, e.key, (e.value)::integer
  from jsonb_each_text(p_answers) e;

  return query select v_access_token, v_tier, v_overall;
end;
$$;

create or replace function public.purge_unclaimed_diagnosis_pii()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  delete from diagnosis_results
  where user_id is null
    and created_at < now() - interval '90 days';
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

drop function if exists public.get_my_diagnosis_results();
create or replace function public.get_my_diagnosis_results()
returns table (access_token uuid, recommended_tier diagnosis_tier, total_score numeric, created_at timestamptz, has_lead boolean)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  return query
    select r.access_token, r.recommended_tier, r.total_score, r.created_at,
           exists (select 1 from diagnosis_leads l where l.result_id = r.id and l.user_id = auth.uid())
    from diagnosis_results r
    where r.user_id = auth.uid()
    order by r.created_at desc;
end;
$$;

create or replace function public.delete_my_diagnosis_result(p_token uuid, p_delete_leads boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authorized';
  end if;

  select id into v_result_id from diagnosis_results
  where access_token = p_token and user_id = v_user_id
  for update;
  if not found then
    return false;
  end if;

  if coalesce(p_delete_leads, false) then
    delete from diagnosis_leads where result_id = v_result_id and user_id = v_user_id;
  end if;
  delete from diagnosis_results where id = v_result_id;
  return true;
end;
$$;

create or replace function public.claim_diagnosis(p_token uuid)
returns table (claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner uuid;
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'not authorized';
  end if;

  select user_id into v_owner from diagnosis_results where access_token = p_token;
  if not found then
    raise exception 'result not found';
  end if;

  if v_owner = v_user_id then
    return query select true;
    return;
  end if;

  if v_owner is not null then
    raise exception 'already claimed by another account';
  end if;

  update diagnosis_results set user_id = v_user_id, claimed_at = now()
  where access_token = p_token and user_id is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'already claimed by another account';
  end if;

  -- 비회원일 때 이 결과에 연결해 낸 강사과정 문의도 귀속과 함께 본인 것으로 묶는다(privacy M-1, 2026-11-26).
  -- 안 묶으면 탈퇴·has_lead·기록 지우기(p_delete_leads)가 이 문의를 못 찾아 "본인에게 연결된 문의는 탈퇴 즉시 파기" 약속이 깨진다.
  update diagnosis_leads set user_id = v_user_id
  where result_id = (select id from diagnosis_results where access_token = p_token) and user_id is null;

  return query select true;
end;
$$;

-- 권한(03-grants.sql 결과와 같게): 제출은 비회원·회원, 목록·삭제는 회원만. purge는 API 서비스 역할만.
revoke execute on function public.submit_diagnosis(text, text, text, diagnosis_experience, text, boolean, integer, boolean, text, boolean, jsonb, text, text, text) from public;
grant execute on function public.submit_diagnosis(text, text, text, diagnosis_experience, text, boolean, integer, boolean, text, boolean, jsonb, text, text, text) to bara_edu_anon, bara_edu_authenticated;
revoke execute on function public.get_my_diagnosis_results() from public, bara_edu_anon;
grant execute on function public.get_my_diagnosis_results() to bara_edu_authenticated;
revoke execute on function public.delete_my_diagnosis_result(uuid, boolean) from public, bara_edu_anon;
grant execute on function public.delete_my_diagnosis_result(uuid, boolean) to bara_edu_authenticated;
revoke execute on function public.purge_unclaimed_diagnosis_pii() from public, bara_edu_anon, bara_edu_authenticated;
-- claim_diagnosis는 create or replace라 기존 grant가 유지된다(다시 주지 않는다).

-- 일회성 backfill(privacy M-1): 이미 귀속된 결과에 붙은 비회원 문의를 결과의 회원에게 묶는다. 멱등.
update diagnosis_leads l set user_id = r.user_id
from diagnosis_results r
where l.result_id = r.id and l.user_id is null and r.user_id is not null;

-- 관리자 직접 select 정책 제거(privacy R-1)
drop policy if exists "diagnosis_results_admin_select" on diagnosis_results;
drop policy if exists "diagnosis_answers_admin_select" on diagnosis_answers;

-- RLS는 이미 켜져 있다(02-schema.sql). 다시 켜 두는 것은 확인용이며 정책은 바꾸지 않는다.
alter table diagnosis_results enable row level security;
alter table diagnosis_answers enable row level security;
alter table diagnosis_leads enable row level security;
