# bara-edu-lms Design Document

> **Summary**: 바라 평생교육원 LMS(USER) + Admin 콘솔 — Supabase + Next.js, YLIA 디자인 시스템 기반
>
> **Project**: 바라 평생교육원 (bara-edu.kr)
> **Version**: 1.0
> **Author**: AI Team (bara-edu)
> **Date**: 2026-08-01 (최종 승인 2026-08-04)
> **Status**: **Approved — Figma-First 게이트 통과, Do 단계 착수 가능**
> **Planning Docs**: [bara-edu-lms.plan.md](../../01-plan/features/bara-edu-lms.plan.md) · [bara-edu-lms.flows.md](../../01-plan/features/bara-edu-lms.flows.md) · [bara-edu-lms.home.md](../../01-plan/features/bara-edu-lms.home.md) (홈 화면, 2026-08-10 추가)

---

## ⚠️ Figma-First 워크플로우 게이트

> **개발 착수 조건**: 아래 체크리스트가 모두 완료된 후에만 `/pdca do bara-edu-lms` 실행 가능. 기존 bara-edu-mvp의 module-4(강좌목록/상세)·module-5(배포)는 본 게이트 통과 후 이 계획에 흡수되어 진행된다.

| 단계 | 담당 | 완료 여부 |
|------|------|:--------:|
| F1. Figma 파일 생성 + 팀 공유 | UI/UX Designer | ✅ |
| F2. 디자인 토큰 적용 (YLIA_UX_Pattern_Guide.html 토큰 이식 — 신규 정의 아님) | UI/UX Designer | ✅ (Colors 22종 + Spacing 8종 + Radius 5종, Figma Variables로 실제 생성) |
| F2b. Design System 컴포넌트 ("Components" 페이지) | UI/UX Designer | ✅ Button(Primary/Secondary/Ghost/Danger/Disabled) · Badge(5종) · Input(Default/Error/Disabled) · Textarea(Default/Error/Disabled) · Tab(밑줄형) · FilterChip(알약형) · AppHeader(Public/User) · AdminTopbar · NavItem(Depth=1/2/3 × Active/Inactive, 6종) · ConfirmDialog(Neutral/Danger) · CategorySelect(1~3Depth) · **Toast(Success/Info/Warning)** · **Icon(Search/Success/Warning/Info — 16x16 벡터, 2026-08-04 신규)** — 전부 토큰 바인딩 |
| F3. 회원가입/로그인 와이어프레임 | UI/UX Designer | ✅ 모바일(01) + **PC(01-pc, 센터 정렬 카드) 완료** |
| F4. 강좌 목록 + 상세 + 신청/입금 안내 와이어프레임 | UI/UX Designer | ✅ 모바일+**PC** 둘 다 완료. 강좌 목록(02a/02a-pc 3열 그리드), 상세(02/02-pc 2단+Sticky ApplyBox) |
| F5. 마이페이지 와이어프레임 | UI/UX Designer | ✅ 모바일(03)+**PC(03-pc, 2열 카드 그리드)** 완료. 설정(회원탈퇴, ConfirmDialog Danger) 포함 |
| F6. 강의실(진도·퀴즈·과제) 와이어프레임 | UI/UX Designer | ✅ PC/태블릿(800, 좌우 2단) + **모바일(390, 커리큘럼 접기/펼치기 아코디언) 둘 다 완료** |
| F7. Admin 콘솔 와이어프레임 | UI/UX Designer | ✅ 05~09 전체 재조립(AdminTopbar+NavItem 7항목+FilterChip+ConfirmDialog) + **10 카테고리관리(NavItem Depth1~3 트리)**, **11 CMS(Input+Textarea)** 신규 추가 |
| F8. 모바일 반응형(USER) / 데스크톱 최소폭(Admin) 레이아웃 정의 | UI/UX Designer | ✅ 390(USER)/1280(Admin) 기준 재조립본에도 동일 적용 |
| F9. 카피라이팅 — ux-writer 검수 완료 | UX Writer | ✅ (2026-08-04, 아래 "F9 ux-writer 검수 결과" 참조) |
| F10. PO 디자인 리뷰 + 승인 | Product Owner | ✅ **2026-08-04 승인 완료** — 조건: 진행 중 수정 발생 시 관련 문서(plan/flows/design.md) 전부 동기화 후 진행 (아래 "운영 원칙" 참조) |
| F11. Figma Dev Mode 링크 → 이 문서에 추가 | Developer | ✅ |

**Figma 파일 URL**: https://www.figma.com/design/H141QVdsrLybIakYlIZVXB
**Figma Dev Mode URL**: https://www.figma.com/design/H141QVdsrLybIakYlIZVXB (Dev Mode 탭 전환)

**페이지 구성 (2026-08-02 컴포넌트 기반 재조립 완료, 16개 페이지)**: Cover · Foundations(토큰) · Components(11개 컴포넌트) · 01 회원가입·로그인 · 02a 강좌 목록 · 02b 약관·정책 페이지 · 02 강좌상세·신청·입금 · 03 마이페이지 · 04 강의실(+퀴즈·과제) · 05 Admin 대시보드 · 06 Admin 신청·입금관리 · 07 Admin 강좌관리 · 08 Admin 회원관리 · 09 Admin 수료관리 · 10 Admin 카테고리관리 · 11 Admin CMS(약관관리)

**F1~F10 전체 완료. Figma-First 게이트 통과 — `/pdca do bara-edu-lms` 착수 가능.**

### 운영 원칙 — 진행 중 수정사항 동기화 (2026-08-04 PO 승인 조건)

> PO 승인 시 명시된 조건: **Do 단계(개발) 진행 중 요구사항/설계가 바뀌면, 코드만 고치고 넘어가지 않는다.** 변경 성격에 따라 관련 문서를 함께 갱신한 뒤 진행한다.

| 변경 종류 | 갱신 대상 |
|---|---|
| 메뉴/기능 범위 변경 | `bara-edu-lms.menu-features.md` (메뉴구조도·기능정의서) |
| 플로우/정책/엣지케이스 변경 | `bara-edu-lms.flows.md` |
| 데이터모델/화면/컴포넌트 변경 | `bara-edu-lms.design.md` + Figma(Components 또는 해당 페이지) |
| 스코프(포함/2차이연) 변경 | `bara-edu-lms.plan.md` |

이 프로젝트 전체에서 지금까지 지켜온 방식(문서 ↔ Figma 항상 동기화)을 Do 단계에도 그대로 적용한다.

### F9 ux-writer 검수 결과 (2026-08-04)

기존 문구는 UI/UX Designer 초안이라 정식 검수 없이 화면에 들어가 있었다. 이모지 미사용/비단정적 어조/초대형 CTA/시니어·해외이주민 고려 쉬운 말/용어 통일 기준으로 전체 화면 문구를 검토했고, 6곳을 수정했다.

| 위치 | 수정 전 | 수정 후 | 사유 |
|---|---|---|---|
| Design System · AdminTopbar | "🔍 검색" | Icon(Search) 벡터 아이콘 + "검색" | 운영 콘솔(Admin)·교육형 서비스는 이모지 미사용 원칙(YLIA 가이드). **1차 수정(단순 삭제)이 부족하다는 피드백을 받아** Icon 컴포넌트(Search/Success/Warning/Info, 16x16 벡터)를 신규 제작해 아이콘 자리를 채움 — 컴포넌트 1곳 수정으로 Admin 05~11 전체에 자동 반영됨. Toast의 텍스트 글리프(✓/ⓘ/⚠)도 같은 Icon 컴포넌트로 교체 |
| 02 강좌상세 (모바일+PC) | "입금자명  신청자 본인 이름" | "입금자명  본인 이름으로 입금해주세요" | 라벨+값처럼 읽혀 모호함 → 무엇을 해야 하는지(행동) 명시. **PC 버전엔 이 줄 자체가 누락돼 있어 이번에 추가함** |
| 02-full (정원마감 상태) | 없음 | "다른 강좌도 둘러보세요" 캡션 추가 | "에러=원인+다음행동" 원칙 — 마감 이유는 버튼이 보여주니 다음 행동을 보충 |
| 03 마이페이지 (탈퇴 ConfirmDialog) | "개인정보는 즉시 파기돼요" | "이름·연락처 등 개인정보는 즉시 삭제되고, 결제 관련 기록은 법령에 따라 일정 기간 보관돼요" | flows.md Q10 정책(거래기록은 법정기간 보관 후 파기)과 문구가 달라 법적으로 부정확했음 |
| 03 마이페이지 | 없음 | "진행 중인 강좌가 있을 때는... 탈퇴할 수 없어요. 고객센터로 문의해 주세요" 안내 추가 | flows.md Q12(진행 중 강좌 있으면 탈퇴 차단) 정책이 화면에 전혀 반영 안 되어 있었음 |
| 11 CMS 편집기 | "본문 (마크다운)" | "본문" | Admin 사용자(운영 담당자)가 비개발자일 수 있어 구현 용어(마크다운) 노출은 불필요한 인지 부담 |

**용어 일관성**: "수강 신청하기/강의실 입장/학습 완료로 표시/제출하기" 등 핵심 CTA는 화면 전체에서 동일하게 유지됨을 확인. "액션"(테이블 헤더) 등 일부 외래어는 Admin(내부 운영자 전용 도구)이라 시니어·해외이주민 배려 대상이 아니므로 유지.

**아이콘 원칙 (2026-08-04 확정)**: 이모지(🔍⚠️ⓘ 등 컬러 픽토그램)는 어디서도 쓰지 않는다. 아이콘이 필요하면 (1) Design System의 `Icon` 컴포넌트(벡터) 인스턴스를 쓰거나, (2) 없는 종류면 같은 방식(16x16, 토큰 색상 바인딩)으로 `Icon`에 variant를 추가한 뒤 쓴다. 단순 기하 도형 문자(✓ ▶ ○ ▾ ▴ 등, 폰트에 기본 포함되어 이모지로 대체되지 않는 글리프)는 계속 텍스트로 써도 된다 — 문제는 "색이 있는 픽토그램으로 렌더링되는지" 여부다.

### 주요 엣지케이스 와이어프레임 (2026-08-02 추가)

대표 상태 외에 flows.md 5절의 "필수" 우선순위 엣지케이스 중 아래 8개를 실제 화면으로 추가했다 (나머지는 텍스트 설명만 존재, 필요 시 추가):

| 화면 | 엣지케이스 | 위치 |
|---|---|---|
| 강좌 목록 | 빈 상태 (조건에 맞는 강좌 없음) | 02a 페이지, "02a-empty" 프레임 |
| 강좌 상세 | 정원 마감 (Button Disabled) | 02 페이지, "02-full" 프레임 |
| 강의실 | 미승인 접근 차단 | 04 페이지, "04d" 프레임 |
| 로그인 | 세션 만료 리다이렉트 안내 | 01 페이지, "01c" 프레임 |
| 공통 | 404 (강좌 없음) | 신규 "12 404 페이지" |
| Admin 신청·입금관리 | 동시 처리 충돌 Toast | 06 페이지 하단 주석 |
| Admin 강좌관리 | 신청 이력 있는 강좌 삭제 차단 (ConfirmDialog) | 07 페이지 하단 주석 |
| 마이페이지 | 입금기한 만료 카드 | 03 페이지, "신청내역-만료" 카드 |

이 작업 중 Toast 컴포넌트(Kind=Success/Info/Warning)를 Design System에 신규 추가했다.

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 신청까지만 온라인화된 상태를 넘어, 수강(학습·진도·수료)과 운영(강좌·회원·입금 관리)까지 하나의 시스템으로 통합 |
| **WHO** | 학습자(직장인·취준자·시니어·경력단절자·해외이주민·B2B) + 내부 운영자(Admin) |
| **RISK** | Supabase 마이그레이션 중 기존 강좌 데이터 정합성, 무통장입금 수동 승인의 운영 지연, RLS 설정 오류로 인한 개인정보 노출 |
| **SUCCESS** | 가입~신청~입금~승인~수강~수료증까지 이탈 없이 완료, Admin이 입금 확인 후 3클릭 이내 승인 처리 |
| **SCOPE** | 기존 강좌안내(Sheets→Supabase 이관) + 회원가입/로그인 + 신청/무통장입금 + 강의실/진도/퀴즈/과제 + 수료증 + Admin 콘솔 전체 |

---

## 1. Overview

### 1.1 Design Goals
- **디자인 시스템 재사용**: 새 토큰을 만들지 않고 `YLIA_UX_Pattern_Guide.html` + `YLIA_브랜드가이드라인.pdf`를 그대로 적용
- **archetype 분리**: USER=교육·인증형(신뢰·성실, 이모지 없음), Admin=운영 콘솔(밀도 우선, 데스크톱 최소 1280px)
- **RLS 우선 보안**: 클라이언트 로직이 아니라 Supabase RLS로 학습자/운영자 데이터 접근을 원천 분리

### 1.2 Design Principles
- **Figma-First**: 코드 작성 전 Figma 확정 (기존 MVP 원칙 유지)
- **정책은 flows.md가 근거**: Q1~Q9 확정 정책(입금 기한 3일, 자유 수강, 무제한 재응시 등)을 임의로 재해석하지 않는다
- **동시 오픈 전제**: 기존 Coming Soon은 이 설계의 모든 화면이 완성될 때까지 유지된다

---

## 2. Architecture

### 2.1 Component Diagram
```
┌──────────────────────────────────────────────────────────────────┐
│                        bara-edu.kr (Browser)                      │
│  (public) 강좌안내/Coming Soon │ (auth) 가입·로그인 │ (user) 마이페이지·강의실 │ (admin) 콘솔 │
└───────────────────────────────┬───────────────────────────────────┘
                                 │ Supabase JS Client (Auth + PostgREST)
┌───────────────────────────────▼───────────────────────────────────┐
│                          Supabase                                  │
│  Auth(이메일/비밀번호) │ Postgres(categories/courses/enrollments/     │
│  lessons/progress/quizzes/assignments/certificates/legal_documents) │
│  RLS Policies                                                       │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 라우트 그룹 (plan.md 4.2 확정안, 2026-08-02 카테고리/탈퇴/CMS 반영)
`app/(public)/`, `app/(auth)/`, `app/(user)/`, `app/(admin)/` — 각 그룹에 미들웨어로 접근 제어 (비로그인 → `(user)` 차단, role≠admin → `(admin)` 차단).

- `(public)`에 `/legal/[slug]`(이용약관/개인정보처리방침 등 공개 약관 페이지) 추가
- `(user)`의 `/my`에 "회원 탈퇴" 액션 추가 (별도 라우트 없이 마이페이지 내 설정 섹션)
- `(admin)`에 `/admin/categories`(카테고리 관리), `/admin/cms`(약관·정책 CMS) 추가

### 2.3 Dependencies
| 컴포넌트 | 의존 대상 | 목적 |
|---|---|---|
| `app/(auth)/*` | `lib/supabase/client.ts`, Supabase Auth | 가입/로그인 |
| `app/(user)/learn/[courseId]/*` | `lib/supabase/queries.ts` | 강좌/강의/진도 조회·기록 |
| `app/(user)/my/*` | `lib/supabase/queries.ts`, Supabase Auth | 탈퇴 처리(진행 중 강좌 있으면 차단) |
| `app/(admin)/enrollments/*` | `lib/supabase/queries.ts`, RLS(role=admin) | 입금 승인/반려 |
| `app/(admin)/categories/*` | `lib/supabase/queries.ts`, RLS(role=admin) | 카테고리 트리 CRUD (최대 3Depth) |
| `app/(admin)/cms/*` | `lib/supabase/queries.ts`, RLS(role=admin) | 약관/정책 문서 CRUD + 버전 관리 |
| `app/(public)/legal/[slug]` | `lib/supabase/queries.ts` | 공개 약관 문서 조회 (최신 published 버전) |
| `proxy.ts` (2026-08-04: Next.js 16부터 `middleware.ts`→`proxy.ts`로 파일명 변경, 기능 동일) | Supabase Auth 세션, `profiles.role`/`status` | 라우트 그룹별 접근 제어, 탈퇴 계정 세션 차단 |

---

## 3. Data Model

### 3.1 핵심 타입 (`lib/types.ts` 확장)

```typescript
export type UserRole = 'learner' | 'admin';
export type ProfileStatus = 'active' | 'withdrawn';

export interface Profile {
  id: string;            // Supabase auth.users.id
  name: string;
  phone?: string;
  role: UserRole;
  status: ProfileStatus;       // 탈퇴 시 'withdrawn' (소프트 삭제)
  withdrawnAt: string | null;
  // 탈퇴 처리 시 name/phone 등 식별정보는 즉시 파기(익명화)한다 — email은
  // Supabase Auth 쪽에서 별도 삭제(재가입 허용을 위해 auth.users만 제거,
  // profiles 행은 통계 목적의 익명 레코드로 잔존 가능 — 구현 시 재검토)
}

// 카테고리: 최대 3Depth 트리 (예: IT·디지털 > 개발 > 프론트엔드)
export interface Category {
  id: string;
  name: string;
  parentId: string | null;   // null이면 1Depth(최상위)
  depth: 1 | 2 | 3;
  order: number;              // 같은 depth 내 정렬 순서
}

export interface Course {
  id: string;
  slug: string;                // /courses/[slug] 라우트에 사용 (2026-08-06 누락 발견, 추가)
  title: string;
  categoryId: string;         // Category(leaf 또는 임의 depth) 참조 — 기존 6종 enum 폐기
  description: string;
  instructor: string;
  fee: number;
  seats: number;
  governmentSupport: boolean;
  status: 'active' | 'upcoming' | 'closed';
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  videoUrl: string;      // 외부 링크 (업로드 아님)
  order: number;
  hasQuiz: boolean;
  hasAssignment: boolean;
}

export type EnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Enrollment {
  id: string;
  userId: string;
  courseId: string;
  status: EnrollmentStatus;
  paymentMethod: 'bank_transfer';   // PG 도입 전까지 고정값
  paymentDueAt: string;             // 신청 시점 + 3일 (Q2)
}

export interface Progress {
  userId: string;
  lessonId: string;
  completedAt: string | null;       // 사용자가 "학습 완료로 표시" 클릭 시 기록
}

export interface QuizSubmission {
  id: string;
  userId: string;
  lessonId: string;
  score: number;
  attemptNo: number;                // 무제한 허용 (Q5)
}

export interface AssignmentSubmission {
  id: string;
  userId: string;
  lessonId: string;
  content: string;                  // 텍스트 또는 링크
  status: 'submitted' | 'approved' | 'rejected';
  isLate: boolean;                  // 마감 초과 여부만 표시, 감점 없음 (Q6)
}

export interface Certificate {
  id: string;
  userId: string;
  courseId: string;
  issuedAt: string;
  fileUrl: string;
  isManualOverride: boolean;        // Admin 수동 수료 처리 여부 (Q9)
}

// CMS: 이용약관/개인정보처리방침 등 법적 문서 관리
export type LegalDocType = 'terms' | 'privacy' | 'refund_policy' | 'etc';

export interface LegalDocument {
  id: string;
  type: LegalDocType;
  slug: string;             // /legal/[slug] 라우트에 사용
  title: string;
  content: string;          // 마크다운
  version: number;
  isPublished: boolean;     // 공개 페이지에는 published된 최신 버전만 노출
  effectiveAt: string;
}
```

### 3.2 RLS 정책 개요
| 테이블 | 학습자(learner) | 운영자(admin) |
|---|---|---|
| `profiles` | 본인 행만 read/update (탈퇴=status를 'withdrawn'으로 update, 진행 중 신청 있으면 애플리케이션 레벨에서 차단) | 전체 read |
| `categories` | 전체 read | 전체 read/write (트리 구조, 최대 depth=3 애플리케이션 레벨 검증) |
| `courses` | active/upcoming만 read | 전체 read/write |
| `enrollments` | 본인 행만 read/insert. **반려/만료(입금기한초과) 건에 한해 본인이 update(status→pending, 재신청)** | 전체 read/update |
| `progress`, `quiz_submissions`, `assignment_submissions` | 본인 행만 read/write | 전체 read, assignment는 status update 가능 |
| `legal_documents` | published된 문서만 read | 전체 read/write (버전 관리) |
| `certificates` | 본인 행만 read | 전체 read/write |

세부 SQL 정책은 Do 단계에서 developer가 작성, security-officer가 리뷰.

**module-lms-4 구현 중 발견·수정한 보안 이슈 (2026-08-06, ✅ security-officer 재점검 완료)**: `profiles_self_update` 정책이 "본인 행"이라는 조건만 있어 학습자가 PostgREST를 직접 호출해 자기 `role`을 `admin`으로 바꾸는 권한상승이 가능했다. `protect_profile_privileged_columns` BEFORE UPDATE 트리거를 추가해 비관리자 요청은 `role`을 항상 원래 값으로 되돌리고 `status`는 `active`→`withdrawn` 전환만 허용하도록 막았다(`supabase/schema.sql`).

**security-officer 2차 점검(2026-08-06)에서 추가로 발견·수정한 이슈 (No-Go → 재점검 후 조치 완료)**:
1. **치명적**: `enrollments_self_insert` RLS가 `status`를 검증하지 않아 학습자가 REST API를 직접 호출해 입금 없이 `status='approved'`로 신청 레코드를 만들 수 있었다 → `with check`에 `status = 'pending'` 조건 추가.
2. **치명적**: 개인정보처리방침/이용약관 페이지 부재 → product-manager가 초안 작성(`docs/01-plan/features/bara-edu-lms.legal-{terms,privacy}.md`), `legal_documents` 테이블에 seed, `/legal/[slug]` 공개 페이지로 노출, 회원가입·수강신청 동의 체크박스에 링크 연결. **⚠️ 본문의 사업자등록번호/주소/대표자/보호책임자 연락처/Supabase 리전은 플레이스홀더 상태 — 실제 공개 전 반드시 실제 정보로 교체 필요.**
3. **개선**: 로그인 `?redirect=` 파라미터에 오픈 리다이렉트(CWE-601) 취약점 → `app/actions/auth.ts`의 `safeRedirect()`가 내부 상대경로만 허용하도록 검증.
4. **개선**: 반려/만료 재신청 시 `course_id`를 바꿔치기할 수 있는 허점 → `protect_enrollment_course_id` BEFORE UPDATE 트리거로 비관리자 요청은 `course_id` 고정.
5. **개선**: 탈퇴 시 `profiles`는 익명화되지만 `auth.users` 이메일은 보존되던 문제 → product-manager가 "이메일도 즉시 익명화(재가입 차단 목적 없음, 법정 보존 대상 아님)"로 결정, `lib/supabase/admin.ts`(service_role 클라이언트) 추가 후 `withdraw()`에서 이메일 익명화·비밀번호 무효화·학습 이력(`progress`/`quiz_submissions`/`assignment_submissions`) 파기를 함께 처리. **⚠️ 배포 환경에 `SUPABASE_SERVICE_ROLE_KEY` 서버 전용 환경변수 설정 필요(현재 `.env.local`에 없음, NEXT_PUBLIC_ 접두사 절대 금지) — 미설정 시 탈퇴 기능이 fail-closed로 즉시 실패한다.**

**qa-reviewer 3차 점검(2026-08-06, 위 5건 수정에 대한 재검토)**: RLS/트리거/서비스키 격리/XSS/서버측 동의 검증은 Pass. 아래 4건은 Fail로 판정되어 추가 수정했다.
- `safeRedirect()`가 `/\evil.com` 같은 백슬래시 케이스(WHATWG URL 파서가 `\`를 `/`와 동일 취급)를 막지 못해 오픈 리다이렉트가 재현됨 → `\` 포함 여부도 함께 차단하도록 보강.
- `withdraw()`가 각 단계의 Supabase 에러를 확인하지 않아 "학습기록은 삭제됐는데 계정은 살아있는" 부분 실패가 조용히 발생할 수 있었음 → 단계별 `error` 체크 후 실패 시 즉시 `/my?withdrawError=failed`로 중단하도록 수정, 실행 순서도 "가장 되돌리기 어려운 것부터"(이메일 익명화 → 프로필 상태 변경 → 학습이력 파기)로 재배치.
- `crypto.randomUUID()` 전역 참조가 배포 Node 런타임에 따라 미지원일 수 있음 → `node:crypto`의 `randomUUID`를 명시적으로 import하도록 변경.
- `legal_documents` 시드가 사업자등록번호 등 플레이스홀더 상태로 `is_published: true`로 게시될 예정이었음 → **`is_published: false`로 시드하도록 변경**했다가, 대표 확인을 거쳐 실제 정보(주소/사업자등록번호/대표자 최종훈/통신판매업 신고번호 제2026-경기광명-0607호/보호책임자 연락처/Supabase 리전 ap-northeast-2(서울))로 모두 교체하고 **`is_published: true`로 재전환 완료(2026-08-06)**. `/legal/terms`, `/legal/privacy` 공개 상태. AWS(Amplify) 호스팅 리전만 미배포로 미확정 — 실제 배포 시 개인정보처리방침 제5조 국외이전 문구 갱신 필요. `supabase/seed.sql`의 legal_documents insert는 `on conflict do update`로 바꿔 재실행 시 기존 행 내용이 최신화되도록 함.

**'expired' 상태 관련 구현 메모**: `enrollments.status`의 `expired` 값은 아직 어떤 코드도 자동으로 기록하지 않는다(스케줄러/Edge Function 미도입). 대신 `status='pending' and payment_due_at < now()`인 행을 애플리케이션 레벨에서 "만료"로 간주(파생, derived)해 화면에 표시하고 재신청을 허용한다. module-lms-6 구현 후에도 실제 `expired` 값을 기록하는 배치/트리거는 도입하지 않았다 — Admin 신청·입금 관리 화면도 동일한 파생 규칙(`deriveStatus()`)을 재사용해 만료 표시만 하고, 승인/반려는 계속 가능하게 뒀다(늦게라도 입금 확인되면 처리할 수 있도록).

**module-lms-6 (Admin 콘솔) 구현 완료 (2026-08-08)** — 대시보드/강좌관리/카테고리관리/신청·입금관리/회원관리/수료관리/약관·정책 CMS 7화면을 `app/(admin)/admin/*`에 구현. 주요 스키마 추가: `categories.is_active`(비활성화), `profiles.email`(auth.users 복제, 관리자 검색용), `enrollments.rejection_reason`/`approved_at`, `certificates.note`, `legal_documents`에 `unique(slug, version)` + `publish_legal_document()` RPC(같은 slug의 다른 버전 자동 unpublish). CMS는 수정 시 새 버전 행을 추가하는 방식으로 이력을 보존한다(F-CMS-2).

**module-lms-5 (강의실) 구현 완료 (2026-08-09)** — 커리큘럼/영상/진도(`/learn/[courseId]/[lessonId]`), 퀴즈 응시·채점, 과제 제출, 수료증 자가발급을 구현. 계획 중 스펙에 없던 공백 2건을 발견해 사용자와 확정: (1) 퀴즈 문제/보기 저장용 `quiz_questions`/`quiz_options` 테이블이 원래 없었음 → 관계형 테이블로 신규 추가하고 관리자 저작 화면(`/admin/courses/[id]/lessons/[lessonId]/quiz`)도 함께 구현. (2) 과제 승인/반려 관리자 화면이 어디에도 없었음(module-lms-6에서 누락) → `/admin/assignments` 신규 구현(Phase 4.5).

주요 스키마 추가: `lessons.assignment_due_at`(과제 마감기한), `assignment_submissions.review_note`(반려 사유 — 이것도 원래 없던 공백), `quiz_questions`/`quiz_options` + 정답 1개 제약(`quiz_options_one_correct_per_question` partial unique index), `courses_enrolled_select`/`lessons_enrolled_select`(승인된 신청자는 강좌가 closed여도 계속 접근 가능하도록 보강). RPC 4종(SECURITY DEFINER): `get_quiz_for_lesson`(정답 비공개 조회), `submit_quiz_attempt`(서버 채점), `issue_certificate_self`(진도100%+과제전건승인 재검증 후 발급), `set_quiz_correct_option`(정답 설정 원자화).

security-officer·qa-reviewer 2차 점검에서 치명적 이슈 3건을 발견해 즉시 수정했다:
- `submit_quiz_attempt` RPC가 응답 jsonb에 `correctOptionId`를 그대로 담아 반환해, Supabase REST를 직접 호출하면(Next.js UI를 거치지 않고도) 정답을 확인할 수 있었음 → 정답 id 제거, `isCorrect` 불리언만 반환.
- `get_quiz_for_lesson`/`submit_quiz_attempt` 둘 다 `auth.uid() is null`만 확인하고 수강 승인 여부를 재검증하지 않아, 결제·승인 없이 로그인만 하면 유료 강좌의 퀴즈 문제(및 위 이슈와 결합 시 정답까지)를 열람할 수 있었음 → `issue_certificate_self`와 동일하게 `enrollments.status='approved'` 재검증 추가.
- `markLessonComplete`/`submitAssignment` 서버 액션이 courseId-lessonId 일치 및 승인 여부를 확인하지 않아, 다른 강좌의 lessonId를 알면 진도/과제 제출을 조작할 수 있었음 → `assertClassroomWriteAccess()` 헬퍼로 두 액션 모두에서 재검증.
- (개선 권장) `setCorrectOption`의 비원자적 2단계 update가 실패 시 문항의 정답이 0개로 남아 채점이 조용히 틀어질 수 있었음 → `set_quiz_correct_option()` RPC로 원자화 + DB 유니크 인덱스로 이중 방어.

**module-lms-7 (통합 QA·보안 점검) 1차 완료 (2026-08-09)** — module-lms-1~6을 하나로 놓고 보는 통합 점검(개별 모듈 리뷰가 아니라 "여러 모듈이 만나는 지점"에 집중). qa-reviewer가 치명적 이슈 2건, security-officer가 개선 권장 2건을 발견해 전부 수정했다:
- **(치명적)** `applyToCourse`가 정원마감/강좌closed를 커밋 직전에 재검증하지 않아, 페이지 로드 이후 정원이 차거나 강좌가 closed로 바뀌어도 그대로 신청이 들어갈 수 있었음(design.md 본 문서의 §5 "서버에서 재검증 후 거부" 요구사항 위반) → `app/actions/enrollment.ts`에 커밋 직전 `courses.status`/좌석 재확인 추가. (이 재확인은 flows.md Q3 "정원 마감은 승인 시점 기준" 정책과 상충하지 않는다 — 이미 페이지 레벨에서 쓰던 것과 동일한 승인수 기준 `isFull` 판정을 커밋 시점까지 연장한 것뿐, 새 정책이 아니다.)
- **(치명적)** `hasActiveEnrollment()`가 "완료"라는 개념을 몰라 approved 신청을 전부 "진행 중"으로 취급 — 강좌를 하나라도 끝까지 수료(진도 100%)한 학습자가 영원히 탈퇴할 수 없었음(module-lms-4가 module-lms-5보다 먼저 작성된 데서 온 통합 공백) → `lib/supabase/classroom-queries.ts`에 `hasIncompleteApprovedEnrollment()` 신설(approved 건은 진도 100%면 제외), `withdraw()`가 이걸 사용하도록 교체.
- **(개선 권장)** Admin 서버 액션 7개 파일 전체가 로그인 여부조차 확인하지 않고 RLS+미들웨어에만 의존 — module-lms-5의 `assertClassroomWriteAccess()` 교훈이 module-lms-6에는 반영되지 않았던 비일관성 → `lib/supabase/require-admin.ts`의 `requireAdminClient()`로 모든 admin-*.ts의 `createClient()` 호출을 교체, 앱 레벨에서도 관리자 여부를 재검증하도록 통일.
- **(참고, 확인 완료)** `docs/01-plan/features/bara-edu-lms.legal-privacy.md`의 front-matter가 "이메일 익명화 미구현" 등 stale한 상태로 남아있었음(본문은 실제 구현과 이미 일치) → security-officer가 재검토 완료로 갱신.

나머지(회원탈퇴-강의실 데이터 정리, 여러 강좌 동시 진행 시 진도 계산, 수료증 발급 경쟁 상태, proxy.ts 라우트 보호 범위, admin 페이지 간 쿼리파라미터 매칭 등)는 전부 Pass 확인.

**module-lms-7 2차 통합 점검 완료 (2026-08-09)** — 배포(AWS Amplify) 직전 마지막 점검. 1차에서 이월했던 경미한 이슈 2건을 마저 수정하고, qa-reviewer·security-officer에게 2차 점검을 의뢰해 발견된 이슈를 전부 수정했다.

이월 건 수정:
- `getCourseBySlug`가 `status in ('active','upcoming')`를 앱단에서 한 번 더 걸러, RLS(`courses_enrolled_select`)가 이미 허용하는 승인된 학습자·관리자까지 closed 강좌에서 404를 보고 있었음 → 앱단 필터 제거, RLS에 판단을 위임(`getPublicCourses` 목록 쿼리는 그대로 유지 — 목록에는 closed가 여전히 안 보여야 함).
- `admin-cms.ts`의 `createNewVersion` 실패 시 `/admin/cms`(목록)로 보내 편집 중이던 문서를 찾을 수 없었음 → 편집 중이던 문서(`/admin/cms/{id}/edit`)로 되돌리고 에러 배너 추가.

2차 qa-reviewer 점검(치명적 1건 + 경미 2건, 전부 수정):
- **(치명적급)** `applyToCourse`의 커밋 write(insert/update)가 에러와 "0행 갱신"(RLS `enrollments_self_reapply` 조건 불일치로 인한 경쟁)을 확인하지 않고 무조건 성공 화면으로 리다이렉트 — 더블클릭 등으로 신청이 실패해도 사용자에게는 성공처럼 보였음 → 결과를 확인해 실패/경쟁 시 `?error=conflict`로 명시적 처리.
- 재신청 시 `rejection_reason`이 초기화되지 않고 남아있던 DB 위생 문제 수정.
- 어디서도 쓰이지 않는 죽은 함수 `hasActiveEnrollment()`(1차에서 `hasIncompleteApprovedEnrollment()`로 대체됨) 제거.

2차 security-officer 점검(개선 권장 2건 수정, 1건은 배포 후 실측 확인 필요, 1건은 PM 확인 필요):
- **(수정)** 회원탈퇴(`withdraw()`) 후에도 `enrollments.status`가 `approved`로 남고, RLS/RPC 어디에도 `profiles.status='active'` 검증이 없어 — refresh token만 무효화될 뿐 아직 만료 전인 access_token을 들고 있으면 탈퇴 직후에도 강의실/퀴즈/수료증 발급에 접근하거나 방금 삭제된 학습기록을 되살릴 수 있는 잔여 접근 창이 있었음(개인정보보호법 "지체없이 파기" 취지와 상충 소지) → `is_active_learner()` 헬퍼 신설, `courses_enrolled_select`/`lessons_enrolled_select`/`progress_self_all`/`quiz_submissions_self_all`/`assignment_submissions_self_insert` 정책과 `get_quiz_for_lesson`/`submit_quiz_attempt`/`issue_certificate_self` RPC 전부에 적용.
- **(수정)** `(admin)/layout.tsx`가 proxy.ts 미들웨어의 role 검증에만 의존하고 자체 재검증이 없어, admin 서버 액션들에 적용한 방어-심층 원칙(`requireAdminClient()`)과 불일치 → layout에서도 `profiles.role`을 재확인하도록 추가.
- **(수정, 기능 견고성)** `set_quiz_correct_option`에서 `p_option_id`가 `p_question_id` 소속이 아니면 두 번째 update가 조용히 0행 적용되어 정답 0개인 문항이 만들어질 수 있었음 → 0행이면 명시적으로 예외 발생.
- **(배포 후 실측 필요)** AWS Amplify가 `proxy.ts`를 모든 요청에서 실제로 실행하는지는 코드 리뷰만으로 보장 불가 — 배포 후 비로그인/일반회원/탈퇴회원 계정으로 `/admin`·`/my`·`/learn` 접근 스모크 테스트 필요.
- **(PM 확인 필요)** 루트 `/`의 Coming Soon 폼이 이메일을 클라이언트에서 직접 무인증 Apps Script 엔드포인트로 전송하는데, 수집 목적/처리방침 고지가 화면에 없음 — 정식 오픈 후에도 유지할 채널인지, 유지한다면 고지 문구를 추가할지 별도 확인 필요.

스키마 변경: `is_active_learner()` 함수 신규, 위 정책 5개 + RPC 3개에 적용, `set_quiz_correct_option` 예외처리 보강 — 사용자가 Supabase SQL 편집기에서 `supabase/schema.sql` 재실행 완료(2026-08-09).

**module-lms-7 배포 완료 + 스모크 테스트 통과 (2026-08-09)** — module-lms-1~7 전체를 최초로 커밋(그 전까지 전부 uncommitted 상태였음)하고 AWS Amplify Hosting에 배포(`https://bara-edu.kr`). 배포 설정: `amplify.yml`(Next.js SSR 표준 빌드스펙), `.env.example`(값 없이 키 목록만, git에 커밋됨), `package.json`의 `engines.node: ">=20"`. `.bkit/`(로컬 도구 런타임 상태)는 `.gitignore`에 추가해 커밋 제외, `.claude/agents/`(README에 문서화된 프로젝트 전용 에이전트 정의)는 포함.

첫 배포 시도에서 빌드 실패 1건 발생 후 즉시 수정: `app/(auth)/reset-password/page.tsx`가 정적 프리렌더링 대상이었는데, 내부 `ResetPasswordForm`(URL 해시 기반 세션 처리, client-only 플로우)의 `createBrowserClient()`가 빌드 시점 서버 렌더링에서도 실행돼, 그 시점에 Amplify 환경변수가 아직 없어 이 페이지 하나 때문에 전체 빌드가 실패했음 → `export const dynamic = 'force-dynamic'` 추가로 해결(환경변수 누락 시에도 다른 페이지 빌드까지 함께 죽는 일이 없도록).

배포 후 스모크 테스트(security-officer가 배포 승인 조건으로 건 항목) 전부 통과:
- 비로그인 상태로 `/admin`·`/my`·`/learn/[courseId]` 접근 → 전부 `/sign-in?redirect=...`로 307 리다이렉트(curl로 직접 확인) → Amplify가 `proxy.ts` 미들웨어를 실제로 실행하고 있음을 확인.
- 일반회원 계정으로 `/admin` 접근 시 `/`로 리다이렉트, 탈퇴회원 계정으로 `/my` 접근 시 강제 로그아웃 — 사용자가 실제 계정으로 직접 확인, 둘 다 의도대로 동작.
- 루트 `/`는 `NEXT_PUBLIC_IS_OPEN=false` 그대로라 Coming Soon 화면이 정상 노출 중(실제 "동시 오픈"은 이 값을 `true`로 바꾸는 별도 단계로 아직 미착수).

미해결로 남은 PM 판단 사항: Coming Soon 폼의 이메일 수집 목적/처리방침 고지 필요 여부(정식 오픈 후에도 유지할 채널인지 확인 필요).

수료증은 DB 레코드로만 존재하며 PDF/파일 생성 파이프라인은 없다(module-lms-6 "재발급"과 동일한 경계, 향후 별도 모듈 검토).

security-officer 점검(1차 No-Go → 수정 후 반영)과 qa-reviewer 점검(조건부 Pass → 개선사항 반영)을 모두 거쳤다:
- `is_admin()` 함수에 `search_path` 고정(SECURITY DEFINER 함수의 고전적 hijacking 패턴 방지).
- `protect_profile_privileged_columns` 트리거가 이제 `email`도 보호(비관리자의 자유로운 이메일 변조로 관리자 검색 결과를 오염시키는 경로 차단) — 단 `withdraw()`의 active→withdrawn 전환에서 이메일을 익명화하는 것은 계속 허용.
- `withdraw()`에 전역 로그아웃(`admin.auth.admin.signOut(accessToken, 'global')`) 추가 — 탈퇴 후에도 다른 기기 세션이 남아있던 문제 해결.
- `/courses/[slug]/apply`(proxy.ts의 탈퇴계정 강제로그아웃 대상이 아닌 (public) 라우트)의 `applyToCourse`에 `profiles.status='active'` 방어 체크 추가.
- `getAdminMembers` 검색어의 PostgREST `.or()` 필터 인젝션 방지(`,()` 제거).
- CMS `createNewVersion`이 `type`을 클라이언트 hidden input이 아니라 DB에서 재조회하도록 변경(위변조로 같은 slug에 다른 종류 문서가 섞이는 것 방지). `createLegalDocument`에도 slug 서버 검증 추가.
- 대시보드 "신규 신청(오늘)" 지표가 `status='pending'`까지 걸러 관리자가 처리할수록 줄어드는 역설이 있었음 → 상태 무관 "오늘 생성" 집계로 수정.

사용자가 관리자 계정으로 7화면 전체 및 실제 신청→승인/반려 플로우를 직접 테스트해 정상 동작을 확인했다(2026-08-08).

---

## 4. UI/UX Design (Figma-First)

### 4.0 디자인 토큰 (YLIA_UX_Pattern_Guide.html 이식 — TBD 아님)

| 카테고리 | 토큰 | 값 |
|---|---|---|
| Primary | `--indigo` | `#3C1E87` |
| Accent | `--pink` | `#E11E87` |
| Info | `--sky` | `#4BC3F0` |
| Success | `--success` | `#1DA463` |
| Warning | `--warning` | `#F0963C` |
| Danger | `--danger` | `#E14B3C` |
| Neutral | `--n-0~9` | `#FFFFFF ~ #17171C` |
| Spacing | `--sp-1~16` | `4px ~ 64px` |
| Radius | `--r-xs~pill` | `4px, 10px, 14px, 20px, 999px` |
| Shadow | `--shadow-sm/md/lg` | 가이드 원본값 그대로 |
| Font | Pretendard | 가이드 원본 스택 그대로 |

다크모드는 가이드의 `html.dark` 오버라이드를 그대로 따른다.

### 4.0b Figma 화면 기준(Viewport) — 페이지별 명시

> 2026-08-02: "Admin은 PC인데 USER는 모바일이야 PC야?"라는 질문이 나온 뒤, 페이지마다 기준이 암묵적이라 헷갈리는 문제를 발견해 아래에 명시한다. Figma 프레임 이름에도 폭(px)을 표기해뒀다.

| 영역 | 기준 | 이유 |
|---|---|---|
| **Admin (전체)** | **PC 전용, 1280px 고정** | YLIA "운영 콘솔" archetype — 데스크톱 우선, 최소 지원폭 1280px, 반응형 최소화(design.md 1.1) |
| **USER — 회원가입/로그인(01), 강좌목록(02a), 강좌상세(02), 마이페이지(03)** | **모바일(390) + PC(1200) 둘 다 존재** | 2026-08-04: "PC로 보는 사람은?" 질문 이후 4개 화면 모두 PC 버전(`-pc` 프레임) 추가. 모바일이 1차 기준(plan.md "웹/모바일 반응형"), PC는 콘텐츠 폭 1200px에 센터 정렬(01 인증카드), 3열 그리드(02a), 2단+Sticky ApplyBox(02), 2열 카드(03) |
| **USER — 강의실(04)** | **390px(모바일, 커리큘럼 접기/펼치기) + 800px(PC/태블릿, 좌우 2단) 둘 다 존재** | 사이드바+영상 2단 레이아웃이 모바일에 그대로 안 맞아 두 기준을 모두 만듦. 모바일은 "04a-mobile" 프레임(접힘/펼침 상태), PC/태블릿은 기존 "04" 프레임 |
| **USER — 퀴즈(04b)/과제(04c) 패널** | **420px** | 강의실 내 서브 패널로, 모바일 강의실(390) 안에 삽입될 때는 폭을 390에 맞춰 축소 적용 (구현 시 반응형 처리) |
| **USER — 약관페이지(02b), 404(12)** | **모바일(390)만 존재** | 콘텐츠가 단순(텍스트 위주)해서 반응형 코드로 처리해도 레이아웃 리스크가 낮음 — PC 버전 별도 제작 보류 |

**PC 우선 데스크톱 폭이 필요한 화면(Admin)과 모바일 우선 폭이 필요한 화면(USER)이 한 파일에 섞여 있으니, 개발 시 반드시 위 표를 기준으로 삼는다** — Figma 프레임의 실제 px 폭이 아니라 이 표의 "기준"이 우선한다.

### 4.1 페이지별 레이아웃 (텍스트 와이어프레임)

#### 회원가입 (`/sign-up`) — 패턴: 폼 기본 구조 + 유효성 검사
```
┌────────────────────────────────┐
│  바라 평생교육원 로고             │
│  이름 *  [______]               │
│  이메일 * [______]               │
│  비밀번호 * [______] (8자 이상)   │
│  연락처  [______]               │
│  [가입하기]                     │
│  이미 계정이 있으신가요? 로그인   │
└────────────────────────────────┘
```

#### 강좌 상세 → 신청/입금 안내 — 패턴: 상세 화면 기본 구조 + 확인 다이얼로그
```
┌────────────────────────────────┐
│ [썸네일] 카테고리 Badge  상태 Badge│
│ 강좌명(H1) / 강사 / 일정 / 수강료  │
│ [수강 신청하기] (정원마감 시 비활성)│
├────────────────────────────────┤
│ (신청 확인 모달)                 │
│  강좌명·기간·수강료 요약          │
│  [신청 확정] [취소]              │
├────────────────────────────────┤
│ (입금 안내 화면)                 │
│  계좌번호 [복사] · 입금자명: OOO  │
│  입금 기한: 신청일+3일            │
│  상태: 입금 대기 중               │
└────────────────────────────────┘
```

#### 마이페이지 (`/my`) — 패턴: 상세 화면 기본 구조(탭)
```
┌────────────────────────────────┐
│ [탭: 신청내역 | 수강중 | 완료 | 수료증] │
│ 신청내역: 강좌명 / 상태배지(대기·승인·반려) │
│ 수강중: 강좌명 / 진도율 바 / [강의실 입장] │
│ 수료증: 발급일 / [다운로드]        │
└────────────────────────────────┘
```

#### 강의실 (`/learn/[courseId]`) — 패턴: 단계형 진행 표시
```
┌───────────┬────────────────────┐
│ 커리큘럼   │ 강의 N: 제목         │
│  1강 ✓    │ [영상 임베드]        │
│  2강 ▶    │ [학습 완료로 표시]    │
│  3강      │ (퀴즈/과제 있으면 하단 노출) │
│ 진도 40%  │                     │
└───────────┴────────────────────┘
```

#### Admin 대시보드 — 패턴: 관리자 콘솔 레이아웃 Type2(상단 GNB+검색 / 좌측 메뉴)
```
┌──────────────────────────────────────┐
│ [로고] [검색]              [운영자 계정] │
├──────────┬────────────────────────────┤
│ 대시보드  │ [신규신청][입금대기][오늘승인][수료임박] │
│ 강좌관리  │  각 카드 클릭 → 해당 목록          │
│ 회원관리  │                                  │
│ 신청·입금 │                                  │
│ 수료관리  │                                  │
└──────────┴────────────────────────────────┘
```

#### Admin 신청·입금 관리 — 패턴: 목록 테이블 + 확인 다이얼로그 + 토스트
```
┌──────────────────────────────────────┐
│ [상태필터: 전체|대기|승인|반려] [검색]    │
│ 이름 | 강좌명 | 신청일 | 상태 | 액션      │
│ 홍길동 | 웹디자인 | 08-01 | 대기 | [승인][반려] │
├──────────────────────────────────────┤
│ (승인 클릭 시) "입금을 확인했나요?" 확인 다이얼로그 │
│ (처리 후) 토스트 "승인 처리되었습니다"     │
└──────────────────────────────────────┘
```

### 4.2 User Flow (요약 — 상세는 flows.md)
```
가입/로그인 → 강좌 탐색 → 신청 → 무통장입금 → (Admin 승인) → 강의실 학습
   → 퀴즈/과제 → 진도 100% → 수료증 발급
```

### 4.3 Component List
| 컴포넌트 | 위치 | 역할 | 참고 패턴 |
|---|---|---|---|
| AuthForm | `components/auth/` | 가입/로그인 공용 폼 | 폼 기본 구조 |
| EnrollmentCard | `components/enrollment/` | 신청 상태별 카드 | 상세 화면 기본 구조 |
| PaymentGuide | `components/enrollment/` | 무통장입금 안내 | — (커스텀) |
| LessonPlayer | `components/classroom/` | 영상 임베드 + 완료 체크 | — (커스텀) |
| ProgressBar | `components/classroom/` | 진도율 표시 | — (uipro-cli 기반) |
| QuizForm | `components/classroom/` | 객관식 퀴즈 | 폼 기본 구조 |
| AssignmentForm | `components/classroom/` | 과제 제출 | 파일 업로드, 저장·임시저장 |
| CertificateCard | `components/mypage/` | 수료증 표시/다운로드 | — (커스텀) |
| AdminSidebar | `components/admin/` | 좌측 3Depth 메뉴 | 관리자 콘솔 레이아웃 |
| AdminDataTable | `components/admin/` | 공용 목록 테이블 | 목록 테이블 기본 동작 |
| ConfirmDialog | `components/ui/` | 승인/반려/삭제 확인 | 확인·경고 다이얼로그 |
| Toast | `components/ui/` | 처리 결과 알림 | 토스트·알림 |

### 4.4 Page UI Checklist (핵심 화면만 발췌)

**신청/입금 안내**
- [ ] 정원 마감 시 신청 버튼 비활성화 + 안내 문구
- [ ] 입금 계좌 복사 버튼, 입금 기한(3일) 표시
- [ ] 상태 배지: 대기/승인/반려/만료

**강의실**
- [ ] 미승인 상태 접근 차단 + 안내
- [ ] 커리큘럼은 자유 순서(잠금 없음)
- [ ] [학습 완료로 표시] 버튼 — 자동 완료 아님

**Admin 신청·입금 관리**
- [ ] 승인/반려 액션에 확인 다이얼로그
- [ ] 반려 시 사유 입력 필수
- [ ] 동시 처리 시 "이미 처리됨" 안내

---

## 4.5 홈(Home) 화면 설계 (2026-08-10 추가 — Figma F1~F8 대응)

> **입력 문서**: `docs/01-plan/features/bara-edu-lms.home.md` (PO 3~9절 + service-planner 부록 10~14절)
> **성격**: 위 문서에 존재하지 않던 "루트 `/` 정식 홈 화면"을 처음으로 화면 스펙화한다. 실제 Figma 파일(`H141QVdsrLybIakYlIZVXB`)에는 아직 이 화면들이 없다 — 이 세션에는 Figma 도구 접근 권한이 없어 **텍스트 와이어프레임 + 컴포넌트 매핑 표**로 F1~F8을 갈음하며, 실제 Figma 프레임 추가는 후속 작업으로 남긴다(4.5.11-5).
> **원칙**: 신규 컴포넌트 최소화 — `/courses`의 카드·배지·칩 마크업은 새 화면에 맞춰 다시 그리지 않고 **공유 컴포넌트로 추출**해 두 화면이 항상 같은 모습을 갖도록 한다. 진짜 신규인 것(히어로, 신청방법 스텝, 브랜드소개, 문의, Footer)만 새로 설계한다.

### 4.5.0 Figma 게이트 체크리스트 (Home 추가분)

| 단계 | 내용 | 상태 |
|---|---|---|
| F1 | Figma 파일 생성 + 팀 공유 | 기존 파일(`H141QVdsrLybIakYlIZVXB`) 재사용 — 신규 파일 불필요 |
| F2 | 디자인 토큰 정의 | ✅ 기존 4.0 토큰 그대로 적용, Home 전용 신규 토큰 없음(4.5.3의 타이포 스케일은 토큰이 아니라 Home 섹션 한정 컴포넌트 값) |
| F3~F6 | Coming Soon / 홈 / 강좌 목록 / 강좌 상세 와이어프레임 | ✅ 홈은 본 문서 4.5.3~4.5.8. Coming Soon은 변경 없음(그대로 롤백용 유지). 강좌 목록/상세는 기존 F4 완료분을 그대로 쓰되 카드·배지·칩만 공유 컴포넌트로 추출(4.5.9) |
| F7 | 모바일 반응형 레이아웃 정의 | ✅ 4.5.2 |
| F8 | 카피라이팅 — ux-writer 검수 완료 확인 | **미완료** — `bara-edu-lms.home.md` 12절 카피는 service-planner 초안이며 아직 ux-writer 정식 검수를 거치지 않았다. F9(PO 승인) 전 ux-writer 확인 필요 |

> F9(PO 승인)는 product-manager, 실제 Figma 파일에 이 프레임들을 반영하는 작업 및 F10 Dev Mode 링크 등록은 developer 담당 — 이번 산출물은 그 전 단계 입력값이다.

### 4.5.1 섹션 구성 및 컴포넌트 매핑

| 순서 | 섹션 | 우선순위 | 코드 컴포넌트(제안 경로) | 신규/재사용 |
|:---:|---|:---:|---|:---:|
| — | AppHeader | Must | `components/layout/AppHeader.tsx` | 재사용(변경 없음) |
| 1 | 히어로 `#hero` | Must | `components/home/HeroBanner.tsx` | **신규** |
| 2 | 카테고리 바로가기 `#categories` | Must | `components/home/CategorySection.tsx` + `components/courses/FilterChip.tsx` | 섹션 래퍼 신규 + FilterChip은 `/courses`에서 **추출·공유**(4.5.9) |
| 3 | 강좌 섹션 `#courses` | Must | `components/home/CourseSection.tsx` + `components/courses/CourseCard.tsx` + `components/courses/Badge.tsx` | 섹션 래퍼 신규 + CourseCard·Badge는 `/courses`에서 **추출·공유**(4.5.9) |
| 4 | 신청 방법 `#apply-guide` | Must | `components/home/ApplyGuideSection.tsx` | **신규** |
| 5 | 브랜드 소개 `#about` | Should(생략 가능) | `components/home/BrandIntroSection.tsx` | **신규** |
| 6 | 문의 `#contact` | Should(생략 가능) | `components/home/ContactSection.tsx` | **신규** |
| — | Footer | Must | `components/layout/Footer.tsx` | **전면 재설계**(기존 파일 교체, 4.5.8) |

`app/(public)/page.tsx`(4.5.1a 참고)가 이 섹션 컴포넌트를 순서대로 배치하는 조립 페이지가 된다.

**4.5.1a 라우팅 전제(디자인 결정에 영향을 주므로 명시)**: H-M1은 "홈도 `(public)` 레이아웃과 동일한 AppHeader를 쓴다"고 규정한다. 현재 `app/page.tsx`는 `(public)` 라우트 그룹 **밖**에 있어 이 레이아웃을 상속받지 못한다(design.md 발견사항 #4, 위 module-lms 이력 참고). 이 스펙은 **`app/page.tsx`를 `app/(public)/page.tsx`로 이동**하는 것을 전제로 설계했다 — 그래야 AppHeader 전환과 Footer 전역 적용(4.5.8)이 코드 중복 없이 성립한다. 라우트 이동 자체는 developer 작업이지만, 이 전제가 깨지면 4.5.8의 Footer 배치 표도 다시 짜야 하므로 여기 명시해 둔다.

### 4.5.2 반응형 레이아웃 기준

| 구간 | 폭 | Tailwind 접두사 | 비고 |
|---|---|---|---|
| 모바일 | 360~767px | (기본, 접두사 없음) | 1열 스택 기본값. 360px에서 잘림 없이 렌더 확인 |
| 태블릿 | 768~1023px | `md:` | 카테고리/강좌 그리드 2열, 신청방법 2×2 |
| 데스크톱 | 1024px~ | `lg:` | 강좌 그리드 3열, 신청방법 4열, 콘텐츠 폭 1200px 고정 |

공통 컨테이너: `mx-auto max-w-[1200px] px-5 md:px-6`(히어로·Footer는 예외 — 각 절 참고). 섹션 세로 여백: `py-14 md:py-20`(히어로 제외, 4.5.3에 별도 규정).

**배경색 교차(zebra) 규칙**: 히어로(인디고) → 카테고리(흰색 `bg-n-0`) → 강좌(연회색 `bg-n-1`) → 신청방법(흰색) → 브랜드소개(연회색, Should) → 문의(흰색, Should) → Footer(흰색+상단 보더). 스크롤 중 배경색이 바뀌는 지점이 곧 섹션 경계라, 시니어 사용자가 "다음 주제로 넘어갔다"를 이미지 없이도 인지할 수 있다 — 이미지 없는 히어로/섹션 구성에서 시각적 리듬을 만드는 핵심 장치다.

### 4.5.3 히어로 섹션 상세 (`#hero`, 타이포그래피 전용)

**핵심 행동**: [강좌 둘러보기] 클릭 → `/courses` (이 화면에서 사용자가 해야 할 단 하나의 행동)

배경 이미지가 없으므로(Q3 확정) 브랜드 컬러 색면 + 타이포그래피 위계만으로 첫인상의 무게감을 만든다.

```
[모바일 375px]                       [데스크톱 1200px+]
┌───────────────────────┐            ┌──────────────────────────────────────┐
│(인디고 #3C1E87 풀블리드)│            │(인디고 풀블리드, 내부 텍스트는 880px 중앙정렬)│
│                       │            │                                        │
│   배움으로 새로운       │            │        배움으로 새로운 나를              │
│   나를 창조합니다       │            │           창조합니다                    │
│   (28px, extrabold,   │            │      (52px, extrabold, 흰색)            │
│    흰색, 중앙정렬)      │            │                                        │
│                       │            │  바라 평생교육원은 IT·디지털, 외국어,      │
│  바라 평생교육원은...   │            │  자격증, 직무역량, 취미·교양 등 다양한     │
│  (16px, n-2, 중앙,     │            │  강좌를 온라인으로 배울 수 있는 곳입니다.   │
│   최대폭 560px)        │            │        (18px, n-2, 최대폭 560px)         │
│                       │            │                                        │
│ [강좌 둘러보기]         │            │   [강좌 둘러보기]   [회원가입]           │
│ (핑크 필, 풀와이드)     │            │   (핑크 필, 인라인)  (아웃라인, 인라인)    │
│ [회원가입]             │            │                                        │
│ (아웃라인, 풀와이드)    │            │                                        │
└───────────────────────┘            └──────────────────────────────────────┘
```

| 요소 | 클래스(Tailwind, 그대로 구현 가능) | 근거 |
|---|---|---|
| 섹션 래퍼 | `bg-indigo` 풀블리드(`w-full`, `max-w` 없음), 내부 `mx-auto max-w-[880px] px-5 py-16 md:py-24 lg:py-28 flex flex-col items-center text-center gap-6 md:gap-8` | 텍스트 컨테이너는 1200px가 아니라 880px로 좁혀 가독성 확보(한 줄 길이가 과도하게 길어지는 것 방지) |
| 슬로건(H1) | `text-[28px] md:text-[40px] lg:text-[52px] font-extrabold leading-[1.25] text-n-0` | 사이트 전체에서 가장 큰 타이포 — 이미지 없는 히어로의 시각적 임팩트를 텍스트 크기·굵기로 대체 |
| 설명문 | `text-[16px] md:text-[17px] lg:text-[18px] leading-[1.7] text-n-2 max-w-[560px]` | H-M10 "본문 16px 이상" 충족(모바일 기준부터 16px, 더 줄이지 않음) |
| CTA 컨테이너 | `flex flex-col sm:flex-row gap-3 sm:gap-4 w-full sm:w-auto` | 모바일은 세로 풀와이드 스택(터치 영역 최대화), 640px 이상부터 가로 배치 |
| 주 CTA `[강좌 둘러보기]` | `inline-flex h-[52px] w-full sm:w-auto items-center justify-center rounded-pill bg-pink px-8 text-[18px] font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white` | **접근성 근거**: `bg-pink`+흰 텍스트 조합은 대비비 약 4.43:1로 WCAG AA 일반 텍스트 기준(4.5:1)을 근소하게 밑돈다. 텍스트를 18px+`font-bold`로 키우면 "큰 텍스트" 기준(3:1)이 적용돼 안전하게 통과한다 — 단순 강조가 아니라 접근성 요건이다 |
| 보조 CTA(비로그인) `[회원가입]` | `inline-flex h-[52px] w-full sm:w-auto items-center justify-center rounded-pill border-2 border-n-0/70 px-8 text-[16px] font-semibold text-n-0 hover:bg-n-0/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white` | 흰 텍스트/인디고 배경 대비 13:1 이상 — 폰트 크기 제약 없음 |
| 보조 CTA(로그인) `[내 강의실로 이동]` | 위와 동일 클래스, `href="/my"` | 11.1 상태표 그대로 |

**세션 분기**: `app/(public)/page.tsx`(서버 컴포넌트)가 `supabase.auth.getUser()`로 로그인 여부를 조회해 `HeroBanner`에 `isLoggedIn` prop으로 전달한다(home.md 11.1 참고, 세션 조회 실패 시 비로그인으로 폴백).

### 4.5.4 카테고리 바로가기 섹션 (`#categories`)

**핵심 행동**: 관심 분야 칩 클릭 → `/courses?category=<id>`

```
┌─────────────────────────────────────────┐
│              분야별로 살펴보기               │  h2, 22/28px bold, 중앙
│   관심 있는 분야를 선택하면...               │  16px, n-6, 중앙
│                                           │
│   [IT·디지털] [외국어] [자격증] [직무역량]   │  FilterChip 재사용(active 없음)
│   [취미·교양] [정부지원]  ...(줄바꿈 허용)   │
└─────────────────────────────────────────┘
```

| 항목 | 내용 |
|---|---|
| 데이터 | `getActiveCategoryTree()` → `depth === 1` 필터(이미 활성 필터링됨, 추가 필터 불필요) |
| 레이아웃 | `mt-8 flex flex-wrap justify-center gap-2 md:gap-3 max-w-[900px] mx-auto` |
| 칩 컴포넌트 | `components/courses/FilterChip.tsx`(4.5.9 추출) — `active` prop을 **optional(기본 false)**로 변경해 그대로 재사용. Home에서는 항상 `active` 생략(현재 페이지가 필터링 상태를 갖지 않으므로) |
| 빈 상태(활성 카테고리 0개) | 섹션 자체를 렌더링하지 않음(`return null`) — home.md 11.2 그대로 |
| 터치 영역 | 칩 1개당 실측 높이 약 34~36px(기존 `py-1.5` 유지) — WCAG 2.2 SC 2.5.8(최소 24×24px) 충족. 44px 권장치(AAA)에는 못 미치지만 `gap-2` 이상 간격으로 오탭 위험은 낮음 |

### 4.5.5 강좌 섹션 (`#courses`)

**핵심 행동**: 강좌 카드 클릭 → `/courses/[slug]` (1클릭 상세 도달)

```
[모바일]                    [태블릿 md]              [데스크톱 lg]
┌──────────┐                ┌────┬────┐              ┌────┬────┬────┐
│ 지금 개설된 강좌 (h2)                                                  │
│ 최근에 열린 강좌부터...(부제)                                          │
├──────────┤                ├────┼────┤              ├────┼────┼────┤
│ [카드1]  │                │[1] │[2] │              │[1] │[2] │[3] │
├──────────┤                ├────┼────┤              ├────┼────┼────┤
│ [카드2]  │                │[3] │[4] │              │[4] │[5] │[6] │
│  ...최대6│                │[5] │[6] │              └────┴────┴────┘
└──────────┘                └────┴────┘
      [전체 강좌 보기] (중앙, 1건 이상일 때만)
```

| 항목 | 내용 |
|---|---|
| 데이터 | `getPublicCourses()`(정렬 `created_at desc`).slice(0, 6) + `getApprovedSeatsTaken(ids)` — 신규 쿼리 없음 |
| 그리드 | `mt-8 md:mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3` — `/courses`와 **완전히 동일한 클래스**. 1~5건일 때 그리드 잔여 칸이 비는 것은 허용(더미 카드 삽입 금지, home.md 11.3 그대로) |
| 카드 컴포넌트 | `components/courses/CourseCard.tsx`(4.5.9 추출), props `{ course, categoryName, isFull }` |
| 빈 상태(0건) | 그리드 대신 `mt-16 text-center text-[16px] text-n-6` "강좌를 준비하고 있어요. 곧 새로운 소식으로 찾아뵐게요." + `[전체 강좌 보기]` 버튼 숨김(home.md 11.3 그대로). 단 본문 크기를 `/courses`의 동일 문구(13px)보다 키운 16px로 지정했다 — 이 섹션에서는 그리드를 대체하는 유일한 본문 내용이라 H-M10 "본문 16px" 대상으로 판단했다. `/courses`의 13px 빈 상태 문구도 같은 기준으로 올릴지는 이번 범위 밖이라 4.5.11에 확인 질문으로 남긴다 |
| `[전체 강좌 보기]` | `mt-10 flex justify-center` 안에 `inline-flex h-11 items-center justify-center rounded-pill border border-n-3 px-6 text-[14px] font-semibold text-indigo hover:border-indigo` — **핑크가 아니라 인디고**를 썼다. 이 화면의 최우선 CTA(핑크)는 히어로의 [강좌 둘러보기] 하나로 한정하고, 보조 탐색 액션은 인디고로 구분한다(핑크+흰 텍스트 조합은 작은 폰트에서 대비비 이슈가 있어 보조 버튼에는 아예 쓰지 않는 게 안전하다 — 4.5.3과 동일 논리) |

### 4.5.6 신청 방법 섹션 (`#apply-guide`)

**핵심 행동**: 이 섹션 자체엔 클릭 행동이 없다(안내 전용) — 목적은 "신청→입금→수강까지 절차를 미리 이해시켜 시니어·초행 방문자의 이탈을 막는 것".

```
[모바일: 1열 스택]              [데스크톱 lg: 4열 1행]
┌─────────────┐                ┌─────┬─────┬─────┬─────┐
│  신청 방법 (h2)               │  ①  │  ②  │  ③  │  ④  │
│  회원가입부터...(부제)         │회원가입│강좌신청│무통장 │운영자 │
├─────────────┤                │      │      │입금  │승인  │
│ ① 회원가입    │                └─────┴─────┴─────┴─────┘
├─────────────┤
│ ② 강좌 신청   │
├─────────────┤
│ ③ 무통장입금  │
├─────────────┤
│ ④ 운영자 승인 │
└─────────────┘
```

| 항목 | 내용 |
|---|---|
| 그리드 | `mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-4` |
| 카드 | `flex flex-col gap-3 rounded-lg bg-n-1 p-6`(테두리 없이 연회색 채움 — 흰 배경+테두리인 강좌 카드와 시각적으로 구분되게) |
| 번호 배지 | `flex h-9 w-9 items-center justify-center rounded-full bg-indigo text-[15px] font-bold text-n-0` 안에 순수 숫자 `1`~`4`(이모지·원문자 유니코드 대신 실제 숫자 텍스트 + 도형 배경 — design.md "아이콘 원칙"과 일관) |
| 스텝 제목 | `text-[17px] md:text-[18px] font-semibold text-n-9` (`<h3>`) |
| 스텝 설명 | `text-[16px] leading-[1.6] text-n-7` — home.md 12.2 카피 그대로, 문구 변경 금지(flows.md Q2와 1:1 일치해야 함) |
| 앵커 | 섹션 최상위 요소에 `id="apply-guide"` — 헤더 "신청방법" 링크(`/#apply-guide`)의 철자와 정확히 일치해야 함(home.md 11.4) |
| 보조 링크(선택) | 그리드 하단 중앙 `mt-8 text-center`에 `text-[14px] font-medium text-indigo underline` "강좌 보러가기" → `/courses`. **선택 사항**(home.md 11.4) — 넣을 경우 이 스펙 그대로, 넣지 않아도 무방 |

### 4.5.7 브랜드 소개(`#about`) / 문의(`#contact`) — Should, 생략 가능

두 섹션 모두 개발 일정이 부족하면 이번 릴리스에서 생략 가능(DoD 영향 없음, home.md 10.1). 넣기로 했다면 아래 그대로 구현한다.

```
┌───────────────────────────┐   ┌───────────────────────────┐
│   바라(בָּרָא)를 소개합니다     │   │        문의하기            │
│  (h2, 20/24px bold, 중앙)   │   │  (h2, 20/24px bold, 중앙)   │
│                           │   │                           │
│ 바라(בָּרָא)는 히브리어로...   │   │ 강좌나 신청 방법이...       │
│ 바라 평생교육원은...          │   │ (16px, n-7, 중앙)          │
│ 나이와 경험에 상관없이...     │   │                           │
│ (각 줄 16~17px, 중앙, gap-3) │   │ [전화 문의 010-9025-5093]   │
│                           │   │ [이메일 문의]               │
│                           │   │ (아웃라인 pill, 모바일 스택)  │
└───────────────────────────┘   └───────────────────────────┘
```

| 항목 | 내용 |
|---|---|
| 브랜드소개 컨테이너 | `mx-auto max-w-[600px] px-5 py-14 md:py-20 flex flex-col items-center text-center gap-6` |
| 제목 | `text-[20px] md:text-[24px] font-bold text-n-9`(`<h2>`). 히브리어 부분은 `<span dir="rtl" lang="he">בָּרָא</span>`로 감싸 스크린리더가 올바른 언어로 읽도록 함(제목·본문 첫 줄 모두 적용) |
| 본문 3줄 | `flex flex-col gap-3`, 각 `<p className="text-[16px] md:text-[17px] leading-[1.8] text-n-7">` — home.md 12.3 문구 그대로, 3줄 각각 별도 `<p>` |
| 문의 컨테이너 | `mx-auto max-w-[600px] px-5 py-14 md:py-20 flex flex-col items-center text-center gap-6` |
| 문의 버튼 | `flex flex-col sm:flex-row gap-3`, 각 `inline-flex h-12 items-center justify-center rounded-pill border border-n-3 px-6 text-[15px] font-medium text-n-7 hover:border-indigo hover:text-indigo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo`, `href="tel:01090255093"` / `href="mailto:info@ylia.io"` |

### 4.5.8 Footer 재설계 (전 페이지 공통, H-M7·H-M8)

**현재 문제**: `components/layout/Footer.tsx`는 "주식회사 일리아 · ylia.io" 한 줄뿐이고, 그마저 `ComingSoon.tsx`에서만 쓰여 실제 서비스 화면(`/courses`, `/my`, `/sign-in` 등)에는 전자상거래법 표시사항이 한 번도 노출된 적이 없다. 이번에 컴포넌트를 전면 교체한다.

**적용 범위(중요 — 배치 위치)**: Footer는 소비자·학습자가 드나드는 화면 전체(교육·인증형 archetype)에 적용하고, **Admin 콘솔(운영 콘솔 archetype)에는 넣지 않는다** — Admin은 "밀도 우선·장식 최소화"가 원칙이고 운영자는 사업자 정보를 다시 볼 필요가 없다. 구현 위치:

| 라우트 그룹 | Footer 배치 | 비고 |
|---|---|---|
| `app/(public)/layout.tsx` | ✅ 추가(`<main>` 아래) | 홈이 이 그룹으로 이동(4.5.1a)하므로 홈도 자동 적용됨 |
| `app/(auth)/layout.tsx` | ✅ 추가 | 회원가입/로그인 화면도 첫인상 신뢰 요소가 필요 |
| `app/(user)/layout.tsx` | ✅ 추가 | 마이페이지/강의실 |
| `app/(admin)/layout.tsx` | ❌ 추가하지 않음 | 운영 콘솔 archetype 원칙 |
| `components/home/ComingSoon.tsx` | 기존 `<Footer />` 호출 유지(변경 없음) | 새 Footer 컴포넌트로 자동 교체되는 효과 — 현재 Coming Soon 화면도 법정 표시사항이 없던 상태였으므로 이번 재설계로 **부수적으로 함께 해결**된다 |

```
[모바일 375px]                              [데스크톱 1200px+]
┌─────────────────────────┐                ┌──────────────────────────────────────────────────────────────┐
│(상단 보더 1px n-3)         │                │(상단 보더 1px n-3)                                                │
│                         │                │                                                                  │
│ 바라 평생교육원              │                │ 바라 평생교육원 · 운영 주식회사 일리아 · 대표 최종훈   [이용약관] [개인정보처리방침]│
│ · 운영 주식회사 일리아       │                │ 사업자등록번호 832-86-03446 · 통신판매업...                    (우측 정렬)      │
│ · 대표 최종훈               │                │ 주소 경기도 광명시 오리로 362 4층 (창업지원센터)                                │
│                         │                │ 대표전화 010-9025-5093 · 이메일 info@ylia.io                              │
│ 사업자등록번호               │                └──────────────────────────────────────────────────────────────┘
│ 832-86-03446             │
│ · 통신판매업 신고번호        │
│ 제2026-경기광명-0607호       │
│                         │
│ 주소 경기도 광명시           │
│ 오리로 362 4층              │
│ (창업지원센터)               │
│                         │
│ 대표전화 010-9025-5093     │
│ · 이메일 info@ylia.io      │
│                         │
│─ ─ ─ ─ ─ ─ ─ ─ ─ (구분선)  │
│ [이용약관] [개인정보처리방침] │
└─────────────────────────┘
```

| 항목 | 클래스 / 내용 |
|---|---|
| 섹션 래퍼 | `<footer className="w-full border-t border-n-3 bg-n-0">` |
| 내부 컨테이너 | `mx-auto max-w-[1200px] px-5 md:px-6 py-8 md:py-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-10` |
| 사업자정보 블록 | `flex flex-col gap-1.5 text-[13px] leading-[1.7]`, 4줄: ① 상호·운영사·대표 ② 사업자등록번호·통신판매업 신고번호 ③ 주소 ④ 대표전화·이메일 — home.md 12.5 문구 그대로. 줄바꿈은 화면 폭에 자연스럽게 맡김(강제 줄바꿈 태그 없음). (12.5 원문의 `|`는 문서 상 필드 구분 표시일 뿐이며, 실제 화면 렌더링은 기존 Footer 관행(`주식회사 일리아 · ylia.io`)대로 `·` 구분자를 사용했다) |
| 상호 줄 강조 | `<p><span className="text-n-9 font-semibold">바라 평생교육원</span><span className="text-n-6"> · 운영 주식회사 일리아 · 대표 최종훈</span></p>` |
| 등록정보 줄 | `text-n-6`(가장 낮은 시각적 우선순위 — `n-1` 배경 대비 4.87:1, `n-0` 배경 대비 5.2:1로 계산 확인, AA 통과) |
| 주소·연락처 줄 | `text-n-7`(대비비 8.1:1) |
| 전화/이메일 링크 | `<a href="tel:01090255093">`, `<a href="mailto:info@ylia.io">` — `hover:text-indigo hover:underline`. 평문처럼 보이다가 hover/focus 시에만 링크임을 드러내 과도한 장식 없이 클릭 가능성만 확보 |
| 약관 링크 블록 | 모바일: `flex items-center gap-4 border-t border-n-2 pt-4 mt-1`(사업자정보와 시각적으로 분리) / 데스크톱(`lg:`): 구분선 없이 우측 정렬, `lg:border-t-0 lg:pt-0 lg:flex-shrink-0` |
| `[이용약관]` | `text-[13px] text-indigo underline underline-offset-2` |
| `[개인정보처리방침]` | `text-[13px] font-bold text-indigo underline underline-offset-2` — H-M7 요구대로 굵게 강조 |
| 링크 색상 결정 근거 | 두 링크 모두 **핑크가 아니라 인디고**를 썼다. 핑크(#E11E87)는 흰/연회색 배경에서 대비비 약 4.43:1로 WCAG AA(4.5:1)에 근소 미달한다. 인디고는 같은 배경에서 8:1 이상이라 안전하며, "법적 필수 링크"라는 성격상 대비 여유를 더 확보하는 쪽이 맞다고 판단했다 |
| 폰트 크기 예외 처리 | Footer 전체 텍스트가 13px로 H-M10 "본문 16px 이상" 기준보다 작다. Footer는 "읽어야 하는 본문"이 아니라 법정 고지·내비게이션 성격의 **메타 정보**로 분류해 이 규칙의 적용 대상에서 제외했다(배지·헤더 내비와 동일 분류 기준, 4.5.10 참고) |

**데이터 계약(`data/site-config.ts` / `lib/types.ts` 확장 — H-M8과 함께 처리)**: Footer가 하드코딩 없이 단일 출처를 참조하도록 `SiteConfig` 타입에 아래 필드를 추가해야 한다(현재 타입에는 `name/phone/email/address`만 있고 사업자 식별 정보가 없다).

```typescript
export interface SiteConfig {
  name: string;                        // 상호 — '바라 평생교육원' (기존)
  operator: string;                    // 운영사 — '주식회사 일리아' (신규)
  representative: string;              // 대표자 — '최종훈' (신규)
  businessRegistrationNumber: string;  // 사업자등록번호 — '832-86-03446' (신규)
  mailOrderLicenseNumber: string;      // 통신판매업 신고번호 — '제2026-경기광명-0607호' (신규)
  phone: string;                       // '010-9025-5093' — 기존 필드, 더미값(010-0000-0000) 교체 필요(H-M8)
  email: string;                       // 'info@ylia.io' — 기존 필드, 'info@bara-edu.kr' 교체 필요(H-M8, home.md 11.5 신규 발견)
  address: string;                     // '경기도 광명시 오리로 362 4층 (창업지원센터)' — 기존 필드, 더미값('서울특별시') 교체 필요
  kakaoUrl?: string;
  instagramUrl?: string;
  openingDate?: string;
  isOpen: boolean;
}
```

Footer 컴포넌트는 이 값을 props가 아니라 `data/site-config.ts`에서 직접 import해 렌더링한다(현재도 정적 값이라 서버/클라이언트 구분 없이 동작).

### 4.5.9 기존 화면 컴포넌트 추출 계획 (`/courses` → 공유)

`/courses`(`app/(public)/courses/page.tsx`) 안에 인라인 함수로 있던 `Badge`/`FilterChip`과, 강좌 상세 페이지에 별도로 다시 작성돼 있던 배지 마크업을 하나로 합쳐 홈과 공유한다.

| 기존 위치 | 새 위치 | 변경 내용 |
|---|---|---|
| `app/(public)/courses/page.tsx`의 인라인 `Badge` 함수(`tone: 'neutral'\|'info'\|'danger'`) | `components/courses/Badge.tsx`(default export) | `app/(public)/courses/[slug]/page.tsx`가 별도 인라인 마크업으로 갖고 있던 `warning`(개강예정) 톤을 합쳐 `tone: 'neutral'\|'info'\|'warning'\|'danger'` 4종으로 통합. 상세 페이지도 이 컴포넌트로 교체(스타일 값 100% 동일이라 시각적 변화 없음) |
| `app/(public)/courses/page.tsx`의 인라인 `FilterChip` 함수 | `components/courses/FilterChip.tsx`(default export) | `active: boolean` → `active?: boolean`(기본 `false`)로만 시그니처 변경. `/courses`의 기존 호출부는 그대로 동작(항상 `active`를 명시적으로 넘기고 있으므로 무변화) |
| `app/(public)/courses/page.tsx`의 카드 `<Link>` 블록 | `components/courses/CourseCard.tsx`(default export, `{ course, categoryName, isFull }` props) | 마크업·클래스 100% 동일하게 이동. `/courses`와 홈 모두 이 컴포넌트를 쓴다 |

이 세 파일 추출은 **시각적으로 아무것도 바뀌지 않는 리팩터링**이다(warning 톤 통합 제외) — 신규 컴포넌트가 아니라 기존 것을 재사용 가능한 형태로 옮기는 작업이라 "신규 컴포넌트 최소화" 원칙에 부합한다.

### 4.5.10 접근성 · 반응형 체크리스트 (H-M10 대응)

| 요구사항 | 이번 설계에서의 충족 방법 |
|---|---|
| 360~1440px 반응형 | 4.5.2 breakpoint 표. 히어로 텍스트 컨테이너는 `max-w-[880px]`라 1440px에서도 좌우 여백이 과도하게 벌어지지 않음. 강좌/신청방법 그리드는 `max-w-[1200px]` 안에서 열 수만 바뀌므로 1440px에서도 카드 폭이 어색하게 늘어나지 않음 |
| 본문 16px 이상 | **"본문(읽어야 하는 안내 텍스트)"과 "메타 정보(라벨·배지·푸터·내비)"를 구분**해 적용했다: 히어로 설명문(16~18px), 신청방법 스텝 설명(16px), 브랜드소개·문의 본문(16~17px), 강좌 0건 안내문(16px)은 전부 16px 이상. 반대로 카테고리/강좌 카드의 배지·부가정보(11~13px), Footer 법정 고지(13px), AppHeader 내비(12.5px, 기존 컴포넌트 변경 없음)는 메타 정보로 분류해 예외로 뒀다 — 이 분류 기준 자체를 4.5.11에서 PO 확인 항목으로 명시한다 |
| 대비 AA | 신규로 쓰는 색상 조합은 전부 4.5:1(또는 큰 텍스트 3:1) 이상을 계산 확인했다: 히어로 흰 텍스트/인디고 배경(13:1+), Footer `n-7`/`n-6` 텍스트 on `n-0`(8.1:1 / 5.2:1), Footer·강좌섹션 링크는 대비 이슈가 있는 핑크 대신 인디고 사용, 히어로 주 CTA는 핑크+흰텍스트 조합(4.43:1)의 근소 미달을 큰 텍스트 기준(18px bold)으로 우회 |
| 키보드 포커스 | 이번에 신규로 만드는 모든 인터랙티브 요소(CTA 버튼, 카테고리 칩 링크, 강좌 카드 링크, 문의 버튼, Footer 링크)에 `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`를 명시했다(히어로는 흰색, 나머지는 인디고 아웃라인). 기존 컴포넌트(AppHeader, AuthForm 버튼 등)는 이번 범위에서 변경하지 않으며 브라우저 기본 포커스 링에 의존하고 있다는 점을 확인만 해 뒀다(4.5.11) |
| 이미지 alt 텍스트 | 홈 화면에는 **`<img>` 요소가 0개**다(히어로는 타이포+색면, 강좌 카드는 썸네일 필드 자체가 없음, AppHeader는 텍스트 로고). 따라서 이 요구사항은 현재 스코프에서 해당 사항 없음(향후 H-C3 히어로 이미지/썸네일 도입 시 재적용) |
| 시맨틱 구조 | `<h1>`은 히어로 슬로건 1개만 사용, 이후 섹션 제목은 전부 `<h2>`, 신청방법 스텝 제목은 `<h3>`. `<footer>` 랜드마크로 Footer를 감싸 스크린리더 랜드마크 내비게이션이 가능하게 함 |
| 다국어(히브리어) 표기 | 브랜드소개 섹션의 `בָּרָא`는 `dir="rtl" lang="he"`로 감싸 스크린리더가 한국어 중간에 자연스럽게 언어를 전환해 읽도록 함 |

**이번 범위 밖이지만 발견한 기존 이슈(수정하지 않음, 확인만 요청)**:

| 발견 | 위치 | 비고 |
|---|---|---|
| `bg-pink` + 흰 텍스트(14px, `font-semibold`) 조합이 대비비 약 4.43:1로 WCAG AA(4.5:1)에 근소 미달 | `AuthForm`의 "가입하기/로그인" 버튼, 강좌 상세의 "수강 신청하기" 버튼, `ConfirmDialog` 확인 버튼, `/courses` FilterChip의 active 상태 등 전사적으로 사용 중인 패턴 | 홈 화면 자체의 신규 CTA는 4.5.3에서 폰트 크기로 우회했지만, 이미 배포된 화면들은 그대로다. 브랜드 컬러(YLIA 가이드 확정값)는 바꿀 수 없으니 근본 해법은 "버튼 텍스트를 18px+bold로 통일"인데, 이는 Design System(Button 컴포넌트) 레벨 변경이라 이번 홈 작업 범위를 넘는다 — qa-reviewer/PO에게 별도 이슈로 전달 권장 |
| `/courses` 카드의 "정부지원"(`bg-info/15 text-info`) 배지·`Badge tone="danger"`(마감) 배지가 연한 색 배경에 연한 색 텍스트를 얹어 대비비가 약 2~3.6:1 수준으로 낮음 | `app/(public)/courses/page.tsx`, `app/(public)/courses/[slug]/page.tsx` | PO가 "강좌 카드 UI는 `/courses` 것을 그대로 재사용"으로 이미 확정했으므로 이번에 손대지 않는다. 다만 4.5.9에서 이 배지를 공유 컴포넌트(`Badge.tsx`)로 추출하는 김에, 별도 티켓으로 톤 값(배경 진하기/텍스트 색)만 조정하면 두 화면에 동시 반영되니 비용이 낮다는 점은 qa-reviewer에게 참고로 전달 |
| AppHeader 내비 텍스트 12.5px, 터치 영역에 별도 패딩 없음 | `components/layout/AppHeader.tsx` | home.md 10.2에 따라 이번 홈 작업으로 변경하지 않음. H-M10 "본문 16px" 대상인지 여부는 4.5.11 질문 참고 |

### 4.5.11 PO 확인 필요 사항 (열린 질문)

| # | 질문 | 권장안 |
|---|---|---|
| 1 | H-M10 "본문 16px 이상"의 적용 범위 — 이 설계는 "읽어야 하는 안내문"에만 16px+를 적용하고 배지·푸터·헤더 내비 같은 메타 정보는 제외했다. 이 분류 기준에 동의하는가 | 동의 권장(전체를 16px로 올리면 배지·칩 UI가 부자연스럽게 커짐) |
| 2 | 전사적 `bg-pink`+흰 텍스트 버튼의 대비비 미달(4.43:1)을 별도 개선 과제로 등록할 것인가 | qa-reviewer 백로그 등록 권장. 근본 해법은 버튼 텍스트 크기/굵기 표준을 18px+bold로 올리는 Design System 변경 |
| 3 | `/courses` 카드의 정부지원·마감 배지 저대비 문제도 함께 개선할 것인가(홈이 그대로 재사용하는 컴포넌트라 홈에도 그대로 상속됨) | 이번 릴리스는 보류(PO가 "그대로 재사용" 확정), 배지 톤 값만 조정하는 별도 소규모 티켓 권장 |
| 4 | 5(브랜드소개)·6(문의) Should 섹션을 이번 릴리스에 포함할지 | 개발 일정에 따라 결정(DoD 영향 없음, home.md 10.1) — 포함 시 4.5.7 스펙 그대로 사용 |
| 5 | 이 설계의 Figma 실물 반영(F1~F8을 실제 Figma 파일 프레임으로) 시점 | Figma 도구 접근 가능한 세션에서 후속 처리 — 그 전까지는 본 문서가 Dev 착수 기준 스펙 역할을 한다 |

---

## 5. Error Handling

| 상황 | 처리 방법 | UI 표현 | Figma 와이어프레임 |
|---|---|---|:---:|
| 세션 만료 중 보호 페이지 접근 | 로그인 화면으로 리다이렉트 후 원래 경로 복귀 | 안내 문구 + 로그인 폼 | ✅ 01c |
| 미승인 상태로 강의실 접근 | 접근 차단 | "입금 확인 후 이용 가능해요" | ✅ 04d |
| 정원 마감 후 신청 시도 | 서버에서 재검증 후 거부 | "정원이 마감되었어요" | ✅ 02-full |
| 수료 조건 미충족 상태 수료증 요청 | 버튼 비활성화 | 부족한 항목 명시 | ☐ |
| Admin 권한 없는 계정의 Admin 라우트 접근 | 403 → 홈 리다이렉트 | (관리자 아님 안내) | ☐ |
| 동시 입금 승인 처리 충돌 | 낙관적 락 또는 상태 재확인 | "이미 처리된 신청이에요" | ✅ 06 하단 Toast 주석 |
| 강좌 0개 (빈 강좌 목록) | — | "조건에 맞는 강좌가 없어요" | ✅ 02a-empty |
| 잘못된 slug 접근 | Next.js 404 | 404 페이지 | ✅ 12 |
| 무통장입금 기한 만료 | 자동 만료, 재신청 가능 | "입금기한 만료" 배지 + 재신청 CTA | ✅ 03 신청내역-만료 |
| 신청 이력 있는 강좌 비활성화 시도 | 확인 다이얼로그 | "이미 신청 N건이 있어요" | ✅ 07 하단 주석 |

---

## 6. Security Considerations

- [ ] 모든 개인정보(이름/연락처/입금자명)는 RLS로 본인+관리자만 접근 가능하도록 제한
- [ ] Supabase Service Role Key는 서버 전용(Admin 전용 API route/RPC)에서만 사용, 클라이언트에 노출 금지
- [ ] Admin 라우트는 미들웨어에서 `profiles.role='admin'` 이중 검증 (RLS만 믿지 않는다)
- [ ] 과제 제출 링크는 임의 스크립트 실행 가능한 마크업으로 렌더링하지 않는다(순수 링크/텍스트만)
- [ ] 비밀번호는 Supabase Auth가 관리(직접 저장·해싱 로직 구현 금지)
- [ ] 개인정보처리방침 갱신 — 회원정보/결제확인용 데이터를 사이트가 직접 저장한다는 사실 반영 (security-officer 담당)

---

## 7. Test Plan

| 레벨 | 대상 | 시나리오 |
|---|---|---|
| L1: API/DB | Supabase RLS | learner 계정으로 타인의 enrollment 조회 시도 → 차단 확인 |
| L2: UI | 신청/입금/승인 플로우 | 정원 마감 강좌 신청 버튼 비활성화 확인 |
| L2: UI | 강의실 접근 제어 | 미승인 상태에서 `/learn/[id]` 직접 접근 시 차단 |
| L3: E2E | 가입→신청→입금대기→(Admin 승인)→강의실→수료증 | 전체 플로우 완주 |
| L3: E2E | Admin 승인/반려 | 반려 시 학습자에게 사유 노출 확인 |

---

## 8. Coding Convention (기존 MVP와 동일 유지)

컴포넌트 PascalCase.tsx / 함수·유틸 camelCase.ts / 타입 PascalCase / 폴더 kebab-case. Supabase 관련 코드는 `lib/supabase/`(client.ts, server.ts, proxy.ts, queries.ts)에 모으고, 프로젝트 루트의 `proxy.ts`가 이를 호출한다.

---

## 9. Implementation Guide

### 9.1 Module Map
| 모듈 | Scope Key | 설명 |
|---|---|---|
| Supabase 셋업 + 스키마/RLS | `module-lms-1` | 프로젝트 생성, 테이블/정책, `lib/supabase/*` |
| 인증(가입/로그인/미들웨어) | `module-lms-2` | `(auth)` 라우트 그룹 |
| 강좌안내(Supabase 기반, 기존 module-4 대체) | `module-lms-3` | `(public)/courses/*` |
| 신청/입금 + 마이페이지 | `module-lms-4` | `(user)/my`, 신청 플로우 |
| 강의실(진도/퀴즈/과제/수료증) (✅ 2026-08-09 완료) | `module-lms-5` | `(user)/learn/*` — Admin 수료관리(module-lms-6)의 "수료임박"/"수료대상자" 목록이 이제 실제 데이터를 반환한다(아래 상세 참조) |
| Admin 콘솔 전체 (✅ 2026-08-08 완료) | `module-lms-6` | `(admin)/*` — 대시보드/강좌/카테고리/신청·입금/회원/수료/CMS 7화면. security-officer·qa-reviewer 점검 반영 완료(아래 상세 참조) |
| 통합 QA + 배포 + 동시 오픈 (🔶 배포·스모크테스트 완료 2026-08-09, 동시오픈만 미착수) | `module-lms-7` | 기존 module-5 흡수. `https://bara-edu.kr`에 배포됨(AWS Amplify), NEXT_PUBLIC_IS_OPEN=false로 Coming Soon 유지 중 |

### 9.2 Implementation Order
1. Figma 게이트(F1~F10) 완료
2. Supabase 프로젝트/스키마/RLS (`module-lms-1`)
3. 인증 (`module-lms-2`)
4. 강좌안내 Supabase 전환 (`module-lms-3`)
5. 신청/입금/마이페이지 (`module-lms-4`)
6. 강의실/진도/퀴즈/과제/수료증 (`module-lms-5`)
7. Admin 콘솔 (`module-lms-6`)
8. 통합 QA·보안 점검·배포·**동시 오픈** (`module-lms-7`)

---

## Version History

| 버전 | 날짜 | 변경사항 | 작성자 |
|---|---|---|---|
| 0.1 | 2026-08-01 | 초안 작성 (bara-edu-lms.plan.md/flows.md 기반) | AI Team |
| 1.1 | 2026-08-10 | 4.5절 홈(Home) 화면 설계 추가(bara-edu-lms.home.md 기반) — 히어로/카테고리/강좌/신청방법/브랜드소개·문의(Should)/Footer 전면 재설계, CourseCard·Badge·FilterChip `/courses`→공유 컴포넌트 추출 계획, 접근성(H-M10) 체크리스트. Figma F1~F8은 텍스트 산출물로 갈음(실물 Figma 반영은 후속) | UI/UX Designer |
