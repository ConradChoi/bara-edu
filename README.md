## AI팀 서브에이전트 (Claude Code용)

이 프로젝트에는 `.claude/agents/`에 Claude Code 서브에이전트 12종이 설치되어 있다. 각 파일은 하나의 "역할"을 맡은 AI 팀원이며, 바라 평생교육원(bara-edu.kr) MVP 프로젝트(`docs/01-plan/features/bara-edu-mvp.plan.md`, `docs/02-design/features/bara-edu-mvp.design.md`)에 맞춰 커스터마이징되어 있다.

### 구성

| 파일 | 역할 | 주로 담당 |
|---|---|---|
| ceo-advisor.md | 대표 | 방향 승인, 우선순위 최종 판단, MVP 스코프 가드 |
| product-manager.md | 프로덕트 매니저 (Product Owner) | 무엇을 왜 만드는가, PRD, 기능 우선순위, Figma 게이트 F9 승인 |
| project-manager.md | 프로젝트 매니저 | 일정/작업 분해, M1~M5 마일스톤 추적 |
| service-planner.md | 서비스기획 | 강좌 카테고리 체계, 신청 플로우, 화면 정의서, 예외처리 |
| ui-ux-designer.md | UI/UX 디자이너 | Figma 와이어프레임/디자인 토큰, 화면 설계 (Figma 게이트 F1~F8) |
| ux-writer.md | UX라이터 | 버튼/에러/CTA 등 제품 내 문구 |
| marketer.md | 마케터 | SEO, Coming Soon 사전신청, 런칭 전략 |
| researcher.md | 리서쳐 | 경쟁 교육원 벤치마킹, 타깃 세그먼트 인사이트 |
| publisher.md | 퍼블리셔 | Figma → Tailwind/uipro-cli 마크업, 반응형 검수 |
| developer.md | 개발자 | Next.js 구현, Sheets/Apps Script 연동, Amplify 배포 |
| qa-reviewer.md | QA | 신청 플로우 검증, 테스트 설계, 배포 전 품질 점검 |
| security-officer.md | 보안/개인정보 담당 | 개인정보 처리 검증, 시크릿/환경변수 점검, 배포 전 보안 리뷰 |

### 사용 방법

Claude Code 안에서 자연어로 요청하면 자동으로 적절한 에이전트가 호출된다 (description에 트리거 조건을 적어뒀기 때문). 특정 역할을 직접 지정하고 싶으면:

```
@product-manager 이 기능 MVP에 넣어야 돼?
@developer lib/sheets.ts 구현해줘
@qa-reviewer 신청 플로우 테스트해줘
@security-officer 배포해도 안전한지 점검해줘
```

### 팀 협업 흐름 (권장)

```
researcher → product-manager(PO) → ceo-advisor(승인)
                ↓
        service-planner ←→ ui-ux-designer ←→ ux-writer   (Figma 게이트 F1~F8)
                ↓
        product-manager(PO) F9 승인
                ↓
        project-manager (모듈 배정/일정, M1~M5)
                ↓
        publisher → developer
                ↓
        qa-reviewer ←→ security-officer  (배포 전 병행 점검)
                ↓
            ceo-advisor(오픈 승인) → marketer (런칭 시점)
```

기능 하나를 진행할 때 이 순서대로 각 에이전트를 순차 호출하면, 기획 → Figma 디자인 → 퍼블리싱 → 개발 → QA/보안 검증까지 한 팀처럼 이어진다. Figma 게이트(F1~F9) 승인 전에는 개발 착수를 배정하지 않는다.

### 프로젝트 루트 CLAUDE.md에 추가하면 좋은 것

```markdown
## AI팀 운영 원칙
- 새 기능은 product-manager(PO)의 PRD 없이 바로 구현하지 않는다.
- 화면이 있는 기능은 service-planner → ui-ux-designer → publisher 순으로 먼저 만든다 (Figma 게이트 F1~F8 통과 필수).
- developer가 작성한 코드는 qa-reviewer와 security-officer 리뷰 없이 배포하지 않는다.
- 방향이 애매한 결정은 ceo-advisor에게 승인을 받는다.
```

### 커스터마이징

- 팀 규모가 작다면 역할을 합쳐도 된다 (예: product-manager + project-manager를 하나로).
- `model:` 필드는 중요한 전략 판단(대표, PM)은 opus, 실행 위주(개발, QA, 보안)는 sonnet으로 기본 설정해뒀다. 비용/속도에 따라 조정 가능.
- `tools:` 필드로 각 에이전트가 쓸 수 있는 도구를 제한해뒀다 (예: qa-reviewer·security-officer는 코드를 직접 수정하지 못하게 Edit 제외). 필요하면 조정.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.