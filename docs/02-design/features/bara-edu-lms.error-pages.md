# bara-edu-lms 오류 화면 정의서 (Error Pages)

> 작성: service-planner / 2026-11-25 / 상태: Draft (PO 확인 질문 6건 대기)
> 다음 단계: ux-writer(최종 문구) -> ui-ux-designer(디자인 스펙, Figma) -> frontend-developer 구현 -> qa-reviewer
> 상위 문서: `bara-edu-lms.design.md` (5. Error Handling, 2.2 라우트 그룹, 4.0 디자인 토큰)
> 이 문서의 **모든 문구는 초안**이다. 최종 문구, 어투, 외국어 병기 여부는 ux-writer가 정한다. 문구 확정 전까지 아래 따옴표 문구는 "의도 전달용 예시"로만 쓴다.

---

## 0. 현황과 범위

| 항목 | 현재 | 문제 |
|---|---|---|
| `app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx` | 없음 | Next 기본 영문 화면 노출. 홈/전화 등 다음 행동이 없다 |
| `proxy.ts` 47-52행 (보호 경로 + API 연결 불가) | 평문 503 `서비스에 일시적으로 연결할 수 없어요.` | 스타일/버튼 없는 흰 화면. 시니어가 빠져나갈 길이 없다 |
| `lib/db/api.ts` | 네트워크 오류 -> `status 503 / code 'unavailable'`, 10초 타임아웃 | 각 화면이 개별 처리. 표현이 화면마다 달라질 위험 |
| `app/layout.tsx` | `<html>` + Pretendard CDN + inline style만 있음(헤더/푸터 없음) | 루트 not-found/global-error는 헤더·푸터가 없다. 직접 그려야 한다 |
| 헤더/푸터 | 그룹 레이아웃(`(public)`, `(user)`)이 각각 렌더링 | 그룹 밖에서 터진 오류에는 헤더·푸터가 안 붙는다 |

범위: 4개 화면(404 / 렌더링 예외 / 루트 실패 / 503). 로그인 폼 내부 에러, 폼 필드 검증, 시험 제출 실패 토스트 등 **화면 안의 부분 오류**는 기존 정의를 따르며 이 문서 범위가 아니다(단 4.6 공통 컴포넌트 재사용 지침은 있음).

### 0.1 화면-파일 매핑 (구현 위치 제안)

| ID | 화면 | 파일 | 헤더/푸터 | 비고 |
|---|---|---|---|---|
| E-404-R | 404 (루트: 없는 주소) | `app/not-found.tsx` | 자체 포함(간이 헤더+푸터) | 루트 레이아웃에는 헤더가 없으므로 이 화면이 직접 그린다 |
| E-404-P | 404 (public 그룹: 없는 slug 등) | `app/(public)/not-found.tsx` | `(public)` 레이아웃이 제공 | 강좌 slug, legal slug의 `notFound()` |
| E-404-U | 404 (user 그룹) | `app/(user)/not-found.tsx` | `(user)` 레이아웃이 제공 | `/learn/...` 없는 강의/시험 |
| E-404-A | 404 (admin 그룹) | `app/(admin)/not-found.tsx` | AdminShell 안 | 없는 회원/강좌 id |
| E-500-U | 렌더링 예외 (사용자) | `app/(public)/error.tsx`, `app/(user)/error.tsx` | 그룹 레이아웃 유지 | 동일 컴포넌트 공유 |
| E-500-A | 렌더링 예외 (관리자) | `app/(admin)/error.tsx` | AdminShell(사이드바) 유지 | 사용자용과 컴포넌트 분리 |
| E-500-R | 렌더링 예외 (루트 폴백) | `app/error.tsx` | 없음(루트 레이아웃만) | 그룹 레이아웃 자체가 던진 예외를 받는 마지막 폴백. 사용자용 컴포넌트 재사용 + 간이 헤더 |
| E-GLB | 루트 레이아웃 실패 | `app/global-error.tsx` | 없음 | 자체 `<html><body>` 필수, 외부 CSS/폰트 의존 금지 |
| E-503 | API 연결 불가 (전체 화면) | `app/(public)/service-unavailable/page.tsx` 또는 동등한 정적 페이지 | 간이 헤더(로고만)+푸터 | proxy가 rewrite로 연결. API/세션 호출 절대 금지 |

> 확인된 Next 동작(`node_modules/next/dist/docs/.../error.md`): `error.tsx`는 **같은 세그먼트의 layout을 감싸지 못한다**. 그래서 그룹 레이아웃(헤더/푸터)이 던진 오류는 `app/error.tsx`가 받고, 루트 레이아웃이 던진 오류만 `global-error.tsx`가 받는다. 이 버전은 재시도 함수 prop 이름이 `unstable_retry`다(이전 버전의 `reset`이 아님). 구현자는 반드시 해당 문서를 읽고 쓴다(AGENTS.md).

---

## 1. 공통 원칙 (4개 화면 전부)

| # | 원칙 | 내용 |
|---|---|---|
| C-1 | 구조 | 큰 아이콘 또는 일러스트(장식, 대체텍스트 없음) -> 제목 1줄 -> 설명 1~2문장 -> 주 버튼 1개 -> 보조 버튼/링크 -> 전화 문의 블록. 한 화면에 "다음 행동"이 3개를 넘지 않는다 |
| C-2 | 어투 | "~했어요/~해 주세요" 해요체, 한 문장 40자 안팎, 한자어/영어 약어 금지("서버", "네트워크", "예외", "API" 금지). 사용자 탓이 아니라고 먼저 말한다("문제가 생겼어요" O, "잘못된 접근입니다" X) |
| C-3 | 글씨 | 제목 28px 이상(모바일 24px 이상), 본문 18px 이상, 버튼 글자 18px 이상. 시니어 기준이므로 기존 디자인 토큰(4.0)의 본문 크기보다 작게 쓰지 않는다 |
| C-4 | 버튼 | 높이 56px 이상, 모바일은 가로 전체 폭(풀 와이드) 세로 배치. 주 버튼은 1개만 강조색, 나머지는 아웃라인/텍스트 링크 |
| C-5 | 전화 문의 | 모든 사용자용 오류 화면 하단에 `siteConfig.phone`(`data/site-config.ts`)을 `tel:` 링크 버튼으로 표시한다. 번호는 하드코딩 금지, `siteConfig`를 import한다. 운영시간은 현재 데이터에 없다(Q4) |
| C-6 | 기술 정보 | HTTP 상태 숫자(404/500/503), `error.message`, 스택, API 에러 코드(`unavailable`, `internal`)를 **본문에 노출하지 않는다**. 예외: 500류에서 `digest`(서버 로그 대조용 해시)를 "문의번호"라는 이름으로 화면 하단 작은 글씨(14px 이상)로 표시 -> 상담원이 로그를 찾는 용도(Q1) |
| C-7 | 로깅 | `error.tsx`/`global-error.tsx`는 `useEffect`에서 `console.error(error)`만(프로덕션 서버 로그와 digest로 대조). 사용자 개인정보를 화면/URL 쿼리에 싣지 않는다 |
| C-8 | 검색 색인 | 오류 화면은 `noindex`. 404는 반드시 HTTP 404, 503은 HTTP 503(`Retry-After` 헤더 포함)로 응답한다(렌더링 예외는 200이 되는 한계는 Next 기본 동작이며 허용) |
| C-9 | 로그인 상태 | 오류 화면은 로그인 여부로 문구를 바꾸지 않는다. 단 헤더가 있는 화면(그룹 레이아웃 안)은 헤더가 평소처럼 로그인 상태를 보여준다. 홈 버튼의 목적지는 항상 `/`(관리자 화면 제외) |
| C-10 | 언어 | 현재 사이트는 한국어 단일(`lang="ko"`). 해외이주민 대상 영문/기타 언어 병기는 이 문서 범위 밖이며 ux-writer가 Q5로 판단한다. 대신 **아이콘 + 숫자 전화번호**로 문구를 못 읽어도 행동할 수 있게 한다 |
| C-11 | 신청/제출 중 오류 안내 | 오류가 난 경로가 `/courses/[slug]/apply`, `/learn/[courseId]/exam` 등 "저장/제출" 성격의 화면이면 사용자용 오류 화면에 안내를 한 줄 추가한다: "방금 하던 신청(또는 제출)이 저장됐는지 [내 강좌]에서 먼저 확인해 주세요." 중복 신청/중복 제출을 막기 위한 장치다. 경로 판별은 `usePathname()` 접두사 매칭 |

---

## 2. E-404 없는 페이지

### 2.1 언제 나오는가

| 트리거 | 화면 | 비고 |
|---|---|---|
| 정의되지 않은 주소(`/abc`, 오타, 옛 Google Sheets 링크 등) | E-404-R (루트) | 헤더/푸터를 이 화면이 그림 |
| `/courses/[slug]`에서 slug가 DB에 없음 또는 비활성/비공개 강좌 | E-404-P | 4.1 기존 Figma 12(404) 와이어프레임을 기준으로 한다 |
| `/courses/[slug]/apply` 없는 slug | E-404-P | |
| `/legal/[slug]` 없는 문서 | E-404-P | |
| `/learn/[courseId]`, `/lessons`, `/exam` 없는 id, 또는 `requires_exam=false` 강좌의 exam 직접 접근(design.md 5절 기존 행) | E-404-U | 로그인 상태, 본인 수강 강좌가 아님 -> 존재 여부를 노출하지 않으려면 404로 통일(보안, 아래 2.5) |
| `/admin/members/[id]`, `/admin/courses/[id]`, `/admin/cms/[id]/edit` 등 없는 id | E-404-A | AdminShell 안에서 표시 |
| `/admin/없는경로` (비관리자 포함) | E-404-R | proxy가 비관리자를 `/`로 리다이렉트하므로 일반 사용자는 404를 보지 않는다 |

### 2.2 보여줄 정보

| 요소 | 내용(초안) | 비고 |
|---|---|---|
| 제목 | "찾으시는 페이지가 없어요" | 숫자 404는 제목에 쓰지 않는다 |
| 설명 | "주소가 바뀌었거나 없어진 페이지예요. 아래에서 원하는 곳으로 이동해 주세요." | 강좌 slug일 때 E-404-P는 "찾으시는 강좌가 없거나 지금은 신청을 받지 않아요." 변형 1개(비활성 강좌와 없는 강좌를 구분하지 않는다) |
| 오류 코드 | 미노출 | 4xx는 상담원이 로그로 조회할 일이 없다 |
| 추천 콘텐츠(Should) | E-404-P에서만 "인기/신규 강좌" 카드 3개 | API 호출이 실패하면 카드 영역만 조용히 숨김(오류 문구 없음). Could 우선순위, 1차 배포에서는 생략 가능(Q6) |

### 2.3 버튼과 링크

| 순서 | 라벨(초안) | 동작 | 강조 |
|---|---|---|---|
| 1 | "홈으로 가기" | `/` | 주 버튼 |
| 2 | "강좌 보러가기" | `/courses` | 보조(아웃라인). E-404-A에서는 "관리자 홈으로" `/admin`이 주 버튼, 사이트 홈은 텍스트 링크 |
| 3 | "전화로 문의하기 010-9025-5093" | `tel:` | 하단 블록 |
| (선택) | "이전 페이지로" | `history.back()` | 직접 진입(이전 기록 없음)이면 표시하지 않는다. 클라이언트 컴포넌트가 필요해 1차에서는 생략 |

### 2.4 관리자 vs 일반 사용자

| 구분 | 차이 |
|---|---|
| 일반 | 위 구성 그대로 |
| 관리자(E-404-A) | AdminShell 사이드바 유지, 제목 "찾을 수 없는 항목이에요", 설명 "삭제됐거나 주소가 잘못됐을 수 있어요.", 주 버튼 "목록으로"(해당 목록 경로 `/admin/members` 등 또는 `/admin`), 전화 블록 없음(내부 도구), 시니어 기준 글자 크기는 관리자 기존 표준을 따름 |
| 관리자가 사용자 화면에서 404 | 일반과 동일(별도 표시 없음) |

### 2.5 엣지케이스

| 상황 | 처리 |
|---|---|
| 로그인 상태로 404 | 헤더(그룹 레이아웃 안)가 로그인 상태 유지. 루트 404(E-404-R)의 간이 헤더는 세션 조회를 하지 않는다(API 장애 시 404까지 막히는 것을 방지). 로그인/회원가입 버튼 없이 로고 + "홈으로"만 |
| 모바일 | 버튼 풀 와이드 세로 배치, 전화 블록은 스크롤 없이 보이도록 하단 고정까지는 하지 않는다(1~2스크롤 허용) |
| 반복 실패 | 해당 없음(재시도 개념 없음) |
| 타 사용자 강의 id 접근 | 존재 여부를 알려주지 않기 위해 "없음"과 "권한 없음"을 같은 404로 통일(확인 필요: 현재 `/learn` 화면이 미승인 시 별도 안내 "입금 확인 후 이용 가능해요" 04d를 쓰므로, **본인의 미승인 신청 강좌는 기존 04d 유지, 신청 이력이 전혀 없는 id만 404**) |
| slug 대소문자/끝 슬래시 | 정규화는 이 문서 범위 아님(기존 라우팅 동작 유지). 404 처리만 정의 |
| 옛 주소 | 오픈 전 Google Sheets 시절 URL은 우리 도메인에 없으므로 해당 없음 |
| 검색 로봇 | 404 응답 코드 유지, 리다이렉트로 홈에 보내지 않는다(soft-404 방지) |

### 2.6 접근성

- 제목은 `<h1>` 하나, 페이지 `<title>`은 "페이지를 찾을 수 없어요 | 바라 평생교육원".
- 이동 시 포커스는 `<h1>`로(또는 `tabIndex=-1`을 둔 main). 스크린리더가 오류 상황을 바로 읽는다.
- 버튼/링크 터치 영역 56px 이상, 포커스 링 3px 이상 대비 3:1 이상.
- 텍스트 대비 4.5:1 이상(본문), 아이콘은 `aria-hidden`.
- 링크는 색만으로 구분하지 않고 전화는 아이콘 + 번호 텍스트를 함께 둔다.

---

## 3. E-500 화면 렌더링 중 예외 (error.tsx)

### 3.1 사용자용/관리자용 분리 판단

**결정: 분리한다.** 근거는 아래와 같다.

| 기준 | 사용자 영역(`(public)`, `(user)`) | 관리자 영역(`(admin)`) | 분리 필요? |
|---|---|---|---|
| 독자 | 시니어 학습자 | 운영자(직원) | 예 |
| 화면 껍데기 | 헤더 + 푸터 | AdminShell(사이드바) | 예 - error.tsx는 레이아웃 안쪽에 그려지므로 파일이 달라야 껍데기가 유지된다 |
| 필요한 정보 | 쉬운 말, 전화 문의 | 어디서 났는지(경로, 시각, digest), 복사 가능한 정보 | 예 |
| 다음 행동 | 홈, 다시 시도, 전화 | 다시 시도, 대시보드, 개발자에게 전달 | 예 |
| 구현 비용 | 공통 레이아웃 컴포넌트 1개 + 본문 2종 | | 낮음 |

공유할 것: 재시도 로직(횟수 추적, `unstable_retry`), `console.error` 로깅, 아이콘 크기/간격 토큰. 문구와 정보 구성은 공유하지 않는다.

### 3.2 언제 나오는가

| 트리거 | 화면 |
|---|---|
| 서버 컴포넌트 렌더링 중 예상 못한 예외(쿼리 결과 형태 이상, null 접근 등) | E-500-U / E-500-A (경로 그룹별) |
| 클라이언트 컴포넌트 렌더링/이벤트 후 상태 갱신 중 예외 | 동일 |
| API가 `status 500` 또는 `code 'internal'`을 반환했는데 화면이 처리 없이 throw | 동일 |
| API 연결 불가(`503 / unavailable`)를 화면이 처리하지 않고 throw | 동일하게 E-500로 떨어지지만, **정상 구현은 E-503 인라인 처리**(4절 규칙 R-3)로 분기해야 한다. error.tsx에서 `error.message`에 unavailable 문구가 있어도 분기하지 않는다(프로덕션에서 메시지가 마스킹됨) |
| `(public)`/`(user)` 레이아웃(헤더·푸터) 자체가 던진 예외 | E-500-R(`app/error.tsx`) |
| `(admin)` 레이아웃(AdminShell) 자체가 던진 예외 | E-500-R(사이드바 없음) |
| 서버 액션에서 던진 예외(폼 제출 중) | 가능하면 액션이 에러 객체를 반환해 인라인 처리, throw는 최후 수단으로 E-500 |

> 참고(사실 확인): `(admin)/layout.tsx`는 아직 `createClient`(`lib/db/server`)와 `supabase.auth.getUser()` 패턴을 쓴다. 이 레이아웃이 던지는 예외는 E-500-R로 가므로 E-500-R는 "관리자도 볼 수 있는 최소 화면"이어야 한다. 이 레이아웃의 현재 구현이 새 API 구조와 맞는지는 별도 점검 대상(이 문서 범위 아님, QA에 전달).

### 3.3 보여줄 정보

| 요소 | 사용자용(초안) | 관리자용(초안) |
|---|---|---|
| 제목 | "화면을 불러오지 못했어요" | "이 화면에서 오류가 발생했어요" |
| 설명 | "잠시 후 다시 해 보세요. 계속되면 전화로 알려 주세요. 불편을 드려 죄송해요." | "일시적일 수 있어요. 다시 시도해도 같으면 아래 정보를 개발 담당에게 전달하세요." |
| 문의번호(digest) | 작은 글씨 "문의번호: abc123" (digest가 없으면 줄 자체 생략). 전화할 때 불러 달라는 안내 1줄 동반 | 같은 값을 항상 표시 + "복사" 버튼 |
| 발생 정보 | 없음 | 발생 경로(`pathname`), 발생 시각(KST), 브라우저 폭은 불필요 |
| 오류 메시지 | 노출 금지 | 프로덕션에서는 Next가 일반화한 `error.message`만 노출 가능(민감정보 없음). 스택은 노출 금지. 개발 환경(`NODE_ENV=development`)에서만 원문 허용 |
| 신청/제출 안내 | C-11 적용 | 적용 안 함 |

### 3.4 버튼과 링크

| 대상 | 순서 | 라벨(초안) | 동작 |
|---|---|---|---|
| 사용자 | 1 (주) | "다시 시도하기" | `unstable_retry()`. 누르면 버튼이 "불러오는 중..." 비활성 + `aria-busy`, 실패 시 같은 화면 복귀 |
| 사용자 | 2 | "홈으로 가기" | `/` |
| 사용자 | 3 | "전화로 문의하기 010-9025-5093" | `tel:` |
| 관리자 | 1 (주) | "다시 시도" | `unstable_retry()` |
| 관리자 | 2 | "관리자 홈으로" | `/admin` |
| 관리자 | 3 | "오류 정보 복사" | 클립보드 복사(경로, 시각, digest). 복사 성공 시 버튼 라벨이 "복사했어요"로 2초 변경 + `aria-live="polite"` |
| 관리자 | 4 (텍스트) | "사이트 홈" | `/` |

### 3.5 엣지케이스

| 상황 | 처리 |
|---|---|
| 로그인 상태 | 헤더 유지. 오류가 세션 문제로 의심돼도 자동 로그아웃/리다이렉트 하지 않는다(데이터 손실 방지). 문구에 "로그아웃" 권유 없음 |
| 비로그인 상태 | 동일. 보호 경로는 proxy가 이미 로그인으로 보냈으므로 오류 화면에서 다시 로그인 요구하지 않는다 |
| 모바일 | 버튼 풀 와이드 세로, 문의번호는 줄바꿈 허용(긴 해시는 `overflow-wrap:anywhere`), 복사 버튼 터치 영역 48px 이상 |
| 반복 실패(재시도 2회 이상 실패) | 재시도 횟수를 `sessionStorage`(경로별 키)에 센다. 3회째부터는 주 버튼을 "홈으로 가기"로 바꾸고 "다시 시도"를 보조로 내리며, 전화 블록을 강조(배경색 있는 카드)하고 설명을 "같은 문제가 반복돼요. 전화로 알려 주시면 도와 드릴게요."로 교체. 성공 시(정상 렌더링) 카운트를 지운다. 자동 재시도(타이머) 금지(시니어가 화면이 저절로 바뀌는 것에 당황) |
| 오류가 연속으로 매 페이지에서 발생 | 위와 별개로 "홈으로"가 같은 오류를 일으킬 수 있음 -> 홈(`/`)이 단일 의존이 되지 않도록 E-503처럼 정적인 최소 홈 폴백은 Q3에서 논의 |
| 입력 중이던 폼 | 오류 화면으로 바뀌면 입력값이 사라진다. C-11 안내로 대체(자동 저장은 범위 밖) |
| 뒤로 가기 | 오류 화면에서 브라우저 뒤로 가기가 직전 정상 화면으로 돌아가게 둔다(`replace` 사용 금지) |
| 동일 오류 중복 로그 | `useEffect` 의존성 `[error]`로 1회만 |
| 관리자 중 한 명이 비관리자 화면에서 오류 | 사용자용 화면과 동일(관리자 구분 없음) |

### 3.6 접근성

- 오류가 나타나면 `role="alert"`(또는 포커스 이동 후 `<h1>` 읽힘) 중 하나만 쓴다: 전체 화면 교체는 **`<h1>`에 포커스 이동**을 우선, 인라인 요소(복사 성공, "불러오는 중")는 `aria-live="polite"`.
- `<title>`: "문제가 생겼어요 | 바라 평생교육원".
- 재시도 버튼 로딩 상태는 시각 + 텍스트 + `aria-busy="true"`로 알린다(색/스피너만으로 표현 금지).
- digest는 `<code>` 또는 `<kbd>`로 감싸고 `user-select: all`로 한 번에 선택 가능하게 한다.
- 키보드: Tab 순서 = 제목 -> 주 버튼 -> 보조 -> 전화. Enter/Space로 모두 동작.

---

## 4. E-GLB 루트 레이아웃 실패 (global-error.tsx)

### 4.1 언제 나오는가

- `app/layout.tsx` 또는 그 의존(폰트/스타일 로딩이 아니라 **렌더링 예외**)이 던진 예외. 루트 레이아웃은 현재 정적이라 발생 확률은 매우 낮다. "마지막 안전망"이다.
- `app/error.tsx`(E-500-R) 자체가 렌더링 중 예외를 던졌을 때도 여기로 온다.
- 자체 `<html>`/`<body>`를 반드시 렌더링한다(루트 레이아웃이 교체되기 때문).

### 4.2 보여줄 정보

| 요소 | 내용 | 제약 |
|---|---|---|
| 스타일 | **전부 인라인 style**. `globals.css`, Pretendard CDN, 디자인 토큰 CSS 변수, 컴포넌트 라이브러리, 이미지 에셋에 의존하지 않는다 | 실패 원인이 그것일 수 있음 |
| 폰트 | 시스템 폰트 스택(`-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif`), 크기는 C-3 준수 | |
| 로고 | 텍스트 "바라 평생교육원"만(이미지 금지) | |
| 제목(초안) | "지금은 화면을 열 수 없어요" | |
| 설명(초안) | "잠시 후 다시 열어 주세요. 계속 안 되면 전화로 알려 주세요." | |
| 문의번호 | digest가 있으면 표시(C-6) | |
| 전화 | `siteConfig.phone` import 허용(순수 데이터 파일, React/환경 의존 없음). 단 `process.env`만 읽는 필드가 포함돼도 렌더링에 영향 없는지 구현자가 확인. 불안하면 이 파일에 한해 번호를 상수로 복제하되 **주석으로 siteConfig와 동기화 필요 명시** | `<html lang="ko">` |

### 4.3 버튼과 링크

| 순서 | 라벨(초안) | 동작 |
|---|---|---|
| 1 (주) | "다시 시도하기" | `unstable_retry()`; 이 prop이 global-error에서 동작하지 않는 경우 `window.location.reload()`로 대체(구현자가 문서 확인) |
| 2 | "홈으로 가기" | `<a href="/">` (일반 앵커, Next `Link` 금지 - 클라이언트 라우터 상태가 손상됐을 수 있으므로 **전체 새로고침**을 일으키는 앵커 사용) |
| 3 | "전화로 문의하기 010-9025-5093" | `tel:` |

### 4.4 관리자와 일반 사용자

차이 없음. 루트 실패 상태에서는 역할을 알 수 없고, 세션 조회도 하지 않는다. 관리자에게 필요한 정보(digest)는 사용자에게도 이미 표시된다.

### 4.5 엣지케이스

| 상황 | 처리 |
|---|---|
| 로그인 상태 | 로그인 여부 표시 없음(헤더 없음). 홈으로 이동하면 정상 복구 시 로그인 유지(쿠키는 그대로) |
| 모바일 | 단일 컬럼, 버튼 풀 와이드, `<meta viewport>`는 Next가 기본 삽입하는지 구현자가 확인(없으면 `<head>`에 직접) |
| 반복 실패 | 재시도 카운트(`sessionStorage`) 3회 이상이면 "다시 시도하기" 숨기고 홈 + 전화만. `sessionStorage`가 막힌 환경이면 try/catch로 무시하고 항상 3개 버튼 표시 |
| 다크 모드 | 지원하지 않음. 고정 밝은 배경(어두운 설정 사용자도 대비 보장을 위해 `color-scheme: light` 지정) |
| JS 비활성/하이드레이션 전 | 정적 HTML만으로 홈 링크와 전화 링크는 동작(버튼이 아니라 앵커라서 가능) |

### 4.6 접근성

- 자체 `<html lang="ko">`, `<title>` 설정("문제가 생겼어요 | 바라 평생교육원").
- 인라인 스타일로도 포커스 링을 지정할 수 없으므로 `<style>` 태그 1개로 `:focus-visible { outline: 3px solid #1a56db; outline-offset: 2px; }` 허용(외부 CSS가 아니므로 안전).
- 색 대비 4.5:1 이상 고정값(토큰 변수 대신 hex 확정값은 ui-ux-designer가 지정).
- 터치 영역 56px 이상.

---

## 5. E-503 API 연결 불가

### 5.1 언제 나오는가 (발생 지점 3곳)

| 지점 | 트리거 | 현재 | 변경 |
|---|---|---|---|
| (a) proxy 보호 경로 | `/my`, `/learn`, `/admin` 접근 + 세션 토큰이 있음 + `getSession`이 `!r.ok`(연결 불가/타임아웃/5xx 등)이고 "죽은 세션 판정"이 아님 | 평문 503 | **E-503 전체 화면으로 rewrite** (5.2) |
| (b) proxy 비보호 경로 | 같은 상황이지만 `/`, `/courses` 등 | `NextResponse.next()` (통과) | **변경 없음.** 공개 화면은 로그인 여부와 무관하게 계속 보여준다. 헤더는 "로그아웃 상태처럼" 보일 수 있음(5.5 엣지) |
| (c) 화면 내부 API 호출 | 서버 컴포넌트/액션이 `ApiResult`에서 `status 503 / code 'unavailable'`를 받음 | 화면별 개별 처리 | 아래 R-3 규칙으로 **세 가지 표현**으로 통일 |

> proxy는 토큰이 **없으면** API를 호출하지 않는다. 즉 비로그인 방문자의 `/my`는 정상적으로 로그인 화면으로 이동하고, 로그인 폼 제출 시점에 API가 죽어 있으면 로그인 폼 내부 에러(기존 패턴)로 처리한다. 이 문서는 폼 문구를 바꾸지 않되 R-3-c와 같은 문구/톤을 쓰도록 ux-writer에게 요청한다.

### 5.2 proxy 평문 응답 -> 화면 전환 결정

**결정: `NextResponse.rewrite()`로 `/service-unavailable` 정적 페이지를 보여주고 HTTP 상태는 503을 유지한다.**

| 선택지 | 판단 | 이유 |
|---|---|---|
| A. 리다이렉트(`/service-unavailable`로 302) | 기각 | 원래 주소를 잃어서 "다시 시도"가 원래 보려던 곳으로 못 돌아간다. 검색/북마크에 오류 주소가 남는다. 상태코드가 200으로 바뀐다 |
| **B. rewrite + status 503 (채택)** | 채택 | 주소창이 `/my` 그대로라 새로고침 한 번이 곧 재시도다. 로봇/모니터링은 503을 본다. 이전 평문 응답과 계약(상태코드)이 같다 |
| C. 평문 유지 | 기각 | 다음 행동이 없다 |
| D. 에러 바운더리로 throw | 기각 | proxy는 렌더링 이전 단계라 바운더리가 없다 |

구현 요구사항(스펙, 코드 아님):

1. rewrite 대상 페이지는 **API, 세션, DB를 일절 호출하지 않는 정적 페이지**여야 한다(장애 중에 또 장애 나는 것을 막는다). 헤더는 로고만, 푸터는 사업자 정보(정적)만.
2. 응답 상태 503, 헤더 `Retry-After: 30`(초안, 값은 backend와 협의), `Cache-Control: no-store`, `noindex`.
3. `NextResponse.rewrite`가 상태코드 지정을 지원하는지 이 Next 버전 문서(`node_modules/next/dist/docs/` proxy/NextResponse)로 구현자가 확인한다. 지원하지 않으면 대안: `/service-unavailable` 페이지를 정적 HTML 문자열로 proxy에서 직접 반환(스타일 인라인, 503). 어느 쪽이든 화면 내용은 이 문서 5.3~5.6을 만족해야 한다.
4. 세션 쿠키는 **삭제하지 않는다**(연결 불가는 세션 만료가 아니다. 현재 코드도 `isDeadSession`만 삭제). 이 불변은 QA 테스트 항목.
5. `/service-unavailable` 경로는 `proxy` 보호 경로 접두사(`/my`, `/learn`, `/admin`)와 겹치면 안 된다.
6. `test/proxy.test.ts`의 기존 503 평문 기대값은 새 계약(상태 503 + 새 본문 일부 문구 대신 rewrite 대상)으로 갱신 필요. QA가 확인.
7. proxy의 `getSession` 대기는 `lib/db/api.ts`의 10초 타임아웃을 따른다. API가 응답 없이 멈추면 보호 경로에서 **최대 10초 흰 화면**이 된다. 개선(예: 보호 경로 한정 짧은 타임아웃 3~5초)은 backend와 협의할 사항으로 Q3에 올림. 이 문서 범위에서는 정의만.

### 5.3 보여줄 정보 (E-503 전체 화면)

| 요소 | 내용(초안) | 비고 |
|---|---|---|
| 제목 | "지금 연결이 원활하지 않아요" | "서비스", "서버" 같은 단어 금지(C-2) |
| 설명 | "잠깐 문제가 생겼어요. 1~2분 뒤에 다시 눌러 보세요. 입력하신 정보는 안전해요." | "정보는 안전해요"는 사실일 때만. 사실 확인 전까지 해당 문장은 ux-writer/PO 확인 보류 표시([확인]) |
| 안심 문구 | "다시 시도하면 하던 곳으로 돌아가요" (rewrite라 URL이 유지될 때만) | |
| 오류 코드 | 미노출 (`503`, `unavailable` 모두 숨김) | digest 없음 |
| 현재 시각/상태 페이지 | 없음 | 상태 페이지(statuspage)는 존재하지 않음 |

### 5.4 버튼과 링크

| 순서 | 라벨(초안) | 동작 | 비고 |
|---|---|---|---|
| 1 (주) | "다시 시도하기" | 현재 URL 새로고침(`location.reload()`) | rewrite로 들어온 경우 원래 주소를 다시 요청. `/service-unavailable`을 **직접** 연 경우는 `/`로 이동 |
| 2 | "홈으로 가기" | `/` (`<a>`, 전체 새로고침) | 공개 화면은 API 없이도 보일 수 있으므로 유효한 출구. 단 홈이 API에 의존해 같이 죽으면 홈도 E-503 인라인(R-3-a) |
| 3 | "전화로 문의하기 010-9025-5093" | `tel:` | |

### 5.5 관리자와 일반 사용자

| 구분 | 처리 |
|---|---|
| 일반(`/my`, `/learn`) | 위 화면 그대로 |
| 관리자(`/admin`) | **같은 화면**을 쓴다. 이유: 연결 불가 상태에서는 세션을 확인할 수 없어 관리자인지 알 수 없다(역할 확인은 `getSession` 응답에 있음). 일반 사용자에게 관리자용 문구/정보를 줄 수 없으므로 하나로 통일. 관리자에게 필요한 추가 정보는 필요 없다(원인은 API 모니터링에서 본다) |
| 화면 내부 503(R-3) | 관리자 영역은 R-3-b(영역 인라인) 문구 변형 1개: "데이터를 불러오지 못했어요. 다시 시도해 주세요." (전화 블록 없음) |

### 5.6 화면 내부 API 503 표현 통일 규칙 (R-3)

| 규칙 | 적용 상황 | 표현 |
|---|---|---|
| R-3-a | 목록/상세 등 **페이지 전체 데이터**가 필요한데 503 | 해당 페이지 본문 영역에 "E-503 인라인" 블록(제목 + 설명 + 다시 시도 + 홈 + 전화). 헤더/푸터 유지. 상태코드는 서버 컴포넌트에서 설정 불가이므로 200(허용) |
| R-3-b | **일부 영역**(홈의 강좌 섹션, 관리자 카드 한 칸) 503 | 그 영역만 "일시적으로 불러올 수 없어요" + "다시 시도" 링크. 나머지 화면 정상(기존 design.md 5절 `listUsers()` 실패 행과 동일 패턴 - "-" 표시 대신 문구) |
| R-3-c | **폼/액션 제출** 중 503 | 폼 상단 인라인 오류("지금 연결이 원활하지 않아요. 입력하신 내용은 그대로 있어요. 잠시 후 다시 눌러 주세요.") + 입력값 유지 + 제출 버튼 재활성화. 화면을 오류 화면으로 교체하지 않는다. 신청/시험 제출은 중복 제출 방지를 위해 "저장됐는지 내 강좌에서 확인" 안내 병기(C-11) |

핵심: `unavailable`(연결 불가)과 `internal`(서버 내부 오류)은 사용자 문구를 따로 만들지 않고 둘 다 "일시적인 문제" 톤으로 통일하되, **연결 불가는 "잠시 후 다시", 내부 오류는 "계속되면 전화"**의 무게 차이만 둔다.

### 5.7 엣지케이스

| 상황 | 처리 |
|---|---|
| 로그인 상태(세션 토큰 있음) | (a) 보호 경로는 E-503 전체 화면. 쿠키 유지 -> API 복구 후 새로고침 한 번으로 정상 진입(**세션 쿠키 삭제 금지**) |
| 로그인 상태 + 공개 경로 | 헤더가 로그인 상태를 확인 못 하면 "로그아웃 상태처럼" 보인다. 이때 헤더에 오해를 막는 표시는 하지 않고(복잡도), 사용자가 "로그인" 버튼을 눌러도 이미 쿠키가 있으므로 복구 후 자연히 정상화. 별도 안내가 필요한지는 Q3 |
| 비로그인 | 보호 경로는 proxy가 API를 부르지 않고 로그인으로 보낸다. 로그인 폼 제출 시 R-3-c |
| 모바일 | 풀 와이드 세로 버튼, 전화 버튼이 첫 화면 안에 보이게(스크롤 없이) 배치 |
| 반복 실패 | 서버가 아니라 정적 페이지라 클라이언트가 직전 결과를 모른다. `sessionStorage` 카운트(경로 무관 1개 키)로 3회 이상이면 설명을 "연결이 계속 안 돼요. 전화로 알려 주세요."로 교체하고 전화 블록 강조. 같은 정책을 R-3-a에도 적용 |
| 복구 감지 | 자동 재시도/폴링 금지(C-2 원칙). 사용자가 직접 눌러야 한다 |
| 장시간 대기(최대 10초) | proxy가 응답을 못 줄 때는 브라우저 로딩 표시만 보인다. 별도 UI 없음(Q3 개선안) |
| 홈 다중 의존 | 홈이 API 의존 데이터를 한 군데라도 받지 못하면 홈 전체가 죽지 않게 R-3-b로 영역 격리(별도 홈 설계 4.5에 이미 있는 원칙 재확인) |
| 쿠키 삭제 불변 | 연결 불가 중 어떤 경우에도 세션 쿠키를 지우지 않는다(QA 테스트) |
| 탈퇴/무효 세션과 구분 | `isDeadSession` true -> 로그인으로 이동(현행). 연결 불가는 절대 로그인 화면으로 보내지 않는다(로그인해도 같은 증상, 혼란) |

### 5.8 접근성

- `<h1>`에 포커스, `<title>` "연결이 원활하지 않아요 | 바라 평생교육원".
- "다시 시도하기" 눌렀을 때 새로고침이라 별도 로딩 알림 불필요. 인라인 재시도(R-3-b)는 버튼 `aria-busy`와 `aria-live="polite"`로 결과 알림("불러왔어요"/"아직 안 돼요").
- R-3-c 폼 오류는 `role="alert"`로 즉시 읽히게 하고 첫 오류 요소로 포커스 이동.
- 색만으로 상태를 표현하지 않고 아이콘(경고) + 텍스트.

---

## 6. Error Handling 표 (design.md 5절 형식)

| 상황 | 처리 방법 | UI 표현 | Figma 와이어프레임 |
|---|---|---|:---:|
| 정의되지 않은 주소 접근 | `app/not-found.tsx`, HTTP 404, noindex | "찾으시는 페이지가 없어요" + 홈/강좌/전화 | 기존 12 재사용 후 확장 |
| 없는/비공개 강좌 slug | `notFound()` -> `(public)/not-found.tsx` | "찾으시는 강좌가 없거나 지금은 신청을 받지 않아요" | 기존 12 |
| 없는 학습 id(신청 이력 없음) | `notFound()` -> `(user)/not-found.tsx` | 404와 동일(존재 여부 비노출) | ☐ |
| 본인 미승인 신청 강좌의 강의실 접근 | 기존 동작 유지 | "입금 확인 후 이용 가능해요"(04d) | ✅ 04d |
| 관리자 없는 id | `(admin)/not-found.tsx` | AdminShell 안 "찾을 수 없는 항목이에요" + 목록으로 | ☐ |
| 비관리자 `/admin` 접근 | proxy 리다이렉트 `/` (변경 없음) | 홈 이동(기존) | ☐ |
| 사용자 화면 렌더링 예외 | `(public)/(user)/error.tsx` | "화면을 불러오지 못했어요" + 다시 시도/홈/전화 + 문의번호 | ☐ |
| 관리자 화면 렌더링 예외 | `(admin)/error.tsx` | 사이드바 유지 + 경로/시각/digest + 복사 | ☐ |
| 그룹 레이아웃(헤더·푸터·AdminShell) 예외 | `app/error.tsx` | 최소 화면(간이 헤더) + 다시 시도/홈/전화 | ☐ |
| 루트 레이아웃 예외 / error.tsx 자체 예외 | `app/global-error.tsx` 인라인 스타일 | "지금은 화면을 열 수 없어요" + 앵커 3개 | ☐ |
| 신청/시험 제출 중 예외 | 오류 화면 + C-11 안내 | "저장됐는지 내 강좌에서 먼저 확인해 주세요" | ☐ |
| 재시도 3회 이상 실패 | 주 버튼이 홈으로 교체, 전화 강조 | "같은 문제가 반복돼요. 전화로 알려 주세요" | ☐ |
| 보호 경로 + API 연결 불가 | proxy rewrite -> `/service-unavailable`(503, no-store, Retry-After), 세션 쿠키 유지 | "지금 연결이 원활하지 않아요" + 다시 시도/홈/전화 | ☐ |
| 공개 경로 + API 연결 불가 | 페이지 통과, 화면 내부 R-3-a/b | 인라인 오류 블록 | ☐ |
| 폼 제출 중 API 연결 불가 | R-3-c 인라인 오류, 입력값 유지 | "입력하신 내용은 그대로 있어요" | ☐ |
| API 응답 지연(10초 타임아웃) | `lib/db/api.ts` 타임아웃 -> 503/unavailable로 위 처리 | 위와 동일 | ☐ |
| 오류 화면 렌더링용 데이터(전화번호) 부족 | `siteConfig.phone`은 정적이라 실패 없음 | - | - |

---

## 7. 접근성 체크리스트 (4개 화면 공통, QA용)

| # | 항목 | 기준 |
|---|---|---|
| A-1 | `<h1>` 정확히 1개, 오류 진입 시 포커스 이동 | 스크린리더 첫 낭독 = 제목 |
| A-2 | 텍스트 대비 4.5:1 이상, 아이콘/포커스 링 3:1 이상 | |
| A-3 | 터치 영역 56px 이상(관리자 복사 버튼 48px 이상) | |
| A-4 | 본문 18px 이상, 제목 28px 이상(모바일 24px) | 200% 확대 시 가로 스크롤 없음 |
| A-5 | 색만으로 의미 전달 금지(아이콘 + 텍스트) | |
| A-6 | 전화는 `tel:` 링크, 번호 숫자를 텍스트로도 노출 | 스크린리더가 숫자를 읽도록 하이픈 포함 |
| A-7 | 키보드만으로 모든 버튼 도달/실행 | Tab 순서 = 제목 -> 주 -> 보조 -> 전화 |
| A-8 | 동적 상태 변화(재시도 중, 복사 성공)는 `aria-live="polite"` | 폼 오류만 `role="alert"` |
| A-9 | 장식 아이콘 `aria-hidden="true"` | |
| A-10 | 애니메이션은 `prefers-reduced-motion` 존중, 자동 소멸/자동 재시도 없음 | |
| A-11 | `<title>`이 화면별로 다름, `lang="ko"`(global-error 포함) | |

---

## 8. 구현 순서 제안 (ui-ux-designer 이후)

1. `app/global-error.tsx` (독립적, 위험 최저)
2. 공용 `ErrorPanel`(사용자용), `AdminErrorPanel`, `NotFoundPanel` 컴포넌트 + 홈/전화 블록
3. `app/not-found.tsx` + 그룹별 `not-found.tsx` (4곳), `app/error.tsx`, 그룹별 `error.tsx`(3곳)
4. `/service-unavailable` 정적 페이지 + `proxy.ts` rewrite 전환 + `test/proxy.test.ts` 갱신
5. 기존 화면의 `unavailable` 개별 처리를 R-3 규칙 3종으로 정리(화면별 점검 목록은 별도 이슈)
6. qa-reviewer: 장애 주입(API 주소 오입력으로 503 재현), 존재하지 않는 slug, 컴포넌트에서 `throw`하는 테스트 페이지(배포 제외)로 error/global-error 확인

---

## 9. PO 확인 질문 (미결)

| # | 질문 | 기본안(PO가 답하지 않으면 적용) |
|---|---|---|
| Q1 | 500류 화면에 "문의번호(digest)"를 작게 노출해도 되는가? 상담 인력이 이 번호로 로그를 조회할 수 있는가? | 노출한다. 조회 불가하면 제거 |
| Q2 | 전화 문의 번호가 `010-9025-5093`(휴대전화 형식)이다. 오류 화면 전 구간에 크게 노출되면 문의가 몰릴 수 있다. 계속 이 번호를 써도 되는가? 운영 시간(예: 평일 9~18시)을 같이 안내할 것인가? | 번호 그대로, 운영시간 문구는 PO가 주면 추가 |
| Q3 | API 장애 시 보호 경로에서 최대 10초 흰 화면이 가능하다. 보호 경로 한정 타임아웃을 3~5초로 줄이고, 공개 경로의 헤더가 "로그아웃처럼" 보이는 문제에 안내를 추가할 것인가? | 이번 범위 밖(별도 이슈), 안내 없음 |
| Q4 | "입력하신 정보는 안전해요"류 안심 문구를 쓸 근거(서버에 이미 저장됨/미저장 구분)를 확인해 줄 수 있는가? 신청/입금 흐름은 요청이 서버에 도달하기 전 실패하면 저장이 안 된다 | 안심 문구 미사용, C-11처럼 "내 강좌에서 확인"만 안내 |
| Q5 | 해외이주민 대상 외국어(영어 등) 병기가 오류 화면에도 필요한가? | 이번에는 한국어만, 숫자 전화번호와 아이콘으로 보완 |
| Q6 | 404에 "인기/신규 강좌" 추천 카드를 이번에 넣을 것인가? (홈과 강좌 목록으로의 버튼만으로 충분한가) | 이번에는 생략 |

## 10. 후속 문서 동기화 (PO 승인 조건: 변경 시 관련 문서 함께 갱신)

- `bara-edu-lms.design.md` 5절 Error Handling에 이 문서의 6절 행 반영(특히 "잘못된 slug 접근" 행의 "Next.js 404" -> 이 정의서 링크, Admin 403 행 상태 갱신).
- `menu-features`/`flows` 문서에 오류 화면 항목 추가.
- `docs/04-report` 또는 plan에 "E-503 rewrite" 결정 기록.

---

## 디자인 스펙

> 작성: ui-ux-designer / 2026-11-25 / 상태: Draft (F8 문구 검수 대기)
> 입력: 위 1~9절(service-planner), `bara-edu-lms.design.md` 4.0 토큰, `app/globals.css`의 `@theme`, `components/layout/AppHeader.tsx`, `Footer.tsx`, `components/admin/AdminShell.tsx`, `components/ui/CopyButton.tsx`
> **문구는 정의서 초안을 그대로 옮겼고, 최종 문구/어투는 ux-writer가 정한다.** 이 절의 따옴표 문구는 레이아웃 검증용 예시다. 문구 길이가 바뀌면 아래 줄 수 가정(375px에서 제목 2줄, 본문 3줄 이내)을 다시 확인한다.
> 새 디자인 토큰은 만들지 않았다. 아래 Tailwind 클래스는 전부 `globals.css` `@theme`에 이미 있는 토큰(`indigo`, `n-0~9`, `pink`, `danger`, `rounded-pill/md/lg`, `shadow-*`)과 기본 스케일이다. hex는 global-error(인라인 스타일, CSS 변수 사용 불가)에서만 쓰며, 값은 `@theme`과 같다.
> 기본값(대표 확인 전): digest 작게 노출 / 전화번호는 보조 버튼 / 한국어만 / 404에 강좌 추천 카드 없음.

### D-0. 기존 자산 점검 결과 (구현 전 반드시 확인)

| # | 확인 사항 | 결과 | 디자인 결정 |
|---|---|---|---|
| 1 | `Footer`는 `async` 서버 컴포넌트이고 `getLegalDocument()`로 DB(API)를 호출한다 | 루트 404, `app/error.tsx`, `/service-unavailable`에서 그대로 쓰면 **API 장애 중에 또 API를 부른다**(5.2 요구사항 1 위반) | 푸터의 표시 영역(사업자 정보 + 이용약관/개인정보처리방침 링크)을 **데이터 조회 없는 순수 컴포넌트 `FooterBody`로 분리**하고, 기존 `Footer`는 `FooterBody` + 환불정책 조회만 남긴다. 오류 화면용은 `FooterBody`만 쓴다(환불정책 링크 생략). 마크업과 클래스는 기존 Footer를 그대로 쓰므로 새 디자인이 아니다 |
| 2 | `AppHeader`는 글씨 12.5px, 높이 57px, 링크 터치 영역이 작다 | 시니어 기준(터치 44px, 글씨 18px) 미달. 단 이 헤더는 사이트 전역 공통이라 이번 범위에서 고치지 않는다 | 그룹 레이아웃 안의 오류 화면은 **기존 헤더를 그대로 쓴다**(일관성). 헤더를 새로 그리는 루트 폴백 화면(E-404-R, E-500-R, E-503)만 `ErrorHeader`(D-1.3)를 쓰고 터치 영역을 키운다. 헤더 확대는 별도 제안으로 남긴다(D-9) |
| 3 | `CopyButton`은 11px 알약 버튼이고 복사할 값 1개만 받는다 | 관리자 "오류 정보 복사"(경로+시각+문의번호)와 터치 영역 48px에 안 맞는다 | `CopyButton`에 선택 props(`label`, `copiedLabel`, `size="lg"`)를 추가해 확장한다. **기본값은 현재 동작과 동일**해 기존 사용처는 영향 없음. 새 컴포넌트를 만들지 않는다 |
| 4 | lucide 등 아이콘 라이브러리가 `package.json`에 없다. 코드에서는 `RadarChart`/`NoticeModal`만 인라인 SVG를 쓴다 | 이번에 의존성을 추가하지 않는다 | 아이콘은 **인라인 SVG 3종**(D-1.2). lucide 아이콘의 선 모양(24px 격자, stroke 2, round)을 그대로 옮긴 것이라 나중에 lucide로 바꿔도 모양이 같다. 이미지/일러스트 자산은 쓰지 않는다 |
| 5 | `ClassroomAccessNotice`는 주 버튼에 `bg-pink` + 흰 글씨를 쓴다 | 핑크 #E11E87 위 흰 글씨는 약 4.4:1로 AA(4.5:1) 근소 미달(design.md 4.5.8에 같은 판단 기록) | 오류 화면의 주 버튼은 **인디고 배경 + 흰 글씨**(약 12:1)로 한다. 핑크는 쓰지 않는다 |
| 6 | `(public)`, `(user)` 레이아웃이 이미 `<main>`을 렌더링한다. `(admin)`은 `AdminShell`이 `<main className="flex-1 p-6">`를 제공한다 | 오류 컴포넌트가 `<main>`을 또 쓰면 landmark가 중첩된다 | 그룹 안의 오류 화면은 `<section aria-labelledby="error-title">`, 루트 폴백(E-404-R, E-500-R, E-503, global-error)만 `<main id="main">`을 쓴다. 컴포넌트가 `as` prop(`'main' \| 'section'`)으로 선택 |
| 7 | `(auth)` 그룹(로그인/가입)도 자체 레이아웃이 있는데 정의서 0.1 표에 `error.tsx`가 없다 | 로그인 화면에서 터진 예외는 `app/error.tsx`(E-500-R)로 간다 | 디자인은 E-500-R(간이 헤더 + 푸터)로 충분하다. 별도 화면은 만들지 않는다. frontend-developer가 의도된 동작인지 확인(정의서 0.1에 행 추가 권장) |

### D-1. 공통 구성 요소

#### D-1.1 레이아웃 원칙

- 한 화면의 핵심 행동은 하나다: 404 = "홈으로 가기", 사용자 error = "다시 시도하기", 관리자 error = "다시 시도", global-error = "다시 시도하기", 503 = "다시 시도하기". 3회 이상 반복 실패 시 핵심 행동이 "홈으로 가기"로 바뀐다(주 버튼은 항상 1개).
- 사용자용은 **중앙 정렬 단일 컬럼**. 이유: 구성 요소가 5개 안팎이라 한눈에 끝나고, 시니어가 좌우로 시선을 옮기지 않는다. 관리자용은 AdminShell의 `main` 영역에 **좌측 정렬 카드**(운영 콘솔 archetype, 정보 복사가 목적).
- 이모지, 일러스트 이미지, 애니메이션 없음(이모지 절제 원칙, 장애 중 이미지 로딩 실패 방지).
- 다크모드 없음. `html.dark` 오버라이드는 오류 화면에 적용하지 않는다(global-error는 `color-scheme: light` 고정, 나머지는 현재 사이트가 라이트 고정이므로 동일).

#### D-1.2 아이콘 (인라인 SVG, `aria-hidden="true"`, `focusable="false"`)

| 화면 | 모양(lucide 대응) | 
|---|---|
| 404 | 돋보기에 물음표 느낌의 `search` (원 + 손잡이) |
| 사용자/루트 error, global-error | `triangle-alert` (삼각형 + 느낌표) |
| 503 | `wifi-off` (사선이 그어진 와이파이 호). 의미가 안 읽히는 사용자를 위해 제목이 항상 같이 있다 |
| 전화 버튼 | `phone` |
| 다시 시도 | `refresh-cw` (로딩 중에는 `animate-spin motion-reduce:animate-none`) |

공통 SVG 속성: `viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"`.

아이콘 배치(사용자용): 원형 배지 안에 중앙 배치.

| 항목 | 모바일(~767px) | 데스크톱(md~) |
|---|---|---|
| 배지 | `size-16` (64px) `rounded-pill bg-n-1 text-indigo` | `md:size-20` (80px) |
| 아이콘 | `size-8` (32px) | `md:size-10` (40px) |

색 선택 이유: 경고성 색(`danger` #E14B3C는 흰 배경 대비 약 3.9:1, `warning` #F0963C는 약 2.2:1)은 아이콘 대비 3:1 기준을 못 넘기거나 "사용자 잘못"처럼 보여, 오류 화면 전체를 **인디고 단색 + 연회색 배지**로 통일했다("사용자 탓이 아니다" 어조와 맞춤, C-2). 아이콘이 없어도 제목만으로 의미가 전달된다.

#### D-1.3 `ErrorHeader` (루트 폴백 전용: E-404-R, E-500-R, E-503)

세션 조회 없음, 링크 1개. 기존 `AppHeader`의 껍데기(`sticky`, `h-[57px]`, `border-b border-n-3 bg-n-0`)를 그대로 쓰되 로고 터치 영역만 키운다.

```
<header className="flex h-[57px] items-center border-b border-n-3 bg-n-0 px-5 md:px-6">
  <a href="/" className="inline-flex min-h-11 items-center text-lg font-bold text-indigo
        focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo">
    바라 평생교육원
  </a>
</header>
```

- 로고는 `next/link`가 아니라 일반 `<a>`(전체 새로고침). 클라이언트 라우터 상태가 손상됐을 수 있는 화면(E-500-R, E-503)에서 안전하고, 404에서도 동작이 같다.
- 로그인/회원가입/메뉴 없음(정의서 2.5). 로고 + 화면 본문의 "홈으로 가기"가 출구 2개다.

#### D-1.4 `ErrorPanel` 본문(사용자용 공통 컴포넌트, 404·error·503이 공유)

슬롯: `icon`, `title`, `description`, `primary`, `secondary`, `phone`, `digest?`, `notice?`(C-11 한 줄). 구조와 클래스:

```
<Root as="main|section" aria-labelledby="error-title"
      className="mx-auto flex w-full max-w-[560px] flex-col items-center px-5 py-10 text-center md:px-6 md:py-20">
  [아이콘 배지]                                   /* D-1.2 */
  <h1 id="error-title" tabIndex={-1}
      className="mt-5 text-2xl font-bold leading-[1.35] text-n-9 break-keep outline-none md:mt-6 md:text-[32px]">
  <p className="mt-3 max-w-[34rem] text-lg leading-[1.7] text-n-7 break-keep md:mt-4" aria-live="polite">
  [notice 한 줄]  className="mt-4 rounded-md bg-n-1 px-4 py-3 text-base leading-[1.6] text-n-8 text-left"
  <div className="mt-8 flex w-full flex-col gap-3 md:mt-10 md:max-w-[420px]">
     [주 버튼] [홈/보조 버튼] [전화 버튼]
  </div>
  [digest 줄]
</Root>
```

| 요소 | 값 | 근거 |
|---|---|---|
| 제목 | 모바일 `text-2xl`(24px), md 이상 `text-[32px]`, `font-bold`, `text-n-9`(#17171C, 흰 배경 대비 약 17:1) | 정의서 C-3(모바일 24px 이상, 데스크톱 28px 이상). 제목은 한 줄이 이상적이지만 375px에서 15자 안팎(24px 기준 약 17자/줄)이라 2줄까지 허용 |
| 본문 | `text-lg`(18px) `leading-[1.7]` `text-n-7`(#4A4A58, 약 8.5:1) | 본문 18px 이상(C-3). `break-keep`으로 단어 중간 줄바꿈 방지 |
| 본문 폭 | 최대 34rem(약 544px) | 한 줄 길이 제한 |
| 정렬 | 아이콘/제목/본문 중앙, `notice`만 좌측 정렬 | 두 줄 이상 문장은 중앙 정렬보다 좌측 정렬이 읽기 쉽다 |
| 여백 | 상하 `py-10`(40px) 모바일, `md:py-20`(80px). 좌우 `px-5`(20px) | 375px에서 콘텐츠 폭 335px. 20px 좌우 여백은 기존 Footer(`px-5`)와 같다 |
| 버튼 묶음 | 모바일 세로 풀 와이드(`w-full flex-col gap-3`), md 이상도 **세로 유지**하되 `max-w-[420px]` | 정의서 C-4(모바일 풀 와이드 세로). 데스크톱에서 가로로 나란히 두면 "무엇이 주 행동인지" 시선이 갈린다고 판단해 세로 유지(주 버튼이 항상 맨 위) |

**버튼 3종 클래스(공통 베이스)**

```
BASE = inline-flex w-full min-h-14 items-center justify-center gap-2 rounded-pill px-6
       text-lg font-bold transition-colors
       focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo
       aria-disabled:cursor-wait aria-disabled:opacity-80
PRIMARY   = BASE + bg-indigo text-white hover:bg-arc-1
SECONDARY = BASE + border-2 border-indigo bg-n-0 text-indigo hover:bg-n-1
PHONE     = (아래 D-1.5)
```

- 높이 `min-h-14`(56px) = 터치 영역 요구(44px) 초과, 정의서 C-4 충족. 아이콘 20px(`size-5`) + 글자 사이 `gap-2`.
- hover 색: 새 hex 없이 기존 `arc-1`(#6450A0, 흰 글씨 대비 약 6.9:1) 사용.
- 포커스 링: 3px 인디고 + 2px 오프셋(흰 배경 대비 12:1). 인디고 버튼 위에서도 오프셋 틈 덕분에 링이 구분된다. `outline-none`만 쓰는 곳 없음.
- 비활성/로딩은 `disabled` 대신 `aria-disabled="true"` + `aria-busy="true"`(`disabled`는 키보드 포커스를 잃어 스크린리더 사용자가 길을 잃는다). 클릭 핸들러는 로딩 중 무시.

#### D-1.5 전화 문의 보조 버튼 (기본값: 보조 버튼)

```
<a href={`tel:${digitsOnlyPhone}`}
   className="flex w-full min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-pill
              border border-n-3 bg-n-1 px-6 py-2 text-n-9 hover:bg-n-2
              focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-indigo">
  <span className="inline-flex items-center gap-2 text-lg font-semibold">[phone 아이콘 size-5] 전화로 문의하기</span>
  <span className="text-[22px] font-bold leading-tight tracking-wide">{siteConfig.phone}</span>
</a>
```

- `digitsOnlyPhone = siteConfig.phone.replace(/[^0-9]/g, '')`(기존 Footer와 같은 방식). 번호 하드코딩 금지, `siteConfig.phone` import(C-5).
- **라벨과 번호를 두 줄로 나눈 이유**: 한 줄로 쓰면 "전화로 문의하기 010-9025-5093"이 18px 볼드 기준 약 300px라 375px 화면(버튼 안쪽 폭 약 287px)에서 어색하게 줄바꿈된다. 두 줄이면 번호(22px)가 가장 크게 보여 문구를 못 읽는 사용자도 숫자로 행동할 수 있다(C-10).
- 높이 72px은 56px 요구를 충족하고 두 줄을 담는다. 모양은 알약(`rounded-pill`)로 다른 버튼과 통일.
- 스크린리더 낭독: "전화로 문의하기 010-9025-5093, 링크". 하이픈 포함 유지(A-6).
- 데스크톱에서 `tel:`은 동작하지 않는 환경이 많다. 번호가 텍스트로 항상 보이므로 별도 처리 없음.
- 강조 전환(반복 실패 시): 같은 요소에 `border-2 border-indigo bg-n-0`로 바꾸고 상단에 `text-base text-n-8` 안내 한 줄. 주 버튼은 "홈으로 가기"로 교체(D-3.3).

#### D-1.6 문의번호(digest) 표시 (기본값: 작게 노출)

```
<p className="mt-8 max-w-full text-sm leading-[1.6] text-n-6">
  문의번호 <code className="select-all break-all rounded-xs bg-n-2 px-1.5 py-0.5 font-mono text-sm text-n-8">{digest}</code>
  <br />전화로 문의하실 때 알려 주세요.
</p>
```

- 위치: 버튼 묶음 **아래**, 푸터 위. 이유: 행동(버튼)을 먼저 보게 하고, 상담 때만 필요한 정보는 맨 아래로 내린다. 상담원이 로그를 찾는 값이므로 읽기 쉬운 고정폭 글꼴.
- 크기 14px(`text-sm`, 정의서 C-6 하한), 색 `text-n-6`(#6B6B7C, 흰 배경 약 5.0:1) 라벨 + 값은 `bg-n-2` 위 `text-n-8`(약 10:1)로 대비 확보. `n-5`(#8E8E9E, 약 3.2:1)는 쓰지 않는다(본문 대비 미달).
- 라벨은 "문의번호", 영어 약어 digest/ID/error code 미노출.
- 긴 해시: `break-all` + `select-all`(한 번 탭으로 전체 선택). 375px에서 가로 스크롤이 생기지 않는다.
- digest가 없으면 이 `<p>` 전체를 렌더링하지 않는다(빈 라벨 금지).
- 터치 영역: 읽기 전용 텍스트라 44px 요구 대상이 아니다.

### D-2. E-404 (E-404-R / E-404-P / E-404-U / E-404-A)

핵심 행동: 홈으로 가기(관리자는 "목록으로").

#### D-2.1 일반 사용자 404 (R, P, U 공통 `NotFoundPanel` = `ErrorPanel` 래퍼)

| 영역 | 구성 |
|---|---|
| 셸 | **E-404-R**: `ErrorHeader` + `<main id="main">`(본문) + `FooterBody`. **E-404-P/U**: 그룹 레이아웃이 `AppHeader`/`<main>`/`Footer`를 제공하므로 본문 `<section>`만 렌더링(D-0 #6) |
| 아이콘 | 404 `search`, 배지 64/80px |
| 제목(초안) | "찾으시는 페이지가 없어요" (E-404-P 강좌 slug: 정의서 2.2 변형 설명 사용) |
| 본문(초안) | "주소가 바뀌었거나 없어진 페이지예요. 아래에서 원하는 곳으로 이동해 주세요." |
| 주 버튼 | "홈으로 가기" → `/` (PRIMARY). 루트 404는 `<a>`, 그룹 안은 `next/link` |
| 보조 버튼 | "강좌 보러가기" → `/courses` (SECONDARY) |
| 전화 | D-1.5 보조 버튼. 404는 digest 없음, C-11 안내 없음 |
| 추천 카드 | **넣지 않는다**(기본값 Q6). 다른 카드가 필요 없도록 슬롯도 만들지 않는다 |

- 3개 행동(홈/강좌/전화) = 정의서 C-1의 상한 3개 충족.
- 본문 영역 높이: 모바일에서 대략 아이콘 64 + 제목 2줄 65 + 본문 3줄 92 + 버튼 56+56+72 + 간격 합계 약 480px라 전화 버튼이 거의 첫 화면에 들어온다. 정의서가 허용한 1~2스크롤 이내.
- 푸터가 짧은 본문 아래로 떠오르지 않도록 E-404-R 루트 화면은 `<div className="flex min-h-screen flex-col">` + `main`에 `flex-1`. 그룹 안은 그룹 레이아웃의 기존 구조를 따른다.
- 반응형: 모바일 위 D-1.4 그대로. md 이상 제목 32px, 상하 여백 80px, 버튼 묶음 `max-w-[420px]` 중앙. 1200px 이상에서도 본문 폭 560px 고정(콘텐츠가 작아 넓히지 않는다). 375px 기준 가로 스크롤 없음(콘텐츠 폭 335px).
- 이유: 404는 사용자가 길을 잃은 상태라 "어디로 가야 하는지"가 가장 크게 보이도록 주 버튼 1개만 강조했다.

#### D-2.2 관리자 404 (E-404-A, `AdminNotFound`)

AdminShell(Topbar + Sidebar)은 `(admin)` 레이아웃이 유지하고, `main`(`flex-1 p-6`) 안에 카드만 그린다. 전화 블록 없음(정의서 2.4).

```
<section aria-labelledby="error-title" className="max-w-[640px] rounded-lg border border-n-3 bg-n-0 p-6 shadow-sm">
  <div className="flex items-start gap-4">
    [search 아이콘 size-6 text-n-6 mt-1 shrink-0]
    <div>
      <h1 id="error-title" tabIndex={-1} className="text-xl font-bold text-n-9 outline-none">찾을 수 없는 항목이에요</h1>
      <p className="mt-2 text-[15px] leading-[1.7] text-n-7">삭제됐거나 주소가 잘못됐을 수 있어요.</p>
    </div>
  </div>
  <div className="mt-6 flex flex-wrap items-center gap-3">
    [주 버튼 "목록으로" -> 해당 목록 경로 또는 /admin]   [텍스트 링크 "사이트 홈" -> /]
  </div>
</section>
```

- 버튼은 관리자 전용 크기: `inline-flex min-h-12 items-center justify-center rounded-pill px-6 text-[15px] font-bold`, 색은 D-1.4의 PRIMARY와 같음. 텍스트 링크 "사이트 홈"은 `inline-flex min-h-12 items-center px-2 text-[15px] text-n-7 underline underline-offset-2`.
- 관리자 화면은 PC 전용(최소 1280px)이라 모바일 분기를 만들지 않는다(design.md 4.0b). 1280px에서 카드 640px은 좌측 정렬(사이드바 옆). 이유: 운영 콘솔은 콘텐츠가 사이드바 옆 좌상단에서 시작하는 것이 일관적이다(AdminShell `p-6`).
- 목적지: `not-found.tsx`는 그룹당 1개라 어느 목록에서 났는지 모른다. 1차는 주 버튼을 "관리자 홈으로"(`/admin`) 고정으로 하고, 정의서의 "목록으로"는 `AdminNotFound`가 `listHref` 선택 prop을 받을 때만 쓴다(ux-writer가 라벨 확정).

### D-3. E-500 사용자 error (E-500-U / E-500-R)

핵심 행동: 다시 시도하기.

#### D-3.1 셸과 구성

| 영역 | E-500-U (`(public)`, `(user)` error.tsx) | E-500-R (`app/error.tsx`) |
|---|---|---|
| 셸 | 그룹의 `AppHeader` + `<main>` + `Footer` 유지(본문 `<section>`만) | `ErrorHeader` + `<main id="main">` + `FooterBody` |
| 컴포넌트 | 동일한 `ErrorPanel` 클라이언트 컴포넌트(`'use client'`) | 동일 |
| 아이콘 | `triangle-alert` 배지 | 동일 |
| 제목(초안) | "화면을 불러오지 못했어요" | 동일 |
| 본문(초안) | "잠시 후 다시 해 보세요. 계속되면 전화로 알려 주세요. 불편을 드려 죄송해요." | 동일 |
| notice(C-11) | 경로가 신청/제출 화면일 때만, 본문 아래 `bg-n-1` 안내 박스 1줄 | 동일 |
| 버튼 | 주 "다시 시도하기"(`unstable_retry`, PRIMARY + `refresh-cw`) / 보조 "홈으로 가기"(SECONDARY) / 전화(D-1.5) | 동일 |
| digest | D-1.6 | 동일 |

- 재시도 중: 라벨이 "불러오는 중..."으로 바뀌고 `refresh-cw`가 회전(`motion-reduce:animate-none`), `aria-busy="true"` + `aria-disabled="true"`. **색/스피너만으로 표현하지 않고 텍스트가 바뀐다**(정의서 3.6).
- 재시도가 실패해 같은 화면으로 돌아오면 라벨은 원래대로 복귀하고, 포커스는 다시 `<h1>`로 간다.
- 자동 재시도/타이머 없음.

#### D-3.2 notice(C-11) 시각

`mt-4 w-full rounded-md bg-n-1 px-4 py-3 text-left text-base leading-[1.6] text-n-8`, 앞에 `info` 아이콘 `size-5 shrink-0 text-indigo`. 문구(초안): "방금 하던 신청(또는 제출)이 저장됐는지 [내 강좌]에서 먼저 확인해 주세요." "[내 강좌]"는 `/my` 링크(`text-indigo underline underline-offset-2 font-semibold`, `inline-flex min-h-11 items-center`)로 만든다. 이 링크는 행동 4번째가 되지만 본문 안 보조 링크라 C-1의 "다음 행동 3개" 한도에서 예외로 둔다(중복 신청 방지가 목적).

#### D-3.3 반복 실패(3회째부터) 레이아웃 전환

| 요소 | 1~2회 | 3회 이상 |
|---|---|---|
| 본문 | 기본 | "같은 문제가 반복돼요. 전화로 알려 주시면 도와 드릴게요."(초안) |
| 주 버튼 | 다시 시도하기(PRIMARY) | **홈으로 가기(PRIMARY)** |
| 두 번째 | 홈으로 가기(SECONDARY) | 다시 시도하기(SECONDARY) |
| 전화 | 회색 보조 버튼 | `border-2 border-indigo bg-n-0`로 강조(D-1.5), 순서는 그대로 3번째 |

- **스타일과 위치를 함께 교환한다.** 3회째부터 맨 위가 "홈으로 가기"(PRIMARY), 두 번째가 "다시 시도하기"(SECONDARY), 세 번째가 전화(강조). 이유: "맨 위 = 가장 권하는 행동" 원칙을 유지하고, 같은 자리를 반복해 눌러 같은 실패를 되풀이하지 않게 한다. 본문 교체는 `aria-live="polite"`로 낭독.

### D-4. 관리자 error (E-500-A, `AdminErrorPanel`)

핵심 행동: 다시 시도. 셸: `(admin)` 레이아웃의 AdminShell(Topbar + Sidebar) 유지, `main` 안에 카드.

```
<section aria-labelledby="error-title" className="max-w-[720px] rounded-lg border border-n-3 bg-n-0 p-6 shadow-sm">
  <div className="flex items-start gap-4">
    [triangle-alert size-6 text-n-6 mt-1 shrink-0]
    <div>
      <h1 id="error-title" tabIndex={-1} className="text-xl font-bold text-n-9 outline-none">이 화면에서 오류가 발생했어요</h1>
      <p className="mt-2 text-[15px] leading-[1.7] text-n-7">일시적일 수 있어요. 다시 시도해도 같으면 아래 정보를 개발 담당에게 전달하세요.</p>
    </div>
  </div>

  <dl className="mt-5 grid grid-cols-[96px_1fr] gap-x-4 gap-y-2 rounded-md bg-n-1 p-4 text-sm leading-[1.6]">
    <dt className="text-n-6">발생 경로</dt>  <dd className="font-mono text-n-8 break-all">{pathname}</dd>
    <dt className="text-n-6">발생 시각</dt>  <dd className="font-mono text-n-8">{KST 시각, 예 2026-11-25 14:03:21}</dd>
    <dt className="text-n-6">문의번호</dt>   <dd className="font-mono text-n-8 break-all select-all">{digest ?? '없음'}</dd>
    [개발 환경에서만] <dt>오류 메시지</dt><dd>{error.message}</dd>
  </dl>

  <div className="mt-6 flex flex-wrap items-center gap-3">
    [다시 시도 PRIMARY(admin 크기)]  [관리자 홈으로 SECONDARY(admin 크기)]  [오류 정보 복사 CopyButton size=lg]  [사이트 홈 텍스트 링크]
  </div>
  <span className="sr-only" aria-live="polite">{복사 상태 문구}</span>
</section>
```

- 관리자 버튼 크기: 높이 `min-h-12`(48px), 글씨 15px(`text-[15px]`), `rounded-pill`, 색은 D-1.4의 PRIMARY/SECONDARY와 동일. 데스크톱 전용이므로 풀 와이드/세로 배치 없음, 한 줄 `flex-wrap`. 정의서 A-3(복사 버튼 48px 이상)을 4개 버튼 모두에 적용해 일관성 확보.
- 글씨: 본문 15px, 정보 블록 14px. 관리자 영역은 정의서 2.4에 따라 관리자 기존 표준을 따르되 14px 아래로는 내리지 않는다.
- **"오류 정보 복사" = `CopyButton` 확장**: `label="오류 정보 복사"`, `copiedLabel="복사했어요"`, `size="lg"`(`min-h-12 px-5 text-[15px] font-semibold rounded-pill border border-n-3 text-n-8 hover:bg-n-1`). 복사 값은 3줄 텍스트: `경로: …\n시각: …\n문의번호: …`. 복사 성공 시 라벨이 2초간 "복사했어요"로 바뀌고(현재 1500ms → 이 화면은 2000ms), 숨은 live 영역 `<span class="sr-only" aria-live="polite">`에 "오류 정보를 복사했어요"가 들어간다. live 영역은 **처음부터 DOM에 존재**해야 낭독된다(조건부 렌더링 금지). 클립보드 권한 거부 시 "복사하지 못했어요. 직접 선택해 주세요"로 바꾸고, `dd`의 `select-all`로 수동 복사 가능.
- 발생 시각은 서버/클라이언트 시간 불일치(하이드레이션 오류)를 피하려고 `useEffect` 안에서 `Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ... })`로 채운다(첫 렌더는 "-").
- 관리자 digest는 항상 표시(없으면 "없음"). 스택 노출 없음, 프로덕션 `error.message` 노출 가능하지만 위 표에서는 개발 환경 한정으로 줄였다(정의서 3.3 "가능"을 가장 보수적으로 적용. 필요하면 PO가 풀어도 된다).
- 3회 이상 반복 실패: 관리자는 전화 블록이 없으므로 레이아웃 변화 없이 본문 1줄만 교체("같은 오류가 반복돼요. 위 정보를 개발 담당에게 전달해 주세요."). 버튼 순서 유지.
- 반응형: 해당 없음(1280px 이상). 사이드바 폭 + 카드 폭 720px가 1280px에서 화면 안에 들어온다.
- 이유: 운영자는 "어디서 났는지"를 복사해 전달하는 것이 목적이라, 정보 블록을 제목 바로 아래에 두고 복사 버튼을 같은 줄 버튼 묶음 안에 둔다.

### D-5. E-GLB global-error (인라인 스타일 전용)

핵심 행동: 다시 시도하기. 셸 없음(헤더/푸터 없음, 텍스트 로고만).

**제약 반영 원칙**: Tailwind 클래스, `globals.css`, CSS 변수, Pretendard CDN, `next/link`, `next/image`, 컴포넌트 라이브러리(`ErrorPanel`, `CopyButton` 등) **전부 사용 금지**. 이 파일은 React 요소 + 인라인 `style`과 `<style>` 태그 1개만 쓴다. 아이콘도 인라인 SVG(외부 파일/이미지 금지).

```
<html lang="ko" style={{ colorScheme: 'light' }}>
  <head>
    <title>문제가 생겼어요 | 바라 평생교육원</title>
    <meta name="robots" content="noindex" />
    <style>{`:focus-visible{outline:3px solid #3C1E87;outline-offset:2px}`}</style>
  </head>
  <body style={BODY}>...
```

> 포커스 링 색은 정의서 4.6의 예시값 `#1a56db`가 아니라 사이트 토큰 `--indigo #3C1E87`로 한다(다른 오류 화면과 동일한 브랜드 링, 흰 배경 대비 12:1). 정의서 4.6은 "hex 확정값은 ui-ux-designer가 지정"이라 했으므로 이 값을 확정으로 한다.

**인라인 스타일 값표** (hex는 `globals.css` `@theme`과 동일)

| 요소 | style 값 |
|---|---|
| `body` | `margin:0; minHeight:'100vh'; background:'#FFFFFF'; color:'#17171C'; fontFamily:"-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif"; WebkitTextSizeAdjust:'100%'` |
| 래퍼 `main` | `display:'flex'; flexDirection:'column'; alignItems:'center'; boxSizing:'border-box'; width:'100%'; maxWidth:560; margin:'0 auto'; padding:'32px 20px 48px'; textAlign:'center'` |
| 텍스트 로고(링크 아님) | `fontSize:18; fontWeight:700; color:'#3C1E87'; marginBottom:32` ("바라 평생교육원") |
| 아이콘 배지 | `width:64; height:64; borderRadius:'50%'; background:'#F7F7F9'; color:'#3C1E87'; display:'flex'; alignItems:'center'; justifyContent:'center'` + SVG `width:32; height:32` |
| `h1` | `margin:'20px 0 0'; fontSize:'clamp(24px, 4vw + 12px, 32px)'; fontWeight:700; lineHeight:1.35; color:'#17171C'; wordBreak:'keep-all'; outline:'none'` + `tabIndex={-1}` |
| 본문 `p` | `margin:'12px 0 0'; fontSize:18; lineHeight:1.7; color:'#4A4A58'; wordBreak:'keep-all'` |
| 버튼 묶음 `div` | `display:'flex'; flexDirection:'column'; gap:12; width:'100%'; maxWidth:420; marginTop:32` |
| 주 버튼(`<button type="button">`) | `display:'flex'; alignItems:'center'; justifyContent:'center'; gap:8; boxSizing:'border-box'; width:'100%'; minHeight:56; padding:'0 24px'; border:0; borderRadius:999; background:'#3C1E87'; color:'#FFFFFF'; fontFamily:'inherit'; fontSize:18; fontWeight:700; cursor:'pointer'` |
| 홈 버튼(`<a href="/">`) | 주 버튼과 같되 `border:'2px solid #3C1E87'; background:'#FFFFFF'; color:'#3C1E87'; textDecoration:'none'` |
| 전화(`<a href="tel:…">`) | `display:'flex'; flexDirection:'column'; alignItems:'center'; justifyContent:'center'; gap:2; boxSizing:'border-box'; width:'100%'; minHeight:72; padding:'8px 24px'; border:'1px solid #DCDCE3'; borderRadius:999; background:'#F7F7F9'; color:'#17171C'; textDecoration:'none'` · 라벨 `fontSize:18; fontWeight:600` · 번호 `fontSize:22; fontWeight:700; letterSpacing:'0.02em'` |
| 문의번호 `p` | `margin:'32px 0 0'; fontSize:14; lineHeight:1.6; color:'#6B6B7C'` · `code`: `background:'#EEEEF2'; color:'#2E2E38'; padding:'2px 6px'; borderRadius:4; fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"; fontSize:14; wordBreak:'break-all'; userSelect:'all'` |

- **hover 상태 없음**(인라인 스타일은 `:hover`를 못 씀). 대신 `:focus-visible`만 `<style>` 1개로 지정(정의서 4.6 허용). hover가 없어도 버튼은 모양만으로 클릭 가능해 보이도록 채움/테두리 차이를 뒀다.
- **반응형**: 미디어 쿼리를 쓸 수 없으므로 유동 값으로 대응한다. 폭 `width:'100%'` + `maxWidth:420`, 제목 `clamp(24px, 4vw + 12px, 32px)`(375px에서 약 27px, 500px 이상에서 32px), 좌우 패딩 20px. 데스크톱도 같은 단일 컬럼 중앙 정렬(콘텐츠가 작아 별도 레이아웃이 필요 없다). `<meta viewport>`는 Next 기본 삽입 여부를 구현자가 확인.
- 전화 번호: `siteConfig.phone` import 허용(정의서 4.2). 위험하면 상수로 복제하고 동기화 주석 필수.
- 구성 순서: 로고 텍스트 → 아이콘 배지 → h1 → 본문 → [다시 시도하기 button] → [홈으로 가기 a] → [전화 a] → [문의번호 p]. 전부 키보드 순서 = 시각 순서.
- 재시도: `onClick`에서 `unstable_retry()`(불가 시 `window.location.reload()`). 로딩 표시는 라벨만 "불러오는 중..."으로 바꾸고 `aria-busy`, `aria-disabled`(스피너 SVG 회전은 `<style>`에 `@keyframes`를 넣으면 가능하지만 **1개 `<style>` 규칙 한도를 지키기 위해 생략**, 텍스트 변화만).
- 3회 이상 반복 실패: "다시 시도하기" 버튼을 숨기고, "홈으로 가기"를 주 버튼 스타일(채운 인디고, 흰 글씨)로 바꾼다. 전화 버튼 스타일을 `border:'2px solid #3C1E87'; background:'#FFFFFF'`로 강조. `sessionStorage` 접근은 try/catch(막히면 항상 3개 표시).
- 접근성: `lang="ko"`, `<title>`, `h1`에 `useEffect`로 포커스(`ref.current?.focus()`), `main`에 `id="main"`, 본문 `p`에 `aria-live="polite"`(반복 실패 시 본문 교체 낭독). SVG `aria-hidden="true"`.
- 대비: 본문 #4A4A58 on #FFF 약 8.5:1, 제목 #17171C 약 17:1, 문의번호 #6B6B7C on #FFF 약 5.0:1, 주 버튼 #FFF on #3C1E87 약 12:1(전부 AA 이상).

### D-6. E-503 `/service-unavailable` (API 연결 불가 전체 화면)

핵심 행동: 다시 시도하기(새로고침).

| 영역 | 구성 |
|---|---|
| 셸 | `ErrorHeader`(D-1.3, 로고 `<a href="/">`만) + `<main id="main">` + `FooterBody`(D-0 #1, API 호출 없음) |
| 아이콘 | `wifi-off` 배지 |
| 제목(초안) | "지금 연결이 원활하지 않아요" |
| 본문(초안) | "잠깐 문제가 생겼어요. 1~2분 뒤에 다시 눌러 보세요." ("입력하신 정보는 안전해요"는 정의서 Q4 확인 전까지 **디자인에 넣지 않는다**) |
| 안심 한 줄 | rewrite로 들어온 경우만 "다시 시도하면 하던 곳으로 돌아가요"(초안) `text-base text-n-6`, 본문 아래 `mt-2` |
| 주 버튼 | "다시 시도하기" `window.location.reload()` (PRIMARY). 주소가 `/service-unavailable` 직접 진입이면 `/`로 이동 |
| 보조 버튼 | "홈으로 가기" `<a href="/">`(SECONDARY, 전체 새로고침) |
| 전화 | D-1.5 보조 버튼. digest 없음, C-11 없음 |

- **정적 페이지 원칙**: 서버 컴포넌트에서 API/세션/DB 호출 없음, `FooterBody`만 사용, `ErrorPanel` 전화 버튼의 `siteConfig`는 정적 파일. 다시 시도/홈 판별은 클라이언트 `'use client'` 작은 컴포넌트 1개(`RetryButton`)로 분리.
- **첫 화면에 전화 버튼이 보이게(정의서 5.7)**: 375x667 기준 높이를 계산하면 헤더 57 + 상단 여백 32 + 배지 64 + 제목(2줄) 약 65 + 본문(3줄) 약 92 + 안심 한 줄 약 30 + 버튼 3개(56+56+72) + 간격 약 130 = 약 650px로 모바일 브라우저 주소창을 빼면 전화 버튼이 간신히 잘린다. 대응: 이 화면만 모바일 상단 여백을 `py-6`(24px), 배지를 `size-14`(56px)로 줄이고, **화면 높이 700px 이하이면 아이콘 배지를 숨긴다**(`[@media(max-height:700px)]:hidden`, 장식 요소라 정보 손실 없음). 이 상태에서 전화 버튼 하단이 약 500px에 위치해 첫 화면에 들어온다. 안심 한 줄은 줄바꿈 없이 1줄(`text-base`)로 유지.
- 반복 실패(3회 이상, `sessionStorage` 단일 키): 본문을 "연결이 계속 안 돼요. 전화로 알려 주세요."로 바꾸고 안심 한 줄 숨김, 전화 버튼을 강조(D-1.5의 `border-2 border-indigo bg-n-0`) + 위치를 두 번째로 올림(홈은 세 번째). "다시 시도하기"는 주 버튼으로 유지(연결 복구는 새로고침이 유일한 해결책이기 때문, 사용자 오류 화면과 다른 점). 자동 재시도 없음.
- 반응형: 모바일 위 값 그대로. md 이상은 D-1.4와 동일(상하 `md:py-20`).
- 응답 헤더(503, `Retry-After`, `no-store`, `noindex`)는 정의서 5.2 요구사항을 따르며 디자인 범위 밖이다.
- 이유: 연결 문제는 사용자 조작으로 즉시 해결되는 것이 새로고침뿐이라, 다른 오류 화면과 달리 "다시 시도하기"를 3회째에도 주 버튼으로 유지하고 전화 안내를 보강하는 방식으로 균형을 잡았다.

### D-7. 접근성 상세 (정의서 7절 체크리스트 구체화)

| 항목 | 구현 방식 |
|---|---|
| 제목 포커스 | 모든 오류/404 본문의 `<h1>`에 `id="error-title"`, `tabIndex={-1}`, `outline-none`(포커스 링은 키보드로 조작하는 요소가 아니라 프로그램 포커스용이라 숨겨도 됨). 서버 컴포넌트인 `not-found.tsx` 본문은 포커스를 직접 못 주므로 `ErrorTitle`이라는 작은 `'use client'` 컴포넌트가 마운트 시 `ref.current?.focus({ preventScroll: false })`를 호출한다. error.tsx 계열은 이미 클라이언트라 같은 컴포넌트를 쓴다 |
| role/aria | 전체 화면 교체에는 `role="alert"`를 쓰지 않는다(포커스 이동으로 낭독, 정의서 3.6). 본문 `p`와 복사 상태는 `aria-live="polite"`. 재시도 버튼은 `aria-busy`/`aria-disabled`. 오류 아이콘 `aria-hidden`. landmark는 `<main>`(루트 폴백) 또는 `<section aria-labelledby="error-title">`(그룹 안) |
| 읽는 순서 | DOM 순서 = Tab 순서 = 시각 순서: 제목 → 본문 → (notice) → 주 버튼 → 보조 → 전화 → 문의번호. CSS `order`로 시각 순서를 바꾸지 않는다 |
| 터치 영역 | 사용자용 버튼 56px(전화 72px), 로고 링크 44px, notice 안 링크 44px. 관리자 버튼 48px |
| 대비 | 본문 #4A4A58(8.5:1), 제목 #17171C(17:1), 보조 라벨 #6B6B7C(5.0:1), 주 버튼 흰/인디고(12:1), 포커스 링 인디고(흰 대비 12:1). `n-4/n-5`는 텍스트에 쓰지 않는다 |
| 글씨 확대 | 200% 확대(320px 상당)에서도 `break-keep` + `break-all`(digest만) 덕에 가로 스크롤 없음. 버튼 높이는 `min-h`라 줄바꿈 시 자동 확장 |
| 모션 | 스피너만 `animate-spin motion-reduce:animate-none`, 그 외 애니메이션 없음 |
| 색만 의존 금지 | 상태는 항상 아이콘 + 텍스트. 반복 실패 강조도 테두리 두께/위치 변화를 함께 사용 |
| 언어/제목 | 페이지 `<title>`은 정의서 2.6/3.6/4.6/5.8의 문구. global-error도 `lang="ko"` |

### D-8. 구현 매핑 (publisher / frontend-developer 전달)

| 디자인 컴포넌트 | 위치 제안 | 재사용/신규 | 비고 |
|---|---|---|---|
| `ErrorHeader` | `components/layout/ErrorHeader.tsx` | 신규(작음) | `AppHeader` 껍데기 클래스 재사용 |
| `FooterBody` | `components/layout/FooterBody.tsx` | **기존 `Footer` 마크업 분리** | `Footer`는 환불정책 조회 + `FooterBody` 합성으로 축소 |
| `ErrorPanel`, `NotFoundPanel`, `ErrorTitle`, `RetryButton`, `PhoneButton` | `components/error/` | 신규 | 사용자용 3화면 공유. 클라이언트는 `ErrorPanel`, `ErrorTitle`, `RetryButton`만 |
| `AdminErrorPanel`, `AdminNotFound` | `components/error/` 또는 `components/admin/` | 신규 | `AdminShell` 건드리지 않음 |
| `CopyButton` | `components/ui/CopyButton.tsx` | **기존 확장**(선택 props) | 기본 동작 불변 |
| global-error 본문 | `app/global-error.tsx` 한 파일 | 신규 | 위 컴포넌트 import 금지(`siteConfig` 제외) |
| 아이콘 | `components/error/icons.tsx` | 신규 인라인 SVG 5종 | global-error는 파일 내부에 복제(import 금지) |

### D-9. 이번 스펙 범위 밖에서 발견한 사용성 이슈 (제안만, 수정하지 않음)

1. `AppHeader` 링크 글씨 12.5px, 터치 영역이 44px 미만이다. 시니어 대상 서비스에서 오류 화면 밖(전 화면)의 문제라 별도 이슈로 올릴 것을 제안한다.
2. `Footer`의 법정 표시 글씨가 13px이다. 법정 고지는 읽는 용도가 아니라 규정 준수 용도라 이번에는 유지하지만, 전화/이메일 링크의 터치 영역이 작다.
3. `ClassroomAccessNotice`의 `bg-pink` 흰 글씨 버튼은 AA 근소 미달(약 4.4:1). 오류 화면은 인디고 버튼으로 해결했다.

### D-10. F8 검수 요청 (ux-writer) 및 PO 확인 연동

- ux-writer에게 확인 요청: 제목/본문/버튼 라벨 전부, 특히 (1) "문의번호" 라벨과 "전화로 문의하실 때 알려 주세요" 안내, (2) 3회 반복 실패 본문, (3) 관리자 404의 "목록으로" 대 "관리자 홈으로" 라벨, (4) 전화 버튼 두 줄 구성에서 라벨 길이(18px 기준 한 줄 약 14자 이내 유지).
- 기본값이 PO 답변으로 바뀌면 영향: Q1 digest 제거 → D-1.6 블록 삭제, 나머지 레이아웃 영향 없음. Q2 운영시간 추가 → D-1.5 버튼 아래 `text-sm text-n-6` 한 줄 추가(높이 +24px, 503 첫 화면 계산 재확인). Q5 외국어 병기 → 제목 아래 보조 줄 `text-base text-n-6` 한 줄 추가(375px 줄 수 재확인). Q6 추천 카드 → `NotFoundPanel` 아래 3카드 슬롯(기존 `CourseCard` 재사용).
- Figma 게이트(오류 화면 한정): 이 문서로 F7(반응형 정의)까지 텍스트 스펙 완료. Figma 프레임 제작은 미착수(프레임 후보: 404-390, 404-1200, 500-390, 500-admin-1280, global-390, 503-390). F8은 ux-writer 검수 대기, F9 승인은 product-manager 요청 전 단계.
