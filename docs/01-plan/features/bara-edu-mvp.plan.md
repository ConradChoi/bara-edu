# 바라 평생교육원 — MVP 웹사이트 Plan

> **프로젝트**: 바라 평생교육원 (bara-edu.kr)
> **운영사**: 주식회사 일리아 (ylia.io)
> **작성일**: 2026-06-06
> **단계**: Plan (PDCA Phase 1)
> **버전**: v1.0

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | 바라 평생교육원의 온라인 접점이 없어 강좌 안내·수강 신청이 전화/오프라인에만 의존 |
| **Solution** | Next.js SSG + Google Sheets/Forms 기반의 경량 교육 안내 사이트를 빠르게 론치 |
| **Function UX Effect** | 직장인·취준자·시니어·경력단절자·해외이주민 등 다양한 학습자가 PC·모바일에서 강좌를 탐색하고 온라인으로 신청 완료 |
| **Core Value** | 최소 개발 비용으로 즉시 운영 가능한 MVP를 론치하고, 이후 CMS/LMS로 점진적 확장 |

---

## 1. 사용자 의도 발견 (Phase 1 Discovery)

### 1.1 핵심 문제
- 바라 평생교육원의 오프라인·전화 중심 운영을 온라인으로 전환
- 다양한 정부 지원 교육과정(국민내일배움카드, 고용보험환급 등)을 포함한 강좌를 웹에서 안내
- 수강 신청을 온라인으로 접수하여 관리 효율화

### 1.2 타겟 사용자
| 세그먼트 | 특성 |
|---------|------|
| 직장인 / 성인 학습자 | 자격증·직무역량 향상 목적, 30~50대 |
| 구직 준비생 / 취준자 | 취업·직업 전환을 위한 교육 수강 |
| 시니어 / 증자 | 평생교육의 전통적 타깃, 50대 이상 |
| 경력단절자 (남녀) | 재취업을 위한 기술 습득 |
| 해외이주민 | 한국 생활·취업을 위한 교육 수요 |
| 기업 / B2B | 직원 교육 위탁, 단체 수강 |

### 1.3 성공 기준 (MVP)
- [ ] bara-edu.kr 도메인에서 정상 접근 가능
- [ ] 모바일/PC 모두 정상 렌더링 (반응형)
- [ ] 강좌 목록에서 상세 페이지까지 3클릭 이내 도달
- [ ] 수강 신청 구글 폼 제출 완료율 > 70%
- [ ] Google Sheets 데이터 업데이트 후 사이트 반영 < 24시간

---

## 2. 탐색한 대안 (Phase 2 Alternatives)

### Approach A: Next.js SSG + Google Sheets + Apps Script ✅ **채택**
- 강좌 데이터를 Google Sheets로 관리, Apps Script가 JSON API 제공
- 빌드 시 SSG로 정적 페이지 생성, AWS Amplify 배포
- **선택 이유**: 개발 속도 빠름, 운영 비용 최소, 비개발자가 Sheets에서 강좌 직접 관리 가능

### Approach B: Next.js + Notion CMS (미채택)
- Notion API 연동 추가 작업 필요, MVP엔 불필요한 복잡성

### Approach C: Next.js + Supabase (미채택)
- 자체 DB·관리자 페이지 구축 비용이 MVP 단계에 과도함

---

## 3. YAGNI 검토 (Phase 3)

### MVP에 포함 (1차 론치)
- [x] Coming Soon 랜딩 페이지 (오픈 전 임시)
- [x] 메인 홈페이지 (기관 소개, 대표 강좌, CTA)
- [x] 강좌 목록 페이지 (Google Sheets 연동)
- [x] 강좌 상세 페이지 (커리큘럼, 일정, 수강료, 강사)
- [x] 수강 신청 연동 (Google Forms → Sheets 자동 수집)

### 2차 작업으로 이연
- [ ] 기관 소개 (About) + 오시는 길
- [ ] 강좌 필터/검색 고도화
- [ ] 회원 시스템 (로그인, 마이페이지, 수료증)
- [ ] 정부지원과정 전용 안내 페이지
- [ ] 온라인 결제 게이트웨이 (무통장 입금 → PG 전환)
- [ ] B2B 기업교육 별도 섹션
- [ ] 커뮤니티 / 게시판

---

## 4. 기술 설계

### 4.1 기술 스택
| 영역 | 기술 | 이유 |
|------|------|------|
| Frontend | Next.js 14 (App Router) + TypeScript | SSG, SEO, 파일 기반 라우팅 |
| 스타일링 | Tailwind CSS + uipro-cli | AI팀 UI 시스템, 빠른 컴포넌트 조립 |
| 데이터 | Google Sheets + Apps Script | 비개발자 콘텐츠 관리 |
| 신청 | Google Forms | 제로 코스트, Sheets 자동 수집 |
| 배포 | AWS Amplify | CI/CD 자동화, bara-edu.kr 도메인 연결 |

### 4.2 데이터 흐름

```
관리자 (Google Sheets 강좌 수정)
    ↓
Apps Script (doGet → JSON 변환)
    ↓
Next.js 빌드 (fetch at build time, getStaticProps)
    ↓
AWS Amplify (정적 배포 + CDN)
    ↓
사용자 브라우저 (bara-edu.kr)
    ↓
수강신청 클릭 → Google Form (별도 탭)
    ↓
Google Sheets 신청 목록 자동 수집
```

### 4.3 프로젝트 구조

```
bara_edu/
├── app/
│   ├── layout.tsx              # 루트 레이아웃 (메타, 폰트, 글로벌 스타일)
│   ├── page.tsx                # 홈 (Coming Soon ↔ 메인 환경변수 토글)
│   ├── courses/
│   │   ├── page.tsx            # 강좌 목록
│   │   └── [slug]/
│   │       └── page.tsx        # 강좌 상세 (generateStaticParams)
│   └── globals.css
├── components/
│   ├── ui/                     # uipro-cli 기반 공통 컴포넌트
│   │   ├── Button.tsx
│   │   ├── Badge.tsx
│   │   └── Card.tsx
│   ├── courses/
│   │   ├── CourseCard.tsx      # 강좌 목록 카드
│   │   ├── CourseFilter.tsx    # 카테고리 필터
│   │   └── CourseDetail.tsx    # 강좌 상세 정보
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── Nav.tsx
│   └── home/
│       ├── HeroSection.tsx
│       ├── FeaturedCourses.tsx
│       └── ComingSoon.tsx
├── lib/
│   ├── google-sheets.ts        # Apps Script API 클라이언트
│   ├── types.ts                # Course, Category, Instructor 타입
│   └── utils.ts                # slug 변환, 날짜 포맷 등
├── data/
│   └── site-config.ts          # 사이트명, 연락처, SNS 링크
├── public/
│   └── images/
├── .env.local                  # APPS_SCRIPT_URL, GOOGLE_FORM_URL 등
└── next.config.js
```

### 4.4 Google Sheets 강좌 스키마

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | string | 유니크 식별자 (slug 기반) |
| title | string | 강좌명 |
| category | string | 카테고리 (IT, 외국어, 자격증 등) |
| description | text | 강좌 소개 |
| curriculum | text | 커리큘럼 (줄바꿈 구분) |
| instructor | string | 강사명 |
| startDate | date | 개강일 |
| endDate | date | 종강일 |
| schedule | string | 수업 시간 (예: 화목 19:00~21:00) |
| fee | number | 수강료 (원) |
| seats | number | 정원 |
| government | boolean | 정부지원 여부 |
| formUrl | url | 수강신청 Google Form URL |
| thumbnail | url | 강좌 이미지 URL |
| status | enum | active / upcoming / closed |

---

## 5. AI 팀 역할 정의

| 역할 | 담당 업무 | 산출물 |
|------|----------|--------|
| **Product Owner** | 기능 우선순위 결정, 스프린트 승인 | 피처 백로그 |
| **Project Manager** | 일정 관리, 이슈 추적 | 프로젝트 타임라인 |
| **Service Planner** | 강좌 카테고리 체계, 신청 플로우 설계 | 서비스 플로우 다이어그램 |
| **UX Writer** | 홈 카피라이팅, CTA 문구, 마이크로카피 | 카피 문서 |
| **Researcher** | 경쟁 교육원 벤치마킹, 타깃 사용자 인사이트 | 리서치 리포트 |
| **Marketer** | SEO 키워드, 메타 태그 전략 | SEO 가이드 |
| **UI/UX Designer** | uipro-cli 활용 디자인 시스템, 와이어프레임 | 디자인 컴포넌트 |
| **Publisher** | HTML/CSS 퍼블리싱, 반응형 마크업 검수 | 퍼블리싱 가이드 |
| **Developer** | Next.js 구현, Sheets API 연동, Amplify 배포 | 소스코드 |
| **QA** | 수강 신청 플로우 검증, 크로스 브라우저 테스트 | QA 리포트 |

---

## 6. 브레인스토밍 로그 (Phase 1-4 주요 결정)

| 단계 | 결정 사항 | 이유 |
|------|----------|------|
| Phase 1 | 복합형 사이트 (강좌안내 + 정부지원 + 신청) | 다양한 타깃 세그먼트 커버 필요 |
| Phase 1 | 타깃: 직장인, 취준자, 시니어, 경력단절자, 해외이주민, B2B | 평생교육원의 전방위 수요 반영 |
| Phase 2 | Google Sheets + Apps Script 채택 | 관리자가 코드 없이 콘텐츠 관리 가능 |
| Phase 2 | AWS Amplify 배포 | CI/CD + CDN + 도메인 관리 통합 |
| Phase 3 | 회원 시스템·온라인 결제는 2차로 이연 | MVP는 안내+신청 접수에 집중 |
| Phase 4 | uipro-cli + ui-ux-pro-max-skill 활용 | AI 팀 설계 일관성 확보 |

---

## 7. 마일스톤

| 마일스톤 | 내용 | 예상 시점 |
|---------|------|----------|
| M1 | Coming Soon 페이지 배포 (bara-edu.kr) | 1주 |
| M2 | Google Sheets 스키마 확정 + Apps Script 배포 | 1주 |
| M3 | 홈 + 강좌 목록 + 강좌 상세 개발 완료 | 2~3주 |
| M4 | Google Forms 수강신청 연동 + 테스트 | 3주 |
| M5 | QA + SEO 최적화 + 정식 오픈 | 4주 |

---

## 8. 범위 외 (Out of Scope — MVP)

- 회원 가입 / 로그인 / 마이페이지
- 온라인 결제 PG 연동
- LMS (동영상 강의, 학습 진도 관리)
- 커뮤니티 / 게시판
- 기관소개(About) 상세 페이지 (이후 추가)
- 다국어 지원

---

## Next Step

```
다음 단계: /pdca design bara-edu-mvp
```

> 설계 단계에서 uipro-cli 컴포넌트 선정, Figma 와이어프레임, Google Sheets 스키마 확정을 진행합니다.
