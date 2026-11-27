-- 운영 DB 패치: 정식 오픈 전 법정 문서 원문 보관 테이블 (2026-11-27)
--
-- 근거: 정식 오픈 계획 docs/01-plan/features/bara-edu-lms.launch-v1.md(개인정보 점검 쟁점 1·2·4-4).
--       오픈 전 회원이 가입·신청 때 본 처리방침·약관 원문을 남겨 두어야 한다(고지·동의 입증). 공개 화면·CMS·API 어디서도
--       읽거나 쓰지 못하게 public이 아닌 archive 스키마에 둔다(public은 03-grants.sql이 웹 역할에 일괄 권한을 준다).
-- 변경: archive 스키마(소유 bara_edu_service, 웹 역할에 usage 없음)와 archive.legal_documents_prelaunch 테이블 생성. 데이터 변경 없음
--       (원문 복사는 1회용 스크립트 api/db/oneoff/2026-11-27-launch-v1.cjs가 한다).
-- 성격: 멱등. 새 DB(bootstrap)에는 필요 없다(오픈 전 원문이 없으므로).
-- 적용: begin; set local role bara_edu_service; <이 파일>; commit;
-- 보관 기간: 해당 시기에 가입한 계정이 남아 있는 동안 + 탈퇴 후 3년(분쟁 대응, 개인정보 점검 제안 — 근거는 변호사 검토 대상).
-- 롤백: drop table if exists archive.legal_documents_prelaunch; drop schema if exists archive;  (원문을 옮긴 뒤에는 하지 않는다)
set local lock_timeout = '5s';
create schema if not exists archive authorization bara_edu_service;
revoke all on schema archive from public;
create table if not exists archive.legal_documents_prelaunch (
  id uuid primary key,
  type text not null,
  slug text not null,
  title text not null,
  content text not null,
  version integer not null,
  is_published boolean not null,
  effective_at timestamptz not null,
  created_at timestamptz not null,
  published_at timestamptz,
  archived_at timestamptz not null default now(),
  archive_reason text not null
);
revoke all on archive.legal_documents_prelaunch from public;
