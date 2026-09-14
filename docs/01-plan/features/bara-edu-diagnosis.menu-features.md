# bara-edu-diagnosis — 도형심리 역량진단 기능정의서 (PRD-lite)

> **작성자**: Product Owner
> **작성일**: 2026-09-14
> **단계**: Plan (PDCA Phase 1) — 스코핑 확정용. **구현 착수 전 문서이며, 이 문서만으로 개발을 시작하지 않는다** (service-planner 플로우 → ui-ux-designer F1~F8 → PO F9 승인 순서 유지)
> **원본 요구사항**: `data/BARA_shape_competency_diagnosis_requirements.md` (v1.0, CEO 1차 검토 완료)
> **선행/참조 문서**: [bara-edu-lms.menu-features.md](./bara-edu-lms.menu-features.md) · [bara-edu-lms.flows.md](./bara-edu-lms.flows.md) · [bara-edu-lms.home.md](./bara-edu-lms.home.md) · [bara-edu-lms.legal-privacy.md](./bara-edu-lms.legal-privacy.md)
> **문서 분리 사유**: LMS 기능정의서는 "수강 → 학습 → 수료" 본 도메인의 IA 인덱스다. 역량진단은 **결제·수강 이전 단계의 별도 유입 퍼널**이고, 자체 데이터 모델(4개 테이블)·자체 관리자 메뉴·비회원 트래픽 처리 규칙을 갖는다. 기존 문서에 끼워 넣으면 260행짜리 LMS IA가 더 비대해지고 "F-DIAG는 오픈 게이트 밖"이라는 사실이 흐려진다. 대신 LMS 기능정의서 2.13에 **포인터 섹션**을 두어 인덱스 일원화는 유지한다.

---

## Executive Summary

| 관점 | 내용 |
|---|---|
| **Problem** | "도형기질활용지도자" 과정은 2급/1급 두 단계인데, 방문자는 **자기가 어디서부터 시작해야 하는지 판단할 근거가 없다.** 특히 과거 학습자·자격 보유자는 "2급을 또 들어야 하나?"에서 막혀 이탈하고, 그 판단을 전부 전화 상담이 떠안고 있다 |
| **Solution** | 30문항 자가진단(약 5분) → 서버 채점 → **추천 과정 1개를 단정적으로 제시**하고 기존 강좌 상세/신청 동선에 그대로 연결한다. 새 결제·새 회원 체계를 만들지 않고 기존 `courses`/`enrollments`/Supabase Auth를 재사용한다 |
| **Function UX Effect** | 홈 배너 1클릭 → 진단 시작 → 결과에서 추천 강좌 상세로 진입 (**홈→강좌 상세 3클릭 이내** 기준 유지). 비회원도 결과 요약까지는 즉시 보고, 상세 결과를 보려면 가입한다 |
| **Core Value** | 진단은 "심리검사 서비스"가 아니라 **과정 추천 + 리드 수집 퍼널**이다. 자격 판정·임상 진단·PBA Radar 연동은 전부 비목표이며, 이 경계를 넘는 요구는 4절에서 Won't로 되돌린다 |

---

## 0. 원본 요구사항서와의 차이 (재정리 근거)

| # | 원본 | 이 문서의 결정 | 근거 |
|---|---|---|---|
| 1 | "Google Sheets 저장" (§11, §17) | **폐기.** 전량 Supabase 테이블 + RLS + SECURITY DEFINER RPC | 프로젝트는 이미 Supabase 전면 이관 완료. Sheets는 RLS·동의 이력·관리자 화면 어느 것도 만족 못 함 |
| 2 | "PBA Radar와 별개 시스템" (§0, §17) | **언급 자체를 스코프에서 제거.** 연동/분리 검토 모두 하지 않음 | CEO 확정 — 본 프로젝트와 무관 |
| 3 | 추천 4단계 모두 과정 페이지 연결 (§13) | **강사과정 tier는 과정 페이지로 연결하지 않는다.** "강사과정 관심 문의" 접수로 대체 | CEO 확정 — 실제 판매 중인 강사과정이 없음. 없는 상품으로 CTA를 보내면 신뢰가 깨진다 |
| 4 | 추천 4단계 = 과정 4개 전제 | 실제 과정은 **2급/1급 2개**. tier 4개 → 과정 2개 + 리드 1개로 **매핑 테이블**을 통해 축약 | `categories`에 "도형기질활용지도자"(2Depth) 존재, 2급 강좌 확인됨. 1급 강좌 등록 여부는 열린 질문 Q2 |
| 5 | 결과 전체를 로그인 후 열람 (§11 보안) | **요약은 비로그인 즉시 공개 / 상세는 로그인 게이팅** | CEO 확정. 전면 게이팅은 완료율(목표 70%)을 직격한다 |
| 6 | "Chart.js 등 라이브러리 사용 가능" (§9) | **차트 라이브러리 신규 도입 금지.** 인라인 SVG Radar | F-ADM-5에서 이미 같은 판단을 내린 선례(`package.json` 의존성 5개 유지 원칙) |
| 7 | "결과 PDF" Phase 1 (§16) | **브라우저 인쇄(print stylesheet) 기반 "PDF로 저장"**으로 Phase 1 충족. 서버 PDF 생성은 Phase 2 | 위와 동일 — jsPDF/puppeteer 도입은 Amplify 빌드·용량 영향이 있어 별도 결정 필요 (Q5) |
| 8 | GA4 이벤트 8종 (§14) | **Phase 2로 이연.** 이 프로젝트에 GA4가 설치되어 있지 않다 | 코드베이스 전수 확인 결과 gtag/GTM 스니펫 없음. 분석 도구 도입은 진단 기능과 별개 결정 (Q6). Phase 1 퍼널은 DB 카운트로 본다 |
| 9 | 문항/해석문구 "DB/config로 관리" (§10) | Phase 1은 **버전 태그가 붙은 TS config**(`data/diagnosis/`), 관리자 CMS는 Phase 2 | 문항은 초기에 거의 안 바뀌고, CMS를 먼저 만들면 관리자 화면이 2개 더 늘어난다. 대신 **응답 원본(30건)을 저장**해 재채점 가능성을 남긴다 |

---

## 1. 문제 정의 — 어떤 세그먼트의 어떤 문제를 푸는가

| 세그먼트 (원본 Persona) | 현재 겪는 문제 | 진단이 풀어야 하는 것 | 대응 기능 |
|---|---|---|---|
| **입문자** (Persona A) / 성인 학습자 | "도형심리"가 뭔지도 모르는 상태에서 2급/1급 중 고르라는 요구를 받는다 → 판단 불가 → 이탈 | 5분 안에 "당신은 2급부터"라는 **명확한 1개의 답** | F-DIAG-4, 7, 8, 14 |
| **과거 학습자** (Persona B) / 경력단절자 | 예전에 배웠으나 활용 못 함. "또 2급을 들으라는 건 돈 낭비 아닌가"에서 멈춤 | 잊은 영역을 **점수로 가시화**해 재수강 명분을 제공 | F-DIAG-10, 11, 12 |
| **기존 자격 보유자** (Persona C) | 이론은 알지만 상담·사례에서 막힘. 1급이 그 갈증을 푸는지 알 수 없음 | 강점/보완 영역을 분리 제시하고 "새 이론보다 실습이 필요" 진단 | F-DIAG-12, 13 |
| **강사 후보자** (Persona D) | 강사과정 문의 창구가 전화뿐. 교육원도 후보군을 축적하지 못함 | 사전 적합 후보를 식별해 **리드로 접수**(과정 판매 아님) | F-DIAG-15, F-ADMDG-3 |
| **교육원 운영자 (내부)** | 상담 전화에서 매번 수준을 구두 확인. 문의자 데이터가 남지 않음 | 상담 전 참고 가능한 진단 데이터 축적 | F-ADMDG-1, 2 |
| **B2B (기업 위탁교육)** | (이번 범위 아님) | — | 비목표 |

> 위 표에 없는 문제를 푸는 화면·기능은 이번 진단 스코프에 넣지 않는다.

---

## 2. 목표 및 성공지표

| 지표 | 목표 | 측정 방법 (Phase 1) |
|---|---|---|
| 진단 완료율 (기본정보 진입 → 결과 생성) | **> 70%** | `diagnosis_results` 생성 수 / 기본정보 제출 수 — 기존 "신청 완료율 > 70%" 기준과 동일 선상 |
| 홈 → 추천 강좌 상세 도달 클릭 수 | **3클릭 이내** | 홈 진단 배너(1) → 진단 시작(2) → 결과 CTA(3). 기존 성공 기준 승계 |
| 소요 시간 중앙값 | **≤ 5분** | `created_at` − 기본정보 제출 시각 (세션 기준, Phase 2 정밀 측정) |
| 결과 → 추천 강좌 상세 클릭률 | ≥ 35% | Phase 2(GA4 또는 서버 로그) |
| 진단 완료 → 회원가입 전환 | ≥ 25% | `diagnosis_results.user_id` 귀속(claim)된 비율 |
| 진단 → 수강신청 전환 | (베이스라인 수집) | `enrollments` 교차 조회 — Phase 2 |
| 모바일 정상 동작 | 360px 이상 무결 | QA 체크리스트 |

---

## 3. 화면 IA / 라우트 결정

### 3.1 라우트 (결정)

원본이 제시한 후보는 `/diagnosis`와 `/shape-check`였으나, **`/selfcheck`로 최종 확정**한다(2026-09-14, 대표 결정 — 도형심리는 첫 번째 사례일 뿐, 앞으로 다른 자가진단 유형도 이 경로 아래 추가할 계획이라 특정 진단명에 묶이지 않는 이름이 필요).

- `/shape-check`는 영문 조어라 주 타깃(30~50대 성인·시니어)이 URL만 보고 뜻을 알 수 없어 최초 탈락.
- `/diagnosis`도 "자가진단"이라는 실제 의미와는 다소 거리가 있고, 향후 다른 자가진단 기능이 늘어날 것을 감안해 더 일반적인 이름인 `/selfcheck`로 대체한다.
- `/selfcheck`는 기존 라우트(`/courses`, `/learn`, `/my`, `/legal`)의 **단수 영문 명사 컨벤션**과 일치한다.
- 향후 다른 자가진단(예: 기질검사)이 추가되면 `/selfcheck/[type]`으로 확장 가능하다. 지금은 도형심리 1종이므로 루트를 그대로 쓴다.

> **참고**: DB 테이블·enum·config 폴더 이름은 여전히 `diagnosis_*`/`data/diagnosis/`를 쓴다(이번 결정은 URL 라우트 한정). 이후 두 번째 자가진단 유형이 실제로 추가되는 시점에, 그때 가서 내부 네이밍도 일반화할지(`selfcheck_*`로 리네이밍) 재검토하는 편이 낫다 — 아직 구현 전이라 지금 당장 바꿔도 비용은 같지만, 실제로 두 번째 유형이 어떤 데이터 구조를 요구할지 모르는 상태에서 미리 일반화하면 도형심리 전용 컬럼(`certificate_level` 등)이 어색하게 남을 수 있다.

| 경로 | 라우트 그룹 | 화면 | 인증 |
|---|---|---|---|
| `/selfcheck` | `(public)` | 진단 랜딩 | 불필요 |
| `/selfcheck/start` | `(public)` | 기본정보 + 30문항 스테퍼(6페이지) | 불필요 |
| `/selfcheck/result/[token]` | `(public)` | 결과 — 요약은 공개, 상세는 로그인 게이팅 | 부분 |
| `/admin/selfcheck` | `(admin)` | 진단 결과 목록 | admin |
| `/admin/selfcheck/[id]` | `(admin)` | 진단 결과 상세 | admin |
| `/admin/selfcheck/leads` | `(admin)` | 강사과정 관심 문의 목록 | admin |

> **`[token]`을 쓰는 이유**: 비회원이 결과 요약을 즉시 봐야 하므로 결과 URL이 **추측 불가능**해야 한다. `diagnosis_results.id`를 그대로 노출하면 열거 공격으로 타인의 요약(이름은 미노출이나 점수·추천)에 접근할 수 있다. 별도 `access_token uuid`를 발급해 URL에 쓰고, `id`는 관리자 화면 내부에서만 쓴다.

### 3.2 진입 동선 (기존 화면 변경분)

| 위치 | 변경 | 우선순위 |
|---|---|---|
| 홈 `/` | 히어로 하단에 진단 배너 섹션 1개 추가 — "나는 어떤 과정부터 시작하면 좋을까요?" | Must |
| 공통 헤더 `AppHeader` | 네비에 "역량진단" 1개 추가 (public/user 공통) | Should |
| 강좌 상세 (도형기질활용지도자 트리) | "내 수준이 맞는지 확인하기" 보조 링크 | Should |
| 관리자 사이드바 `AdminSidebar` | "진단 결과 조회" + "강사과정 문의" 메뉴 추가 (현행 11개 → 13개) | Must |

---

## 4. 비목표 (Won't do) — MVP로 끌려 들어오면 즉시 되돌린다

| # | 비목표 | 사유 |
|---|---|---|
| W1 | PBA Radar 관련 문항·데이터·브랜드 혼합 | CEO 확정. 본 프로젝트와 무관 |
| W2 | 임상 심리진단 / 정신건강 상태 판정 표현 | 법적·윤리적 리스크. 모든 화면에 비임상 고지 문구 필수 |
| W3 | 자격증·강사 자격 자동 부여/확정 | 진단은 **학습 추천**이다. 자격 판정은 기존 `course_exam_submissions`(F-LRN-7) 영역 |
| W4 | 강사과정 상세/신청 페이지 신설 | 판매 중인 상품이 없다. 리드 접수까지만 |
| W5 | 진단 결과 기반 결제·할인쿠폰 연동 | 무통장입금 플로우를 건드리지 않는다 |
| W6 | 진단 문항/임계값 관리자 CMS | Phase 2. Phase 1은 config + 버전 태그 |
| W7 | 리마케팅·상담 자동화(문자/메일 발송) | Phase 2 이후. 발송 남용·수신동의 이슈는 privacy-security-officer 선행 점검 필요 |
| W8 | 다국어(해외이주민 대응) | 기존 LMS와 동일하게 이연. 쉬운 한국어 카피로만 대응 |
| W9 | 차트 라이브러리(Chart.js 등) 도입 | 인라인 SVG로 충족. 의존성 추가는 별도 승인 사안 |
| W10 | 진단 결과 공개 공유(SNS 카드·오픈그래프 이미지 생성) | 개인정보가 담긴 결과를 공유 가능하게 만들면 게이팅 정책과 충돌 |

---

## 5. 기능정의서 (F-DIAG-*)

우선순위: **Must**(Phase 1 필수) / **Should**(Phase 1 목표, 미완 시 오픈 가능) / **Could**(Phase 2 후보) / **Won't (Later)**

### 5.1 (public) 진단 랜딩·응답

| ID | 메뉴/화면 | 기능명 | 설명 | 우선순위 | 관련 데이터 |
|---|---|---|---|:---:|---|
| F-DIAG-1 | `/selfcheck` 랜딩 | 진단 소개 + 시작 CTA | 제목("도형심리 역량진단")·보조문구("나에게 맞는 과정은 어디부터일까요?")·**약 5분/30문항** 표기·진단 목적·**비임상/비자격판정 고지**·CTA. `(public)` 그룹이라 `AppHeader`/`Footer` 자동 적용 | Must | 정적 카피 |
| F-DIAG-2 | 홈·헤더·강좌상세 | 진단 진입점 | 홈 히어로 하단 배너(Must), 헤더 네비 "역량진단"(Should), 도형기질 강좌 상세 보조 링크(Should). **홈→결과 3클릭 기준의 1번째 클릭** | Must | site-config |
| F-DIAG-3 | `/selfcheck/start` 1단계 | 기본정보 + 개인정보 동의 | 이름(필수) · **휴대전화 또는 이메일 중 최소 1개**(2026-09-14 재결정 — 최소수집 원칙 지적으로 "둘 다 필수"에서 완화) · 학습경험 4지선다(처음/과거수강/자격보유/현재활용, 필수) · 보유 자격 수준(선택) · **개인정보 수집·이용 동의 체크(필수, `/legal/privacy` 링크, 동의 전 항목·목적·보유기간 요약 고지 포함)** · **만 14세 이상 확인 체크(필수, 신규)**. 마케팅 수신 동의는 Phase 1에 발송 기능이 없어 제거. 로그인 상태면 `profiles`에서 이름·휴대전화·이메일 프리필 가능 | Must | `diagnosis_results`, `legal_documents` |
| F-DIAG-4 | `/selfcheck/start` 2~7단계 | 30문항 응답 | 6영역 × 5문항, **페이지당 5문항(= 영역 1개)**, 상단 진행률 바 + "n/30", 이전/다음. **한 문항이라도 미응답이면 다음 진행 차단**(해당 문항으로 포커스 이동 + 오류 메시지). 척도는 숫자 대신 문구 우선 노출("설명할 수 있다" 등) | Must | `diagnosis_answers` |
| F-DIAG-5 | `/selfcheck/start` | 응답 임시 보존 | 새로고침·실수 이탈 시 응답 유지. **localStorage만 사용**(서버 draft 테이블 만들지 않음 — 비회원 draft는 소유자 식별이 불가능해 개인정보만 늘어남). 제출 성공 또는 24시간 경과 시 삭제 | Should | localStorage |
| F-DIAG-6 | 제출 | 서버 채점 | Server Action → `submit_diagnosis()` RPC(SECURITY DEFINER). 영역 원점수(0~20) → 100점 환산, 전체 = 6영역 평균. **클라이언트가 계산한 점수·추천 결과는 신뢰하지 않는다**(기존 시험 RPC 원칙 승계). 응답 30건 원본도 함께 저장 | Must | `diagnosis_results`, `diagnosis_answers` |
| F-DIAG-7 | 제출 | 추천 과정 판정 로직 | 원본 §8.1~8.4의 4개 tier(`level2` / `level1` / `supervision` / `instructor_candidate`)를 **서버에서 판정**. 경계값은 §8.5 우선순위 그대로: ① 기본 역량 결손(기본이론·도형판독·전체평균 중 하나라도 60 미만) → 무조건 `level2` ② 그 다음 상위 tier부터 역순 평가 ③ `instructor_candidate`는 7개 기준 **전부** 충족 시에만. 판정 결과와 사용한 **임계값 버전(`version`)을 결과 행에 스냅샷 저장**해 이후 기준이 바뀌어도 과거 결과가 뒤집히지 않게 한다 | Must | `diagnosis_results.recommended_tier`, `version` |
| F-DIAG-8 | `/selfcheck/result/[token]` | **결과 요약 (비로그인 공개)** | 로그인 없이 즉시 노출: ① 추천 과정 라벨(예: "기초부터 체계적으로 정리하는 단계") ② 전체 점수(100점) ③ 추천 과정명 ④ 비임상/비자격판정 주의 문구 ⑤ 추천 강좌 CTA(F-DIAG-14) ⑥ **"영역별 상세·차트·PDF는 로그인 후 확인" 안내 + 로그인/가입 버튼**. 영역별 점수는 이 단계에서 응답에 포함시키지 않는다(클라이언트 숨김 금지) | Must | `diagnosis_results` (RPC 요약 뷰) |
| F-DIAG-9 | 결과 | **상세 결과 게이팅 + 결과 귀속(claim)** | 로그인 상태 + 해당 결과의 소유자일 때만 상세 열람. 비회원이 만든 결과는 `user_id=null` 상태로 생성되고, 그 토큰 URL을 가진 사용자가 로그인/가입을 마치면 **최초 1회 claim**하여 `user_id`를 채운다. 이미 다른 회원에게 귀속된 결과는 재귀속 불가. 로그인 후 원래 결과 URL로 복귀(기존 F-AUTH-3 리다이렉트 패턴 재사용) | Must | `diagnosis_results.user_id`, `claimed_at` |
| F-DIAG-10 | 결과 상세 | 6영역 점수 표시 | 영역별 100점 환산 점수를 **수치 + 막대**로 표시. 색상만으로 고저를 구분하지 않는다(접근성) | Must | `diagnosis_results.score_*` |
| F-DIAG-11 | 결과 상세 | Radar 차트 | 6축 인라인 SVG polygon. **차트 라이브러리 신규 도입 금지**(F-ADM-5 선례). Radar는 보조 시각화이며 주인공은 추천 과정 카드다. 스크린리더용으로 F-DIAG-10 수치 표와 반드시 병기 | Should | `diagnosis_results.score_*` |
| F-DIAG-12 | 결과 상세 | 강점/보완 자동 해석 | 최고점 1~2개 = 강점, 최저점 1~2개 = 보완. 영역별 문구는 `data/diagnosis/` config에서 가져오며, **판정된 영역 코드는 결과 행에 저장**(문구가 개정돼도 어떤 영역이 뽑혔는지는 보존). 동점 처리 규칙 필요 → Q4 | Must | `diagnosis_results.strength_areas`, `improvement_areas` |
| F-DIAG-13 | 결과 상세 | 추천 이유 설명 | "왜 이 과정인가"를 tier별 문구 + 실제 점수 근거(예: "도형판독 48점")로 서술. `instructor_candidate`에는 **"자가진단 점수만으로 강사 자격을 판정하지 않습니다…" 고지 문구 필수 노출** | Must | config |
| F-DIAG-14 | 결과(요약·상세 공통) | 추천 강좌 CTA | tier → 강좌 매핑을 **DB 테이블(`diagnosis_course_links`)로 관리**하고 slug를 코드에 하드코딩하지 않는다(F-ADMC-7 제약 2번과 동일한 이유). `supervision` tier는 1급 강좌로 보내되 **CTA 라벨/설명만 "실습·슈퍼비전 중심"으로 다르게** 노출한다(별도 강좌 아님). **매핑된 강좌가 없거나 비활성이면 CTA를 깨진 링크로 두지 않고 "문의하기"로 대체 폴백** | Must | `diagnosis_course_links`, `courses` |
| F-DIAG-15 | 결과 | **강사과정 관심 문의 접수** | tier = `instructor_candidate`일 때만 노출. "강사과정이 열리면 안내받기" 폼(이름/연락처 프리필 + 한 줄 메모 + 연락 수신 동의). 제출 시 `diagnosis_leads`에 적재되고 **관리자 화면에서만 확인**된다(자동 회신·자동 발송 없음 → W7). 강좌 상세/신청 페이지로는 연결하지 않는다 | Must | `diagnosis_leads` |
| F-DIAG-16 | 결과 상세 | PDF로 저장 | **브라우저 인쇄 기반**(print stylesheet + `window.print()`). 헤더/네비/CTA는 인쇄에서 숨기고 점수·차트·해석만 남긴다. 서버 PDF 생성(파일 저장·재다운로드)은 Phase 2 | Should | — |
| F-DIAG-17 | `/my` 마이페이지 | 내 진단 결과 | 귀속된 결과를 마이페이지에서 다시 열람(최신 1건 카드 + 이전 이력 링크). 없으면 "진단 받아보기" 유도 | Should | `diagnosis_results` |
| F-DIAG-18 | 전 화면 | 접근성·모바일 | 키보드 조작 가능 / 라디오 `label` 연결 / 오류 메시지 명시 / 색상 비의존 / 360px 이상 대응 / 모바일 터치 영역 최소 44px | Must | — |
| F-DIAG-19 | 전 화면 | 퍼널 이벤트 추적(GA4) | 원본 §14의 8개 이벤트. **이 프로젝트에 GA4/GTM이 아직 설치돼 있지 않아** 분석 도구 도입 자체가 선행 결정이다(Q6). Phase 1은 DB 카운트로 완료율만 본다 | **Could (Phase 2)** | — |
| F-DIAG-20 | 결과 | 재진단 / 이전 결과 비교 | 학습 후 성장 확인용. 데이터(응답 원본)는 Phase 1부터 쌓이므로 화면만 나중에 붙이면 된다 | **Could (Phase 2)** | `diagnosis_results` |
| F-DIAG-21 | 제출 | 제출 남용 방지 | 동일 연락처·동일 세션의 단시간 반복 제출 제한(비회원 공개 쓰기 경로라 최소한의 방어 필요). 구체 정책은 Q7 | Should | RPC 내 검증 |

### 5.2 (admin) 진단 관리 `/admin/selfcheck`

| ID | 메뉴/화면 | 기능명 | 설명 | 우선순위 | 관련 데이터 |
|---|---|---|---|:---:|---|
| F-ADMDG-1 | 목록 | 진단 결과 조회 | 최신순 목록: 일시 · 이름 · **마스킹 연락처**(기존 F-ADM-3 마스킹 패턴 준수) · 학습경험 · 전체점수 · 추천 tier · 회원 귀속 여부. 필터: tier / 기간 / 회원-비회원 | Must | `diagnosis_results` |
| F-ADMDG-2 | 상세 | 진단 결과 상세 | 6영역 점수 + 강점/보완 + 응답 30건 원본. 회원 귀속 시 `/admin/members/[id]` 링크. **관리자 열람은 기존 `admin_access_logs` 패턴 적용 검토**(개인정보 포함 화면) | Should | `diagnosis_results`, `diagnosis_answers` |
| F-ADMDG-3 | **강사과정 문의** | 리드 목록 + 처리 상태 | `/admin/selfcheck/leads` — 접수 목록(일시·이름·연락처·메모·연결된 진단 결과 링크) + 상태 전환(신규 → 연락함 → 종료) + 관리자 메모. **Phase 1 포함**(F-DIAG-15가 접수만 하고 볼 화면이 없으면 리드가 유실된다 — 접수 기능과 조회 화면은 한 세트로만 승인한다) | Must | `diagnosis_leads` |
| F-ADMDG-4 | 목록 | CSV 내보내기 | 상담·마케팅 활용. 개인정보 대량 반출이라 privacy-security-officer 점검 선행 필요 | **Could (Phase 2)** | `diagnosis_results` |
| F-ADMDG-5 | 통계 | 진단 통계 대시보드 | tier 분포 · 일별 진단 수 · 완료율 · 진단→수강신청 전환율. 차트는 F-ADM-5와 동일하게 CSS/SVG 막대 | **Could (Phase 2)** | 집계 쿼리 |
| F-ADMDG-6 | 설정 | 문항·해석문구·임계값 CMS | 코드 배포 없이 문항/문구/추천 임계값 수정. 버전 관리 필수(과거 결과 스냅샷 유지) | **Could (Phase 2)** | `diagnosis_question_sets`(신설 예정) |
| F-ADMDG-7 | 자동화 | 리마케팅·상담 자동화 | 문자/메일 자동 발송, 미완료자 리타게팅 | **Won't (Later)** | — |

---

## 6. Phase 구분

### Phase 1 (MVP — 이번 스프린트 승인 대상)

> 판단 기준: **"진단을 받고, 추천 과정으로 넘어가고, 운영자가 그 결과와 리드를 볼 수 있다"**까지가 한 덩어리다. 이 중 하나라도 빠지면 기능이 성립하지 않는다.

- 공개: F-DIAG-1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 18
- 관리자: F-ADMDG-1, **F-ADMDG-3(강사과정 문의 접수 화면 — Phase 1 확정)**
- Phase 1 목표(Should, 미완 시에도 오픈 가능): F-DIAG-5, 11, 16, 17, 21, F-ADMDG-2
- 부수 작업: 개인정보처리방침 개정(7절), 관리자 사이드바 메뉴 2개 추가, 홈 진단 배너

> **"강사과정 문의 접수 화면"의 Phase 귀속 (명시 요청 사항)**
> - **접수 폼(F-DIAG-15) = Phase 1 Must**, **관리자 조회 화면(F-ADMDG-3) = Phase 1 Must**.
> - 사유: 진단 4개 tier 중 하나가 최상위 tier인데 이 경로만 종착점이 없으면 "추천했는데 아무 데도 못 간다"는 UX 공백이 생긴다. 또한 폼만 만들고 조회 화면을 Phase 2로 미루면 **수집한 개인정보를 아무도 보지 않는 상태로 방치**하게 되어 개인정보 최소수집 원칙에 위배된다.
> - 단, Phase 1의 리드 화면은 **목록 + 상태 전환 + 메모**까지다. 자동 회신·알림 발송·리드 스코어링은 Phase 2/Won't.

### Phase 2 (오픈 후 재검토)

- F-DIAG-19(GA4 이벤트 — 분석 도구 도입 결정 후), F-DIAG-20(재진단 비교)
- F-ADMDG-4(CSV), F-ADMDG-5(통계 대시보드), F-ADMDG-6(문항 CMS)
- 서버 생성 PDF(파일 보관·재다운로드), 진단→수강신청 전환 추적
- **Won't (Later)**: F-ADMDG-7(리마케팅 자동화), W1~W10 전체

---

## 7. 데이터 요구사항 (Supabase 테이블 설계 초안)

> PM 레벨 초안이다. 정식 DDL·RLS·RPC 시그니처는 backend-developer가 `supabase/schema.sql` 컨벤션(테이블 → 인덱스 → RLS → RPC 순, `create table if not exists` + `alter ... add column if not exists`)에 맞춰 확정한다.

### 7.1 신규 enum

| 이름 | 값 |
|---|---|
| `diagnosis_tier` | `level2` / `level1` / `supervision` / `instructor_candidate` |
| `diagnosis_experience` | `none` / `past_course` / `certified` / `active_use` |
| `diagnosis_lead_status` | `new` / `contacted` / `closed` |

### 7.2 `diagnosis_results` — 진단 결과 (1건 = 1회 진단)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid pk | 관리자 내부 식별자 |
| `access_token` | uuid unique, default gen_random_uuid() | **공개 URL용**. `/selfcheck/result/[token]` |
| `user_id` | uuid null → `profiles(id)` | 비회원은 null. 로그인 후 claim 시 채움 |
| `claimed_at` | timestamptz null | 귀속 시각 |
| `respondent_name` | text null | 이름/닉네임. 90일 미귀속 파기 시 null로 비움 |
| `phone` | text null | 휴대전화. 휴대전화·이메일 중 **최소 1개**만 필수(2026-09-14 재결정 — 최초 "둘 다 필수" CEO 지시를 privacy-security-officer의 최소수집 원칙 지적 이후 완화). 90일 미귀속 파기 시 null로 비움 |
| `email` | text null | 이메일(위와 동일 규칙) |
| `age_confirmed` | boolean not null | 만 14세 이상 확인(2026-09-14 privacy-security-officer 지적으로 추가 — RPC에서도 재검증) |
| `learning_experience` | `diagnosis_experience` not null | |
| `certificate_level` | text null | 보유 자격(선택) |
| `version` | text not null | 문항·임계값 버전 스냅샷 (예: `shape-v1`) |
| `score_theory` / `score_reading` / `score_analysis` / `score_counseling` / `score_case_record` / `score_teaching` | smallint (0~100) | 영역별 환산 점수 |
| `total_score` | numeric(5,2) | 6영역 평균 |
| `recommended_tier` | `diagnosis_tier` not null | 판정 결과 스냅샷 |
| `strength_areas` | text[] | 영역 코드 1~2개 (`theory` 등) |
| `improvement_areas` | text[] | 영역 코드 1~2개 |
| `consent_privacy` | boolean not null | 필수 동의 |
| `consent_privacy_doc_version` | integer null | 동의 시점 처리방침 버전(`legal_documents.version`) — 동의 이력 입증용 |
| `utm_source` / `utm_medium` / `utm_campaign` | text null | 유입 분석(Phase 2에서 활용) |
| `created_at` | timestamptz default now() | |

- 인덱스: `access_token`(unique), `user_id`, `created_at desc`, `recommended_tier`
- RLS: **직접 insert/select 전면 차단.** 쓰기는 `submit_diagnosis()` RPC, 요약 읽기는 `get_diagnosis_summary(token)` RPC, 상세 읽기는 `get_diagnosis_detail(token)` RPC(로그인 + 소유자 검증)로만. 관리자만 `is_admin()` 정책으로 직접 select 허용.

### 7.3 `diagnosis_answers` — 문항별 원응답

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `result_id` | uuid → `diagnosis_results(id)` on delete cascade | |
| `item_code` | text | `A1`~`F5` (30개) |
| `score` | smallint check (0~4) | |
| pk | (`result_id`, `item_code`) | 30행/결과 |

- 존재 이유: 문항·임계값이 개정돼도 **과거 응답으로 재채점/재분석이 가능**하고, Phase 2 문항 개선(변별력 분석)의 유일한 근거 데이터다.
- RLS: 관리자만 select. 학습자 노출 경로 없음(상세 결과에도 원응답은 표시하지 않는다).

### 7.4 `diagnosis_leads` — 강사과정 관심 문의

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid pk | |
| `result_id` | uuid null → `diagnosis_results(id)` on delete set null | 진단에서 넘어온 경우 연결 |
| `user_id` | uuid null → `profiles(id)` | 로그인 상태였다면 |
| `topic` | text not null default `'instructor_course'` | **향후 다른 문의 유형 재사용을 위한 확장 슬롯** |
| `name` / `contact` | text not null | |
| `message` | text null | 한 줄 메모 |
| `consent_contact` | boolean not null | 연락 수신 동의 |
| `status` | `diagnosis_lead_status` default `'new'` | |
| `admin_note` | text null | |
| `handled_by` | uuid null → `profiles(id)` | |
| `handled_at` | timestamptz null | |
| `created_at` | timestamptz default now() | |

- **기존 메커니즘 재사용 여부 판단**: 현재 코드베이스의 "문의하기"는 `ContactSection`의 `tel:`/`mailto:` 링크뿐이고 **접수 데이터를 저장하는 테이블이 전혀 없다**. `enrollments`를 유사 리드로 전용하는 방식은 수강신청 상태머신(pending/approved/rejected)과 입금 기한·수료 조건에 오염을 일으키므로 금지한다. → **신규 테이블이 맞다.** 다만 `topic` 컬럼을 두어 추후 일반 문의로 확장 가능하게 설계한다.
- RLS: insert는 RPC 경유, select/update는 `is_admin()`만.

### 7.5 `diagnosis_course_links` — tier → 강좌 매핑 (운영 설정)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `tier` | `diagnosis_tier` pk | 4행 고정 |
| `course_id` | uuid null → `courses(id)` | `instructor_candidate`는 null |
| `cta_label` | text | 예: "도형기질활용지도자 2급 자세히 보기" |
| `description` | text null | tier별 추천 이유 보조 문구 |
| `is_active` | boolean default true | |
| `updated_at` | timestamptz | |

- Phase 1은 **seed로 4행 삽입 + SQL로 수정**, 관리자 편집 화면은 Phase 2(F-ADMDG-6에 포함).
- **확정된 매핑(Q2, 2026-09-14)**: `level1`/`supervision` 두 tier 모두 1급 강좌(`https://bara-edu.kr/courses/shape-test-analysis-1`, slug `shape-test-analysis-1`)의 `course_id`로 연결하되 `cta_label`/`description`만 다르게(`supervision`은 "실습·슈퍼비전 중심" 문구). `level2`는 2급 강좌로 연결(slug는 구현 착수 시 실제 DB에서 재확인). `instructor_candidate`는 `course_id=null`로 두고 F-DIAG-15 리드 폼으로 대체.
- 강좌 slug 하드코딩 금지 원칙(F-ADMC-7 제약 2)을 그대로 승계한다.

### 7.6 config로 관리하는 것 (DB 아님, Phase 1)

`data/diagnosis/` 아래 TS 상수로 관리하고 `DIAGNOSIS_VERSION`을 함께 export한다.
- 30문항 텍스트 + 영역 매핑 + 0~4 척도 라벨
- 영역별 강점/보완 해석 문구
- tier별 추천 라벨·추천 이유 템플릿·고지 문구
- 추천 임계값 세트(원본 §8.1~8.4)

### 7.7 개인정보 영향 (privacy-security-officer 인계 사항 — 플래그만)

이번 기능은 **신규 개인정보 수집 항목**을 만든다: 이름/닉네임, 휴대전화 또는 이메일(최소 1개), 도형심리 학습경험·보유 자격, 진단 응답 및 결과 점수. 특히 **비회원 수집 경로가 이 프로젝트에서 처음 생긴다**(기존에는 가입 후에만 수집). 최초 CEO 결정(Q1)은 휴대전화+이메일을 모두 필수로 받는 것이었으나, privacy-security-officer가 "Phase 1은 결과를 문자·메일로 발송하는 기능 자체가 없어 상담 연결에 연락 수단 1개면 충분한데 둘 다 강제하는 것은 최소수집 원칙(개인정보 보호법 제16조)에 어긋날 수 있다"고 지적해 **2026-09-14 재결정으로 "둘 중 최소 1개"로 완화**했다(아래 Q1 갱신 참고).

| 항목 | 상태 |
|---|---|
| `legal_documents`(개인정보처리방침) 제1조 수집 항목 개정 | **필요 — 구현 단계에서 privacy-security-officer 수행** |
| 수집 목적·보유기간 명시 (미귀속 비회원 결과의 파기 주기) | **정책 미정 → Q3** |
| 마케팅 수신 동의 분리(선택 항목) | **폐기(2026-09-14)** — Phase 1은 실제 발송 기능이 없어 `consent_marketing` 컬럼·체크박스 자체를 제거함. Phase 2에서 발송 기능을 실제로 만들 때 다시 추가 |
| 동의 시점 방침 버전 스냅샷 | 설계 반영됨(`consent_privacy_doc_version`) |
| 관리자 열람 로깅(`admin_access_logs`) 적용 범위 | 검토 필요(F-ADMDG-2) |

---

## 8. 구현 전 반드시 확정해야 할 열린 질문

| # | 질문 | 결정권자 | 미해결 시 영향 | 확정 내용 |
|---|---|---|---|---|
| **Q1** | 연락처를 **필수**로 받는가, 선택으로 두는가? (원본 §4.2가 "정책 결정" 상태로 남겨둠) | CEO/운영 | 필수화하면 완료율(목표 70%)이 떨어지고, 선택이면 상담 리드로 못 쓴다 | **✅ 재확정(2026-09-14)**: 휴대전화·이메일 **중 최소 1개**만 필수. (1차 결정은 "둘 다 필수"였으나 privacy-security-officer가 Phase 1에 발송 기능이 없어 최소수집 원칙에 어긋날 수 있다고 지적, CEO가 완화로 재결정). 스키마는 `phone`/`email` 두 컬럼을 유지하되 둘 다 nullable로 두고 RPC(`submit_diagnosis`)에서 "최소 1개" 조건만 검증 |
| **Q2** | **"도형기질활용지도자 1급" 강좌가 실제로 등록되어 있는가?** 2급만 확인된 상태다 | 운영 | tier 3개 중 2개(`level1`/`supervision`)의 CTA가 갈 곳이 없다 | **✅ 확정(2026-09-14)**: 1급 강좌 등록되어 있음 — `https://bara-edu.kr/courses/shape-test-analysis-1` (slug: `shape-test-analysis-1`). `level1`/`supervision` 두 tier 모두 이 강좌로 연결(7.5절 `diagnosis_course_links` 참고). 2급 강좌 slug는 구현 착수 시 실제 DB에서 재확인 |
| **Q3** | 비회원 진단 결과(미귀속)의 **보유기간**은? | CEO + privacy-security-officer | 처리방침에 쓸 문구가 확정되지 않아 개정이 막힌다 | **✅ 확정(2026-09-14)**: PO 제안대로 진행 — 미귀속 결과는 **90일 후 개인식별정보(이름·연락처) 파기, 점수·응답은 비식별 통계로만 보존**. 기존 `purge_unverified_signups()` 배치 패턴 재사용 |
| **Q4** | 강점/보완 **동점 처리** 규칙 (예: 6영역이 모두 같은 점수, 최고점 3개 동점) | PO + service-planner | 결과 화면이 빈 채 렌더링되거나 4개가 쏟아질 수 있다 | 동점 시 **영역 정의 순서(기본이론→…→교육지도)** 우선, 최대 2개까지. 최고점=최저점(전 영역 동점)이면 강점/보완 섹션 대신 "전 영역이 고르게 나타납니다" 단일 문구 |
| **Q5** | 결과 PDF를 **브라우저 인쇄**로 충족할지, 서버 PDF 생성 라이브러리를 도입할지 | PO + developer | Phase 1 범위와 의존성 정책이 흔들린다 | **Phase 1은 인쇄 기반**(의존성 0). 파일 보관·재발급이 필요해지면 기존 수료증 PDF 정책과 **묶어서** 한 번에 결정 |
| **Q6** | **GA4/GTM을 도입할 것인가?** 현재 미설치 | CEO | 원본 §14 이벤트 8종을 구현할 대상이 없다 | 진단과 분리해 별도 결정. 도입 시 개인정보처리방침 제3자 제공·위탁 항목 개정이 따라온다(홈 문서에서 이미 지적된 이슈) |
| **Q7** | 비회원 공개 쓰기 경로의 **남용 방지** 수준 | developer + security | 스팸·더미 데이터로 리드/통계가 오염된다 | Phase 1은 RPC 내 최소 방어(동일 연락처 단시간 반복 제출 차단 + 제출 간 최소 소요시간 검증). CAPTCHA는 도입하지 않음(의존성·UX 비용) |
| **Q8** | 진단 결과를 **상담 전화에서 조회**해야 하는가? (운영자가 고객명으로 검색) | 운영 | F-ADMDG-1의 검색 요건이 바뀐다 | 목록에 이름/연락처 검색 포함(Phase 1). 단 연락처는 마스킹 표시, 원문은 상세에서만 |
| **Q9** | 헤더 네비에 "역량진단"을 **상시 노출**할지, 홈 배너만 둘지 | PO + ui-ux-designer | 헤더 항목이 3개로 늘어 모바일에서 밀림 | 홈 배너(Must) 먼저, 헤더 노출은 디자인 검토 후 결정(Should) |

---

## 9. Next Step (승인 시)

```
1) service-planner : 진단 응답 스테퍼 상세 플로우 + 결과 화면(요약/게이팅/상세 3상태) 정의
                     강사과정 리드 폼·관리자 리드 화면 상태 정의
2) ui-ux-designer  : Figma F1~F8 (기존 Design System 컴포넌트 인스턴스로 조립, 신규 컴포넌트는 Radar/점수바만)
3) PO              : F9 디자인 리뷰·승인 (게이팅 경계와 비임상 고지 문구가 유지되는지 최종 확인)
4) backend-developer : submit_diagnosis / get_diagnosis_summary / get_diagnosis_detail / claim_diagnosis RPC 계약 확정 후 frontend와 공유
5) frontend-developer : 구현
6) qa-reviewer     : 추천 로직 테스트 케이스(경계값 포함) + 게이팅 우회 검증
7) privacy-security-officer : 처리방침 개정 + 비회원 수집·보유기간·RPC 권한 점검 (배포 게이트)
```

> **PO 승인 조건**: ~~Q1~Q3은 **구현 착수 전** 반드시 닫혀야 한다~~ → **2026-09-14 CEO 확정으로 Q1~Q3 전부 종결.** service-planner 단계로 진행 가능. Q4~Q9는 디자인/구현 단계에서 닫아도 무방하다.
