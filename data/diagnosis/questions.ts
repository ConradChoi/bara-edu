// 도형심리 역량진단(/selfcheck) 30문항. 원본 요구사항서
// `data/BARA_shape_competency_diagnosis_requirements.md` 7절을 그대로 옮긴 것 — 문항
// 텍스트 자체를 바꾸려면 원본 요구사항서와 함께 검토해야 한다(임의 수정 금지).
// 문항 코드(A1~F5)는 그대로 submit_diagnosis() RPC의 diagnosis_answers.item_code로 저장된다.

export type DiagnosisAreaCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export type DiagnosisQuestion = {
  code: string; // 예: 'A1'
  area: DiagnosisAreaCode;
  text: string;
};

export const DIAGNOSIS_QUESTIONS: DiagnosisQuestion[] = [
  // A. 기본 이론 이해
  { code: 'A1', area: 'A', text: '도형심리 검사의 목적과 기본 원리를 설명할 수 있다.' },
  { code: 'A2', area: 'A', text: '동그라미·세모·네모·에스의 기본적인 기질적 특징을 구분할 수 있다.' },
  { code: 'A3', area: 'A', text: '각 도형의 강점과 보완점을 설명할 수 있다.' },
  { code: 'A4', area: 'A', text: '기질과 성격을 구분하여 설명할 수 있다.' },
  { code: 'A5', area: 'A', text: '도형심리 검사의 진행 순서와 기본적인 검사 방법을 알고 있다.' },
  // B. 도형 판독 능력
  { code: 'B1', area: 'B', text: '검사지에서 1차·2차·3차·4차 도형을 구분할 수 있다.' },
  { code: 'B2', area: 'B', text: '주도형에서 나타나는 여러 형태를 구별하고 기본 의미를 설명할 수 있다.' },
  { code: 'B3', area: 'B', text: '복합도형과 복합기질을 구분하여 해석할 수 있다.' },
  { code: 'B4', area: 'B', text: '이분법 도형과 보조도형을 찾아낼 수 있다.' },
  { code: 'B5', area: 'B', text: '도형의 크기·위치·겹침·반복 등 그림에서 나타나는 특징을 관찰할 수 있다.' },
  // C. 분석 능력
  { code: 'C1', area: 'C', text: '한 개의 특징만 보는 것이 아니라 여러 도형 정보를 종합해 해석할 수 있다.' },
  { code: 'C2', area: 'C', text: '상·중·하 등 주요 분석 기준을 실제 검사지에 적용할 수 있다.' },
  { code: 'C3', area: 'C', text: '라이프쇼크·조인트포인트 등 주요 분석기법을 찾아보고 해석 근거를 설명할 수 있다.' },
  { code: 'C4', area: 'C', text: '검사지의 특이 특징을 단정적으로 판단하지 않고 다른 정보와 함께 확인할 수 있다.' },
  { code: 'C5', area: 'C', text: '처음 보는 검사지도 일정한 분석 순서에 따라 전체적으로 분석할 수 있다.' },
  // D. 상담·활용 능력
  { code: 'D1', area: 'D', text: '검사 결과를 상대방이 이해하기 쉬운 언어로 설명할 수 있다.' },
  { code: 'D2', area: 'D', text: '결과를 일방적으로 설명하기보다 질문을 통해 검사자의 실제 경험과 연결할 수 있다.' },
  { code: 'D3', area: 'D', text: '도형의 특징을 관계·커뮤니케이션·강점 등의 실제 생활 문제에 연결할 수 있다.' },
  { code: 'D4', area: 'D', text: '검사 결과와 실제 상담 내용이 다를 때 추가적인 정보를 확인할 수 있다.' },
  { code: 'D5', area: 'D', text: '도형심리 분석과 임상적 진단을 구분하고 필요한 경우 전문기관 안내가 필요한 상황을 판단할 수 있다.' },
  // E. 사례 분석·기록 능력
  { code: 'E1', area: 'E', text: '검사 내용을 정해진 분석 양식에 따라 기록할 수 있다.' },
  { code: 'E2', area: 'E', text: '내가 내린 해석의 근거를 다른 사람에게 설명할 수 있다.' },
  { code: 'E3', area: 'E', text: '상담 내용을 축어록 또는 사례기록 형태로 정리할 수 있다.' },
  { code: 'E4', area: 'E', text: '이전 검사와 현재 검사를 비교해 변화나 차이를 관찰할 수 있다.' },
  { code: 'E5', area: 'E', text: '내 분석에 확신이 없을 때 슈퍼비전이나 다른 전문가의 의견을 활용할 수 있다.' },
  // F. 교육·지도 능력
  { code: 'F1', area: 'F', text: '도형심리를 처음 배우는 사람에게 4가지 도형을 쉽게 설명할 수 있다.' },
  { code: 'F2', area: 'F', text: '학습자가 잘못 분석한 부분을 발견하고 이유를 설명할 수 있다.' },
  { code: 'F3', area: 'F', text: '하나의 사례를 가지고 분석 과정을 단계적으로 시연할 수 있다.' },
  { code: 'F4', area: 'F', text: '도형심리 실습이나 그룹 교육을 진행할 수 있다.' },
  { code: 'F5', area: 'F', text: '교육 중 질문이나 예외 사례가 나왔을 때 근거를 가지고 답변할 수 있다.' },
];
