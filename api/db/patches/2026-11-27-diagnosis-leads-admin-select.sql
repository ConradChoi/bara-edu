-- 운영 DB 패치: 강사과정 문의(diagnosis_leads) 관리자 select 정책 제거 (2026-11-27)
--
-- 근거: 자가진단 민감정보 동의 QA minor 2. 관리자 문의 목록을 API op admin.listDiagnosisLeads(이름·연락처 가림 +
--       열람 한 행만 원문, 접속 기록과 한 트랜잭션)로 옮겼으므로, 일반 /v1/query로 이름·연락처 원문을 가림·기록 없이
--       읽을 수 있는 경로를 닫는다. diagnosis_results·diagnosis_answers(2026-11-26, privacy R-1)와 같은 처리다.
-- 변경: diagnosis_leads_admin_select 정책 1개 drop. 이 뒤로 diagnosis_leads에는 정책이 없다(RLS 켜짐 — 일반 쿼리 접근 불가).
--       읽기·쓰기는 security definer 함수(submit_diagnosis_lead·claim_diagnosis·get_my_diagnosis_results(문의 유무만)·
--       delete_my_diagnosis_result·purge_old_diagnosis_leads)와 bara_edu_service 경로(API op admin.listDiagnosisLeads·
--       admin.updateDiagnosisLead, 탈퇴 삭제, 파기 스케줄러)로만.
-- 적용 당일 확인: select count(*) from pg_policies where tablename = 'diagnosis_leads'  -> 0 (개인정보 점검 R-4)
-- 성격: 멱등(drop policy if exists). 데이터 변경 없음.
-- 적용: begin; set local role bara_edu_service; <이 파일>; commit;
-- 배포 순서: API(admin.listDiagnosisLeads 포함) -> 앱(문의 목록이 op를 쓰는 버전) -> 이 패치.
--       앱보다 먼저 적용하면 옛 앱의 문의 목록 직접 조회가 0행(빈 목록)으로 보인다.
-- 롤백: 패치 뒤 앱을 옛 버전으로 되돌릴 때는 정책부터 되살린다(옛 앱은 직접 select라 정책이 없으면 목록이 조용히 0행):
--       create policy "diagnosis_leads_admin_select" on diagnosis_leads for select using (is_admin());
set local lock_timeout = '5s';
drop policy if exists "diagnosis_leads_admin_select" on diagnosis_leads;
