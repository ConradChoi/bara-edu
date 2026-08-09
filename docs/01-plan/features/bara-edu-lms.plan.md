# 바라 평생교육원 — LMS(User) + Admin 콘솔 Plan

> **프로젝트**: 바라 평생교육원 (bara-edu.kr)
> **운영사**: 주식회사 일리아 (ylia.io)
> **작성일**: 2026-08-01
> **단계**: Plan (PDCA Phase 1)
> **버전**: v1.0
> **관계 문서**: [bara-edu-mvp.plan.md](./bara-edu-mvp.plan.md) — 본 문서가 흡수·확장하는 선행 계획

---

## Executive Summary

| 관점 | 내용 |
|------|------|
| **Problem** | 강좌 안내·신청까지만 온라인화된 상태로는 실제 "수강"(학습, 진도, 수료)과 "운영"(강좌/회원/결제 관리)이 여전히 오프라인·수작업에 머문다 |
| **Solution** | Supabase(Auth+DB) 기반 풀 LMS(강의실·진도·퀴즈/과제·수료증)와 운영자 Admin 콘솔을 함께 구축, 기존 강좌안내 MVP와 **동시에 정식 오픈** |
| **Function UX Effect** | 학습자는 가입 → 강좌 신청 → (무통장입금) → 승인 → 강의 수강 → 수료증까지 웹/모바일 브라우저에서 끊김 없이 진행. 운영자는 Admin 콘솔에서 강좌·신청·입금·수료를 한 곳에서 처리 |
| **Core Value** | 완성될 때까지 Coming Soon으로 무결점 상태를 유지하고, 강좌안내+LMS+Admin을 한 번에 열어 "반쯤 만든 사이트"로 오픈하는 리스크를 없앤다 |

---

## 0. 의사결정 배경 (2026-08-01 ceo-advisor 승인 사항)

| 항목 | 결정 |
|---|---|
| LMS 범위 | **풀 LMS** — 동영상(링크 방식, 자체 업로드 없음) + 진도관리 + 퀴즈/과제 + 수료증 + 결제 |
| 백엔드 | **Supabase** (Auth, Database, 필요 시 Storage는 서류 첨부 등 제한적 용도로만) |
| 결제 | 온라인 결제(PG) 지향하되, **PG 계약 전에는 무통장입금 수동 승인으로 우선 진행** — 이후 PG로 단계적 전환 |
| 화면 구성 | USER(학습자) 화면 + Admin(운영자) 화면 분리 구축 |
| 오픈 전략 | **동시 오픈** — 기존 강좌안내 MVP(bara-edu-mvp.plan.md)의 미완성분(강좌 목록/상세/신청, 배포)을 이 계획에 흡수해 LMS+Admin과 함께 완성 후 한 번에 오픈. 완성 전까지는 지금처럼 Coming Soon 페이지만 노출 |
| 디바이스 | 웹/모바일 브라우저 반응형으로 동시 대응. 하이브리드 앱은 **추후** — 지금은 만들지 않되 Supabase API 우선 설계로 재사용 가능성만 확보 |
| 디자인 레퍼런스 | `YLIA_UX_Pattern_Guide.html` + `YLIA_브랜드가이드라인.pdf` 채택 — USER 화면=교육·인증형 archetype, Admin 화면=운영 콘솔 archetype |

---

## 1. 사용자 의도 발견 (Phase 1 Discovery)

### 1.1 핵심 문제
- 강좌 "신청"까지는 온라인화해도, 신청 이후(입금 확인, 수강 시작, 진도 확인, 수료 처리)가 여전히 전화·수기 관리로 남으면 온라인 전환의 의미가 반감된다.
- 강좌 데이터를 Google Sheets로 수동 관리하는 방식은 회원·결제·진도와 연결되는 순간 정합성이 깨진다 — 하나의 시스템에서 강좌·회원·수강·결제를 함께 다뤄야 한다.

### 1.2 대상 사용자 (역할 2종)
| 역할 | 세그먼트 | 니즈 |
|---|---|---|
| 학습자(USER) | 직장인/성인 학습자, 취준자, 시니어, 경력단절자, 해외이주민, B2B 담당자 | 쉬운 가입, 명확한 입금/승인 안내, 이해하기 쉬운 강의실 UI, 진도·수료증 확인 |
| 운영자(Admin) | 바라 평생교육원 내부 운영 담당자 | 강좌 등록/수정, 신청·입금 확인, 회원 관리, 수료 처리를 하나의 화면에서 빠르게 처리 |

### 1.3 성공 기준
- [ ] 회원가입~강좌 신청~입금~수강 시작까지 학습자가 이탈 없이 완료 가능
- [ ] 운영자가 무통장입금 확인 후 3클릭 이내로 수강 권한을 부여할 수 있음
- [ ] 강의실 진도율이 정확히 기록되고, 완료 조건 충족 시 수료증이 자동 발급됨
- [ ] 웹/모바일 브라우저 반응형 정상 동작 (Admin은 데스크톱 우선, 최소 지원 폭 1280px)
- [ ] 완성 전까지 bara-edu.kr은 Coming Soon만 노출 (미완성 화면 노출 없음)

---

## 2. 탐색한 대안 (Phase 2 Alternatives)

### Approach A: Supabase (Auth + Postgres DB) ✅ **채택**
- 회원 인증, 강좌/신청/결제/진도/수료 데이터를 관계형으로 관리, RLS로 학습자/운영자 권한 분리
- **선택 이유**: BaaS라 서버 인프라를 직접 구축하지 않고도 인증+DB+API를 빠르게 확보. 강좌 데이터까지 Supabase로 옮기면 Admin이 직접 CRUD 가능해져 Google Sheets 수동 관리가 필요 없어짐

### Approach B: Google Sheets/Forms 유지 + 별도 LMS 시스템 연동 (미채택)
- 강좌 카탈로그는 Sheets, 회원/진도는 별도 시스템 — 두 시스템 간 강좌 ID 동기화가 지속적 운영 부담이 되고, Admin이 두 곳을 오가며 관리해야 함

### Approach C: 자체 서버 + DB 직접 구축 (Node/Express + PostgreSQL 등) (미채택)
- 인증/권한/RLS를 처음부터 구현해야 해 MVP~LMS 전환 기간 내 완성이 어려움. Supabase가 이미 제공하는 것을 다시 만드는 셈

### 데이터 마이그레이션 결정
기존 MVP plan의 "Google Sheets 강좌 스키마"는 **Supabase `courses` 테이블로 이관**한다. Google Forms 기반 신청은 **자체 신청 플로우(무통장입금 안내 포함)로 대체**한다. 이 결정으로 bara-edu-mvp.plan.md 4.1~4.4의 Sheets/Forms 관련 항목은 본 문서 기준으로 대체된다.

---

## 3. YAGNI 검토 (Phase 3)

### 포함 (이번 통합 오픈 범위)
**공통 강좌안내(기존 MVP 흡수분)**
- [x] 강좌 목록/상세 (Supabase 기반으로 재구현)
- [x] Coming Soon (기존 구현 유지, 오픈 전까지 노출)

**USER (LMS)**
- [x] 회원가입/로그인 (이메일+비밀번호, Supabase Auth)
- [x] 마이페이지 (내 강좌, 진도, 신청/입금 내역, 수료증)
- [x] 강좌 신청 + 무통장입금 안내 (계좌/입금자명 매칭 안내, 입금 확인 대기 상태 표시)
- [x] 강의실 (커리큘럼 목록 → 링크형 강의 재생 화면 → 수강 완료 체크)
- [x] 진도율 계산 및 표시
- [x] 퀴즈 (기본형: 객관식) / 과제 (텍스트 또는 링크 제출)
- [x] 수료증 발급 (조건 충족 시 PDF/이미지 다운로드)
- [x] **회원 탈퇴** (진행 중 강좌 있으면 차단, 소프트 삭제+개인정보 즉시 익명화, 재가입 허용 — 2026-08-02 추가)
- [x] **약관·정책 공개 페이지** (`/legal/[slug]`, CMS에서 관리하는 최신 published 버전 노출 — 2026-08-02 추가)

**Admin**
- [x] Admin 로그인 (역할 기반 접근 제어)
- [x] 대시보드 (신규 신청/입금 대기/수료 임박 요약)
- [x] 강좌 관리 (등록/수정/커리큘럼·강의 링크 등록, **최대 3Depth 카테고리 선택** — 2026-08-02 추가)
- [x] 회원 관리 (학습자 목록/상세, **탈퇴 회원 조회** 포함 — 2026-08-02 추가)
- [x] 신청·입금 관리 (무통장입금 확인 → 수강 권한 부여)
- [x] 진도/수료 관리 (수료 조건 확인, 수료증 발급 상태 확인)
- [x] **카테고리 관리** (최대 3Depth 트리 CRUD, 강좌 연결된 카테고리는 삭제 대신 비활성화 — 2026-08-02 추가)
- [x] **약관·정책 CMS** (이용약관/개인정보처리방침/환불정책 등 문서 CRUD + 버전 관리 — 2026-08-02 추가)

### 2차 이연 (이번 오픈 범위에서 제외)
- [ ] 소셜 로그인 (카카오/네이버 등) — 이메일 가입으로 우선 검증
- [ ] PG 자동결제 — PG 계약 완료 후 별도 단계로 전환 (무통장입금 우선)
- [ ] 동영상 자체 업로드/스트리밍 — 링크 방식 유지, 자체 호스팅은 트래픽/비용 검증 후 재검토
- [ ] 퀴즈 자동 채점 고도화(서술형 AI 채점 등), 과제 표절 검사
- [ ] 하이브리드 앱 — Supabase API 우선 설계로 나중 전환만 대비, 지금 만들지 않음
- [ ] 커뮤니티/게시판, 다국어 지원 (기존 MVP plan과 동일하게 이연 유지)

---

## 4. 기술 설계

### 4.1 기술 스택
| 영역 | 기술 | 이유 |
|------|------|------|
| Frontend | Next.js (App Router) + TypeScript, React 19 | 기존 프로젝트 스택 유지 (package.json 기준 Next 16.2.7) |
| 스타일링 | Tailwind CSS + uipro-cli + **YLIA 디자인 토큰** | `YLIA_UX_Pattern_Guide.html`의 CSS 토큰을 Tailwind config에 이식, 회사 공통 디자인 시스템과 일치 |
| 인증/DB | **Supabase** (Auth, Postgres, RLS) | 회원/강좌/신청/결제/진도/수료를 관계형으로 통합 관리 |
| 결제 | 무통장입금(수동 확인) → PG 연동(계약 후 단계적 전환) | PG 계약 리스크를 오픈 일정에서 분리 |
| 동영상 | 외부 링크(YouTube 비공개 등) 임베드 | 자체 스토리지/스트리밍 비용·복잡도 회피 |
| 배포 | AWS Amplify (bara-edu.kr) | 기존 결정 유지 |

### 4.2 라우트 구조 (개요)
```
app/
├── (public)/                 # 기존 강좌안내 + Coming Soon
│   ├── page.tsx               # 홈 (IS_OPEN 토글)
│   └── courses/[slug]/
├── (auth)/
│   ├── sign-in/  sign-up/
├── (user)/                    # 로그인 학습자 전용
│   ├── my/                    # 마이페이지 (신청내역/진도/수료증)
│   └── learn/[courseId]/      # 강의실 (커리큘럼, 강의 재생, 퀴즈/과제)
└── (admin)/                   # 운영자 전용, 역할 기반 접근
    ├── dashboard/
    ├── courses/                # 강좌 CRUD
    ├── members/                # 회원 관리
    ├── enrollments/            # 신청·입금 관리
    └── certificates/           # 수료 관리
```

### 4.3 Supabase 데이터 모델 (개요 — 상세는 Design 단계에서 확정)
| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `profiles` | user_id, name, phone, role(learner/admin) | Supabase Auth users와 1:1 |
| `courses` | id, title, category, description, curriculum, instructor, fee, seats, government_support, status | 기존 Sheets 스키마 이관 |
| `lessons` | id, course_id, title, video_url, order | 링크형 강의 |
| `enrollments` | id, user_id, course_id, status(pending/paid/approved/rejected), payment_method | 무통장입금 상태 포함 |
| `progress` | user_id, lesson_id, completed_at | 강의별 완료 체크 |
| `quizzes` / `quiz_submissions` | course_id, questions(json), user_id, score | 객관식 기본형 |
| `assignments` / `assignment_submissions` | course_id, user_id, content/link, status | 텍스트/링크 제출 |
| `certificates` | user_id, course_id, issued_at, file_url | 수료 조건 충족 시 생성 |

RLS 원칙: 학습자는 본인 데이터만 read/write, 운영자(role=admin)는 전체 read/write. 세부 정책은 Design 단계에서 developer가 확정.

### 4.4 무통장입금 운영 플로우 (엣지케이스 — service-planner 확정 필요)
```
학습자: 강좌 신청 → 무통장입금 안내 확인 → 계좌 이체
Admin: 입금 대기 목록 확인 → 입금 확인 → [승인] 클릭 → enrollments.status=approved → 학습자 강의실 접근 권한 즉시 부여
(미입금 장기 대기 시 자동 만료/리마인드 정책은 Design 단계에서 확정)
```

---

## 5. AI 팀 역할 정의 (`.claude/agents/` 12종 기준)

| 역할 | 담당 업무(LMS+Admin 확장분) | 산출물 |
|---|---|---|
| **CEO Advisor** | 오픈 전략(동시 오픈) 승인, 마일스톤별 Go/No-Go, 보안 게이트 최종 확인 | 의사결정 로그 |
| **Product Owner** | 본 Plan/PRD, MVP-LMS 스코프 관리, Figma 게이트 F9 승인 | 본 문서, 피처 백로그 |
| **Project Manager** | 마일스톤/모듈 일정 관리, 동시 오픈 준비 상태 추적 | WBS, 진행 보고 |
| **Service Planner** | USER/Admin 플로우, 무통장입금 엣지케이스, 퀴즈/과제 화면 정의서 | 서비스 플로우, 화면 정의서 |
| **UI/UX Designer** | YLIA UX Pattern Guide 기반 Figma 설계(교육·인증형 + 운영 콘솔) | Figma 파일, 디자인 토큰 |
| **UX Writer** | 가입/입금/승인/수료 관련 카피, Admin 라벨 | 카피 문서 |
| **Publisher** | LMS/Admin 화면 마크업, 반응형(Admin=데스크톱 우선) | 퍼블리싱 결과물 |
| **Developer** | Supabase 스키마/RLS 구현, Next.js 라우트 구현, 배포 | 소스코드 |
| **QA** | 신청~입금~승인~수강~수료 전체 플로우 검증 | QA 리포트 |
| **Security Officer** | Supabase 개인정보(회원정보, 결제 확인용 계좌정보) 처리 검증, RLS/권한 점검 | 보안 체크리스트 |
| **Researcher** | 유사 교육기관의 LMS/무통장입금 운영 사례 조사 | 리서치 리포트 |
| **Marketer** | 동시 오픈 시점 SEO/런칭 캠페인 | SEO 가이드 |

---

## 6. 브레인스토밍 로그 (2026-08-01 결정)

| 단계 | 결정 사항 | 이유 |
|---|---|---|
| CEO 1차 검토 | LMS+Admin을 즉시 승인하지 않고 스코프 확인 질문 | Sheets/Forms 인프라로는 LMS 불가능, 아키텍처 전환 규모 확인 필요 |
| 스코프 확정 | 풀 LMS + Supabase + 링크형 영상 + 무통장입금 우선 | 예산/일정에 맞게 결제는 단계적으로, 영상은 비용 최소화 |
| 오픈 전략 확정 | 기존 MVP와 LMS+Admin **동시 오픈** | 반쯤 만든 사이트로 여는 리스크보다 완성 후 한 번에 여는 것을 선택 |
| 디바이스 전략 | 반응형 우선, 하이브리드 앱은 추후(가드레일만) | 지금 앱까지 만드는 것은 과설계(YAGNI) |
| 디자인 레퍼런스 | YLIA UX Pattern Guide + 브랜드가이드라인 채택 | 회사 공통 자산 재사용, 디자인 토큰 재정의 불필요 |

---

## 7. 마일스톤 (bara-edu-mvp의 M1~M5를 흡수·재정의)

| 마일스톤 | 내용 | 비고 |
|---|---|---|
| L1 | Coming Soon 유지 (완료) | 기존 구현 그대로 노출 지속 |
| L2 | Supabase 프로젝트 구성 + 스키마/RLS 확정 | courses 포함 전체 테이블 |
| L3 | 강좌 목록/상세 (Supabase 기반, 기존 MVP module-4 대체) | |
| L4 | 회원가입/로그인 + 강좌 신청 + 무통장입금 플로우 | |
| L5 | 강의실(진도) + 퀴즈/과제 + 수료증 | |
| L6 | Admin 콘솔 (강좌/회원/신청·입금/수료 관리) | |
| L7 | 통합 QA + 보안 점검 + SEO + **동시 정식 오픈** | Coming Soon 해제 시점 |

---

## 8. 범위 외 (Out of Scope)

- 소셜 로그인, PG 자동결제(계약 전), 동영상 자체 업로드/스트리밍
- 퀴즈 서술형 자동채점, 과제 표절 검사
- 하이브리드 앱 실제 구현 (가드레일만 반영)
- 커뮤니티/게시판, 다국어 지원

---

## Next Step

```
다음 단계: service-planner에게 USER/Admin 플로우 및 무통장입금 엣지케이스 정의 요청
이후: /pdca design bara-edu-lms (Figma 게이트 포함 Design 문서 작성)
```

> Figma 디자인 게이트(F1~F9) 완료 전까지 developer 착수는 승인되지 않는다 (ceo-advisor.md 판단 기준 3).
