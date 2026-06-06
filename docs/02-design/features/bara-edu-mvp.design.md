# bara-edu-mvp Design Document

> **Summary**: 바라 평생교육원 MVP 웹사이트 — Next.js SSG + Google Sheets + Figma-First 설계
>
> **Project**: 바라 평생교육원 (bara-edu.kr)
> **Version**: 0.1
> **Author**: AI Team (bara-edu)
> **Date**: 2026-06-06
> **Status**: Draft
> **Planning Doc**: [bara-edu-mvp.plan.md](../01-plan/features/bara-edu-mvp.plan.md)

---

## ⚠️ Figma-First 워크플로우 게이트

> **개발 착수 조건**: 아래 Figma 체크리스트가 모두 완료된 후에만 `/pdca do bara-edu-mvp` 실행 가능.

| 단계 | 담당 | 완료 여부 |
|------|------|:--------:|
| F1. Figma 파일 생성 + 팀 공유 | UI/UX Designer | ✅ |
| F2. 디자인 토큰 정의 (색상, 타이포, 간격) | UI/UX Designer | ☐ |
| F3. Coming Soon 페이지 와이어프레임 | UI/UX Designer | ☐ |
| F4. 홈 페이지 와이어프레임 | UI/UX Designer | ☐ |
| F5. 강좌 목록 페이지 와이어프레임 | UI/UX Designer | ☐ |
| F6. 강좌 상세 페이지 와이어프레임 | UI/UX Designer | ☐ |
| F7. 모바일 반응형 레이아웃 정의 | UI/UX Designer | ☐ |
| F8. 카피라이팅 (UX Writer 검수 완료) | UX Writer | ☐ |
| F9. PO 디자인 리뷰 + 승인 | Product Owner | ☐ |
| F10. Figma Dev Mode 링크 → 이 문서에 추가 | Developer | ☐ |

**Figma 파일 URL**: https://www.figma.com/design/HUnCKQmUxDtTp1BCDBxa73
**Figma Dev Mode URL**: https://www.figma.com/design/HUnCKQmUxDtTp1BCDBxa73 (Dev Mode 탭 전환)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 온라인 접점 없는 바라 평생교육원을 웹으로 전환, 강좌 안내·신청을 디지털화 |
| **WHO** | 직장인·취준자·시니어·경력단절자·해외이주민·B2B 기업 담당자 |
| **RISK** | Google Sheets API 의존성 — 서비스 장애 시 강좌 데이터 미노출 / 빌드 실패 |
| **SUCCESS** | 도메인 정상 접근, 모바일/PC 반응형, 3클릭 이내 강좌 신청 도달, 신청 완료율 > 70% |
| **SCOPE** | Coming Soon + 홈 + 강좌 목록 + 강좌 상세 + Google Forms 신청 연동 |

---

## 1. Overview

### 1.1 Design Goals

- **Figma → 코드 1:1 매핑**: uipro-cli 컴포넌트를 Figma 컴포넌트와 1:1 대응시켜 일관성 보장
- **정적 우선 SSG**: 모든 페이지를 빌드 타임에 생성, 런타임 API 호출 없음 (Google Sheets는 빌드 시만 호출)
- **Google Sheets 단일 진실 공급원**: 강좌 데이터의 유일한 소스, 관리자가 코드 없이 업데이트
- **모바일 퍼스트**: Tailwind 반응형, 시니어·해외이주민 고려한 큰 폰트·여백

### 1.2 Design Principles

- **Figma-First**: 코드 작성 전 반드시 Figma 디자인 확정
- **최소 의존성**: npm 패키지는 꼭 필요한 것만 (Next.js, Tailwind, uipro-cli)
- **데이터 분리**: UI 컴포넌트는 데이터 구조에 무관하게 props로만 동작

---

## 2. Architecture Options

### 2.0 Architecture Comparison

| 기준 | A: Minimal | B: Clean | C: Pragmatic ✅ |
|------|:---:|:---:|:---:|
| 신규 파일 | 12개 | 28개 | 18개 |
| 복잡도 | 낮음 | 높음 | 중간 |
| 유지보수성 | 보통 | 높음 | **높음** |
| 개발 공수 | 낮음 | 높음 | **중간** |
| Figma 매핑 용이성 | 낮음 | 높음 | **높음** |
| **추천** | | | ✅ |

**선택**: Option C — Pragmatic Balance
**이유**: uipro-cli 컴포넌트와 Figma 컴포넌트를 기능 단위로 매핑, MVP + 2차 확장 모두 수용 가능

### 2.1 Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                  bara-edu.kr (Browser)                   │
│  ┌────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Header │  │  Page Layer  │  │       Footer         │  │
│  │  Nav   │  │  (App Router)│  │                      │  │
│  └────────┘  └──────┬───────┘  └──────────────────────┘  │
└─────────────────────┼────────────────────────────────────┘
                      │ props (SSG 빌드 시 주입)
┌─────────────────────▼────────────────────────────────────┐
│              Component Layer (uipro-cli 기반)             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │  home/       │  │  courses/    │  │   ui/ (공유)  │   │
│  │  HeroSection │  │  CourseCard  │  │   Button      │   │
│  │  ComingSoon  │  │  CourseFilter│  │   Badge       │   │
│  │  FeaturedList│  │  CourseDetail│  │   Card        │   │
│  └──────────────┘  └──────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────-┘
                      ↑ 빌드 타임 데이터 패치
┌─────────────────────┴────────────────────────────────────┐
│                   lib/ (Infrastructure)                  │
│  sheets.ts (Apps Script API) │ types.ts │ utils.ts       │
└──────────────────────────────────────────────────────────┘
                      ↑ Google Sheets 조회
┌─────────────────────┴────────────────────────────────────┐
│              Google Workspace                            │
│  Google Sheets (강좌 DB) │ Apps Script (JSON API)        │
│  Google Forms (수강신청 수집)                              │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
[빌드 타임]
  next build
    → lib/sheets.ts: fetch(APPS_SCRIPT_URL)
    → Google Sheets → Apps Script → JSON 반환
    → generateStaticParams() → /courses/[slug] 페이지 생성
    → AWS Amplify 배포

[런타임 — 사용자 요청]
  사용자 → CDN → 정적 HTML/CSS/JS (API 호출 없음)
  수강신청 클릭 → Google Form (외부 이동)
  Google Form 제출 → Google Sheets 자동 수집
```

### 2.3 Dependencies

| 컴포넌트 | 의존 대상 | 목적 |
|---------|---------|------|
| app/courses/page.tsx | lib/sheets.ts | 강좌 목록 데이터 |
| app/courses/[slug]/page.tsx | lib/sheets.ts | 강좌 상세 데이터 |
| lib/sheets.ts | Apps Script URL | Google Sheets JSON API |
| components/courses/* | lib/types.ts | Course 타입 |
| components/home/* | data/site-config.ts | 사이트 메타 정보 |

---

## 3. Data Model

### 3.1 Course 타입 정의

```typescript
// lib/types.ts

export interface Course {
  id: string;           // slug (예: web-design-2026-07)
  title: string;        // 강좌명
  category: CourseCategory;
  description: string;  // 강좌 소개 (마크다운 허용)
  curriculum: string[]; // 커리큘럼 항목 배열
  instructor: string;   // 강사명
  instructorBio?: string;
  startDate: string;    // ISO date string
  endDate: string;
  schedule: string;     // 예: "화·목 19:00~21:00"
  fee: number;          // 수강료 (원)
  seats: number;        // 정원
  governmentSupport: boolean; // 정부지원 여부
  formUrl: string;      // Google Forms URL
  thumbnail?: string;   // 이미지 URL
  status: CourseStatus;
}

export type CourseCategory =
  | 'IT/디지털'
  | '외국어'
  | '자격증'
  | '직무역량'
  | '취미/교양'
  | '정부지원';

export type CourseStatus = 'active' | 'upcoming' | 'closed';

export interface SiteConfig {
  name: string;         // "바라 평생교육원"
  phone: string;
  email: string;
  address: string;
  kakaoUrl?: string;
  instagramUrl?: string;
  openingDate?: string; // Coming Soon 오픈 예정일
  isOpen: boolean;      // false = Coming Soon 모드
}
```

### 3.2 Google Sheets 컬럼 매핑

| Sheets 컬럼 | TypeScript 필드 | 타입 | 비고 |
|------------|----------------|------|------|
| A: id | id | string | slug 형식 |
| B: title | title | string | |
| C: category | category | CourseCategory | |
| D: description | description | string | |
| E: curriculum | curriculum | string[] | 줄바꿈 → 배열 변환 |
| F: instructor | instructor | string | |
| G: instructorBio | instructorBio | string | 선택 |
| H: startDate | startDate | string | YYYY-MM-DD |
| I: endDate | endDate | string | YYYY-MM-DD |
| J: schedule | schedule | string | |
| K: fee | fee | number | 숫자만 |
| L: seats | seats | number | |
| M: governmentSupport | governmentSupport | boolean | TRUE/FALSE |
| N: formUrl | formUrl | string | Google Forms URL |
| O: thumbnail | thumbnail | string | 이미지 URL |
| P: status | status | CourseStatus | active/upcoming/closed |

---

## 4. API Specification

### 4.1 Apps Script 엔드포인트

| Method | URL | 설명 | 인증 |
|--------|-----|------|------|
| GET | `APPS_SCRIPT_URL?action=courses` | 전체 강좌 목록 | 없음 (공개 URL) |
| GET | `APPS_SCRIPT_URL?action=course&id={slug}` | 특정 강좌 상세 | 없음 |

### 4.2 응답 형식

**GET ?action=courses**
```json
{
  "status": "ok",
  "data": [
    {
      "id": "web-design-2026-07",
      "title": "웹디자인 실무 과정",
      "category": "IT/디지털",
      "status": "active",
      "fee": 150000,
      "startDate": "2026-07-01"
    }
  ]
}
```

**GET ?action=course&id=web-design-2026-07**
```json
{
  "status": "ok",
  "data": {
    "id": "web-design-2026-07",
    "title": "웹디자인 실무 과정",
    "category": "IT/디지털",
    "description": "...",
    "curriculum": ["HTML/CSS 기초", "반응형 웹", "포트폴리오 제작"],
    "instructor": "홍길동",
    "startDate": "2026-07-01",
    "endDate": "2026-07-31",
    "schedule": "화·목 19:00~21:00",
    "fee": 150000,
    "seats": 20,
    "governmentSupport": true,
    "formUrl": "https://forms.gle/xxx",
    "thumbnail": "https://...",
    "status": "active"
  }
}
```

### 4.3 lib/sheets.ts 구현 스펙

```typescript
// lib/sheets.ts
export async function getAllCourses(): Promise<Course[]>
export async function getCourseBySlug(slug: string): Promise<Course | null>

// 사용 예 (app/courses/page.tsx — SSG)
export const revalidate = 86400; // 24시간마다 ISR 재빌드
```

---

## 5. UI/UX Design (Figma-First)

### 5.0 Figma 디자인 토큰 (확정 후 기입)

> **주의**: 아래 토큰은 Figma 디자인 완료 후 UI/UX Designer가 채워야 합니다.
> 개발자는 Figma Dev Mode의 실제 값을 참조하여 Tailwind config에 적용합니다.

| 카테고리 | 토큰 | 값 (Figma 확정 후 기입) |
|---------|------|----------------------|
| Primary Color | `--color-primary` | TBD |
| Secondary Color | `--color-secondary` | TBD |
| Background | `--color-bg` | TBD |
| Text Main | `--color-text` | TBD |
| Font Family | `--font-main` | TBD |
| Font Size Base | `--text-base` | TBD |
| Border Radius | `--radius` | TBD |
| Spacing Unit | `--spacing` | TBD |

### 5.1 페이지별 레이아웃

#### Coming Soon 페이지 (`/`)

```
┌────────────────────────────────────────┐
│          바라 평생교육원 로고             │
│                                        │
│     [히어로 이미지 or 배경]              │
│                                        │
│   "평생교육, 새로운 시작"  (H1)          │
│   "곧 만납니다. YYYY.MM.DD 오픈"  (H3)  │
│                                        │
│   [이메일 사전신청 인풋] [신청하기]       │
│                                        │
│   연락처: 000-0000-0000 | 카카오 채널    │
└────────────────────────────────────────┘
```

#### 홈 메인 페이지 (`/`)

```
┌────────────────────────────────────────┐
│  [Header: 로고 | 강좌안내 | 신청방법]    │
├────────────────────────────────────────┤
│           Hero Section                 │
│   "배움으로 새로운 내일을" (H1)          │
│   기관 소개 한 줄 설명  (p)             │
│   [강좌 보러가기 CTA]                   │
├────────────────────────────────────────┤
│           대표 강좌 (최대 6개)           │
│  [카드] [카드] [카드]                   │
│  [카드] [카드] [카드]                   │
│         [전체 강좌 보기]                │
├────────────────────────────────────────┤
│           수강 신청 방법               │
│  Step 1 → Step 2 → Step 3             │
├────────────────────────────────────────┤
│  [Footer: 기관정보 | 연락처 | 이용약관]  │
└────────────────────────────────────────┘
```

#### 강좌 목록 페이지 (`/courses`)

```
┌────────────────────────────────────────┐
│  [Header]                              │
├────────────────────────────────────────┤
│  강좌 안내 (H1)                        │
│  [카테고리 필터 탭: 전체 | IT | 외국어…] │
├────────────────────────────────────────┤
│  [CourseCard] [CourseCard] [CourseCard]│
│  [CourseCard] [CourseCard] [CourseCard]│
│  ...                                   │
├────────────────────────────────────────┤
│  [Footer]                              │
└────────────────────────────────────────┘
```

#### 강좌 상세 페이지 (`/courses/[slug]`)

```
┌────────────────────────────────────────┐
│  [Header]                              │
├────────────────────────────────────────┤
│  [썸네일 이미지]                        │
│  카테고리 Badge  |  상태 Badge          │
│  강좌명 (H1)                           │
│  강사: 홍길동 / 일정: 화목 19:00~21:00   │
│  수강료: 150,000원                      │
│  [정부지원 배지 (조건부)]               │
├────────────────────────────────────────┤
│  강좌 소개 (description)               │
├────────────────────────────────────────┤
│  커리큘럼 (ordered list)               │
├────────────────────────────────────────┤
│  ┌──────────────────┐                  │
│  │  수강료: 150,000원│                  │
│  │  정원: 20명       │                  │
│  │  개강: 2026-07-01 │                  │
│  │  [수강 신청하기 →] │ (Google Forms)   │
│  └──────────────────┘                  │
│  무통장 입금 안내                       │
├────────────────────────────────────────┤
│  [Footer]                              │
└────────────────────────────────────────┘
```

### 5.2 User Flow

```
홈 (메인)
  └→ [강좌 보러가기] → /courses (강좌 목록)
       └→ [카테고리 필터] → 필터된 목록
       └→ [CourseCard 클릭] → /courses/[slug] (강좌 상세)
            └→ [수강 신청하기] → Google Forms (새 탭)
                 └→ 제출 완료 → Google Sheets 수집
```

### 5.3 Component List

| 컴포넌트 | 위치 | 역할 | uipro-cli 매핑 |
|---------|------|------|----------------|
| Header | components/layout/ | 글로벌 헤더, Nav | NavigationHeader |
| Footer | components/layout/ | 글로벌 푸터 | Footer |
| ComingSoon | components/home/ | Coming Soon 화면 | - (커스텀) |
| HeroSection | components/home/ | 홈 히어로 | HeroBanner |
| FeaturedCourses | components/home/ | 대표 강좌 리스트 | CardGrid |
| CourseCard | components/courses/ | 강좌 카드 | Card |
| CourseFilter | components/courses/ | 카테고리 필터 탭 | TabFilter |
| CourseDetail | components/courses/ | 강좌 상세 정보 | - (커스텀) |
| ApplyBox | components/courses/ | 신청 사이드박스 | StickyBox |
| Button | components/ui/ | CTA 버튼 | Button |
| Badge | components/ui/ | 카테고리/상태 배지 | Badge |

### 5.4 Page UI Checklist

#### Coming Soon 페이지

- [ ] 로고: 바라 평생교육원 로고 이미지
- [ ] H1 텍스트: 메인 슬로건
- [ ] 오픈 예정일: 날짜 표시 (site-config.openingDate)
- [ ] 이메일 입력: 사전 신청 이메일 인풋 (Google Form 연결)
- [ ] CTA 버튼: "사전 신청하기"
- [ ] 연락처: 전화번호 + 카카오 채널 링크

#### 홈 메인 페이지

- [ ] Header: 로고, 강좌안내 링크, 신청방법 앵커 링크
- [ ] Hero: H1 슬로건, 부제목, "강좌 보러가기" CTA 버튼
- [ ] 대표 강좌 섹션: CourseCard 최대 6개 (active/upcoming 우선)
- [ ] 각 CourseCard: 썸네일, 카테고리 Badge, 강좌명, 일정, 수강료, 정부지원 Badge
- [ ] "전체 강좌 보기" 버튼: /courses 링크
- [ ] 신청 방법 섹션: Step 1~3 시각적 표현
- [ ] Footer: 기관명, 주소, 전화, 이메일, 개인정보처리방침 링크

#### 강좌 목록 페이지

- [ ] H1: "강좌 안내"
- [ ] 카테고리 필터 탭: 전체, IT/디지털, 외국어, 자격증, 직무역량, 취미/교양, 정부지원 (7개)
- [ ] 선택된 탭: 활성 스타일 (색상 변경)
- [ ] CourseCard 그리드: 3열 (PC), 2열 (태블릿), 1열 (모바일)
- [ ] 강좌 없음 상태: "현재 모집 중인 강좌가 없습니다" 빈 상태 메시지
- [ ] 정부지원 Badge: governmentSupport=true 시 조건부 표시

#### 강좌 상세 페이지

- [ ] 썸네일 이미지 (없으면 기본 이미지 표시)
- [ ] 카테고리 Badge
- [ ] 상태 Badge: 모집중 / 예정 / 마감 (status 값에 따라)
- [ ] H1: 강좌명
- [ ] 강사명 텍스트
- [ ] 일정 텍스트 (schedule)
- [ ] 개강~종강 날짜
- [ ] 강좌 소개 (description, 마크다운 렌더링)
- [ ] 커리큘럼 리스트 (curriculum 배열)
- [ ] ApplyBox: 수강료, 정원, 개강일, [수강 신청하기] 버튼 (Google Forms 새 탭)
- [ ] 무통장 입금 안내 텍스트
- [ ] 정부지원 안내 (governmentSupport=true 시 표시)

---

## 6. Error Handling

| 상황 | 처리 방법 | UI 표현 |
|------|---------|---------|
| Sheets API 빌드 오류 | Amplify 빌드 실패, 이전 배포 유지 | (사용자 미노출) |
| 강좌 slug 없음 | Next.js 404 | 404 페이지 ("강좌를 찾을 수 없습니다") |
| 썸네일 로드 실패 | img onError → 기본 이미지 | 바라 평생교육원 기본 OG 이미지 |
| 강좌 0개 | 빈 상태 컴포넌트 | "현재 모집 중인 강좌가 없습니다" |

---

## 7. Security Considerations

- [ ] Apps Script URL을 `.env.local`에만 저장 (`APPS_SCRIPT_URL` — 서버 빌드 전용)
- [ ] Google Forms URL은 `NEXT_PUBLIC_` 접두사 불필요 (빌드 시 HTML에 포함)
- [ ] XSS: description 마크다운 렌더링 시 sanitize-html 적용
- [ ] HTTPS: AWS Amplify ACM 인증서 자동 적용 (bara-edu.kr)
- [ ] 개인정보: Google Forms는 Google의 개인정보처리방침 적용 (별도 처리 불필요)

---

## 8. Test Plan

### 8.1 Test Scope

| 타입 | 대상 | 도구 | 단계 |
|------|------|------|------|
| L1: API | Apps Script 엔드포인트 응답 형식 | curl | Do |
| L2: UI | 페이지 렌더링, 필터 동작, 링크 이동 | Playwright | Do |
| L3: E2E | 홈 → 목록 → 상세 → 신청 링크 전체 플로우 | Playwright | Do |

### 8.2 L1: API Test Scenarios

| # | 엔드포인트 | Method | 설명 | 예상 상태 | 예상 응답 |
|---|-----------|--------|------|:---------:|---------|
| 1 | ?action=courses | GET | 전체 강좌 반환 | 200 | `.status="ok"`, `.data` 배열 |
| 2 | ?action=course&id=valid | GET | 유효 slug 상세 반환 | 200 | `.data.id` 존재 |
| 3 | ?action=course&id=invalid | GET | 없는 slug | 200 | `.data=null` or 빈 객체 |

### 8.3 L2: UI Action Test Scenarios

| # | 페이지 | 액션 | 예상 결과 |
|---|------|------|---------|
| 1 | /courses | 페이지 로드 | 강좌 카드 1개 이상 렌더링 |
| 2 | /courses | IT/디지털 탭 클릭 | 해당 카테고리만 표시 |
| 3 | /courses/[slug] | 페이지 로드 | 강좌명, 수강료, ApplyBox 모두 표시 |
| 4 | /courses/[slug] | 수강 신청 버튼 클릭 | Google Forms 새 탭 오픈 |
| 5 | / (홈) | "강좌 보러가기" 클릭 | /courses 이동 |

### 8.4 L3: E2E Scenario Test Scenarios

| # | 시나리오 | 단계 | 성공 기준 |
|---|---------|------|---------|
| 1 | 강좌 신청 전체 플로우 | 홈 → 강좌목록 → 강좌상세 → 신청버튼 클릭 | Google Forms URL 새 탭 오픈 (3클릭 이내) |
| 2 | 카테고리 필터 | 강좌목록 → 탭 클릭 → 결과 변경 확인 | 카테고리 일치 카드만 표시 |
| 3 | 모바일 반응형 | iPhone SE viewport → 모든 페이지 | 스크롤 가능, 버튼 클릭 가능 |

### 8.5 Seed Data Requirements

| 엔티티 | 최소 수 | 필수 필드 |
|-------|:------:|---------|
| Course (active) | 3 | id, title, category, fee, formUrl, status=active |
| Course (upcoming) | 1 | id, title, startDate (미래 날짜) |
| Course (각 카테고리) | 1 이상 | category 필드 전 옵션 커버 |

---

## 9. Clean Architecture (Layer Assignment)

### 9.1 Layer Structure

| 레이어 | 역할 | 위치 |
|-------|------|------|
| **Presentation** | 페이지, UI 컴포넌트 | `app/`, `components/` |
| **Application** | 데이터 패치 로직 (SSG) | `app/*/page.tsx` (getStaticProps 대응) |
| **Domain** | 타입, 유틸리티 | `lib/types.ts`, `lib/utils.ts` |
| **Infrastructure** | 외부 API 클라이언트 | `lib/sheets.ts` |

### 9.2 This Feature's Layer Assignment

| 컴포넌트 | 레이어 | 위치 |
|---------|-------|------|
| HeroSection, CourseCard | Presentation | `components/home/`, `components/courses/` |
| page.tsx (데이터 패치) | Application | `app/courses/page.tsx` |
| Course, CourseStatus | Domain | `lib/types.ts` |
| getAllCourses() | Infrastructure | `lib/sheets.ts` |

---

## 10. Coding Convention

### 10.1 Naming Conventions

| 대상 | 규칙 | 예시 |
|------|------|------|
| 컴포넌트 | PascalCase | `CourseCard`, `HeroSection` |
| 함수 | camelCase | `getAllCourses()`, `formatFee()` |
| 타입/인터페이스 | PascalCase | `Course`, `CourseCategory` |
| 파일 (컴포넌트) | PascalCase.tsx | `CourseCard.tsx` |
| 파일 (유틸) | camelCase.ts | `sheets.ts`, `utils.ts` |
| 폴더 | kebab-case | `components/`, `home/`, `courses/` |

### 10.2 Environment Variables

| 변수 | 범위 | 설명 |
|------|------|------|
| `APPS_SCRIPT_URL` | 서버 빌드 전용 | Google Apps Script 배포 URL |
| `NEXT_PUBLIC_SITE_NAME` | 클라이언트 | 사이트명 |
| `NEXT_PUBLIC_IS_OPEN` | 클라이언트 | Coming Soon 토글 (true/false) |
| `NEXT_PUBLIC_OPEN_DATE` | 클라이언트 | 오픈 예정일 |

---

## 11. Implementation Guide

### 11.1 File Structure (완성 형태)

```
bara_edu/
├── app/
│   ├── layout.tsx              # 메타, 폰트, 글로벌 스타일
│   ├── page.tsx                # 홈 (IS_OPEN 환경변수로 Coming Soon ↔ Main 분기)
│   ├── courses/
│   │   ├── page.tsx            # 강좌 목록 (SSG + ISR 24h)
│   │   └── [slug]/
│   │       └── page.tsx        # 강좌 상세 (generateStaticParams)
│   ├── not-found.tsx           # 404 페이지
│   └── globals.css
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Badge.tsx
│   │   └── Card.tsx
│   ├── courses/
│   │   ├── CourseCard.tsx
│   │   ├── CourseFilter.tsx
│   │   ├── CourseDetail.tsx
│   │   └── ApplyBox.tsx
│   ├── home/
│   │   ├── ComingSoon.tsx
│   │   ├── HeroSection.tsx
│   │   └── FeaturedCourses.tsx
│   └── layout/
│       ├── Header.tsx
│       ├── Footer.tsx
│       └── Nav.tsx
├── lib/
│   ├── sheets.ts               # Apps Script API 클라이언트
│   ├── types.ts                # 공유 타입 정의
│   └── utils.ts                # formatFee, formatDate, slugify
├── data/
│   └── site-config.ts          # 사이트 정적 설정
├── public/
│   ├── images/
│   │   └── default-course.jpg  # 기본 강좌 이미지
│   └── og-image.jpg            # OG 이미지
├── .env.local                  # (gitignore)
├── next.config.js
├── tailwind.config.js
└── tsconfig.json
```

### 11.2 Implementation Order

> **전제 조건**: Figma 디자인 승인 완료 후 착수

1. [ ] 프로젝트 초기화 (`create-next-app`, Tailwind, uipro-cli 설치)
2. [ ] `lib/types.ts` — Course, SiteConfig 타입 정의
3. [ ] `data/site-config.ts` — 정적 사이트 설정
4. [ ] `lib/sheets.ts` — Apps Script API 클라이언트 구현
5. [ ] `lib/utils.ts` — formatFee, formatDate 유틸
6. [ ] `components/ui/*` — uipro-cli 기반 공통 컴포넌트 (Button, Badge, Card)
7. [ ] `components/layout/*` — Header, Footer, Nav
8. [ ] `components/home/*` — ComingSoon, HeroSection, FeaturedCourses
9. [ ] `components/courses/*` — CourseCard, CourseFilter, CourseDetail, ApplyBox
10. [ ] `app/page.tsx` — 홈 페이지 (Coming Soon ↔ Main 분기)
11. [ ] `app/courses/page.tsx` — 강좌 목록
12. [ ] `app/courses/[slug]/page.tsx` — 강좌 상세
13. [ ] `app/not-found.tsx` — 404 페이지
14. [ ] AWS Amplify 배포 설정 + bara-edu.kr 도메인 연결
15. [ ] Google Sheets 실 데이터 연결 + 빌드 검증

### 11.3 Session Guide

#### Module Map

| 모듈 | Scope Key | 설명 | 예상 턴 |
|------|-----------|------|:-------:|
| 프로젝트 초기화 + 타입 + 유틸 | `module-1` | 셋업, types, sheets.ts, utils | 20-25 |
| 공통 컴포넌트 + 레이아웃 | `module-2` | ui/, layout/ 컴포넌트 | 20-25 |
| 홈 페이지 (Coming Soon + Main) | `module-3` | home/ 컴포넌트 + app/page.tsx | 20-25 |
| 강좌 목록 + 상세 페이지 | `module-4` | courses/ 컴포넌트 + app/courses/* | 25-30 |
| 배포 + 도메인 + 검증 | `module-5` | Amplify, 도메인, E2E 테스트 | 15-20 |

#### Recommended Session Plan

| 세션 | 단계 | Scope | 예상 턴 |
|------|------|-------|:-------:|
| Session 1 | Plan + Design | 전체 | 30-35 |
| **⛔ Figma 디자인 게이트** | — | Figma 승인 완료 대기 | — |
| Session 2 | Do | `--scope module-1` | 20-25 |
| Session 3 | Do | `--scope module-2,module-3` | 40-50 |
| Session 4 | Do | `--scope module-4` | 25-30 |
| Session 5 | Do | `--scope module-5` | 15-20 |
| Session 6 | Check + Report | 전체 | 30-40 |

---

## Version History

| 버전 | 날짜 | 변경사항 | 작성자 |
|------|------|---------|-------|
| 0.1 | 2026-06-06 | 초안 작성 | AI Team |
