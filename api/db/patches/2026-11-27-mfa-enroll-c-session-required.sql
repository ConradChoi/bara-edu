-- 운영 DB 패치: 입구 C(인증 앱 바꾸기) 등록 대기에는 시작한 세션(session_hash)이 반드시 있게 (2026-11-27)
--
-- 근거: 관리자 2단계 인증 보안 점검 후속 R-3(docs/02-design/features/bara-edu-lms.admin-totp-security-review.md "후속 보안 점검 (2026-11-27)").
--       session_hash가 null인 입구 C 대기는 새 API에서 아무도 읽거나 확정할 수 없는 죽은 행이다. 앞으로 생기지 않게 검사 제약으로 막는다.
-- 변경: (1) session_hash가 null인 입구 C 대기 삭제(옛 API가 만든 것, 최대 10분짜리 대기 — 인증 앱 자체는 그대로)
--       (2) 검사 제약 mfa_enrollments_entry_c_session_check (entry <> 'C' or session_hash is not null) 추가
--       (2)는 api/db/01-auth.sql의 같은 블록과 글자 그대로 같다(test/patch-mfa-enroll-c-session-required.test.ts).
-- 성격: 멱등(제약이 있으면 건너뜀). 데이터 변경은 (1)뿐.
-- 적용: begin; set local role bara_edu_service; <이 파일>; commit;
-- 배포 순서: API ec8066c 이상(입구 C에 session_hash를 넣는 API)이 돌고 있을 때만. 옛 API(45bb82a 이하)로 되돌리면 입구 C 시작이 실패하므로 그때는 롤백을 먼저 한다.
-- 롤백: alter table auth.mfa_enrollments drop constraint if exists mfa_enrollments_entry_c_session_check;
set local lock_timeout = '5s';
delete from auth.mfa_enrollments where entry = 'C' and session_hash is null;
-- R-3 시작
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'auth.mfa_enrollments'::regclass and conname = 'mfa_enrollments_entry_c_session_check') then
    alter table auth.mfa_enrollments add constraint mfa_enrollments_entry_c_session_check check (entry <> 'C' or session_hash is not null);
  end if;
end $$;
-- R-3 끝
