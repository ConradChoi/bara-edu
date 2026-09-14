// 도형심리 역량진단(/selfcheck) 설정값 — 문항 텍스트가 아닌 것 전부(척도 라벨, 영역
// 메타, 추천 tier 카피, 강점/보완 해석 문구). submit_diagnosis() RPC의 채점·판정 로직과
// 반드시 같은 값을 참조해야 하는 임계값 자체는 DB RPC 안에 있다 — 여기 있는 값은
// 화면 표시용 카피일 뿐, 채점 로직을 바꾸려면 schema.sql의 submit_diagnosis()도 함께 고쳐야 한다.

// 문항/임계값 버전 태그. submit_diagnosis() RPC가 diagnosis_results.version에 그대로
// 저장한다 — 나중에 문항이나 기준이 바뀌어도 과거 결과가 어떤 버전으로 채점됐는지 보존된다.
export const DIAGNOSIS_VERSION = 'shape-v1';

// submitDiagnosis()가 제출 성공 직후 심는 httpOnly 쿠키 이름 — "이 브라우저가 방금 이
// 토큰을 제출했다"는, 클라이언트가 위조할 수 없는 유일한 신호다. 결과 페이지가 이 쿠키와
// 토큰이 일치할 때만 로그인/가입 후 확인 없는 자동 귀속(AutoClaim)을 허용한다
// (app/actions/diagnosis.ts, app/(public)/selfcheck/result/[token]/page.tsx 양쪽에서 참조).
export const RECENT_SUBMIT_COOKIE = 'bara_selfcheck_recent_token';

export type DiagnosisAreaCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type DiagnosisAreaMeta = {
  code: DiagnosisAreaCode;
  name: string;
  // diagnosis_results의 실제 컬럼명이자, strength_areas/improvement_areas 배열에 저장되는 코드값.
  dbKey: 'theory' | 'reading' | 'analysis' | 'counseling' | 'case_record' | 'teaching';
  scoreColumn: 'scoreTheory' | 'scoreReading' | 'scoreAnalysis' | 'scoreCounseling' | 'scoreCaseRecord' | 'scoreTeaching';
  strengthCopy: string;
  improvementCopy: string;
};

// 순서가 스테퍼 페이지 순서(2~7페이지)이자, PM 문서 Q4의 동점 처리 우선순위(정의 순서)와 동일하다.
export const DIAGNOSIS_AREAS: DiagnosisAreaMeta[] = [
  {
    code: 'A',
    name: '기본 이론 이해',
    dbKey: 'theory',
    scoreColumn: 'scoreTheory',
    strengthCopy: '기초 개념을 비교적 안정적으로 이해하고 있습니다.',
    improvementCopy: '기본 이론을 한 번 더 정리하면 이후 학습이 훨씬 수월해져요.',
  },
  {
    code: 'B',
    name: '도형 판독 능력',
    dbKey: 'reading',
    scoreColumn: 'scoreReading',
    strengthCopy: '검사지에서 도형을 읽어내는 감각이 좋습니다.',
    improvementCopy: '도형을 구분하고 읽어내는 연습을 조금 더 하면 좋아요.',
  },
  {
    code: 'C',
    name: '분석 능력',
    dbKey: 'analysis',
    scoreColumn: 'scoreAnalysis',
    strengthCopy: '여러 정보를 종합해 해석하는 능력이 강점입니다.',
    improvementCopy: '여러 도형 정보를 종합해서 해석하는 연습이 더 필요해요.',
  },
  {
    code: 'D',
    name: '상담·활용 능력',
    dbKey: 'counseling',
    scoreColumn: 'scoreCounseling',
    strengthCopy: '지식을 실제 상담 언어로 잘 풀어내고 있습니다.',
    improvementCopy: '지식을 실제 상담 언어로 바꾸는 연습이 더 필요합니다.',
  },
  {
    code: 'E',
    name: '사례 분석·기록 능력',
    dbKey: 'case_record',
    scoreColumn: 'scoreCaseRecord',
    strengthCopy: '분석 근거를 기록하고 정리하는 습관이 잘 잡혀 있습니다.',
    improvementCopy: '분석 근거를 기록하고 검토하는 경험을 보완하면 좋습니다.',
  },
  {
    code: 'F',
    name: '교육·지도 능력',
    dbKey: 'teaching',
    scoreColumn: 'scoreTeaching',
    strengthCopy: '다른 사람에게 도형심리를 설명하고 지도하는 역량이 뛰어납니다.',
    improvementCopy: '학습 지도 경험을 조금 더 쌓으면 좋아요.',
  },
];

export const DIAGNOSIS_SCALE_LABELS: { score: 0 | 1 | 2 | 3 | 4; label: string }[] = [
  { score: 0, label: '처음 접한다 / 거의 알지 못한다' },
  { score: 1, label: '들어본 적 있다' },
  { score: 2, label: '설명할 수 있다' },
  { score: 3, label: '실제로 적용할 수 있다' },
  { score: 4, label: '다른 사람을 지도할 수 있다' },
];

export type DiagnosisTier = 'level2' | 'level1' | 'supervision' | 'instructor_candidate';

export const DIAGNOSIS_TIER_LABELS: Record<DiagnosisTier, string> = {
  level2: '기초부터 체계적으로 정리하는 단계',
  level1: '기본 분석에서 실전 활용으로 확장하는 단계',
  supervision: '새로운 이론보다 사례와 피드백이 필요한 단계',
  instructor_candidate: '강사과정 사전 적합 후보',
};

export const DIAGNOSIS_LEARNING_EXPERIENCE_LABELS: Record<string, string> = {
  none: '처음',
  past_course: '과거 수강 경험 있음',
  certified: '자격증 있음',
  active_use: '현재 활용 중',
};

// 강사과정 사전 적합 후보에게 반드시 함께 노출해야 하는 고지 문구(원본 요구사항서 §8.4).
export const INSTRUCTOR_CANDIDATE_DISCLAIMER =
  '자가진단 점수만으로 강사 자격을 판정하지 않습니다. 실제 사례 분석, 과정 이수, 시범강의 및 별도 평가가 필요합니다.';

// 모든 결과 화면(요약·상세)에 상시 노출하는 비임상/비자격판정 고지(원본 요구사항서 §0, §4.1).
export const DIAGNOSIS_DISCLAIMER =
  '이 결과는 학습 추천을 위한 자가진단이며, 임상적 진단이나 자격을 판정하지 않습니다.';
