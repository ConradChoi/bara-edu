-- 운영 DB 패치: 미귀속 진단 결과 90일 파기 조건 보완 (2026-11-26) — 함수 1개 교체
--
-- 대상: public.purge_unclaimed_diagnosis_pii (api/db/02-schema.sql의 같은 정의와 동일, 동기화 테스트로 확인)
-- 변경: 대상 조건을 `respondent_name is not null`에서 `(respondent_name is not null or phone is not null or email is not null)`로 넓힌다.
--       이름이 먼저 비워진 비회원 행(정정·삭제 처리 등)도 90일이 지나면 phone·email이 파기된다(절차 문서 R2). 비우는 컬럼은 그대로다.
-- 성격: create or replace function만 담았다. 멱등, 테이블·정책·데이터 변경 없음, 소유자·grant(revoke) 유지.
-- 적용: 한 트랜잭션 안에서 함수 소유자 역할로 전환한 뒤 실행한다(파일에는 역할 전환을 넣지 않는다 — 패치 형식 테스트).
--       begin; set local role bara_edu_service; <이 파일>; commit;
-- 배포 순서: 이 패치 -> API -> 앱 (함수만 바뀌므로 어느 순서와도 호환된다)

create or replace function public.purge_unclaimed_diagnosis_pii()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer;
begin
  update diagnosis_results
  set respondent_name = null, phone = null, email = null, certificate_level = null,
      utm_source = null, utm_medium = null, utm_campaign = null
  where user_id is null
    and created_at < now() - interval '90 days'
    and (respondent_name is not null or phone is not null or email is not null);
  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;
