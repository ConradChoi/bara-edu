-- 운영 DB 일회성 정리: 민감정보 별도 동의 전 자가진단 결과 삭제 (2026-11-26)
--
-- 기획: docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md 7장 B안(대표 결정 2026-11-26 질문 1)·"API 계약" 배포 순서 5
-- 하는 일(한 트랜잭션)
--   1. diagnosis_results에서 동의 기록(sensitive_consent_version·sensitive_consented_at)이 없는 행을 모두 지운다.
--      diagnosis_answers는 FK cascade로 함께 지워지고, diagnosis_leads는 지우지 않고 result_id만 null이 된다(FK set null, 7장).
--   2. 검사 제약 diagnosis_results_sensitive_consent_required를 validate하고, 두 컬럼을 not null로 바꾼다.
--      이 뒤로는 동의 기록 없는 결과가 어떤 경로로도 생길 수 없다.
--   3. 건수만 NOTICE 한 줄로 출력한다(값은 출력하지 않는다). 운영자 접근 기록에 이 줄을 그대로 적는다(개별 건마다
--      admin_access_logs를 남기지 않는다, 7장).
-- 성격: 멱등. 두 번째 실행은 0건을 지우고 validate·not null은 아무것도 바꾸지 않는다.
--       패치(2026-11-26-diagnosis-consent.sql)가 먼저 적용돼 있어야 한다(제약이 없으면 validate에서 실패하고 전부 롤백된다).
-- 적용: 앱 배포(새 동의 화면) 뒤에 실행한다. 패치와 같은 방식이다(파일에는 역할 전환을 넣지 않는다).
--       begin; set local role bara_edu_service; <이 파일>; commit;
--       psql이면 NOTICE가 화면에 나온다: "NOTICE:  diagnosis consent cleanup: results_deleted=..."
-- 실행 전 대표 보고용 건수(읽기 전용, 값 출력 없음) — 같은 역할로 실행:
--   select count(*) as total,
--          count(*) filter (where user_id is not null) as member,
--          count(*) filter (where user_id is null) as nonmember
--     from diagnosis_results where sensitive_consent_version is null or sensitive_consented_at is null;
--   select count(*) as leads_to_unlink from diagnosis_leads l join diagnosis_results r on r.id = l.result_id
--    where r.sensitive_consent_version is null or r.sensitive_consented_at is null;

lock table diagnosis_results in share row exclusive mode;

do $$
declare
  v_answers integer;
  v_leads integer;
  v_total integer;
  v_member integer;
begin
  select count(*) into v_answers
    from diagnosis_answers a join diagnosis_results r on r.id = a.result_id
   where r.sensitive_consent_version is null or r.sensitive_consented_at is null;
  select count(*) into v_leads
    from diagnosis_leads l join diagnosis_results r on r.id = l.result_id
   where r.sensitive_consent_version is null or r.sensitive_consented_at is null;

  with d as (
    delete from diagnosis_results
     where sensitive_consent_version is null or sensitive_consented_at is null
    returning user_id
  )
  select count(*), count(*) filter (where user_id is not null) into v_total, v_member from d;

  raise notice 'diagnosis consent cleanup: results_deleted=% (member=%, nonmember=%), answers_deleted=%, leads_unlinked=%',
    v_total, v_member, v_total - v_member, v_answers, v_leads;
end
$$;

alter table diagnosis_results validate constraint diagnosis_results_sensitive_consent_required;
alter table diagnosis_results alter column sensitive_consent_version set not null;
alter table diagnosis_results alter column sensitive_consented_at set not null;
