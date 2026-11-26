-- 운영 DB 패치: 관리자 접속 기록 보관 기간 1년 -> 2년 (2026-11-26, 대표 결정)
--
-- 대상: public.purge_old_admin_access_logs (api/db/02-schema.sql의 같은 정의와 동일, 동기화 테스트로 확인)
-- 변경: 삭제 기준을 `interval '1 year'`에서 `interval '2 years'`로 늘린다. 그 외 동작은 같다.
-- 성격: create or replace function 1개. 멱등, 테이블·데이터 변경 없음, 함수 소유자·grant(revoke) 유지.
-- 적용: 한 트랜잭션 안에서 함수 소유자 역할로 전환한 뒤 실행한다(파일에는 역할 전환을 넣지 않는다 — 패치 형식 테스트).
--       begin; set local role bara_edu_service; <이 파일>; commit;
-- 주의: 적용 전에 이미 1년 넘은 기록은 매일 파기 작업에서 지워졌을 수 있다(되살릴 수 없음). 적용 뒤부터 2년 보관이 된다.

create or replace function public.purge_old_admin_access_logs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  delete from admin_access_logs where created_at < now() - interval '2 years';
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;
