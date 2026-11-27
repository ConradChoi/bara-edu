-- 운영 DB 패치: 관리자 2단계 인증 입구 C(인증 앱 바꾸기) 등록 대기를 시작한 세션에 묶기 (2026-11-27)
--
-- 근거: 관리자 2단계 인증 보안 점검 m-1(docs/02-design/features/bara-edu-lms.admin-totp-security-review.md 4장).
--       입구 C의 등록 대기(새 비밀 키)는 같은 사용자의 어느 세션에서나 enroll/current로 다시 읽혔다. 시작한 세션만 읽고 확정하게 한다.
-- 변경: auth.mfa_enrollments.session_hash 컬럼(nullable, auth.sessions(token_hash) 참조, 세션 삭제 시 함께 삭제) 1개 추가.
--       api/db/01-auth.sql의 같은 줄과 글자 그대로 같다(test/patch-mfa-enroll-session.test.ts).
-- 성격: 멱등(add column if not exists). 기존 데이터 변경 없음(기존 대기는 null — 최대 10분 뒤 만료).
-- 적용: begin; set local role bara_edu_service; <이 파일>; commit;
-- 배포 순서: 이 패치 -> API. 새 API는 이 컬럼을 읽으므로 패치가 먼저다. 옛 API는 이 컬럼을 쓰지 않아 호환된다.
--       패치 순간 진행 중이던 입구 C 대기(session_hash null)는 새 API에서 다시 읽거나 확정할 수 없다(처음부터 다시 시작, 최대 10분 영향).
-- 롤백: 지우지 않는다(옛 API는 이 컬럼을 쓰지 않는다).
set local lock_timeout = '5s';
alter table auth.mfa_enrollments add column if not exists session_hash text references auth.sessions (token_hash) on delete cascade;
