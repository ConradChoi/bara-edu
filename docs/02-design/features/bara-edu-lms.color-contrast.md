# 공개 화면 색 대비 접근성 수정안 (WCAG AA 4.5:1)

- 작성: 2026-11-28 (UI/UX 디자이너) / 상태: **설계안 — 대표 확정 전, 코드 미수정**
- 근거 측정: `docs/01-plan/features/bara-edu-lms.home.md` 197~200행 (Lighthouse 12 모바일, 접근성 94~96, color-contrast 미달)
- 기준 토큰: `app/globals.css`의 `@theme`, `docs/02-design/features/bara-edu-lms.design.md` 4.0
- 대비값은 WCAG 상대휘도 공식으로 직접 계산했고(소수 둘째 자리 반올림, 오차 ±0.02), 반투명 배지 배경은 흰 바탕 위에 합성한 색 기준이다. 구현 뒤 Lighthouse로 재측정해 확정한다.

## 0. 결론 한눈에 보기

| # | 미달 요소 | 수정 방식 | 바꿀 것 | 새 대비 |
|---|---|---|---|---|
| 1 | 커리큘럼 "퀴즈·과제" 배지 (info) | **새 토큰 추가** + 배지 글자색만 교체 | `text-info` 글자 -> `text-info-strong`(#0b6e99) | 5.10:1 (배경 #e4f6fd) |
| 2 | 회색 보조 글자 `text-n-5` | **토큰 값은 유지**, 글자 용도만 `text-n-6`으로 교체 | `text-n-5` -> `text-n-6`(#6b6b7c) | 5.23:1 (흰 바탕) |
| 3 | 분홍 버튼 흰 글자 | **새 토큰 추가**(버튼 전용 진한 분홍) | 흰 글자 버튼 배경 `bg-pink` -> `bg-pink-deep`(#d91b81) | 4.75:1 |
| 4 | 분홍 배지·분홍 글자 | **새 토큰 추가**(글자 전용) | `text-pink` -> `text-pink-ink`(#c4166f) | 4.88:1 (분홍 10% 배경) |

핵심 원칙: **`--color-pink`, `--color-info`, `--color-n-5`의 값은 하나도 바꾸지 않는다.** 이 토큰들은 로고·테두리·진행바·아이콘처럼 "글자가 아닌 곳"에서도 쓰이므로 값을 바꾸면 브랜드와 화면 전체가 흔들린다. 대신 "글자로 쓸 때"의 짝 토큰을 추가한다. (design.md 4.0의 "신규 정의 아님" 원칙은 YLIA 토큰 원본값을 유지한다는 뜻이므로, 원본 토큰은 그대로 두고 접근성용 파생 토큰만 더하는 이 안은 어긋나지 않는다. 4.0 표에 파생 토큰 행을 추가한다 — 10장.)

## 1. 커리큘럼 "퀴즈·과제" 배지 (info)

- 위치: `components/courses/Badge.tsx`의 `info: 'bg-info/15 text-info'`, 사용처 `app/(public)/courses/[slug]/page.tsx` 113~114행. 11px semibold라 "큰 글자(3:1)" 예외도 못 받는다.
- 현재: #4bc3f0 on #e4f6fd = 1.82:1.
- 판단: `--color-info` 값을 바꾸면 안 된다. sky(#4bc3f0)는 브랜드 보조색이며 `text-info`가 5개 파일에서 장식 용도(아이콘 글리프)로도 쓰인다. 글자 전용 짝 토큰을 추가한다.
- 추가 토큰: `--color-info-strong: #0b6e99;`
- 대비: #0b6e99 on #e4f6fd(info/15) **5.10:1**, on 흰 바탕 5.67:1, on info/10 배경 약 5.3:1.
- 바꿀 곳(글자색만, 배경 `bg-info/15`는 유지해 "연한 하늘색 배지" 인상은 그대로):

| 파일 | 변경 |
|---|---|
| `components/courses/Badge.tsx` | `info: 'bg-info/15 text-info-strong'` |
| `components/admin/StatusBadge.tsx` 5행 | 같은 클래스 (이 파일 주석대로 courses/Badge와 동일 토큰 유지) |
| `app/(public)/selfcheck/page.tsx` 13행 | `bg-info/10 ... text-info` -> `text-info-strong` (12.5px, 같은 문제. Lighthouse 측정 대상은 아니었으나 동일 미달) |
| `app/(public)/selfcheck/result/[token]/page.tsx` 183행 | "!" 글리프 `text-info` -> `text-info-strong` (aria-hidden 장식이라 필수는 아님, 같은 안내 상자 내 일관성 목적) |
| `components/admin/Notice.tsx` 12행 | `info: 'text-info'` -> `text-info-strong` (아이콘 글리프, 선택) |

- `text-info` 사용처 전수(5개 파일): selfcheck/page.tsx, selfcheck/result/[token]/page.tsx, admin/Notice.tsx, admin/StatusBadge.tsx, courses/Badge.tsx. 위 표가 전부이며 글자 용도로 남는 `text-info`는 0건이 된다. `bg-info/10`, `bg-info/15` 배경은 유지.
- 접근성 보강(선택): 배지 의미가 색에만 의존하지 않고 글자("퀴즈", "과제")가 이미 있으므로 추가 조치 불필요.

## 2. 회색 보조 글자 `text-n-5`

- 현재 #8e8e9e on #ffffff = 3.22:1 (13px 등). 강좌 상세 `dt`(강사/수강료/정원/총 강좌 시간/수강 기간), "N강", 교재 출판사, 자가진단 결과 면책 문구 등.
- 판단: **토큰 값은 바꾸지 않는다.** 이유는 `n-5`가 글자 외에도 `border-n-5`(비밀번호 입력, OTP 입력, 복구 코드 목록, 관리자 MFA 카드)와 스피너 테두리로 쓰이고, 입력 테두리는 비텍스트 대비 3:1(WCAG 1.4.11)을 맞추는 현재 값 #8e8e9e(3.22:1)가 정확히 그 용도에 적합하기 때문이다. 값을 진하게 바꾸면 테두리가 무거워지는 부작용이 생긴다.
- 수정: **글자로 쓰인 `text-n-5`를 `text-n-6`(#6b6b7c, 이미 있는 토큰)으로 교체.** 새 토큰 불필요.
- 대비 (n-6 #6b6b7c):

| 배경 | 대비 | 판정 |
|---|---|---|
| n-0 #ffffff | 5.23:1 | 통과 |
| n-1 #f7f7f9 | 4.88:1 | 통과 |
| n-2 #eeeef2 | 4.52:1 | 통과(여유 적음, n-2 배경 위 작은 글자는 n-7 권장) |

- 위계 영향: 보조 글자가 n-7(#4a4a58, 본문 보조)과 구분되는지 확인 필요. n-6(5.23)과 n-7(8.4 근방)은 여전히 눈에 띄게 다르다. 항목 이름(dt)이 값(n-9)보다 약하게 보이는 위계는 유지된다.
- 영향 범위(`text-n-5` grep: **27개 파일 51건**) — 전부 글자 용도이며 전역 일괄 교체 안전:
  - 공개/사용자: `app/(public)/courses/[slug]/page.tsx`(8), `app/(public)/selfcheck/result/[token]/page.tsx`(2), `app/(user)/my/page.tsx`(3), `app/(user)/learn/[courseId]/exam/page.tsx`(1), `components/auth/AuthForm.tsx`(1), `components/auth/ResendConfirmationForm.tsx`(1), `components/classroom/CertificateAction.tsx`(1), `components/classroom/CurriculumSidebar.tsx`(2), `components/diagnosis/DiagnosisStepper.tsx`(1), `components/home/NoticeModal.tsx`(1)
  - 관리자(1280px 데스크톱 전용 화면, 같은 규칙 적용): admin/assignments(3), categories(1), certificates(4), cms(1), cms/[id]/edit(1), courses/[id](1), courses/[id]/exam(1), courses/[id]/lessons/[lessonId]/quiz(1), enrollments(2), exam-bank(2), members(1), members/[id](1), page.tsx 대시보드(6), selfcheck(1), selfcheck/[id](2), selfcheck/leads(1), `components/admin/MemberProfileEditor.tsx`(1)
- 관리자 화면은 밀도 우선 콘솔이라 11~12px 글자가 많다. 대비 4.5:1은 크기와 무관하게 필요하므로 함께 교체한다(별도 예외 없음).
- **일부러 흐리게 둔 용도 구분**
  - `text-n-4`(#b8b8c4): `components/ui/ConfirmDialog.tsx` 72행(비활성 버튼, 이유는 title로 안내) — WCAG 1.4.3은 비활성 컨트롤을 대비 기준에서 제외하므로 **유지**. `admin/categories/page.tsx` 121행(비활성 카테고리, 취소선) — 상태 표현이지만 글자 정보가 읽혀야 하므로 **n-4 -> n-6 으로 올리고 `line-through`로 상태 구분을 유지**하길 권장(선택).
  - `placeholder:text-n-5`(3곳: `MemberProfileEditor.tsx`, `AuthForm.tsx` 265행, `ResendConfirmationForm.tsx` 88행): 입력 예시 안내 글자. Lighthouse는 플레이스홀더를 판정하지 않지만 시니어에게는 읽히지 않는 안내가 곧 장애이므로 **`placeholder:text-n-6`으로 교체**(이미 `PasswordField.tsx`가 n-6을 쓰고 있어 일관성도 맞는다). 그래서 위 51건 중 플레이스홀더 3건도 같이 교체 대상이다.
  - `border-n-5`, `bg-n-5` 계열: **유지**(비텍스트 3:1 용도).
- 교체 후 `n-5`의 역할: "테두리·스피너 등 비텍스트 전용"으로 의미가 좁아진다. 글자에 n-5를 쓰지 않는다는 규칙을 design.md에 한 줄 명시한다(10장).

## 3. 분홍 배경 + 흰 글자 (버튼·선택 칩)

- 현재 #ffffff on #e11e87 = 4.43:1. 4.5에 0.07 모자라지만 14px/12.5px는 "큰 글자"가 아니라 통과가 아니다(큰 글자 3:1은 18.66px bold 이상).
- 대상(grep `bg-pink` + `text-white`): 32개 파일 46건. 대표: "로그인하고 신청하기"(`courses/[slug]/page.tsx`, 3건), `components/courses/FilterChip.tsx`(선택된 카테고리 칩 `border-pink bg-pink text-white`), 홈 `HeroBanner`, 자가진단 스텝퍼·결과, 마이 페이지, 강의실 폼 버튼, 관리자 저장 버튼 등. 폭넓게 퍼져 있다.
- **대안 비교**

| 대안 | 결과 | 판단 |
|---|---|---|
| A. `--color-pink` 값 자체를 #d91b81 등으로 변경 | 전역 일관 | **비권장.** 로고와 브랜드 분홍이 어긋나고, `border-pink`·진행바·포커스 등 글자 아닌 용도까지 전부 바뀜 |
| B. 새 토큰 `pink-deep`(#d91b81)을 "흰 글자가 올라가는 분홍 면" 전용으로 추가 (**권장**) | 4.75:1, 육안 차이 작음 | 브랜드 분홍은 로고·테두리·포커스·분홍 면(글자 없는 진행바 등)에 그대로 유지 |
| C. 색은 두고 글자를 굵게/크게 | 14px bold는 큰 글자 아님 -> 여전히 4.43 | 불가 |
| D. 흰 글자 대신 n-9 어두운 글자 | 분홍 위 n-9은 대비는 충분하나 브랜드 CTA 인상 훼손 | 비권장 |

- 추가 토큰: `--color-pink-deep: #d91b81;` — 흰 글자 대비 **4.75:1**(L=0.171). #e11e87 대비 명도 약 6% 낮아져 나란히 놓지 않으면 같은 분홍으로 보인다.
- hover/pressed 상태가 있으면 `#c4166f`(`pink-ink`, 흰 글자 5.69:1)를 쓰면 진해지는 방향이라 대비는 더 올라간다.
- 바꿀 곳 규칙(구현용 grep 기준): 같은 클래스 문자열 안에 `bg-pink`와 `text-white`가 함께 있는 곳 -> `bg-pink` 를 `bg-pink-deep`로. `border-pink`도 같은 요소에 있으면 `border-pink-deep`로 맞춰 가장자리가 어긋나지 않게 한다. `bg-pink`만 있고 글자가 없는 요소(ProgressBar, ScoreBar의 채움 막대 등)는 **그대로 둔다**.
- 브랜드 영향: 로고, 파비콘, 히어로 이미지 속 분홍, 포커스 링은 변하지 않는다. 버튼·선택 칩만 한 톤 진해진다. 대표 승인이 필요하다(11장 결정 1).

## 4. 분홍 글자 / 분홍 연한 배경 배지

- 현재: `bg-pink/10 text-pink` = 3.81:1 (홈 `components/home/NoticeModal.tsx` 62행 11.5px 배지; `components/home/DiagnosisBanner.tsx`는 `bg-pink/10` 배경 위 글자 확인 필요). 같은 조합이 관리자 필터 칩(`admin/exam-bank` 78행, `admin/selfcheck` 82·94행)과 `DiagnosisStepper` 354행 선택 칩(`has-[:checked]:bg-pink/10 has-[:checked]:text-pink`)에도 있다.
- 또한 **흰 배경 위 `text-pink`도 4.43:1로 미달**이다(FilterChip hover, 탭 활성 `admin/assignments` 71행 등). `text-pink` 전체 22건/14개 파일이 같은 규칙으로 정리된다.
- 판단: 배지 배경 투명도를 낮춰도 해결되지 않는다(분홍/5% 배경에서 #d91b81 글자가 4.40). 글자 전용 토큰이 필요하다.
- 추가 토큰: `--color-pink-ink: #c4166f;`
- 대비: #c4166f on 분홍 10% 배경(#fce8f3 근방) **4.88:1**, on 흰 바탕 **5.69:1**, on n-1 약 5.3:1.
- 바꿀 곳: 글자 용도의 `text-pink` -> `text-pink-ink`, `hover:text-pink` -> `hover:text-pink-ink`, `has-[:checked]:text-pink` -> `has-[:checked]:text-pink-ink`. `border-pink`, `bg-pink/10` 배경은 **유지**(배지는 연분홍 면 + 분홍 테두리의 브랜드 인상 그대로, 글자만 진해짐).
- 대상 파일(grep `text-pink`): `courses/FilterChip.tsx`, `home/NoticeModal.tsx`, `diagnosis/DiagnosisStepper.tsx`(2), `diagnosis/LeadForm.tsx`(2), `auth/AuthForm.tsx`(4), `classroom/CertificateAction.tsx`(2), `classroom/LessonPlayer.tsx`, `(user)/my/page.tsx`, `(user)/learn/[courseId]/exam/page.tsx`, `(public)/selfcheck/result/[token]/page.tsx`(2), admin `assignments`, `enrollments`, `exam-bank`, `selfcheck`(2).
- 링크성 분홍 글자(AuthForm 등)는 본문 14px 안팎이라 같은 토큰을 쓴다. 밑줄 유지 여부는 기존 스타일을 따른다.

## 5. 이번 측정에는 없었지만 같은 구조로 미달인 항목 (추가 발견, 같이 처리 권장)

`components/courses/Badge.tsx`와 `components/admin/StatusBadge.tsx`의 `warning`·`danger` 배지도 같은 방식(`text-X on bg-X/15`)이다. 로그인 뒤·관리자에서 쓰여 이번 Lighthouse에는 안 잡혔다.

| 배지 | 현재 | 제안 토큰 | 새 대비 |
|---|---|---|---|
| warning (#f0963c on #fdefe2 근방) | 약 2.04:1 | `--color-warning-strong: #9a5a00` | 약 4.86:1 |
| danger (#e14b3c on #fae4e2 근방) | 약 3.28:1 (흰 바탕 위 글자도 3.98:1) | `--color-danger-strong: #b42318` | 약 5.41:1 (흰 바탕 6.57:1) |

이 둘은 범위 밖이므로 **대표가 이번 수정에 포함할지 결정**한다(11장 결정 3). `text-success`(#1da463)도 흰 바탕 약 3.3:1로 글자에 쓰면 미달이며, 사용처는 별도 grep 후 같은 방식으로 `success-strong`을 정한다(이 문서에서는 미확정).

## 6. 최종 토큰 추가안 (`app/globals.css` `@theme`에 추가될 값, 구현은 frontend)

```css
/* 접근성(AA 4.5:1)용 파생 토큰 — 원본 토큰은 그대로 두고 "글자·흰 글자 배경" 용도만 분리 */
--color-pink-deep: #d91b81;   /* 흰 글자가 올라가는 분홍 면(버튼·선택 칩). 흰 글자 4.75:1 */
--color-pink-ink: #c4166f;    /* 분홍 글자·hover (흰 5.69:1, 분홍10% 배경 4.88:1) */
--color-info-strong: #0b6e99; /* 하늘색 배지 글자 (info/15 배경 5.10:1) */
/* 선택(5장 결정 시) */
--color-warning-strong: #9a5a00;
--color-danger-strong: #b42318;
```

기존 토큰(`--color-pink`, `--color-info`, `--color-n-5` 등) 값 변경 없음. 다크모드(`html.dark`)는 현재 `globals.css`에 오버라이드가 없어 이번 범위에서 제외한다.

## 7. 구현 체크(frontend용, 설계 외 참고)

1. `globals.css`에 토큰 추가 -> 클래스 교체(2~4장) -> `npm run build`/스냅샷 테스트 갱신. `test/components/confirm-dialog.test.ts`는 `text-n-4`(비활성, 유지)라 영향 없음. 다른 테스트의 인라인 스냅샷에 `text-n-5`/`text-pink`가 있으면 함께 갱신.
2. 검증: Lighthouse 모바일 3개 화면(홈·강좌 목록·강좌 상세) color-contrast 통과, 로그인 뒤 화면과 관리자는 수동 확인.
3. Tailwind v4는 `@theme`의 `--color-*`가 자동으로 `bg-*`, `text-*`, `border-*` 유틸리티가 된다(`pink-deep`, `pink-ink`, `info-strong`).

## 8. 시각 영향 요약

| 항목 | 눈에 띄는 변화 |
|---|---|
| 회색 보조 글자 | 한 단계 진해져 시니어에게 읽기 쉬워짐. 위계는 유지 |
| info 배지 | 하늘색 글자 -> 진한 청록 계열 글자, 배경 면은 그대로 |
| 분홍 버튼 | 약 6% 진해진 분홍(거의 같은 색으로 보임) |
| 분홍 글자·배지 | 글자만 진한 마젠타, 배경·테두리는 그대로 |
| 로고·파비콘·히어로 | 변화 없음 |

## 9. F8(카피) 영향

글자 내용 변경 없음. ux-writer 재검수 불필요.

## 10. design.md 반영 문구 (확정 후 4.0 표 아래에 추가할 내용)

- 4.0 토큰 표에 "접근성 파생(글자용)" 행 추가: `pink-deep #D91B81`(흰 글자 면), `pink-ink #C4166F`(분홍 글자), `info-strong #0B6E99`(info 글자).
- 규칙 두 줄: "글자에는 `n-5`를 쓰지 않는다(`n-6` 이상). `n-5`는 테두리·비텍스트 전용" / "`pink`, `info` 원본 토큰은 면·테두리·아이콘 전용, 글자·흰 글자 배경에는 파생 토큰을 쓴다".
- Figma Foundations Colors 변수에도 파생 토큰 3종을 추가(Figma-First 원칙, 변수명은 코드 토큰과 동일하게).

## 11. 대표 결정 사항

1. **브랜드 분홍**: 권장안 B(원본 `#e11e87` 유지, 버튼·선택 칩 면만 `#d91b81`, 분홍 글자는 `#c4166f`)로 갈지, 아니면 분홍 면을 지금 색(4.43:1) 그대로 두고 미달을 감수할지. (전역 변경 A안은 로고와 어긋나 비권장.)
2. **`text-n-5` 일괄 교체** 승인 — 관리자 화면 27개 파일 51건 포함 여부(관리자 제외도 가능하나 일관성상 포함 권장).
3. **warning·danger 배지(5장)** 를 이번에 함께 고칠지 별도로 할지.
4. 선택: 비활성 카테고리 `text-n-4 line-through`(admin/categories 121행)를 n-6으로 올릴지.

### 11-1. 대표 결정 (2026-11-28)

1. 브랜드 분홍: **권장안 B로 간다.** 원본 `#e11e87`은 그대로 두고, 버튼과 선택 칩 면은 `pink-deep`, 분홍 글자는 `pink-ink`를 쓴다.
2. `text-n-5` 일괄 교체: **관리자 화면을 포함한다.**
3. warning·danger·success: **이번에 함께 고친다.** 값은 아래와 같고, 대비는 WCAG 공식으로 다시 계산했다.
   - `--color-warning-strong: #9a5a00`: warning 15% 배경 4.85:1, 흰 바탕 5.47:1
   - `--color-danger-strong: #b42318`: danger 15% 배경 5.42:1, 흰 바탕 6.57:1
   - `--color-success-strong: #11703f`: success 15% 배경 5.22:1, 흰 바탕 6.15:1. `#137a48`은 4.56:1로 여유가 없어 쓰지 않는다.
4. 비활성 카테고리 `text-n-4 line-through`: **이번에는 바꾸지 않는다.** 선택 항목이라 그대로 둔다.
