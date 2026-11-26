// 도형심리 자가진단 민감정보 처리 동의(동의 상자 ②) 문구 원문, 버전별 고정 보관.
// 근거: docs/02-design/features/bara-edu-lms.diagnosis-sensitive-consent.md 5.2절(동의 증명), 문구는
// bara-edu-lms.diagnosis-sensitive-consent-copy.md 2.2절 SC-SENS-TITLE ~ SC-SENS-CHECK + SC-SENS-WITHDRAW(API 계약에서 포함으로 결정).
//
// 규칙
//  - 한 번 배포한 버전의 text는 한 글자도 고치지 않는다. 바꾸려면 새 버전(sc-v2 ...)을 추가하고
//    CURRENT_SENSITIVE_CONSENT_VERSION과 DB 함수 submit_diagnosis()의 허용 목록을 같은 배포에서 바꾼다.
//    (api/test/diagnosis-consent.test.ts가 sc-v1 원문 해시와 허용 목록 일치를 검사한다.)
//  - 화면은 이 상수에서 문구를 그리고, 제출 때 CURRENT_SENSITIVE_CONSENT_VERSION을 p_consent_sensitive_version으로 보낸다.
//    그래서 저장된 버전과 화면 문구가 어긋날 수 없다.
//  - `**…**`는 굵게 표시할 부분이다(화면이 해석한다). 4개 고지 항목의 summary는 항상 보이고, detail도 접지 않는다(디자인 열린 문제 처리 1).
//  - effectiveFrom(게시일, YYYY-MM-DD)은 문구가 아니라서 배포 때 채워도 버전을 올리지 않는다. null이면 아직 배포 전이다.

export type SensitiveConsentItemKey = 'purpose' | 'items' | 'period' | 'refuse';

export type SensitiveConsentText = {
  title: string; // SC-SENS-TITLE
  what: string; // SC-SENS-WHAT
  intro: string; // SC-SENS-INTRO
  items: ReadonlyArray<{ key: SensitiveConsentItemKey; summary: string; detail: string }>; // SC-SENS-*-SUM / *-DETAIL
  linkNotice: string; // SC-SENS-LINK-NOTICE
  check: string; // SC-SENS-CHECK (옵션 A)
  withdraw: string; // SC-SENS-WITHDRAW
};

export type SensitiveConsentVersion = { effectiveFrom: string | null; text: SensitiveConsentText };

export const SENSITIVE_CONSENT_VERSIONS = {
  'sc-v1': {
    effectiveFrom: null,
    text: {
      title: '**민감정보**(자가진단 응답·결과) 처리 동의 (필수)',
      what: '민감정보는 법에서 더 조심해서 다루도록 정한 정보예요.',
      intro: '바라 평생교육원은 자가진단의 **응답과 결과를 민감정보로 보고**, 다른 개인정보와 따로 동의를 받아 아래와 같이 처리해요.',
      items: [
        {
          key: 'purpose',
          summary: '**처리 목적: 점수 계산과 결과 안내**',
          detail: '자가진단 점수를 계산하고, 결과와 추천 과정을 알려 드려요. 강사과정 사전 적합 후보로 나오면 강사과정 상담을 연결할 때에도 써요.',
        },
        {
          key: 'items',
          summary: '**처리 항목: 30개 문항 응답과 그 결과**',
          detail: '30개 문항에 대한 응답, 영역별 점수와 전체 점수, 강점·보완 영역, 추천 과정',
        },
        {
          key: 'period',
          summary: '**보유 기간: 회원 계정에 연결하지 않으면 진단한 날부터 90일이 지나면 모두 지워요.**',
          detail: '회원 계정에 연결하면 **회원 탈퇴 때나 직접 지울 때(삭제 요청 포함)까지** 보관해요. 지운 결과는 결과 링크로도 열리지 않아요.',
        },
        {
          key: 'refuse',
          summary: '**동의하지 않을 수 있어요. 다만 동의하지 않으면 자가진단을 할 수 없어요.**',
          detail: '강좌 정보 보기와 전화 상담은 동의 없이 이용할 수 있어요.',
        },
      ],
      linkNotice: '결과 화면 주소(결과 링크)를 아는 사람은 누구나 추천 과정과 전체 점수를 볼 수 있어요. 결과 링크는 다른 사람에게 보내지 않도록 조심해 주세요. 다른 사람에게 보이지 않게 지키려면 링크를 공유하지 말고, 지우고 싶으면 회원은 마이페이지에서 지우고 회원이 아니면 전화나 이메일로 요청해 주세요.',
      check: '자가진단 응답과 결과를 민감정보로 처리하는 데 동의해요 (필수)',
      withdraw: '동의는 나중에 거둘 수 있어요. 회원은 마이페이지에서 진단 기록을 지우면 되고, 회원이 아니면 전화나 이메일로 요청해 주세요.',
    },
  },
} as const satisfies Record<string, SensitiveConsentVersion>;

export type SensitiveConsentVersionId = keyof typeof SENSITIVE_CONSENT_VERSIONS;

// 지금 화면이 보여 주고 서버가 받는 버전. DB 함수 submit_diagnosis()의 허용 목록(array['sc-v1'])과 같아야 한다.
export const CURRENT_SENSITIVE_CONSENT_VERSION: SensitiveConsentVersionId = 'sc-v1';
