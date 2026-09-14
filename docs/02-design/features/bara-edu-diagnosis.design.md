# bara-edu-diagnosis Design Document (도형심리 역량진단, `/selfcheck`)

> **Summary**: 결제·수강 이전 유입 퍼널 "자가진단". 기존 YLIA 디자인 시스템(bara-edu-lms Figma 파일) 토큰·컴포넌트를 그대로 이식하고, 신규는 ScoreBar·Radar SVG 등 최소한만 추가한다.
>
> **Project**: 바라 평생교육원 (bara-edu.kr)
> **Author**: UI/UX Designer (AI Team)
> **Date**: 2026-09-14
> **Status**: **F1 완료(2026-09-14, PO 세션에서 Figma MCP 도구 노출 확인 후 직접 반영). F2~F8도 완료 — F8만 ux-writer 정식 검수 대기.**
> **Planning Docs**: [bara-edu-diagnosis.menu-features.md](../../01-plan/features/bara-edu-diagnosis.menu-features.md)(F-DIAG-*/F-ADMDG-*) · [bara-edu-diagnosis.flows.md](../../01-plan/features/bara-edu-diagnosis.flows.md)(스테퍼·결과 3상태·리드폼·관리자 플로우)
> **참조**: [bara-edu-lms.design.md](./bara-edu-lms.design.md) 4.0(토큰)·4.5(홈 섹션 추가 선례)·4.6.7~4.6.10(상태 배지형 화면 선례) — 이번 문서는 이 파일의 확장이 아니라 별도 유입 퍼널이라 분리하되, 토큰·컴포넌트는 100% 승계한다.

---

## 0. Figma 반영 결과 (2026-09-14 후속 — PO 세션에서 직접 수행)

앞서 ui-ux-designer 서브에이전트 세션에는 Figma MCP 도구가 노출되지 않아 텍스트 와이어프레임으로 F1~F8을 갈음했으나(아래 원본 기록 유지), 이어진 PO(대표) 세션에서는 Figma 도구가 정상 노출되어 **실제 Figma 파일에 화면 10개를 직접 반영했다.**

**작업 파일**: 기존 Figma 파일 `H141QVdsrLybIakYlIZVXB` 재사용(신규 파일 생성 안 함).

**신규 페이지 2개 + 프레임 10개**:

| 페이지 | 프레임 | 크기 | 대응 절 |
|---|---|---|---|
| `13 자가진단(도형심리)` | 13a 랜딩 | 420×420 | 3.1 |
| | 13b 스테퍼 · 기본정보 | 420×620 | 3.2 |
| | 13c 스테퍼 · 문항응답 | 420×720 | 3.2 (B1 정상 응답 + B2 미응답 오류 상태 함께 표현) |
| | 13d 결과 · 요약 (State A) | 420×700 | 3.3 |
| | 13e 결과 · 상세 (State C) | 420×1080 | 3.3 (ScoreBar 6개 + RadarChart + 강점/보완 + 추천이유 + PDF버튼) |
| | 13f 강사과정 리드폼 | 420×537 | 3.4 |
| | 13g 홈 배너 · F-DIAG-2 | 800×140 | 3.6 |
| `14 Admin 진단·문의관리` | 14a 진단 결과 목록 | 1280×700 | 3.5 |
| | 14b 진단 결과 상세 | 700×900 | 3.5 |
| | 14c 강사과정 문의 목록 | 1280×700 | 3.5 (상태 배지 3종 + 액션 버튼) |

**신규 컴포넌트 2개를 실제로 컴포넌트화**(인스턴스로 배치, 하드코딩 프레임 아님):
- `ScoreBar` — 6영역 점수 막대(label+value+진행바). 13e·14b 양쪽에서 동일 컴포넌트의 인스턴스로 재사용.
- `RadarChart` — 6축 인라인 SVG polygon(`figma.createNodeFromSvg`로 직접 생성, 라이브러리 미사용 원칙 준수). 13e에 배치.

**기존 컴포넌트 재사용 확인**: AppHeader(Kind=Public), Button(Primary/Secondary), Badge(Info/Success/Warning/Neutral), Input, Textarea, FilterChip, AdminTopbar, NavItem(Depth=1) — 전부 기존 "Components" 페이지의 정의를 `getNodeByIdAsync(id).createInstance()`로 인스턴스화했다(같은 파일 내 컴포넌트라 `importComponentByKeyAsync`는 사용 불가 — 다른 화면 작업 때도 동일하게 확인된 제약).

**작업 중 발견해 즉시 고친 이슈**:
1. ScoreBar 컴포넌트의 라벨 텍스트를 마스터에서 짧은 placeholder로 만든 뒤 인스턴스에서 긴 텍스트로 덮어쓰자, `textAutoResize`가 이미 고정폭(HEIGHT 모드)으로 굳어 있어 줄바꿈이 발생 — 각 인스턴스의 label/value 텍스트 노드에 `textAutoResize = 'WIDTH_AND_HEIGHT'`를 다시 적용해 해결.
2. 리드 목록 목업(14c) 초안 작성 중 실수로 대화에 언급됐던 실제 개인 이메일 주소가 샘플 데이터로 들어간 것을 발견해 즉시 `hana****@example.com` 형태의 명백한 가짜 값으로 교체.
3. `Toast` 컴포넌트가 실제로 Figma "Components" 페이지에 존재함을 확인(Kind=Success/Info/Warning) — 아래 §"Toast 컴포넌트 존재 확인" 참고, 코드베이스에는 대응 React 컴포넌트가 없다는 기존 기록은 유효하다.

**미반영(범위 밖)**: 13c는 B1·B2 2문항만 대표로 만들고 "…(같은 형식으로 B3~B5)" 안내 텍스트로 나머지를 대체했다 — 실제 화면은 5문항 전부 렌더되지만, 패턴이 완전히 동일해 Figma 목업에서 반복 배치할 실익이 낮다고 판단(디자인 검증 목적에는 대표 2문항으로 충분). 필요 시 F9 승인 후 developer 구현 단계에서 실제 5문항 전부를 반영한다.

---

## 0-1. (참고 기록) 최초 서브에이전트 세션의 Figma 접근 시도 결과

**시도**: 이번 세션에서 실제로 Figma MCP 도구를 호출해 기존 Figma 파일(`H141QVdsrLybIakYlIZVXB`)에 신규 페이지/프레임을 만들려고 시도했다.

**결과**: 이번 서브에이전트 세션에 전달된 도구 목록에는 `Read`/`Write`/`Edit`/`Grep`/`Glob` 5개만 존재하고, Figma MCP 관련 함수(`use_figma`/`get_design_context`/`create_new_file` 등)는 애초에 함수 스펙 자체가 주어지지 않았다 — 즉 "시도했지만 실패"가 아니라 **호출할 수 있는 함수가 이번 세션에는 노출되지 않았다.** "이전 세션에서 안 됐다더라"는 전언 때문에 건너뛴 것이 아니라, 이번 세션의 실제 도구 목록을 확인한 결과다.

**참고(정합성 확인)**: 같은 프로젝트의 기존 `bara-edu-lms.design.md` 4.5절에도 동일한 케이스 기록이 이미 있다 — "이 세션에는 Figma 도구 접근 권한이 없어 텍스트 와이어프레임 + 컴포넌트 매핑 표로 F1~F8을 갈음"(홈 화면 추가 시점, 2026-08-10). 즉 이 프로젝트에서 Figma MCP 쓰기 도구는 **세션마다 노출 여부가 다르다** — 위 0절에서 보듯 바로 다음 세션(PO 세션)에서는 정상 노출되었다.

**대응 당시 조치**: 아래 1~7절에 **텍스트 와이어프레임 + 코드 컴포넌트 1:1 매핑 표 + 토큰 적용표 + 신규 컴포넌트 상세 스펙**으로 F2~F8을 갈음했다(그대로 유지, 여전히 유효한 구현 참고 자료). F1은 위 0절에서 후속 완료됨.

---

## Figma-First 게이트 체크리스트

| 단계 | 내용 | 상태 |
|---|---|---|
| F1 | Figma 파일 생성 + 팀 공유 | **✅ 완료(2026-09-14, 위 0절)** — 기존 파일(`H141QVdsrLybIakYlIZVXB`)에 페이지 2개·프레임 10개 반영 |
| F2 | 디자인 토큰 정의 | ✅ 신규 토큰 없음. 기존 4.0 토큰(YLIA_UX_Pattern_Guide.html 이식분) 그대로 적용 — 2절 |
| F3~F6 | Coming Soon/홈/강좌목록/강좌상세 대응 (진단 랜딩/스테퍼/결과) 와이어프레임 | ✅ 3절 + 실제 Figma 프레임(위 0절) |
| F7 | 모바일 반응형 레이아웃 정의 | ✅ 6절 (360px 기준) — Figma 프레임은 420px 기준(기존 파일의 "Mobile/Desktop 420" 컨벤션과 동일) |
| F8 | 카피라이팅 — ux-writer 검수 | **미완료** — 화면 문구는 PM·service-planner 문서(menu-features/flows)의 확정 문구를 그대로 옮겼으나, ux-writer의 정식 톤 검수(이모지·비단정 어조·용어 통일)는 아직 거치지 않음. F9 전 필요 |

> F9(PO 승인)는 product-manager, F10(Dev Mode 링크) 등록은 developer 담당 — 이번 산출물은 그 전 단계 입력값이다.

---

## Context Anchor

| Key | Value |
|---|---|
| **WHY** | 방문자가 2급/1급 중 어디서 시작할지 판단 근거가 없어 전화 상담에 의존 → 자가진단으로 판단 근거 제공 + 리드 수집 |
| **WHO** | 입문자·과거 학습자·자격 보유자(학습 추천 대상) + 강사 후보자(리드) + 관리자(운영) |
| **핵심 게이팅** | 요약은 비로그인 즉시 공개, 상세(영역별 점수·Radar·강점보완·PDF)는 로그인 후. **이름은 서버 요약 응답에도 포함하지 않는다** — 화면에서 숨기는 게 아니라 API 계약 자체에 없어야 함(qa-reviewer 검증 포인트) |
| **RISK** | 제3자 claim(공유된 결과를 남이 로그인해서 채가는 것), State A 응답에 상세 데이터가 실려 나가는 게이팅 우회, 신규 컴포넌트 남용 |
| **SUCCESS** | 진단 완료율 >70%, 홈→추천강좌상세 3클릭 이내, claim 전환 ≥25% |
| **SCOPE** | 공개 3화면(+리드폼 인라인) + 관리자 3화면(2목록+1상세) + 기존 화면 변경 3곳(홈/헤더/강좌상세) + AdminSidebar 메뉴 2개 |

---

## 1. 디자인 원칙 적용 (YLIA archetype)

- **archetype**: `/selfcheck` 전체는 USER 화면 = "교육·인증형". 인물 사진은 없지만(원본 요구사항에 이미지 자산 없음) 자격·커리큘럼 신뢰도를 전면에 내세운다 — 결과 화면의 "주인공은 추천 과정 카드"(PM 문서 F-DIAG-11)라는 지시를 그대로 따라 Radar보다 추천 카드를 시각적으로 먼저·크게 배치한다.
- **어조**: "당신은 도형심리 이해도가 낮습니다" 같은 단정적 진단 문구를 쓰지 않는다. flows.md·menu-features.md가 이미 "~에 가까워요"류 어조로 카피를 준비해뒀으므로(예: "기초부터 체계적으로 정리하는 단계") 그대로 승계하고, 화면 설계 단계에서 임의로 더 단정적인 문구를 추가하지 않는다.
- **이모지 미사용**: 잠금 안내박스, 오류 배너, 상태 배지 어디에도 이모지·컬러 픽토그램을 쓰지 않는다(LMS 04.6.7 "텍스트 배지만으로 상태 표현" 선례 승계 — 자물쇠 아이콘 없이 텍스트로 "잠김" 표현).
- **Admin**: "운영 콘솔" archetype, 기존 `/admin/enrollments`·`/admin/assignments`와 동일 레이아웃(AdminTopbar 상단 + AdminSidebar 좌측, Type2), 데스크톱 전용 1280px.

---

## 2. 디자인 토큰 (신규 없음 — TBD 항목 없음)

전부 `bara-edu-lms.design.md` 4.0의 기존 토큰을 그대로 쓴다. 이번 기능에서 실제로 쓰는 토큰만 발췌:

| 용도 | 토큰 | 값 | 사용처 |
|---|---|---|---|
| 추천 카드 강조 / 주 CTA | `--pink` (`bg-pink`) | `#E11E87` | "진단 시작하기", "수강 신청하기 보러가기" 등 주 CTA |
| Radar 축/영역 점수 막대 | `--indigo` (`bg-indigo`) | `#3C1E87` | ScoreBar 채움색, Radar polygon stroke |
| 안내/정보 박스 | `--sky`(`info`, `bg-info/15`) | `#4BC3F0` | 잠금 안내 박스, "응시 가능"류 정보 배지와 동일 톤 |
| 성공 | `--success` | `#1DA463` | 리드 접수 성공 메시지, 상태배지 "연락함"/"종료" |
| 경고 | `--warning` | `#F0963C` | 미응답 문항 배너, "이미 다른 계정에 연결됨" 안내(danger 아닌 warning 톤 — 근거는 7-6절) |
| 위험 | `--danger` | `#E14B3C` | 필드 오류 테두리, 관리자 "바로 종료" 확인창 |
| 중립 텍스트/배경 | `--n-0~9` | 그대로 | 본문/보더/배경 |
| Spacing/Radius | `--sp-*`/`--r-*` | 그대로 | 카드 패딩, 버튼 pill(`rounded-pill`) |

**신규 색상 추가 없음.** ScoreBar·Radar도 위 토큰(indigo/pink/n-2)만 사용한다.

---

## 3. 화면별 와이어프레임 + 컴포넌트 매핑

### 3.1 `/selfcheck` 랜딩 (F-DIAG-1)

**핵심 행동**: [진단 시작하기] 클릭 → `/selfcheck/start`

```
[AppHeader kind="public"]  ← 재사용, 변경 없음

┌──────────────────────────────────────────┐
│              도형심리 역량진단               │  h1, 28/40px bold
│      나에게 맞는 과정은 어디부터일까요?        │  16~18px, n-6
│                                          │
│         약 5분 · 30문항                    │  Badge(tone="neutral") 재사용
│                                          │
│  이 진단은 학습 방향을 안내하는 자가진단이며,   │  12.5px, n-5, 박스(bg-n-1)
│  임상 심리검사나 자격 판정이 아니에요.         │  ← 전 화면 공통 고지, 문구 고정
│                                          │
│           [진단 시작하기]                  │  Pill 버튼, bg-pink, h-52px 이상
└──────────────────────────────────────────┘

[Footer]  ← 재사용
```

| 요소 | 코드 컴포넌트 | 신규/재사용 |
|---|---|---|
| 헤더/푸터 | `AppHeader`, `Footer` | 재사용 |
| "약 5분·30문항" | `Badge`(tone=`neutral`) | 재사용 |
| 비임상 고지 박스 | 신규 마크업(단순 `div`, 지정 컴포넌트 아님) — Home `#apply-guide` 안내박스와 동일 톤(`bg-n-1 rounded-lg p-4`) | 마크업 재사용, 컴포넌트 신규 아님 |
| CTA | 기존 Hero 주 CTA 클래스 그대로(`inline-flex h-[52px] rounded-pill bg-pink ...`) | 재사용(클래스 복사) |

### 3.2 `/selfcheck/start` — 스테퍼

#### 3.2.0 복원 다이얼로그 (F-DIAG-5)

`ConfirmDialog` 재사용. 단, **기존 컴포넌트에 없는 prop 필요**(7-1절 갭 참고): "이어서 하기"/"새로 시작하기"처럼 취소 버튼도 의미 있는 라벨이어야 하는데 현재 `ConfirmDialog`는 취소 버튼 텍스트가 "취소"로 고정돼 있다.

```
title: "작성하던 진단이 있어요"
description: "이어서 진행할까요?"
confirmLabel: "이어서 하기"
cancelLabel: "새로 시작하기"   ← 신규 prop 필요
tone: "neutral"
```

#### 3.2.1 1페이지 — 기본정보 (F-DIAG-3)

```
[진행 표시 없음 — 1페이지는 문항 스테퍼 이전 단계]

이름 *          [________________]
휴대전화 (연락처 1개는 필수)  [________________]  예: 01012345678
이메일 (연락처 1개는 필수)   [________________]
지금까지의 학습 경험 * (라디오 4지, 세로 나열, 각 행 min-h 48px)
  ◯ 처음 접해요
  ◯ 예전에 배운 적 있어요
  ◯ 자격증을 갖고 있어요
  ◯ 지금도 활용하고 있어요
보유 자격 수준 (선택)   [________________]

[수집 항목·목적·보유기간·거부권 요약 고지 박스 — PIPA 제22조]

☐ 개인정보 수집·이용에 동의합니다 (필수)  [자세히 보기 → /legal/privacy, 새 탭]
☐ 만 14세 이상입니다 (필수)

                                    [다음]
```

(2026-09-14 갱신: 휴대전화·이메일은 "둘 다 필수"에서 "최소 1개 필수"로 완화, 마케팅 동의 체크박스는 Phase 1에 발송 기능이 없어 제거, 대신 연령 확인 체크박스와 동의 전 요약 고지 박스를 추가 — privacy-security-officer 지적 반영)

- 필드 오류: 해당 `<input>` 하단에 `text-[12px] text-danger` 인라인 문구 + `border-danger`, `aria-invalid="true"` + `aria-describedby`로 오류 텍스트와 연결(스크린리더 대응, F-DIAG-18).
- 로그인 상태 프리필: 이름/휴대전화/이메일에 `profiles` 값 채움, 필드는 계속 `disabled` 아님(수정 가능).
- 컴포넌트: 개별 `Input`/`Textarea`/`Checkbox` 전용 컴포넌트가 실제 코드베이스에 없음(`AuthForm.tsx`처럼 각 화면이 자체 `<input className="h-11 rounded-md border border-n-3 ...">` 마크업을 직접 씀) — **이번 화면도 동일 컨벤션**을 따른다(신규 Input 컴포넌트를 만들지 않음, `AuthForm`/`ExamForm`과 동일한 인라인 스타일 클래스 재사용).

#### 3.2.2 2~7페이지 — 30문항 (F-DIAG-4)

```
[상단 고정]
진행률 바 ─────────────────●───────── (ProgressBar와 동일 마크업, label만 "n/30문항"으로 교체)
2/7 · 도형 판독 능력
●●○○○○  ← 영역 도트 인디케이터(6개, Should) — 완료:●(indigo) 현재:pink 테두리 강조, 이후:○(n-3)

[본문 — 문항 카드 5개, 세로 스택]
┌ 1. 도형의 4가지 기본형을 구분할 수 있다 ──────────┐
│ ◯ 처음 접한다 / 거의 알지 못한다        (0)      │  라디오 옵션 행, min-h 48px
│ ◯ 들어본 적 있다                       (1)      │  각 행 = <label> 전체가 클릭 영역
│ ◉ 설명할 수 있다                       (2)      │  선택됨: border-pink + bg-pink/5
│ ◯ 실제로 적용할 수 있다                 (3)      │
│ ◯ 다른 사람을 지도할 수 있다             (4)      │
└──────────────────────────────────────────────┘
(※ 미응답 시: 카드 border-danger + 하단 "이 문항에 답해주세요" 문구)

[하단 고정]
[이전]                                    [다음 / 제출하기]
```

라디오 옵션 마크업(신규 스타일이지만 새 컴포넌트는 아님 — `ExamForm.tsx`의 `<fieldset>/<label>/<input type=radio>` 패턴을 확장):

```html
<fieldset>
  <legend class="text-[14.5px] font-medium text-n-9 mb-3">1. 도형의 4가지 기본형을 구분할 수 있다</legend>
  <label class="flex items-center gap-3 min-h-[48px] rounded-lg border border-n-3 px-4
                 has-[:checked]:border-pink has-[:checked]:bg-pink/5">
    <input type="radio" name="A1" value="2" id="A1-2" class="h-5 w-5 accent-pink" />
    <span class="flex-1 text-[14px] text-n-8">설명할 수 있다</span>
    <span class="text-[11px] text-n-4">2</span>
  </label>
  ...
</fieldset>
```

- `<label>`이 `<input>`을 감싸므로 F-DIAG-18의 "라디오 label 연결"을 마크업 구조로 자동 충족(별도 `htmlFor` 불필요, 감싸는 방식이 명시적 연결의 한 형태).
- 터치 영역: `min-h-[48px]` + 가로 전체 클릭 가능 → 44px 요구 충족.
- 색상 비의존: 선택 상태를 `border-pink`(색) + 라디오 자체의 체크 표시(형태) 이중으로 표현. 숫자 배지는 보조 정보라 위반 아님.
- 상단 진행률 바: 기존 `ProgressBar` 컴포넌트를 그대로 쓰되 label을 "진도 {n}%" → "{completed}/30문항"으로 바꾼 변형이 필요(컴포넌트 자체를 복제하지 말고 `label` prop을 추가해 재사용 권장 — 7-2절 갭).
- 영역 도트 인디케이터: 신규 소형 마크업(`<div className="flex gap-1.5">` + 6개 `<span>` 원) — 별도 이름 붙은 컴포넌트를 만들 필요는 없을 만큼 단순하다고 판단(Should, 생략 가능).

### 3.3 결과 — State A (비로그인 요약, F-DIAG-8)

```
[AppHeader kind="public"]

┌──────────────────────────────────────────┐
│ 추천 과정                                  │
│ 기초부터 체계적으로 정리하는 단계             │  h2, 22/28px bold — 카드 최상단(주인공)
│                                          │
│        72점                              │  전체 점수, 48px extrabold, indigo
│        (100점 만점)                       │
│                                          │
│ 도형기질활용지도자 2급이 잘 맞아요.           │  1~2문장, tier 공통 카피(점수 인용 없음)
│                                          │
│ 이 진단은 학습 방향을 안내하는 자가진단이며,   │  비임상 고지, 상시 노출(랜딩과 동일 문구)
│ 임상 심리검사나 자격 판정이 아니에요.         │
│                                          │
│         [2급 자세히 보기 →]                │  CTA, F-DIAG-14 매핑/폴백 규칙 적용
├──────────────────────────────────────────┤
│ 영역별 점수, Radar 차트, 강점·보완 해석,      │  잠금 안내 박스(bg-n-1 또는 bg-info/10)
│ PDF 저장은 로그인 후 확인할 수 있어요         │
│         [로그인]   [회원가입]              │  outline / pill 버튼
├──────────────────────────────────────────┤
│ (tier === instructor_candidate 인 경우만)  │
│ [강사과정 관심 문의 폼]  ← 3.5절            │
└──────────────────────────────────────────┘

[Footer]
```

- CTA 폴백: `diagnosis_course_links`에 매핑 강좌가 없거나 `is_active=false`면 버튼 라벨을 "문의하기"로 바꾸고 `tel:`/`mailto:`(Home `#contact`와 동일 스타일)로 대체. **깨진 링크 상태를 화면에 두지 않는다.**
- 컴포넌트: 카드 래퍼는 강좌 상세 페이지의 "상세 화면 기본 구조"(`bg-n-0 rounded-lg border p-6`) 재사용. 잠금 안내 박스는 자격시험 LOCKED 상태(4.6.7)의 안내 박스와 동일 톤.

#### 3.3.1 State A-거부 (제3자가 이미 귀속된 결과를 봄, F-DIAG-9)

State A와 동일 레이아웃이되, 잠금 안내 박스 자리를 아래로 교체:

```
┌──────────────────────────────────────────┐
│ 이 진단 결과는 이미 다른 계정에 연결되어 있어요 │  경고 박스(tone=warning, danger 아님 — 7-6절 근거)
│ 본인의 결과가 맞다면 고객센터로 문의해주세요    │
└──────────────────────────────────────────┘
```
어느 계정인지는 절대 노출하지 않는다(auth.ts 이메일 열거 방지 원칙과 동일 결).

#### 3.3.2 결과 없음 (존재하지 않는 token)

```
┌──────────────────────────────────────────┐
│         결과를 찾을 수 없어요               │
│  링크 주소를 다시 확인해주시거나              │
│  새로 진단을 받아보세요                      │
│         [새로 진단받기 →]  (/selfcheck)     │
└──────────────────────────────────────────┘
```
일반 404 템플릿(`bara-edu-lms.design.md`의 "12 404 페이지")을 그대로 쓰지 않고, 진단 전용 안내(위 문구 고정)로 대체 — flows.md 4절 지시 그대로.

### 3.4 결과 — State C (로그인 후 상세, F-DIAG-9~13/16/17)

State A 카드 전체 + 아래를 이어서 배치(잠금 박스 자리는 사라짐):

```
┌──────────────────────────────────────────┐
│ (State A 카드 전체 그대로 — CTA까지)         │
├──────────────────────────────────────────┤
│ 영역별 점수                                │  h3
│ 기본이론 이해        72점  ▓▓▓▓▓▓▓▓░░      │  ScoreBar × 6 (신규 컴포넌트, 4.1절)
│ 도형 판독 능력       48점  ▓▓▓▓░░░░░░      │
│ 분석 능력           65점  ▓▓▓▓▓▓░░░░      │
│ 상담·활용 능력       58점  ▓▓▓▓▓░░░░░      │
│ 사례 분석·기록       61점  ▓▓▓▓▓▓░░░░      │
│ 교육·지도 능력       50점  ▓▓▓▓▓░░░░░      │
├──────────────────────────────────────────┤
│         [Radar SVG, 6축]                  │  RadarChart(신규, 4.2절), aria-hidden
│         (위 ScoreBar 목록이 텍스트 대응표)    │  role="img" + aria-label 요약 문장
├──────────────────────────────────────────┤
│ 강점                                      │
│  · 기본이론 이해 — {문구, config}           │  최대 2개, 카드 tone=success 계열 텍스트
│ 보완하면 좋아요                             │
│  · 도형 판독 능력 — {문구, config}          │  최대 2개, tone=info/n-6 텍스트(경고색 아님)
├──────────────────────────────────────────┤
│ 왜 이 과정인가요                            │
│  전체 점수는 72점이고, 그중 도형판독 48점이   │  h3 + 본문, 점수 인용 포함
│  다른 영역보다 낮아서...(tier별 템플릿)       │
│  (instructor_candidate tier만)             │
│  "자가진단 점수만으로 강사 자격을 판정하지     │  고지 문구, 고정
│   않습니다..."                             │
├──────────────────────────────────────────┤
│ [PDF로 저장]   마이페이지에서 다시 보기 →    │  버튼 + 텍스트 링크
├──────────────────────────────────────────┤
│ (tier === instructor_candidate 인 경우만)   │
│ [강사과정 관심 문의 폼] — profiles 프리필     │  3.5절
└──────────────────────────────────────────┘
```

**PDF 저장(F-DIAG-16, print stylesheet)**: `window.print()` 클릭 시 `@media print`로 아래를 `display:none` 처리 — AppHeader, Footer, 모든 CTA 버튼(추천강좌 CTA·로그인/가입·PDF버튼 자신), 리드 폼. **남기는 것**: 추천 라벨, 전체 점수, 영역별 점수, Radar SVG, 강점/보완, 추천 이유, 비임상 고지 문구(이건 CTA가 아니므로 인쇄본에도 유지 — 고지 의무는 인쇄 여부와 무관).

### 3.4.1 신규 컴포넌트 스펙 — `ScoreBar`

```tsx
// components/selfcheck/ScoreBar.tsx (신규)
function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-n-7">{label}</span>
        <span className="font-semibold text-n-9">{score}점</span>
      </div>
      <div className="h-2 w-full rounded-pill bg-n-2">
        <div className="h-full rounded-pill bg-indigo" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
```
- 기존 `ProgressBar`(classroom)와 마크업 구조가 거의 동일하지만 **의미가 다르다**(진도율 vs 역량 점수, 재사용 시 label 위치·용도 혼동 우려) → PM 문서가 이미 "Radar/점수바만 신규"로 명시했으므로 별도 컴포넌트로 분리하는 것이 맞다고 판단.
- 색상 비의존 원칙: 막대 자체는 단색(indigo)이지만 숫자(`{score}점`)가 항상 병기되므로 F-DIAG-10 요건 충족(색만으로 고저를 구분하지 않음).

### 3.4.2 신규 컴포넌트 스펙 — `RadarChart` (인라인 SVG, F-DIAG-11)

```tsx
// components/selfcheck/RadarChart.tsx (신규) — Chart.js 등 라이브러리 사용 안 함(W9)
const AREAS = ['기본이론', '도형판독', '분석', '상담·활용', '사례기록', '교육지도'] as const;

function RadarChart({ scores }: { scores: number[] /* 0~100, 6개, AREAS 순서 */ }) {
  const CENTER = 100, RADIUS = 80;
  const angle = (i: number) => (Math.PI * 2 * i) / 6 - Math.PI / 2; // 12시 방향 시작
  const point = (i: number, r: number) => [
    CENTER + r * Math.cos(angle(i)),
    CENTER + r * Math.sin(angle(i)),
  ];
  const gridRings = [0.25, 0.5, 0.75, 1].map((ratio) =>
    Array.from({ length: 6 }, (_, i) => point(i, RADIUS * ratio).join(',')).join(' ')
  );
  const dataPoints = scores.map((s, i) => point(i, (RADIUS * s) / 100).join(',')).join(' ');

  return (
    <svg viewBox="0 0 200 200" role="img" aria-hidden="true" className="mx-auto w-full max-w-[280px]">
      {gridRings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="var(--color-n-3, #E4E4E7)" strokeWidth="1" />
      ))}
      {AREAS.map((_, i) => {
        const [x, y] = point(i, RADIUS);
        return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="var(--color-n-3, #E4E4E7)" strokeWidth="1" />;
      })}
      <polygon points={dataPoints} fill="rgba(60,30,135,0.18)" stroke="#3C1E87" strokeWidth="2" />
      {AREAS.map((label, i) => {
        const [x, y] = point(i, RADIUS + 16);
        return (
          <text key={label} x={x} y={y} textAnchor="middle" fontSize="9" fill="#52525B">
            {label}
          </text>
        );
      })}
    </svg>
  );
}
```

- `aria-hidden="true"`로 처리하고 **스크린리더 대응은 별도 hidden 표를 추가하지 않는다** — 바로 위(3.4절 레이아웃)에 이미 렌더되는 `ScoreBar` 목록이 동일 수치 정보를 텍스트로 제공하므로 F-DIAG-11의 "수치 표와 병기" 요건을 중복 마크업 없이 충족한다(스코어바 목록 → Radar 순서 배치로 이미 "병기"됨).
- 6개 값이 전부 동일(전 영역 동점)하면 정육각형이 그대로 그려져도 시각적으로 문제없음 — 별도 처리 불필요.

### 3.5 강사과정 관심 문의 리드 폼 (F-DIAG-15)

인라인 상시 노출 폼(모달 아님 — `FormDialog`/`ConfirmDialog`는 여기 부적합, flows.md 근거 그대로). `useActionState` 기반 `AuthForm.tsx`와 동일 구현 패턴.

```
┌──────────────────────────────────────────┐
│ 강사과정 소식을 가장 먼저 받아보세요          │  h3
│ 이름 *        [________________]          │  State A: sessionStorage 프리필/빈값
│ 연락처 *      [________________]          │  State C: profiles 프리필
│ 한 줄 메모(선택) [________________] (0/100)│
│ ☐ 연락 수신에 동의합니다 (필수)              │
│              [안내받기 신청]                │
└──────────────────────────────────────────┘

성공 시 폼 자리 교체:
┌──────────────────────────────────────────┐
│ 문의가 접수됐어요                           │
│ 강사과정 소식이 준비되면 안내드릴게요          │
└──────────────────────────────────────────┘

재방문(sessionStorage 플래그 존재) 시:
┌──────────────────────────────────────────┐
│ 이미 문의를 남겼어요                        │
└──────────────────────────────────────────┘
```
- 실패 시: 입력값 유지 + 필드별 인라인 오류(3.2.1과 동일한 오류 표현 규칙) + 서버 오류는 폼 상단 배너.

### 3.6 State B 다이얼로그 — claim 확인 (Q11, F-DIAG-9)

`ConfirmDialog`(tone=`neutral`) 그대로 재사용 가능(신규 prop 불필요, 이 다이얼로그는 "취소"가 곧 "연결하지 않음"이라 기존 API로 충분):

```
title: "이 결과를 내 계정에 연결할까요?"
description: "본인이 진행한 진단이 맞다면 연결해주세요. 다른 사람의 결과라면 취소해주세요."
confirmLabel: "연결하기"
tone: "neutral"
```
[취소] 클릭 → State A 유지(로그인 상태 유지, 결과와는 미연결) — 별도 화면 없음, 그 자리에서 잠금 박스만 다시 노출.

### 3.7 `/admin/selfcheck` 목록 (F-ADMDG-1)

```
[AdminTopbar]
┌──────────┬─────────────────────────────────────────┐
│AdminSidebar│  진단 결과 조회                            │
│          │  [tier ▾] [기간 ▾] [회원/비회원 ▾]  [검색: 이름·연락처] │  조회조건 모듈
│          │  ┌───────────────────────────────────┐  │
│          │  │일시 이름 연락처(마스킹) 학습경험 전체점수 tier 귀속 │  AdminTable
│          │  │09-14 홍*동 010-****-1234 처음 72   level2 미귀속│
│          │  └───────────────────────────────────┘  │
│          │  페이지네이션                              │
└──────────┴─────────────────────────────────────────┘
```
- tier 배지: `Badge`(tone 매핑 — level2=`neutral`, level1=`info`, supervision=`info`, instructor_candidate=`warning` 강조) — 신규 톤 추가 없이 기존 4-tone(`neutral/info/warning/danger`) 안에서 매핑.
- 귀속 여부: `StatusBadge`(tone=`success` "회원" / `neutral` "비회원").
- 연락처 마스킹: 기존 `lib/supabase/admin-queries.ts` 마스킹 유틸 재사용(신규 규칙 없음).

### 3.8 `/admin/selfcheck/[id]` 상세 (F-ADMDG-2)

```
일시 / 학습경험 / 회원 귀속(→ /admin/members/[id] 링크, 있으면)
영역별 점수 (ScoreBar 6개 재사용 — 3.4.1 컴포넌트를 Admin에서도 그대로 씀)
강점 / 보완 (텍스트, 3.4와 동일 톤)
응답 원본 30건 (AdminTable, 문항코드/점수 2열 × 6영역 그룹)
```
- 열람 시 `admin_access_logs`에 자동 기록(기존 `logAdminAccess()` 헬퍼 재사용) — **화면에는 아무 표시도 하지 않는다**(회원 상세 패널과 동일한 무표시 백그라운드 로깅 패턴, Q15).

### 3.9 `/admin/selfcheck/leads` 목록 (F-ADMDG-3)

```
[조회조건] 상태(전체/신규/연락함/종료) · 기간 · 검색(이름/연락처)
┌───────────────────────────────────────────────────┐
│접수일시 이름 연락처 메모 연결된진단 상태   담당자 처리일시 액션 │
│09-14  김*수 010-**** "1급..." [진단결과 보기] [신규] —  —   [연락함으로 표시][바로 종료]│
│09-13  이*영 ...                              [연락함] 관리자A 09-14 [종료 처리][메모수정]│
└───────────────────────────────────────────────────┘
```

| 상태 | StatusBadge tone |
|---|---|
| 신규 | `neutral`(회색) |
| 연락함 | `info`(파랑) |
| 종료 | `success`(초록) |

- **[연락함으로 표시]** → `ConfirmDialog` (`reasonField` 있으나 **선택**) — 7-1절 갭: 현재 컴포넌트는 `reasonField` 제공 시 무조건 `required`라 이 케이스를 그대로 못 만든다.
- **[바로 종료]/[종료 처리]** → `ConfirmDialog` (`reasonField` **필수**, 기존 컴포넌트 그대로 사용 가능).
- **[메모수정]** → `FormDialog`(textarea 1개, submitLabel="저장") — 그대로 재사용 가능, 신규 prop 불필요.
- 동시 처리 충돌: 기존 `/admin/enrollments`의 `?error=already-processed` 리다이렉트 + 목록 상단 배너 패턴 그대로 재사용("Toast" 컴포넌트가 실제로는 코드베이스에 없음 — 7-3절 참고).

### 3.10 `AdminSidebar` 메뉴 추가

현재 실제 `AdminSidebar.tsx`는 그룹 헤더 없는 **평면 11개 리스트**다(YLIA 운영콘솔 가이드가 말하는 "3Depth 섹션 그룹화"가 아직 적용돼 있지 않음 — 7-4절 갭). 최소 변경 원칙에 따라 리스트 끝에 2개를 추가하고, 시각적 스캔을 돕는 얇은 섹션 캡션만 추가(신규 컴포넌트 아님, `<span className="mt-2 px-3 text-[11px] text-n-4">자가진단</span>` 텍스트 구분선 1줄):

```
대시보드
신청·입금 관리
계좌정보 관리
강좌 관리
문제은행 관리
카테고리 관리
회원 관리
운영자 관리
과제 검토
수료 관리
약관·정책 CMS
──────────── 자가진단 ────────────   ← 신규 캡션(구분선)
진단 결과 조회        (/admin/selfcheck)
강사과정 문의         (/admin/selfcheck/leads)
```

### 3.11 홈 배너 섹션 추가 (F-DIAG-2, Must)

`bara-edu-lms.design.md` 4.5절의 홈 섹션 추가 컨벤션을 그대로 따른다 — 신규 섹션 컴포넌트 `components/home/SelfcheckBannerSection.tsx`, 배치 위치는 **히어로 바로 다음**(카테고리 섹션보다 앞 — "히어로 하단"이라는 PM 지시를 문자 그대로 반영).

```
[Hero]
┌──────────────────────────────────────────┐ bg-n-1 (zebra 규칙: 카테고리=흰색이므로 이 배너는
│   나는 어떤 과정부터 시작하면 좋을까요?       │ 그 앞에서 연회색으로 한 번 끊어줌)
│   5분이면 나에게 맞는 과정을 알 수 있어요     │
│         [5분 자가진단 시작하기 →]            │  pill 버튼, bg-pink (Hero 주 CTA와 동일 클래스)
└──────────────────────────────────────────┘
[카테고리 섹션 #categories]
...
```
CTA 목적지: `/selfcheck`(랜딩 경유 — flows.md 1.1 진입 동선 그대로, `/selfcheck/start`로 바로 보내지 않는다).

### 3.12 헤더 네비 "역량진단" (Q9 해결 제안) + 강좌상세 보조 링크

**Q9(헤더 상시 노출 여부)에 대한 디자인 단계 결론**: `AppHeader.tsx`는 현재 로고+네비 2개(강좌안내/마이페이지 또는 신청방법)를 한 줄에 배치하며 **모바일 축소용 햄버거 메뉴가 없다**. 360px 기준으로 "바라 평생교육원" 로고 + 기존 2개 링크만으로도 이미 폭이 빠듯한데, "역량진단"(4자) 링크를 그대로 추가하면 초소형 화면에서 줄바꿈/겹침 위험이 있다.

**결론(제안)**: `md:` 이상에서만 노출한다.
```tsx
<Link href="/selfcheck" className="hidden text-[12.5px] text-n-7 md:inline">역량진단</Link>
```
모바일(360~767px)에서는 헤더에 노출하지 않는 대신 홈 배너(Must, 3.11절)와 강좌 상세 보조 링크만으로 발견 경로를 보장한다 — "3클릭 이내" 목표는 헤더 없이도 홈 배너 경로로 이미 충족되므로(배너→랜딩→시작), 헤더 노출은 반복 방문자를 위한 부가 경로로 한정해도 무방하다고 판단. **F9에서 PO 확인 필요.**

**강좌 상세 보조 링크(Should)**: 도형기질활용지도자 2급/1급 강좌 상세 페이지의 CTA 영역 하단에 텍스트 링크 1줄 추가:
```
[수강 신청하기]
내 수준이 맞는지 확인하기 →   (/selfcheck, 텍스트 링크, 밑줄, n-6)
```
카테고리 조건부 렌더 — 도형기질활용지도자 트리 소속 강좌에서만 노출(다른 강좌 상세에는 영향 없음).

---

## 4. 컴포넌트 재사용 현황 요약

| 코드 컴포넌트 | 재사용 위치 | 변경 필요 여부 |
|---|---|---|
| `AppHeader` | 랜딩/스테퍼/결과 전체 | 3.12절 nav 항목 1개 추가(조건부 `md:` 노출) |
| `Footer` | 랜딩/스테퍼/결과 전체 | 변경 없음 |
| `Badge` | 랜딩("5분·30문항"), 결과(tier) | 변경 없음(기존 4-tone 그대로 매핑) |
| `StatusBadge` | Admin 목록(귀속 여부, 리드 상태 3종) | 변경 없음 |
| `ConfirmDialog` | 복원 다이얼로그, claim 확인, Admin 리드 상태전환 2종 | **`cancelLabel` prop 추가 필요(복원 다이얼로그용) / `reasonField`에 `required` 여부 옵션 필요(연락함 처리용)** — 7-1절 |
| `FormDialog` | Admin 리드 메모수정 | 변경 없음, 그대로 사용 가능 |
| `AdminTable` | 진단 목록/상세 응답표, 리드 목록 | 변경 없음 |
| `AdminSidebar` | 메뉴 2개 추가 | 리스트 항목 추가 + 캡션 1줄(3.10절) |
| `AdminTopbar` | Admin 전 화면 | 변경 없음 |
| `ProgressBar` | 스테퍼 진행률(변형) | **label 커스터마이즈 prop 필요**(현재 "진도 n%" 고정 문구) — 7-2절 |
| `ExamForm`/`AuthForm` 마크업 패턴 | 문항 라디오, 기본정보 폼, 리드 폼 | 패턴만 차용, 컴포넌트 공유 아님(각 폼이 자체 마크업 보유하는 기존 컨벤션 그대로) |
| `CourseCard`/`FilterChip` | 사용 안 함(진단 화면에 강좌 목록 UI 없음) | 해당 없음 |

**신규 컴포넌트 (PM 문서 지시대로 최소화)**: `ScoreBar`, `RadarChart` — 이 2개만 신규. 그 외 "신규"로 표시한 것은 전부 **섹션 래퍼 수준**(`SelfcheckBannerSection`, 리드 폼 인라인 블록)이며 내부는 기존 마크업 패턴 차용이라 컴포넌트 라이브러리 관점의 "신규 원자 컴포넌트"는 아니다.

---

## 5. 접근성 체크리스트 (F-DIAG-18, 전 화면 공통)

- [ ] 모든 라디오 옵션은 `<label>`이 `<input>`을 감싸는 구조(3.2.2) — `htmlFor` 누락으로 인한 미연결 없음
- [ ] 라디오/체크박스/버튼 터치 영역 최소 44px — 문항 옵션 행 `min-h-[48px]`, 버튼 `h-[44px]` 이상
- [ ] 색상 비의존 — ScoreBar(숫자 병기), Badge/StatusBadge(텍스트 라벨 항상 포함), 오류 상태(테두리색 + 문구 동시)
- [ ] 오류 메시지는 시각적 강조(빨간 테두리)만이 아니라 텍스트로 명시 + `aria-describedby` 연결
- [ ] 360px 뷰포트에서 가로 스크롤 없이 렌더(스테퍼 본문 1열, 하단 고정 버튼바 `sticky bottom-0`)
- [ ] Radar SVG는 `aria-hidden`, 동일 정보의 텍스트 표(ScoreBar)가 반드시 인접 배치
- [ ] 키보드만으로 스테퍼 이전/다음/제출, 다이얼로그(`<dialog>` 네이티브 포커스 트랩) 전부 조작 가능
- [ ] 미응답 문항 포커스 이동 시 `scrollIntoView` + `focus()` 동시 수행(포커스 없이 스크롤만 하면 스크린리더 사용자가 놓침)
- [ ] 잠금 안내 박스·거부 화면 모두 아이콘 없이 텍스트만으로 상태 전달(이모지·픽토그램 금지 원칙 준수)

---

## 6. 반응형 기준

| 화면 | 기준 |
|---|---|
| `/selfcheck`, `/selfcheck/start`, `/selfcheck/result/[token]` | **모바일 우선, 360px부터 무결.** 768px(md) 이상은 카드 최대폭 640px 중앙 정렬(기존 인증 카드 패턴과 동일), 문항 카드는 md 이상에서도 1열 유지(가독성 우선, 다열 전환 안 함) |
| 홈 배너 섹션(3.11) | 기존 홈 섹션과 동일 폭 규칙(`max-w-[1200px]`, 360/768/1024 브레이크포인트 — LMS design.md 4.5.2 승계) |
| Admin 3화면(3.7~3.9) | **데스크톱 전용 1280px 고정**, 반응형 없음(YLIA 운영콘솔 원칙) |

---

## 7. 발견한 갭·이슈 (developer/PO 확인 필요)

### 7-1. `ConfirmDialog`에 두 가지 prop 확장 필요
현재 `components/ui/ConfirmDialog.tsx`는 (a) 취소 버튼 라벨이 "취소"로 하드코딩, (b) `reasonField`를 넘기면 textarea가 항상 `required`다. 이번 기능에서 두 군데가 이 한계에 걸린다:
- 3.2.0 복원 다이얼로그 — "새로 시작하기"처럼 취소 자체가 의미 있는 선택지 → `cancelLabel?: string`(기본값 "취소") 추가 권장.
- 3.9 "연락함으로 표시" — flows.md 2.2절이 명시적으로 "사유 선택(필수 아님)"이라 규정 → `reasonField.required?: boolean`(기본 true, 이 케이스만 false) 추가 권장.
둘 다 하위 호환 유지되는 optional prop이라 기존 사용처(엔롤먼트 반려 등)에는 영향 없음.

### 7-2. `ProgressBar`에 label override 필요
`components/classroom/ProgressBar.tsx`는 "진도 n%" 문구가 고정돼 있다. 스테퍼 진행률 표시(3.2.2)는 "n/30문항"이 필요해 그대로 못 쓴다. `label?: string`, `valueLabel?: string` 정도의 prop을 추가해 재사용하거나, 굳이 강행하지 않고 스테퍼 전용 마크업을 별도로 두는 것도 허용 범위(구현 판단은 developer에게 위임).

### 7-3. "Toast" 컴포넌트는 실제 코드베이스에 없다 (2026-09-14 후속: Figma에는 실존 확인됨)
이번 작업 지시와 `bara-edu-lms.design.md`의 Figma "Components" 페이지 설명에는 `Toast` 컴포넌트가 존재한다고 돼 있지만, 실제 `components/` 디렉터리에는 Toast 구현이 없다. 기존 "처리 결과 알림"은 전부 **서버 액션 → `redirect('...?error=already-processed')` → 페이지가 쿼리파라미터를 읽어 상단에 인라인 배너를 렌더**하는 방식으로 되어 있다(`/admin/enrollments` 확인). 이번 문서의 "이미 처리됨" 안내(3.9절)도 이 실제 패턴을 따르도록 설계했다. **후속 Figma 반영 세션(0절)에서 실제로 확인한 결과, Figma "Components" 페이지에 `Toast`(Kind=Success/Info/Warning) 컴포넌트 세트가 실존한다** — 즉 갭은 "Figma에 없는 걸 잘못 기록"이 아니라 "Figma에는 있는데 React 구현이 안 됐다"는 방향이 맞다. 이번 진단 기능은 실제 코드 패턴(인라인 배너)을 그대로 따르므로 당장 영향은 없지만, Toast 컴포넌트를 실제로 쓸 계획이 있다면 별도로 `components/ui/Toast.tsx` 구현이 필요하다(이번 스코프 아님, Phase 2 후보로만 기록).

### 7-4. `AdminSidebar`가 평면 리스트 — YLIA "3Depth 섹션 그룹화" 가이드와 불일치
운영 콘솔 archetype 가이드는 좌측 내비를 서비스별로 섹션 그룹화하라고 하지만, 실제 `AdminSidebar.tsx`는 그룹 헤더 없는 11개 평면 리스트다. 이번 작업은 **최소 변경**을 위해 캡션 1줄만 추가하는 절충안(3.10절)으로 설계했다 — 전체 사이드바를 섹션 트리로 재구조화하는 것은 기존 11개 항목 전부에 영향을 주는 별도 규모의 작업이라 이번 스코프에 포함하지 않았다. 향후 메뉴가 더 늘어나면(예: Phase 2 CSV/통계/CMS) 이 절충안이 한계에 부딪힐 수 있어 PO 판단 필요.

### 7-5. 스테퍼 라디오 터치영역이 기존 `QuizForm`/`ExamForm`보다 크다
기존 강의실 퀴즈/시험 라디오는 `h-4 w-4` 인라인 스타일로 터치 영역이 44px에 못 미친다. 이번 진단 화면은 F-DIAG-18이 명시적으로 44px를 요구해 3.2.2의 확대된 카드형 라디오를 새로 설계했다 — 결과적으로 같은 서비스 안에 라디오 UI가 두 가지 크기로 공존하게 된다. 일관성 관점에서는 향후 퀴즈/시험 라디오도 같은 크기로 맞추는 게 좋지만, 이번 스코프는 아니므로 **Should, Phase 2 검토 제안**으로만 남긴다.

### 7-6. "이미 다른 계정에 연결됨" 안내를 danger가 아닌 warning 톤으로 설계
flows.md는 톤을 지정하지 않았다. "돌아올 수 있게/따뜻하게" 원칙에 따라, 사용자 잘못이 아닐 수 있는 상황(링크 공유·혼동)에 danger(빨강, 위협적 톤)를 쓰는 대신 warning(주황) 톤을 제안했다(2절 토큰표, 3.3.1절). ux-writer/PO 확인 필요.

### 7-7. PM/서비스플래너 문서와 실제 구현 가능성 사이 — 큰 갭은 없음
전반적으로 두 문서(menu-features/flows)가 이미 실제 코드(`auth.ts`/`admin-enrollments.ts`/`ExamForm` 등)를 확인하고 쓰여 있어(예: "회원가입 redirect 파라미터 없음"을 서비스플래너가 이미 코드로 확인) 디자인 단계에서 새로 발견한 구조적 모순은 없었다. 위 7-1~7-6이 전부이며, 전부 **기존 컴포넌트의 작은 prop 확장** 또는 **디자인 톤 확인** 수준으로 backend/frontend 구현을 막을 정도의 이슈는 아니다.

---

## 8. Next Step

```
1) PO(F9)        : F1 완료(위 0절) 상태에서 F8(ux-writer 미검수)만 남기고 스펙 승인 여부 결정.
                   3.12절 Q9(헤더 노출 md 이상 한정), 3.3.1 warning 톤(7-6) 확인.
2) ux-writer(F8)  : 화면 문구 정식 검수(비단정 어조/이모지 없음/시니어 배려 재확인) — 기존 F9 ux-writer
                   검수 체크리스트(bara-edu-lms.design.md) 방식 그대로 적용.
3) F10 Dev Mode 링크 등록(developer) — Figma 프레임 반영은 완료됐으므로 이 단계만 남음.
4) backend-developer : 7-1 ConfirmDialog prop 확장을 frontend와 공유, RPC 계약(submit_diagnosis 등)에
                       "요약 응답에 이름 미포함" 규칙 반영.
5) frontend-developer: 신규 컴포넌트(ScoreBar/RadarChart) + 화면 조립, /my pending claim 분기(Q10) 포함.
6) qa-reviewer    : 게이팅 우회(State A 응답에 상세 데이터 포함 여부), 제3자 claim 시나리오 집중 검증.
```
