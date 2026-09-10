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
  address: string | null;      // 수강신청 확인 화면에서 회원당 1회 입력받아 재사용(자격증 발급용, 2026-08-28 추가)
  photoPath: string | null;    // private 버킷(member-photos) 경로. 공개 URL 아님 — Admin은 서명 URL로만 조회
  // 탈퇴 처리 시 name/phone/address/photoPath 등 식별정보는 즉시 파기(익명화)한다 — email은
  // Supabase Auth 쪽에서 별도 삭제(재가입 허용을 위해 auth.users만 제거,
  // profiles 행은 통계 목적의 익명 레코드로 잔존 가능 — 구현 시 재검토)
}

// 입금 계좌(무통장입금 안내, Admin > 계좌정보 관리에서 최대 3개까지 등록, 2026-08-28 추가)
export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  order: number;
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
  totalHours: number | null;  // 총 강좌 시간(시간 단위), 선택 입력 — 관리자 요청으로 2026-08-17 추가
  startDate: string | null;   // 강좌 시작 년월일("YYYY-MM-DD"), 선택 입력 — 관리자 요청으로 2026-08-28 추가
  endDate: string | null;     // 강좌 종료 년월일("YYYY-MM-DD"), 선택 입력 — 관리자 요청으로 2026-08-28 추가
  scheduleType: 'weekday' | 'weekend' | 'both' | null;  // 평일반/주말반/평일+주말반, 선택 입력
  requiresCertificateInfo: boolean;  // 수강신청 시 주소·자격증 사진 필수 여부(기본 true, 2026-08-29 추가 — 자격과정이 아닌 강좌는 관리자가 끌 수 있음)
  governmentSupport: boolean;
  status: 'active' | 'upcoming' | 'closed';
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  videoUrl: string | null;      // 외부 링크 (업로드 아님). lessonMode='video'일 때만 사용
  order: number;
  hasQuiz: boolean;
  hasAssignment: boolean;
  lessonMode: 'video' | 'online' | 'offline';  // 강의 방식(2026-08-25 추가, 관리자 요청)
  onlineMeetingUrl: string | null;   // lessonMode='online' 필수(Zoom/Meet 등 참여 링크)
  onlineScheduledAt: string | null;  // lessonMode='online' 선택(실시간 수업 일시)
  offlineLocationName: string | null; // lessonMode='offline' 선택
  offlineAddress: string | null;      // lessonMode='offline' 선택
}

// 강좌 교재(주교재/보조교재, 2026-08-30 추가). 주교재는 강좌당 최대 1개(unique 인덱스로 강제),
// 보조교재는 여러 개 등록 가능 — 실물 교재뿐 아니라 유인물·PPT 등 자료 전반을 포괄. 둘 다 선택 항목.
export type CourseMaterialKind = 'main' | 'supplementary';

export interface CourseMaterial {
  id: string;
  courseId: string;
  kind: CourseMaterialKind;
  title: string;
  publisher: string | null;
  purchaseUrl: string | null;
  order: number;
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
┌────────────────────────────────────────────────┐
│ [로고] [검색]                          [운영자 계정] │
├──────────┬───────────────────────────────────────┤
│ 대시보드  │ 신청 · 수료                              │
│ 강좌관리  │ [신규신청][입금대기][오늘승인][수료임박]        │
│ 회원관리  │ 회원 가입                                │
│ 신청·입금 │ [오늘가입][이번주가입][미인증수(비클릭)]      │
│ 수료관리  │ (정원초과 강좌 경고, 있을 때만)              │
│ 카테고리  │ ──────────────────────────────           │
│ CMS      │ 가입 추이 (최근 30일) — 막대 차트           │
│          │ 최근 가입자 (10명, 행 클릭 → 상세)          │
│          │ 수료 임박 학습자                          │
└──────────┴───────────────────────────────────────┘
```

#### Admin 대시보드 확장 — 회원 가입 지표 (F-ADM-2~5, 2026-09-09 추가)

> 선행 조건: `bara-edu-lms.menu-features.md` 2.5절 F-ADM-2~6과 "F-ADM-2~5 공통 제약"을 반드시 함께 읽는다(KST 자정 헬퍼, `role='learner'` 필터, 재가입 중복 카운트 허용 등). 이 절은 그 위에 화면 배치·마크업만 정의한다.
>
> **정정 사항**: 요청 당시 재사용 후보로 언급된 `components/courses/Badge.tsx`(tone: neutral/info/warning/danger)는 공개(public) 화면 전용 배지다. Admin 화면(`/admin/enrollments`, `/admin/courses`, `/admin/assignments`, `/admin/members` 등)은 이미 전부 `components/admin/StatusBadge.tsx`(tone: neutral/success/warning/danger)를 쓰고 있으므로, 신규 배지도 이 컴포넌트를 그대로 재사용한다. 새 컴포넌트를 만들거나 `Badge.tsx`를 끌어오지 않는다.

**1) 카드 레이아웃 — 그룹 분리(도메인 라벨 + 그리드 분리), 하나의 그리드에 섞지 않는다**

기존 카드 4개(신청·수료)와 신규 3개(회원 가입: 오늘가입/이번주가입/미인증수)는 데이터 성격이 다르고(전자는 "처리해야 할 일", 후자는 "가입 추이 참고 지표") 클릭 목적지도 다르다(`/admin/enrollments`·`/admin/certificates` vs `/admin/members`). `grid-cols-4`를 7칸으로 늘려 한 줄에 욱여넣기보다, 카드 그룹 위에 작은 이거브로우 라벨을 붙여 두 그리드로 분리한다.

```tsx
{/* 그룹 A: 신청 · 수료 (기존, KST 자정 헬퍼로 교체) */}
<section className="flex flex-col gap-2">
  <p className="text-[12px] font-semibold uppercase tracking-wide text-n-5">신청 · 수료</p>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    {applicationCards.map((c) => (
      <Link key={c.label} href={c.href} className="rounded-lg border border-n-3 bg-n-0 p-4">
        <p className="text-[12px] text-n-6">{c.label}</p>
        <p className="mt-1 text-[24px] font-semibold text-n-9">{c.value}</p>
      </Link>
    ))}
  </div>
</section>

{/* 그룹 B: 회원 가입 (신규) */}
<section className="flex flex-col gap-2">
  <p className="text-[12px] font-semibold uppercase tracking-wide text-n-5">회원 가입</p>
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <Link href="/admin/members" className="rounded-lg border border-n-3 bg-n-0 p-4">
      <p className="text-[12px] text-n-6">오늘 신규가입</p>
      <p className="mt-1 text-[24px] font-semibold text-n-9">{stats.signupToday}</p>
      <p className="mt-0.5 text-[11px] text-n-5">{todayLabel /* 예: 9/9 */}</p>
    </Link>
    <Link href="/admin/members" className="rounded-lg border border-n-3 bg-n-0 p-4">
      <p className="text-[12px] text-n-6">이번주 신규가입</p>
      <p className="mt-1 text-[24px] font-semibold text-n-9">{stats.signupThisWeek}</p>
      <p className="mt-0.5 text-[11px] text-n-5">{weekRangeLabel /* 예: 9/8~9/14 */}</p>
    </Link>
    {/* 미인증 카드는 <Link>가 아니라 <div> — F-ADM-6(미인증 목록/재전송)이 이번 범위 제외라
        드릴다운 화면이 없다. 클릭 가능한 것처럼 보이지 않도록 hover 스타일도 주지 않는다. */}
    <div className="rounded-lg border border-n-3 bg-n-0 p-4">
      <p className="text-[12px] text-n-6">이메일 미인증</p>
      <p className="mt-1 text-[24px] font-semibold text-n-9">{stats.unconfirmedTotal}</p>
      <p className={`mt-0.5 text-[11px] ${stats.unconfirmedOver7d > 0 ? 'text-warning' : 'text-n-5'}`}>
        7일 초과 방치 {stats.unconfirmedOver7d}건
      </p>
    </div>
  </div>
</section>
```

- 이거브로우 라벨(`text-[12px] font-semibold uppercase tracking-wide text-n-5`)은 카드 그룹 표식용으로 가볍게, 아래 목록·차트 섹션의 `<h2 className="text-[15px] font-semibold text-n-9">`보다 한 단계 낮은 위계로 둔다 — 페이지 안에서 "그룹 라벨 < 섹션 제목"이 한눈에 구분되게.
- 반응형: Admin은 데스크톱 전용(F8, 최소폭 1280 기준)이라 필수는 아니지만 창을 좁혀도 카드가 깨지지 않도록 `sm:` 분기만 최소로 넣는다(그룹 A 2/4열, 그룹 B 1/3열). 별도 `md`/`lg` 세분화는 하지 않는다(과설계 방지).
- 미인증 카드의 보조 표기(+7일 초과 건수)는 값이 0이어도 항상 노출한다(문구 자체가 "0건"이라는 안심 정보이기도 함). 0보다 클 때만 `text-warning`으로 색을 올려 주의를 끈다.

**2) 배치 순서 — "가입" 도메인 콘텐츠를 카드 바로 아래에 몰아서 배치, 기존 섹션 순서는 건드리지 않는다**

```
1. 카드 그룹 A (신청 · 수료)
2. 카드 그룹 B (회원 가입)
3. 가입 추이 (최근 30일) — 전체 폭
4. 최근 가입자 (10명) — 전체 폭
5. [조건부] 정원 초과 강좌 경고 — 기존 위치 그대로
6. 수료 임박 학습자 — 기존 위치 그대로
```

- 3·4는 카드 그룹 B(오늘/이번주 가입, 미인증)가 방금 보여준 숫자를 "왜 그런 숫자인지" 추세와 명단으로 이어서 설명하는 콘텐츠라 카드 바로 아래에 붙인다. 기존 "정원 초과 경고"(운영 액션이 필요한 알림)와 "수료 임박"(과제/진도 도메인) 두 섹션은 이번 변경과 무관하므로 순서를 유지한다 — 불필요한 화면 diff를 피한다.
- **2단(좌우) 배치는 채택하지 않는다.** 최근 가입자 목록은 이름·마스킹이메일(`ab***@gmail.com`)·가입일시·배지 4열이라 좌우 분할 시 이메일이 잘리기 쉽고, 가입 추이 차트도 30개 막대를 좌우 절반 폭(약 400~500px 추정)에 욱여넣으면 막대 하나가 10px 미만으로 좁아져 시니어 관리자 기준 가독성이 떨어진다. 두 섹션 모두 전체 폭으로 세로 배치하고, 차트를 목록보다 위에 둔다(요약 추세 → 상세 명단 순서가 자연스럽다).

**3) 가입 추이 막대 차트 — 인라인 CSS(flex + 인라인 style height %), SVG 불필요**

차트 라이브러리를 새로 넣지 않는다는 제약(F-ADM-5)에 맞춰, `<svg><rect>`보다 flex 막대가 더 단순하고 Tailwind 유틸리티만으로 hover 상태까지 처리할 수 있어 이 방식을 쓴다.

```tsx
// components/admin/SignupTrendChart.tsx
// data는 항상 30개(가입자 0명인 날짜도 count:0으로 채워서 전달), 오래된 날짜 → 최근 날짜 순.
export type DailySignupPoint = { date: string; count: number }; // date: 'YYYY-MM-DD' (KST)

export default function SignupTrendChart({ data }: { data: DailySignupPoint[] }) {
  const allZero = data.every((d) => d.count === 0);
  if (allZero) {
    return <p className="py-8 text-center text-[13px] text-n-6">최근 30일간 신규 가입이 없어요.</p>;
  }
  const max = Math.max(...data.map((d) => d.count));

  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {data.map((d) => (
          <div
            key={d.date}
            title={`${d.date} · ${d.count}명`}
            style={{ height: `${(d.count / max) * 100}%` }}
            className="min-h-[2px] w-full flex-1 rounded-t-[2px] bg-indigo/70 hover:bg-indigo"
          />
        ))}
      </div>
      {/* 라벨 밀도: 30개 전부 표시하면 겹친다 — 5일 간격 + 마지막 날짜만 노출(약 7개) */}
      <div className="mt-1 flex gap-[3px] text-[10px] text-n-5">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 text-center">
            {i % 5 === 0 || i === data.length - 1 ? d.date.slice(5).replace('-', '/') : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- 막대는 `min-h-[2px]`로 0명인 날에도 얇은 기준선을 남긴다(값이 0인지, 데이터가 안 왔는지 구분되게).
- 정확한 수치는 hover 시 `title` 툴팁으로만 제공한다(관리자 데스크톱 전용 도구라 키보드/터치 접근성은 이번 범위에서 별도 처리하지 않음 — 4.5.10 접근성 체크리스트는 공개 화면 대상이라 이 위젯에는 적용하지 않는다. qa-reviewer 리뷰 시 참고).
- 막대 색은 이 프로젝트의 브랜드 액센트인 `bg-indigo`(hover 시 진하게, 평소 `/70` 투명도)를 쓴다 — Admin 화면에서 이미 활성 상태 표시(`AdminSidebar` 활성 NavItem)에 `bg-indigo/10 text-indigo`를 쓰고 있어 톤이 일관된다.

**4) 인증상태 배지 — `components/admin/StatusBadge.tsx` 재사용, tone은 success/warning**

기존 컨벤션(`enrollments`/`assignments`의 `STATUS_TONE`)이 "대기·미완료 계열 = warning", "완료·승인 계열 = success"로 이미 일관되어 있으므로 그대로 따른다.

```tsx
<StatusBadge tone={isConfirmed ? 'success' : 'warning'}>
  {isConfirmed ? '인증완료' : '미인증'}
</StatusBadge>
```

최근 가입자 목록(F-ADM-3)은 `AdminTable` + `StatusBadge`로 조립하고, "행 클릭 시 이동"은 `/admin/members` 목록처럼 이름 셀만 링크로 두지 않고 행 전체를 클릭 가능하게 만든다 — 이 위젯은 이름 외 다른 셀에 별도 액션이 없는 "훑어보기" 목록이라 행 전체 클릭이 더 자연스럽다(반면 `/admin/members` 정식 목록은 행마다 다른 액션이 늘어날 수 있어 이름 링크만 유지, 이번에 바꾸지 않는다). 서버 컴포넌트를 유지하기 위해 별도 클라이언트 컴포넌트 없이 "stretched link" 패턴을 쓴다:

```tsx
<tr key={m.id} className="relative hover:bg-n-1">
  <td className="relative">
    <Link href={`/admin/members/${m.id}`} className="absolute inset-0" aria-label={`${m.name} 상세 보기`} />
    <span className="relative font-medium text-n-9">{m.name}</span>
  </td>
  <td>{maskEmail(m.email)}</td>
  <td>{new Date(m.createdAt).toLocaleString('ko-KR')}</td>
  <td>
    <StatusBadge tone={m.emailConfirmed ? 'success' : 'warning'}>
      {m.emailConfirmed ? '인증완료' : '미인증'}
    </StatusBadge>
  </td>
</tr>
```

`maskEmail`은 로컬파트 앞 2자 + `***` + `@도메인` 형식(`ab***@gmail.com`, 스펙 예시와 동일). 로컬파트가 2자 미만이면 있는 만큼만 쓰고 나머지를 `***`로 채운다(예: `a***@gmail.com`).

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

## 4.6 자격시험(Course Exam) 기능 설계 (2026-09-09 추가)

> **입력 문서**: `docs/01-plan/features/bara-edu-lms.menu-features.md` F-ADMCAT-4, F-ADMC-7~9, F-LRN-7~10, F-ADMCE-1/4/5(전부 재논의 대상 아님, 확정 정책은 그대로 인용). 이 절은 그 위에 화면·컴포넌트·데이터 계약만 정의한다.
> **참고 화면**: 관리자 퀴즈 저작(`app/(admin)/admin/courses/[id]/lessons/[lessonId]/quiz/page.tsx` + `app/actions/admin-quiz.ts`), 카테고리 순서 변경(`app/actions/admin-categories.ts`의 `swapOrder`), 학습자 강의실(`app/(user)/learn/[courseId]/[lessonId]/page.tsx`, `components/classroom/{CurriculumSidebar,QuizForm,QuizResult,CertificateAction}.tsx`), 강좌 폼(`components/admin/{CourseForm,CategoryPicker}.tsx`), 수료 관리(`app/(admin)/admin/certificates/page.tsx`).

### 4.6.0 의존 관계 요약

- **재사용**: 퀴즈 저작 화면의 문항/보기 CRUD form-action 패턴, `ConfirmDialog`, `StatusBadge`, `AdminTable`, 카테고리 관리의 ▲▼ 순서변경(`swapOrder`) 패턴, `getCertificateEligibilityForCourse`/`CertificateAction` 게이트, `/admin/certificates` 기존 3섹션.
- **신규**: `categories.is_certification`, `courses.requires_exam`/`exam_pass_score`/`exam_max_attempts`, 테이블 4종(`course_exam_questions`/`course_exam_options`/`course_exam_submissions`/`course_exam_attempt_resets`), RPC `submit_course_exam`(SECURITY DEFINER), 서버 액션 `app/actions/admin-exam.ts` + `app/actions/classroom-exam.ts`, 화면 `/admin/courses/[id]/exam` + `/learn/[courseId]/exam`. (**2026-09-10 갱신**: `course_exam_questions`/`course_exam_options`는 이후 문제은행 구조로 대체됨 — 4.6.11 참고. `course_exam_submissions`/`course_exam_attempt_resets`는 그대로 유지.)

### 4.6.1 데이터 모델 확장 (`lib/types.ts`)

```typescript
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  depth: 1 | 2 | 3;
  order: number;
  isActive: boolean;
  isCertification: boolean;   // depth===1에서만 의미 있음(F-ADMCAT-4). depth 2/3는 항상 false로 저장·검증
}

export interface Course {
  // ...기존 필드 그대로
  requiresExam: boolean;          // 기본 false. is_certification 카테고리가 아니면 서버가 저장 시 강제로 false 정규화
  examPassScore: number | null;   // 1~100, requiresExam=true일 때만 값 존재(기본 60)
  examMaxAttempts: number | null; // 1 이상, requiresExam=true일 때만 값 존재(기본 3, 무제한 옵션 없음)
}

export type CourseExamQuestion = {
  id: string;
  courseId: string;
  question: string;
  order: number;
  options: CourseExamOption[];
};

export type CourseExamOption = {
  id: string;
  questionId: string;
  label: string;
  order: number;
  isCorrect: boolean;   // 관리자 조회 전용 필드 — 학습자 응답에는 절대 포함하지 않는다(F-LRN-7 정답 비노출 원칙)
};

export type CourseExamSubmission = {
  id: string;
  userId: string;
  courseId: string;
  score: number;      // 0~100
  passed: boolean;     // 응시 시점 examPassScore 기준 스냅샷. 이후 합격기준이 바뀌어도 재계산하지 않음
  attemptNo: number;    // 최근 리셋 이후 1부터 재기산
  submittedAt: string;
};

export type CourseExamAttemptReset = {
  id: string;
  userId: string;
  courseId: string;
  reason: string;   // 필수
  resetAt: string;
  resetBy: string;  // 처리한 관리자 profiles.id
};
```

`lib/supabase/classroom-queries.ts`의 `CertificateEligibility`도 함께 확장한다:

```typescript
export type CertificateEligibility = {
  eligible: boolean;
  alreadyIssued: boolean;
  totalLessons: number;
  completedLessons: number;
  pendingAssignmentLessonTitles: string[];
  examRequired: boolean;
  examPassed: boolean;   // examRequired=false면 항상 true로 채워 eligible 계산식을 단순하게 유지
};
```
`eligible` 산식에 `&& (!examRequired || examPassed)`를 추가한다. `CertificateAction`의 "부족한 항목" 안내 줄에도 `examRequired && !examPassed`일 때 `· 자격시험 합격 필요` 문구 + `/learn/${courseId}/exam` 인라인 링크를 덧붙인다(기존 텍스트 톤 유지, 새 버튼 만들지 않음).

### 4.6.2 Admin 카테고리 관리 — 자격증 플래그 (F-ADMCAT-4)

`/admin/categories`의 `CategoryNode`에서 "활성화/비활성화" 버튼 옆, **depth===1인 노드에만** 토글 버튼을 추가한다(`toggleCategoryActive`와 동일한 hidden-current 패턴 재사용):

```tsx
{category.depth === 1 && (
  <form action={toggleCategoryCertification.bind(null, category.id)}>
    <input type="hidden" name="current" value={String(category.isCertification)} />
    <button type="submit" className="rounded-pill border border-n-3 px-2.5 py-1 text-[11.5px] text-n-7">
      {category.isCertification ? '자격증 해제' : '자격증 지정'}
    </button>
  </form>
)}
{category.isCertification && <StatusBadge tone="info">자격증</StatusBadge>}
```

`toggleCategoryCertification` 서버 액션은 대상 카테고리의 `depth !== 1`이면 클라이언트 조건과 무관하게 즉시 실패시킨다(서버 재검증). 초기 시드는 "자격증" 1Depth 카테고리 1건만 `is_certification=true`(menu-features 확정, 이름은 언제든 바뀔 수 있으므로 판정에 쓰지 않는다).

### 4.6.3 강좌 등록/수정 폼 — 시험 설정 블록 (F-ADMC-7 / Q4 답변)

**결론: `CourseForm`을 `'use client'`로 전환하고, `CategoryPicker`에 `onLevel1Change` 콜백을 추가한다.** 두 방식은 양자택일이 아니라 함께 필요하다 — 콜백만 추가하면 그 값을 받아 조건부 렌더링할 상태를 가질 부모가 여전히 서버 컴포넌트라 무용하고, `CourseForm`만 client화해도 `CategoryPicker`가 선택값을 부모에 알릴 방법이 없다.

`CourseForm`을 client로 바꿔도 안전한 이유: 현재 이 컴포넌트는 데이터를 직접 fetch하지 않는 순수 프레젠테이션 컴포넌트이며(전부 props), `action` prop은 서버 액션 참조를 그대로 전달받아 `<form action={action}>`에 연결하는 형태라 Next.js가 공식 지원하는 "서버 액션을 client 컴포넌트에 prop으로 전달" 패턴과 정확히 일치한다. 실제 변경량은 상단 `'use client'` 한 줄 + `useState` 두 개뿐이다.

```tsx
// components/admin/CategoryPicker.tsx — onLevel1Change 콜백 추가
export default function CategoryPicker({
  categories,
  defaultCategoryId,
  name = 'categoryId',
  onLevel1Change,                 // 신규: 1Depth 선택이 바뀔 때마다 해당 Category(또는 null) 전달
}: {
  categories: Category[];
  defaultCategoryId?: string;
  name?: string;
  onLevel1Change?: (category: Category | null) => void;
}) {
  const [selected, setSelected] = useState<(string | null)[]>(() => buildPath(defaultCategoryId, categories));

  // 수정 화면 진입 시(defaultCategoryId 있음) 최초 1회도 부모에 알려야 함
  useEffect(() => {
    onLevel1Change?.(categories.find((c) => c.id === selected[0]) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLevel1Select(id: string) {
    setSelected([id || null, null, null]);
    onLevel1Change?.(categories.find((c) => c.id === id) ?? null);
  }
  // level1 <select onChange>만 handleLevel1Select로 교체, level2/3 select는 변경 없음
```

```tsx
// components/admin/CourseForm.tsx — 최상단 'use client' 추가
'use client';
import { useState } from 'react';

export default function CourseForm({ categories, action, defaultValues, submitLabel }: { /* 기존과 동일 */ }) {
  const [level1, setLevel1] = useState<Category | null>(null);
  const [examEnabled, setExamEnabled] = useState(defaultValues?.requiresExam ?? false);
  const showExamBlock = level1?.isCertification === true;

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-n-3 bg-n-0 p-5">
      {/* ...기존 필드... */}
      <CategoryPicker categories={categories} defaultCategoryId={defaultValues?.categoryId} onLevel1Change={setLevel1} />
      {/* ...기존 필드(교재/자격증정보 체크박스 등)... */}

      {showExamBlock && (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-n-3 bg-n-1 p-4">
          <label className="flex items-center gap-2 text-[12.5px] text-n-7">
            <input
              type="checkbox"
              name="requiresExam"
              defaultChecked={defaultValues?.requiresExam ?? false}
              onChange={(e) => setExamEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            자격시험 응시 필요
          </label>
          {examEnabled && (
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
                합격 기준 점수(%)
                <input
                  name="examPassScore"
                  type="number"
                  min={1}
                  max={100}
                  required
                  defaultValue={defaultValues?.examPassScore ?? 60}
                  className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-n-7">
                최대 응시 횟수
                <input
                  name="examMaxAttempts"
                  type="number"
                  min={1}
                  required
                  defaultValue={defaultValues?.examMaxAttempts ?? 3}
                  className="h-10 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px]"
                />
              </label>
            </div>
          )}
        </fieldset>
      )}

      <button type="submit" className="h-11 rounded-pill bg-pink text-[14px] font-semibold text-white">
        {submitLabel}
      </button>
    </form>
  );
}
```

- 카테고리를 자격증 → 일반으로 바꾸면 `showExamBlock`이 즉시 false가 되어 입력 필드가 DOM에서 사라진다. 그 전에 입력해 둔 값을 지우지 않아도 안전한 이유: `updateCourse`/`createCourse` 서버 액션(`app/actions/admin-courses.ts`)이 저장 직전 `categoryId`의 1Depth 조상을 서버에서 재조회해 `is_certification`이 false면 `requiresExam=false, examPassScore=null, examMaxAttempts=null`로 강제 덮어쓴다(클라이언트 hidden 값을 신뢰하지 않는다는 기존 원칙 그대로).

### 4.6.4 시험 문제 저작 화면 `/admin/courses/[id]/exam` (F-ADMC-8 / Q1 답변)

**결론: 기존 퀴즈 저작 화면 패턴을 거의 그대로 따르되, 아래 2가지만 다르게 간다.**

| 항목 | 퀴즈 화면(기존) | 시험 화면(신규) | 사유 |
|---|---|---|---|
| 문항 순서 | 등록순 고정, 재정렬 UI 없음 | **▲▼ 순서 변경 버튼 추가**(`/admin/categories`의 `swapOrder()` 로직을 `course_exam_questions`에 이식) | F-ADMC-8이 "순서 변경"을 명시적으로 요구, 퀴즈에는 없던 요건 |
| 보기 개수 | 자유 추가/삭제(개수 고정 없음) | **동일하게 자유 추가/삭제, 4개로 고정하지 않음** | menu-features 어디에도 "4개 고정" 문구가 없다. 퀴즈와 같은 조작 방식을 유지해야 관리자 학습 비용이 없다. 4개 고정이 실제 의도라면 4.6.11 질문 #5로 별도 확인 필요 |

- 페이지 상단에 4.6.3에서 설정한 **합격 기준/최대 응시 횟수를 읽기 전용으로 요약 표시**: `합격 기준 {examPassScore}% · 최대 응시 {examMaxAttempts}회` + `[강좌 수정에서 변경]` 링크(`/admin/courses/${id}`). **이 두 값은 이 화면에서 수정하지 않는다** — Q5 답변(아래) 참고.
- `course.requiresExam === false`인데 이 URL에 직접 접근한 경우 `notFound()`가 아니라 안내 배너를 얹는다: "이 강좌는 자격시험이 설정되어 있지 않아요. 강좌 수정 화면에서 먼저 켜주세요." + `[강좌 수정으로 이동]`. 문항 목록/CRUD는 계속 노출한다 — 카테고리를 되돌리면 등록된 문항이 그대로 복구되어야 하므로(F-ADMC-7~9 제약 #3) 조회·정리 자체를 막을 이유가 없다.
- 문항 목록 상단에 신규 경고 배너(퀴즈 화면엔 없던 안전장치): 정답이 하나도 지정되지 않은 문항이 있으면 `"정답이 설정되지 않은 문항이 N개 있어요. 학습자 제출 시 해당 문항은 항상 오답으로 채점돼요."` — 경고일 뿐 저장을 막지 않는다(F-ADMC-9 "차단하지 않는다" 원칙과 동일 기조).
- 문항 0건 + `requiresExam=true`일 때 "등록된 문항이 없어요." 아래에 한 줄 추가: `"문항이 0개인 동안 학습자에게는 '시험 준비 중' 안내만 보여요."`
- 서버 액션은 `app/actions/admin-exam.ts` 신규 생성 — `admin-quiz.ts`를 거의 그대로 복제하되 테이블명(`course_exam_questions`/`course_exam_options`)·리다이렉트 경로(`/admin/courses/${courseId}/exam`)만 교체하고, `moveQuestionUp`/`moveQuestionDown`(신규, `admin-categories.ts`의 `swapOrder` 로직 이식) 2개를 추가한다.

### 4.6.5 강좌 목록/폼 — 시험 미등록 경고 (F-ADMC-9)

- `/admin/courses` 목록의 강좌명 셀 옆에 `requiresExam && examQuestionCount === 0`인 행만 `StatusBadge tone="warning"`로 `시험 문제 미등록` 배지를 추가한다. `getAdminCourses()` 쿼리에 `examQuestionCount` 집계 컬럼 추가가 필요하다.
- `/admin/courses/[id]` 저장 성공 메시지 바로 아래, 같은 조건이면 인라인 경고 배너를 추가한다: `"자격시험이 켜져 있지만 문항이 없어요. 이 상태에서는 학습자가 수료증을 받을 수 없어요."` + `[문제 등록하러 가기]`(`/admin/courses/${id}/exam`). 저장 자체는 계속 성공 처리(비차단).

### 4.6.6 학습자 CurriculumSidebar — 자격시험 섹션 배치 (F-LRN-7 / Q3 답변)

**결론: 교재 섹션 다음, 사이드바 맨 아래.** 최종 순서: `커리큘럼 목록 → ProgressBar → 교재(조건부) → 자격시험(조건부, requiresExam=true인 강좌만)`.

이유: 교재는 "학습에 필요한 참고 자료"로 강의 목록과 밀접해 커리큘럼 바로 아래가 자연스럽고(이미 그렇게 구현돼 있음), 자격시험은 "커리큘럼을 다 마친 뒤 보는 최종 관문"이라 개념적으로도 실제 학습 순서상으로도 가장 마지막 단계다. menu-features 원문 "맨 아래 고정"과 일치하며, 교재가 없는 강좌(주교재/보조교재 미등록)에서도 자격시험 섹션은 항상 마지막 위치에 고정된다.

```tsx
// CurriculumSidebar.tsx — 교재 섹션 다음에 추가
{requiresExam && (
  <div>
    <h2 className="mb-2 text-[13px] font-semibold text-n-9">자격시험</h2>
    <Link
      href={`/learn/${courseId}/exam`}
      className={`flex items-center justify-between rounded-md px-3 py-2 text-[13px] ${
        examStatus === 'locked' ? 'text-n-5' : 'font-semibold text-indigo bg-indigo/10'
      }`}
    >
      <span>시험 응시하기</span>
      <StatusBadge tone={EXAM_STATUS_TONE[examStatus]}>{EXAM_STATUS_LABEL[examStatus]}</StatusBadge>
    </Link>
  </div>
)}
```

- `requiresExam`, `examStatus`(`'locked'|'not_ready'|'available'|'passed'|'exhausted'`)는 4.6.7의 판정 로직을 공유 함수(`getExamStatusForCourse(userId, courseId)`, `lib/supabase/classroom-queries.ts` 신규)로 뽑아 `CurriculumSidebar`를 렌더링하는 두 페이지(`/learn/[courseId]/[lessonId]`, 신규 `/learn/[courseId]/exam`) 모두에서 동일하게 계산해 props로 내려준다.
- 잠금 상태에서도 링크는 클릭 가능하게 둔다(F-LRN-7b "섹션이 보이되 잠금"). 사이드바에서 아예 못 누르게 막기보다, 클릭하면 `/learn/[courseId]/exam`에서 왜 잠겼는지 설명하는 편이 F-LRN-7b의 의도("응시할 수 있어요" 안내를 실제로 보여주는 것)에 더 맞는다고 판단했다 — 최종 확정은 4.6.11 질문 #1 참고.

### 4.6.7 `/learn/[courseId]/exam` 화면 — 상태 정의 (F-LRN-7b/8/10 / Q2 답변)

공통 접근 가드: 로그인 필요 + `enrollments.status='approved'`(기존 `getClassroomAccess`/`ClassroomAccessNotice` 그대로 재사용 — 강의실과 동일 기준). `requiresExam=false`인 강좌로 이 URL에 직접 접근하면 `notFound()`(사이드바에 진입 링크 자체가 없어 정상 경로로는 도달 불가능).

판정 순서(우선순위대로 위에서부터 확인):

```
1. 진도 100% && 과제 전건 승인?           아니면 → LOCKED
2. course_exam_questions 개수 == 0?      맞으면 → NOT_READY
3. 합격 기록(passed=true) 존재?           맞으면 → PASSED
4. 응시 횟수(최근 리셋 이후) >= examMaxAttempts && 미합격?   맞으면 → EXHAUSTED
5. 그 외                                             → AVAILABLE
```

| 상태 | 배지 | 헤드라인 | 본문 | CTA |
|---|---|---|---|---|
| LOCKED | `neutral` "잠김" | "모든 강의와 과제를 마치면 응시할 수 있어요" | "진도 {completed}/{total}" (+ 승인 대기 과제 있으면 "· 과제 승인 대기: {목록}", `CertificateAction` 문구 스타일과 동일) | 비활성 버튼 "시험 응시하기"(disabled, 회색 — `CertificateAction` 비활성 버튼과 동일 클래스) |
| NOT_READY | `neutral` "준비중" | "시험을 준비하고 있어요" | "문항이 등록되면 응시할 수 있어요. 잠시만 기다려 주세요." | 없음(에러 화면 아님, F-LRN-10) |
| AVAILABLE | `info` "응시 가능" | "시험에 응시할 수 있어요" | "합격 기준 {examPassScore}% · 남은 응시 횟수 {remaining}회" (+ 이전 응시 있으면 "지난 응시: {lastScore}점 (불합격)") | 활성 버튼 "시험 응시하기" → 같은 화면 하단에 `ExamForm`(문항 목록, `QuizForm`과 동일한 라디오+form 구조) 노출 |
| PASSED | `success` "합격" | "합격했어요" | "{score}점 · {합격일자}" | 텍스트 링크(버튼 아님) "강의실로 돌아가 수료증 확인하기" → 강좌 첫 강의(`/learn/{courseId}/{firstLessonId}`) |
| EXHAUSTED | `danger` "응시 횟수 소진" | "재응시 횟수를 모두 사용했어요" | "최근 점수 {lastScore}점 · 합격 기준 {examPassScore}%. 재응시 횟수를 모두 사용했습니다. 담당자에게 문의해 주세요."(F-LRN-8 원문 그대로) | 텍스트 링크 2개(Home `#contact` 섹션과 동일 스타일) `tel:` / `mailto:` — 신규 버튼 아님 |

- 응시 제출은 `submit_course_exam(course_id, answers jsonb)` RPC(SECURITY DEFINER)를 호출하는 신규 서버 액션 `submitCourseExam`(`app/actions/classroom-exam.ts`)이 처리한다. 응답은 `{ score, passed }`만 반환하며 `correctOptionId`는 어떤 경우에도 포함하지 않는다(module-lms-5 `submit_quiz_attempt`의 정답 노출 취약점 수정 이력을 그대로 준수).
- RPC 내부 재검증 항목: (a) `enrollments.status='approved'`, (b) 진도 100%+과제 전건 승인, (c) 문항 수 > 0, (d) 잔여 횟수 > 0, (e) 이미 합격한 적 없음(합격 후 재제출 시도는 거부). 클라이언트 상태 판정과 RPC가 어긋나도(레이스 컨디션) RPC가 최종 권위를 갖는다 — `issue_certificate_self`와 동일 원칙.
- **아이콘 원칙**: "잠금"을 표현할 자물쇠 아이콘이 Design System에 없다(Icon 컴포넌트는 현재 Search/Success/Warning/Info 4종뿐). 이모지(🔒) 사용은 금지 원칙 위반이라, 별도 아이콘을 새로 그리지 않고 **`StatusBadge` 텍스트만으로 상태를 표현**한다 — ui-ux-designer 확인 필요(4.6.11 질문 #2).

### 4.6.8 수료증 발급 게이팅 갱신 (F-LRN-9)

`issue_certificate_self(course_id)` RPC의 검증 조건에 `(NOT requires_exam) OR EXISTS(course_exam_submissions WHERE user_id=... AND course_id=... AND passed=true)`를 추가한다. 미충족 시 기존 에러 패턴과 동일한 형태로 `'exam not passed'` 예외를 던진다. 클라이언트 쪽은 `ClassroomLessonPage`의 기존 `ERROR_MESSAGE['certificate-failed']`("아직 수료증을 발급받을 수 없어요.") 문구를 그대로 재사용한다 — 부족한 항목은 이미 `CertificateAction`의 비활성 버튼 하단 설명(4.6.1의 "· 자격시험 합격 필요" 포함)에서 충분히 드러나므로 에러 문구를 사유별로 세분화할 필요가 없다.

### 4.6.9 Admin 수료 관리 화면 확장 (F-ADMCE-1/4/5 / Q6 답변)

**결론: 신규 화면을 만들지 않고 기존 `/admin/certificates`에 섹션 2개를 추가한다.** menu-features 1절 사이트맵에서 자격시험 관련 신규 admin 라우트는 `/admin/courses/[id]/exam` 하나뿐이고, F-ADMCE-1/4/5는 전부 기존 `/admin/certificates` 산하 기능으로 정의돼 있어 새 라우트를 만들 근거가 없다.

섹션 순서(기존 3개 + 신규 2개, 총 5개):

```
1. 수료 조건 충족자        (기존, 게이트에 "시험 합격" 조건 추가)
2. [신규] 수료 보류 학습자   (F-ADMCE-1 "미충족 사유 배지")
3. [신규] 시험 응시 현황     (F-ADMCE-5)
4. 발급 이력               (기존, 변경 없음)
5. 수동 수료 처리           (기존, 변경 없음 — 시험 불합격 구제도 이 폼을 그대로 사용, F-ADMCE-3)
```

**1) 수료 조건 충족자(기존 섹션 수정)**: `getCertificateEligibleLearners()` 쿼리 조건에 `AND (NOT c.requires_exam OR EXISTS(...passed=true))`를 추가한다. 화면 마크업 변경 없음.

**2) 수료 보류 학습자(신규)**: `approved` 상태로 수강 중이며 아직 수료 조건을 다 채우지 못한 학습자를, 진도/과제/시험 3개 배지로 함께 보여준다 — "이 학습자는 왜 아직 수료증을 못 받았나요?"라는 문의에 한 화면에서 답하기 위한 목적(F-ADMCE-1).

```tsx
<li className="flex items-center justify-between rounded-lg border border-n-3 p-3 text-[13px]">
  <span><span className="font-medium text-n-9">{userName}</span> · {courseTitle}</span>
  <div className="flex items-center gap-1.5">
    <StatusBadge tone={completed === total ? 'success' : 'warning'}>진도 {completed}/{total}</StatusBadge>
    {hasAssignments && (
      <StatusBadge tone={pendingAssignments === 0 ? 'success' : 'warning'}>
        {pendingAssignments === 0 ? '과제 전건 승인' : `과제 승인대기 ${pendingAssignments}건`}
      </StatusBadge>
    )}
    {requiresExam && <StatusBadge tone={EXAM_TONE[examState]}>{EXAM_LABEL[examState] /* 미응시|불합격(N/M회)|횟수소진|합격 */}</StatusBadge>}
  </div>
</li>
{requiresExam && examState === '횟수소진' && (
  <ConfirmDialog
    triggerLabel="응시 횟수 리셋"
    title="재응시 기회를 추가할까요?"
    description="학습자가 다시 응시할 수 있게 돼요. 기존 응시 기록은 삭제되지 않고 그대로 남아요."
    confirmLabel="리셋"
    tone="neutral"
    action={resetExamAttempts.bind(null, userId, courseId)}
    reasonField={{ name: 'reason', label: '리셋 사유 (필수)', placeholder: '예: 시스템 오류로 인한 재응시 요청' }}
  />
)}
```
- **정정(ui-ux-designer 검토, 2026-09-09)**: `ConfirmDialog`(`components/ui/ConfirmDialog.tsx`)는 이미 `reasonField` prop을 지원하며, `/admin/enrollments`의 반려 사유 입력이 정확히 이 방식(네이티브 `<dialog>` + textarea)으로 구현돼 있다 — 별도 인라인 `<form>`을 새로 만들 필요가 없다(위 초안의 "ConfirmDialog에 사유 입력 필드 없음" 서술은 오류였다). `tone="neutral"`을 쓰는 이유: 삭제/반려 같은 파괴적 행위가 아니라 "기회를 더 주는" 조치라 확인 버튼을 danger(빨강)로 만들 이유가 없다.
- `resetExamAttempts(userId, courseId, formData)` 서버 액션은 `course_exam_attempt_resets`에 사유와 함께 새 행을 insert한다. 이후 "잔여 횟수" 계산은 `examMaxAttempts − (가장 최근 리셋 시각 이후의 제출 수)`로 매긴다(F-ADMC-7~9 제약 #4, 기존 응시 이력은 삭제하지 않음).

**3) 시험 응시 현황(신규, F-ADMCE-5)**: `requiresExam=true`인 강좌만 대상으로, 회원·강좌·최근 점수·합격여부·잔여 횟수·최근 응시일시를 `AdminTable`로 보여준다. 0건이면 "아직 응시 기록이 없어요."(기존 빈 상태 문구 톤 유지). 이 이력은 F-ADMM-2(회원 상세 패널)에도 그대로 노출해야 하므로, 조회 함수(`getCourseExamSubmissionHistory`)를 `lib/supabase/admin-queries.ts`에 공용으로 두고 `/admin/certificates`와 `/admin/members/[id]` 양쪽에서 재사용한다.

### 4.6.10 열린 질문 — 구현 시 확정된 답 (2026-09-09)

| # | 질문 | 확정 |
|---|---|---|
| 1 | 사이드바 LOCKED 상태의 "자격시험" 링크를 클릭 가능하게 둘지 | **클릭 가능**으로 구현(ui-ux-designer 승인) — 클릭 시 `/learn/[courseId]/exam`에서 왜 잠겼는지 안내 |
| 2 | "잠금" 상태를 자물쇠 아이콘 없이 텍스트 배지만으로 표현해도 되는지 | **텍스트 배지로 충분**(ui-ux-designer 확인) — 신규 아이콘 추가 안 함 |
| 3 | "응시 횟수 리셋" 사유 입력 UI 구현 방식 | **`ConfirmDialog`의 `reasonField` prop 사용**으로 확정(위 4.6.9 정정 참고) — 인라인 `<form>` 아님 |
| 4 | PASSED 상태의 "강의실로 돌아가기" 링크 대상 | **첫 강의로 고정** — `lessons[0]` |
| 5 | `course_exam_options` 보기 개수 | **자유(고정 없음)**로 구현 — 강의 퀴즈와 동일한 조작 방식 |
| 6 | flows.md 동기화 | 이번 라운드에서는 미반영 — 후속 작업으로 남김(별도 요청 시 처리) |

### 4.6.11 문제은행(Question Bank) 재설계 + 강좌 복사 기능 (2026-09-10 추가)

> **계기**: 관리자 문의("시험문제를 매번 강좌를 생성했을 때 만들어야 하는건가요?")에 위 4.6.1~4.6.10 설계의 한계(문항이 강좌 1개에 완전히 묶여 있어 같은 자격증의 여러 강좌가 문항을 재사용할 수 없음)를 확인한 뒤, 관리자가 두 기능을 직접 요청·범위 확정: ① 문제은행 분리, ② 강좌 복사.

**데이터 모델 변경** — `course_exam_questions`/`course_exam_options`(강좌 소유)를 폐기하고 3개 테이블로 대체:
- `exam_question_bank(id, category_id, question, order)` — **1Depth 카테고리 소유**. 관리자가 "문제은행 범위"로 "1Depth 카테고리별로 분리(추천)"를 확정(전체 공용이 아님 — 서로 무관한 자격증끼리 문항이 섞이는 걸 방지).
- `exam_bank_options(id, bank_question_id, label, is_correct, order)` — 문항의 보기. 정답 1개 제약은 기존과 동일하게 부분 유니크 인덱스로 강제.
- `course_exam_question_links(id, course_id, bank_question_id, order)` — 강좌↔문항 연결 join 테이블. 강좌의 "시험"은 이제 이 링크의 순서 있는 집합일 뿐이고, 문항 내용은 항상 문제은행에서 조인해 가져온다. `unique(course_id, bank_question_id)`로 같은 강좌에 같은 문항 중복 연결을 막는다.
- 신규 RPC `get_root_category_id(p_category_id)` — 강좌의 `category_id`에서 1Depth 조상까지 거슬러 올라간다(plpgsql, 최대 3단계 loop). 앱(`getCourseCertificationCategoryId`)과 DB 마이그레이션 양쪽에서 재사용해 "조상 찾기" 로직이 두 곳에 중복되지 않게 함.
- 기존 데이터 마이그레이션: `course_exam_questions`/`course_exam_options`의 기존 행을 **PK id를 그대로 재사용**하며 신규 테이블로 옮기고(참조 매핑이 trivial해짐), `course_exam_question_links`도 함께 생성한 뒤 옛 테이블은 drop. `if exists(...)`로 감싸 schema.sql 재실행 시 조용히 스킵되는 1회성 멱등 마이그레이션으로 구현.
- `set_course_exam_correct_option`/`get_course_exam`/`submit_course_exam` RPC 3종은 게이팅 로직(수강 여부·진도·과제·advisory lock·응시 횟수)은 그대로 두고, 문항 조회 경로만 `course_exam_question_links` → `exam_question_bank` → `exam_bank_options` 조인으로 교체.

**화면 변경**:
- `/admin/courses/[id]/exam`(F-ADMC-8, 기존 화면 재활용) — 문항 CRUD를 제거하고 **연결 관리 전용**으로 축소. 문항 내용은 읽기 전용 표시 + ▲▼ 순서 변경 + "연결 해제"(문항 자체는 안 지움, cascade 아님 — 링크 행만 delete)만 제공. 하단에 "문제은행에서 추가" 섹션(같은 카테고리에서 아직 이 강좌에 연결 안 된 문항 목록 + "추가" 버튼).
- `/admin/exam-bank`(F-ADMC-8b, 신규) — 1Depth 자격증 카테고리 picker(`?categoryId=` 쿼리) + 기존 퀴즈 저작 화면과 동일한 CRUD 패턴(문항 추가/수정/삭제/▲▼순서, 보기 추가/수정/삭제/정답설정). 카테고리가 하나도 없으면 `/admin/categories`로 안내.
- `AdminSidebar`에 "문제은행 관리" 메뉴 추가(강좌 관리 바로 아래).
- 서버 액션 분리: `app/actions/admin-exam.ts`(연결 관리만 — `linkBankQuestionToCourse`/`unlinkBankQuestionFromCourse`/`moveCourseExamLinkUp`/`Down`)와 `app/actions/admin-exam-bank.ts`(신규, 문항 내용 CRUD — `admin-quiz.ts`를 거의 그대로 복제하되 테이블명/categoryId 기준만 교체). 문제은행 쓰기 액션은 `categoryId`가 실제 1Depth+자격증 카테고리인지 서버에서 재검증(`assertCertificationCategory`) — hidden 필드 신뢰 금지 원칙(F-ADMC-7 constraint #3와 동일 이유) 유지.

**강좌 복사(F-ADMC-10, 신규)** — 관리자가 "강좌 복사 범위"로 "기본정보+커리큘럼+교재+시험설정 모두(추천)"를 확정:
- `duplicateCourse(courseId)` 서버 액션. 기본정보(제목에 "(복사본)" 접미, slug는 `-copy`→`-copy-2`… 순으로 빈 슬러그 탐색, 상태는 항상 `upcoming`으로 초기화 — 복사본이 실수로 바로 공개되지 않게), 커리큘럼(`lessons`, 강의별 `quiz_questions`/`quiz_options`까지 포함 — 그래야 `has_quiz=true`인 강의가 빈 퀴즈로 남지 않음), 교재(`course_materials`), 시험설정(`course_exam_question_links`)을 순차 insert로 복제.
- 시험 문항은 **내용을 복제하지 않고 문제은행 참조(`bank_question_id`)만 복사** — 원본/복사본 강좌가 같은 문제은행을 계속 공유해서 쓴다(문제은행을 도입한 이유와 동일: 문항을 두 번 만들 필요 없음).
- 진입점: `/admin/courses` 목록 각 행에 "복사" 버튼(비파괴적 작업이라 `ConfirmDialog` 없이 즉시 실행하는 폼 submit). 완료 후 새 강좌의 수정 화면(`/admin/courses/[id]?duplicated=1`)으로 이동, "제목·slug·일정 등 필요한 부분을 수정해주세요" 안내.

### 4.6.12 배포 전 발견 사항 3건 수정 (2026-09-10, 4.6.11 같은 날 후속)

1. **치명적 버그 발견·수정 — 학습자 시험 상태 조회가 admin-only RLS에 막혀 있었음.** qa-reviewer 배경 리뷰에서 `lib/supabase/classroom-queries.ts`의 `getCourseExamState()`가 드랍된 옛 테이블을 여전히 직접 select하고 있는 걸 발견. 조사 결과 이건 4.6.11의 마이그레이션 누락이 아니라 **9/9 최초 출시 때부터 있던 잠재 버그** — 옛 `course_exam_questions`/`course_exam_options`도 처음부터 admin-only select RLS였는데(4.6.0 참고), 이 함수는 학습자 본인 세션(anon key+쿠키, RLS 그대로 적용)으로 직접 select해왔다. RLS는 조용히 빈 결과만 돌려주므로 `questionCount`가 항상 0으로 계산돼 시험 섹션이 모든 학습자에게 계속 'not_ready'로만 보였을 가능성이 있다(실제로 진도 100%에 도달한 학습자가 아직 없어 미발견 상태였을 수 있음). `get_my_exam_reset_at()`과 동일한 패턴으로 신규 RPC `get_course_exam_readiness(p_course_id)`(SECURITY DEFINER, 문항 수·정답 미설정 여부 2개 값만 반환 — 문항 내용은 노출 안 함)를 추가해 우회.
2. **`duplicateCourse` 원자성 보강.** 복사 중 어느 단계에서 실패해도 이미 만들어진 새 강좌 row가 그대로 남아 `status='upcoming'`이면 공개 목록(`getPublicCourses`)에 미완성 강좌가 노출될 위험이 있었다(qa-reviewer 지적). 새 강좌를 항상 `status='closed'`로 먼저 만들고, 커리큘럼·교재·시험연결 복사가 전부 성공한 뒤 마지막 단계에서만 `upcoming`으로 전환하도록 변경. 강좌 시작/종료일과 강의별 과제 마감일·온라인 세션 일시는 원본이 이미 지났을 수 있어 복사 시 null로 초기화.
3. **문제은행 스코프를 1Depth→2Depth로 재조정.** 관리자가 실제 `/admin/exam-bank` 화면을 써보고 "카테고리(1Depth) 안에 문항이 다 모여 있으면 강좌에 맞는 문항을 찾기 어렵다"고 피드백 — 같은 자격증이라도 "2급"/"1급"처럼 2Depth 세부과정마다 실제 출제 내용이 다르므로, 1Depth 전체 공용은 실무에서 너무 넓은 스코프였다. 대응:
   - `exam_question_bank.category_id`가 이제 (원칙적으로) 2Depth id를 담는다. 세부과정을 안 나눈 자격증(강좌가 1Depth에 직접 배정)은 1Depth 루트 자체가 스코프로 남는다.
   - `getCourseExamBankCategoryId()`(이전 `getCourseRootCategoryId`를 대체) — 강좌 category depth가 1~2면 그대로, 3이면 부모(2Depth)로 캡핑. 기존 `get_root_category_id()` DB RPC(1Depth 고정)는 이 목적엔 더 이상 쓰지 않지만, 정의 자체는 남겨둠(다른 곳에서 참조 안 하므로 무해).
   - `getExamBankCategories()`(이전 `getCertificationCategories()`를 대체) — 1Depth 자격증 카테고리 자신 + 그 자식인 2Depth 카테고리를 모두 후보로 반환(`"부모명 > 자식명"` 라벨). `/admin/exam-bank` picker가 이 목록을 그대로 pill 버튼으로 노출.
   - `admin-exam-bank.ts`의 `assertCertificationCategory()`도 "1Depth 자체가 자격증" 또는 "2Depth이고 부모가 자격증"인 경우 모두 허용하도록 확장.
   - **기존 데이터 보정**: 4.6.11 마이그레이션이 이미 1Depth id로 만들어둔 기존 문항(도형기질활용지도자 2급 강좌의 문항 1개)은, 실제로 연결된 강좌의 카테고리를 역으로 조회해 올바른 2Depth id로 재계산하는 결정론적 `update` 문을 schema.sql에 추가해 자동 보정(재실행해도 항상 같은 값으로 수렴해 안전, 연결된 강좌가 없는 문항은 그대로 둠).
   - **(같은 날 추가 조정)** 실제 화면(도형기질활용지도자/에니어그램처럼 2Depth 세부과정이 있는 자격증)에서 써보니, picker에 함께 뜨는 1Depth "자격증" 자체 pill이 실질적으로 거의 안 쓰이면서 혼란만 준다는 지적 → `getExamBankCategories()`가 **2Depth 세부과정이 하나라도 있는 1Depth는 그 자체를 목록에서 제외**하도록 수정(세부과정을 아예 안 나눈 자격증만 1Depth 루트가 노출). `getCourseExamBankCategoryId()`의 depth1~2 그대로/depth3 캡핑 로직은 변경 없음 — 세부과정 없이 1Depth에 직접 배정된 강좌는 여전히 정상 동작하되, 그 문제은행은 picker 목록에 없으므로 자격시험 화면의 "문제은행 관리로 이동" 딥링크로만 접근 가능하다(현재로선 실사용 사례가 없어 허용 가능한 트레이드오프로 판단). 스키마 변경 없음(순수 앱 레이어 필터링).

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
| Admin 대시보드 "최근 가입자" 0건(오픈 초기) | — | "아직 가입한 회원이 없어요" 빈 상태 문구(`AdminTable` 기존 "검색 결과가 없어요" 톤과 동일) | ☐ |
| Admin 대시보드 "가입 추이" 30일 전부 0건 | — | 차트 대신 "최근 30일간 신규 가입이 없어요" 안내 문구로 대체(차트 자체를 렌더링하지 않음) | ☐ |
| `auth.admin.listUsers()`(F-ADM-4 미인증 수) 조회 실패/타임아웃 | 예외를 상위로 전파해 대시보드 전체를 에러 페이지로 만들지 않는다 — 해당 카드만 값 자리에 "-" 표시, 나머지 카드·섹션은 정상 렌더링 | 카드에 "-" + "일시적으로 불러올 수 없어요" | ☐ |
| KST 자정 헬퍼 도입 후 "오늘/이번주" 경계 회귀 | 자정 직전·직후(23:59↔00:00 KST) 유닛 테스트로 헬퍼 자체를 검증 | — (QA 항목, UI 없음) | ☐ |
| 시험 응시 조건(진도/과제) 미충족 상태로 `/learn/[courseId]/exam` 접근 | UI가 LOCKED 상태로 표시, `submit_course_exam` RPC도 동일 조건 재검증(우회 차단) | "모든 강의와 과제를 마치면 응시할 수 있어요" + 비활성 CTA | ☐ |
| `requires_exam=true`인데 문항 0건 상태로 응시 시도 | RPC가 거부, UI는 애초에 CTA를 숨김 | "시험을 준비하고 있어요"(에러 화면 아님, F-LRN-10) | ☐ |
| 응시 횟수 소진 후 재제출 시도(직접 API 호출 포함) | RPC가 잔여 0으로 거부 | "재응시 횟수를 모두 사용했습니다. 담당자에게 문의해 주세요" + 문의 링크 | ☐ |
| 이미 합격한 강좌에 재응시 시도 | RPC가 거부(합격 후 잠금) | "합격했어요" 상태 유지, CTA 없음 | ☐ |
| `requires_exam=false`인 강좌의 `/learn/[courseId]/exam` 직접 접근 | `notFound()` | 404 페이지(기존 12 재사용) | ☐ |
| 카테고리를 자격증 → 일반으로 변경 후 강좌 저장 | 서버가 `requires_exam`/`exam_pass_score`/`exam_max_attempts`를 강제 정규화, 기존 문항·응시 기록은 삭제하지 않음(되돌리면 복구) | 강좌 수정 성공 토스트만, 별도 경고 없음(정책상 허용된 동작) | ☐ |
| 자격시험 응시 횟수 리셋 시 사유 미입력 | 폼 검증 실패 | "사유를 입력해주세요." | ☐ |
| `requires_exam=true` + 문항 0건 강좌 목록 노출 | — | 강좌 목록에 `시험 문제 미등록` 경고 배지(StatusBadge warning) | ☐ |

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
| 1.2 | 2026-09-09 | Admin 대시보드에 회원 가입 지표(F-ADM-2~5) 화면 정의 추가 — 카드 그룹 분리(신청·수료 / 회원가입, 미인증 카드는 비클릭), 배치 순서(가입 추이→최근 가입자를 카드 바로 아래로, 2단 배치는 기각), `SignupTrendChart`(라이브러리 없는 flex+인라인 style 막대, 라벨 5일 간격), 인증상태 배지는 `components/admin/StatusBadge.tsx`(success/warning) 재사용, 최근 가입자 행 클릭은 stretched-link 패턴. Error Handling 표에 관련 엣지케이스 4건 추가. Figma 05 Admin 대시보드 페이지 반영은 ui-ux-designer 후속 작업(F7 재검토 필요) | Service Planner |
| 1.3 | 2026-09-09 | 4.6절 자격시험(Course Exam) 기능 설계 추가(F-ADMCAT-4/F-ADMC-7~9/F-LRN-7~10/F-ADMCE-1·4·5) — 데이터 모델 4테이블+3필드 확장, 카테고리 관리 자격증 플래그 토글, `CourseForm`을 `'use client'`로 전환하고 `CategoryPicker`에 `onLevel1Change` 콜백을 추가해 카테고리 실시간 연동(시험 설정 3필드는 CourseForm에 위치), 시험 문제 저작 화면(`/admin/courses/[id]/exam`, 퀴즈 저작 패턴 재사용+순서변경 추가), `CurriculumSidebar` 자격시험 섹션을 교재 섹션 다음 맨 아래 배치, `/learn/[courseId]/exam` 5개 상태(LOCKED/NOT_READY/AVAILABLE/PASSED/EXHAUSTED) 문구·CTA 정의, 수료증 발급 게이팅에 시험 합격 조건 추가, `/admin/certificates`에 "수료 보류 학습자"·"시험 응시 현황" 2섹션 신규(신규 라우트 없음). Error Handling 표에 엣지케이스 8건 추가. 열린 질문 6건(사이드바 잠금 클릭 가능 여부, Lock 아이콘 필요 여부, 리셋 사유 폼 형태, 보기 개수 고정 여부, flows.md 동기화 등)은 PO/ui-ux-designer/developer 확인 필요 | Service Planner |
