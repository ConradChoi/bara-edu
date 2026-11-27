-- 운영 DB 패치: 오픈 전 법정 문서 원문 보관 테이블 잠금 (2026-11-27)
--
-- 근거: 정식 오픈 계획 docs/01-plan/features/bara-edu-lms.launch-v1.md 3.2·6장(개인정보 점검 선택 권고, 대표 요청 11-27).
--       archive.legal_documents_prelaunch는 고지·동의 입증용 원문이므로 보관 뒤에는 바뀌면 안 된다.
-- 변경: 두 겹으로 읽기 전용으로 만든다. 데이터 변경 없음.
--   1. 권한: 소유 역할 bara_edu_service에게서도 insert·update·delete·truncate 권한을 거둔다(select만 남김).
--   2. 트리거: 권한을 다시 주더라도 insert·update·delete·truncate 문장은 오류로 막는다(문장 단위, 0행이어도 막음).
--   실수·앱 경로 변경을 막는 장치이고, 의도적 해제는 대표 승인과 운영 기록으로 다룬다(아래 해제 방법).
--   막지 못하는 것(QA 11-27): 소유자·RDS 마스터의 drop trigger·alter table … disable trigger, 슈퍼유저급의
--   session_replication_role=replica, drop table·drop schema … cascade(보관본이 통째로 사라짐). 앱 접속 역할 bara_edu_app도
--   set role bara_edu_service가 되므로 앱이 침해되면 풀릴 수 있다(앱 코드는 archive 스키마를 쓰지 않는다).
--   그래서 원본 무결성은 저장소의 내보내기 파일(docs/legal/prelaunch-archive/, sha256)과 운영 기록의 DB 다이제스트로 확인한다.
-- 성격: 멱등. 2026-11-27-legal-prelaunch-archive.sql 적용과 원문 복사(1회용 스크립트) 뒤에 적용한다.
-- 적용: begin; set local role bara_edu_service; <이 파일>; commit;
-- 해제(대표 승인·운영 기록 필수): drop trigger legal_documents_prelaunch_readonly on archive.legal_documents_prelaunch;
--       grant insert, update, delete, truncate on archive.legal_documents_prelaunch to bara_edu_service;
set local lock_timeout = '5s';

create or replace function archive.reject_prelaunch_write() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'archive.legal_documents_prelaunch is read-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end
$$;
revoke all on function archive.reject_prelaunch_write() from public;

drop trigger if exists legal_documents_prelaunch_readonly on archive.legal_documents_prelaunch;
create trigger legal_documents_prelaunch_readonly
  before insert or update or delete or truncate on archive.legal_documents_prelaunch
  for each statement execute function archive.reject_prelaunch_write();

revoke insert, update, delete, truncate on archive.legal_documents_prelaunch from bara_edu_service;
