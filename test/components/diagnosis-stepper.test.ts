import { expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SENSITIVE_CONSENT_VERSIONS } from '@/data/diagnosis/consent';
import { AGE_CONFIRM_COPY, OUTDATED_ERROR_COPY, PRIVACY_CONSENT_COPY, SENSITIVE_REFUSAL_COPY, SUBMIT_ERROR_COPY } from '@/data/diagnosis/consent-copy';

vi.mock('@/app/actions/diagnosis', () => ({ submitDiagnosis: async () => {} }));
import DiagnosisStepper from '@/components/diagnosis/DiagnosisStepper';

const SC_V1 = SENSITIVE_CONSENT_VERSIONS['sc-v1'].text;
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(DiagnosisStepper, props as never));
const strip = (s: string) => s.replace(/\*\*/g, '');
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const checkbox = (html: string, name: string) => html.match(/<input type="checkbox"[^>]*>/g)?.find((i) => i.includes(`name="${name}"`));

test('동의 체크 3개는 따로 있고 모두 미체크, "모두 동의" 없음(로그인 프리필이 있어도)', () => {
  const html = render({ defaultName: '홍길동', defaultEmail: 'a@b.kr' });
  for (const name of ['consentPrivacy', 'consentSensitive', 'ageConfirmed']) {
    const input = checkbox(html, name);
    expect(input, name).toBeDefined();
    expect(input).not.toContain('checked');
  }
  expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  expect(text(html)).not.toMatch(/모두 동의|전체 동의/);
});

test('민감정보 상자: sc-v1 원문이 전부 보이고(고지 4항목 요약·자세히 접지 않음), 숨은 칸으로 sc-v1을 보낸다', () => {
  const html = render();
  const t = text(html);
  for (const s of [SC_V1.title, SC_V1.what, SC_V1.intro, SC_V1.linkNotice, SC_V1.check, SC_V1.withdraw]) expect(t).toContain(strip(s));
  expect(SC_V1.items).toHaveLength(4);
  for (const item of SC_V1.items) {
    expect(t).toContain(strip(item.summary));
    expect(t).toContain(strip(item.detail));
  }
  expect(html).not.toContain('<details');
  expect(html).toContain('<input type="hidden" name="consentSensitiveVersion" value="sc-v1"/>');
  // 체크박스가 고지 영역을 가리킨다
  expect(checkbox(html, 'consentSensitive')).toContain('aria-describedby="consent-sensitive-summary"');
  expect(html).toContain('id="consent-sensitive-summary"');
});

test('개인정보 상자(SC-PRIV-*)와 연령(SC-AGE-CHECK) 문구, 순서 ① → ② → ③', () => {
  const t = text(render());
  for (const s of [PRIVACY_CONSENT_COPY.title, ...PRIVACY_CONSENT_COPY.items, PRIVACY_CONSENT_COPY.check, AGE_CONFIRM_COPY.check]) expect(t).toContain(strip(s));
  expect(t.indexOf(PRIVACY_CONSENT_COPY.check)).toBeLessThan(t.indexOf(SC_V1.check));
  expect(t.indexOf(SC_V1.check)).toBeLessThan(t.indexOf(AGE_CONFIRM_COPY.check));
  expect(t).not.toContain('학습 경험, 30문항 응답'); // 옛 ① 요약의 응답 항목은 ②로 옮겼다
});

test('처음에는 오류·거부 안내가 없다', () => {
  const t = text(render());
  expect(t).not.toContain(SENSITIVE_REFUSAL_COPY.error);
  expect(t).not.toContain(SENSITIVE_REFUSAL_COPY.altTitle);
});

test('consent-required(sensitive): 오류 배너 + 민감정보 오류 + 거부 안내(강좌·전화·운영시간), 체크는 여전히 미체크', () => {
  const html = render({ serverError: 'consent-required', serverConsent: 'sensitive' });
  const t = text(html);
  expect(t).toContain(SUBMIT_ERROR_COPY['consent-required']);
  expect(t).toContain(SENSITIVE_REFUSAL_COPY.error);
  expect(t).toContain(SENSITIVE_REFUSAL_COPY.notSent);
  expect(t).toContain(SENSITIVE_REFUSAL_COPY.altTitle);
  expect(html).toContain('href="/courses"');
  expect(html).toContain('href="tel:01090255093"');
  expect(t).toContain('전화로 상담받기 010-9025-5093');
  expect(t).toContain('운영시간 평일');
  const input = checkbox(html, 'consentSensitive')!;
  expect(input).toContain('aria-invalid="true"');
  expect(input).toContain('consentSensitive-error');
  expect(input).not.toContain('checked');
  expect(html.match(/role="region"/g)).toHaveLength(1);
});

test('consent-required(privacy): 개인정보 오류 아래 거부 안내 1번', () => {
  const html = render({ serverError: 'consent-required', serverConsent: 'privacy' });
  const t = text(html);
  expect(t).toContain(PRIVACY_CONSENT_COPY.error);
  expect(t).not.toContain(SENSITIVE_REFUSAL_COPY.error);
  expect(html.match(/role="region"/g)).toHaveLength(1);
  expect(t.indexOf(SENSITIVE_REFUSAL_COPY.altTitle)).toBeLessThan(t.indexOf(SC_V1.check));
});

test('consent-outdated: 경고 배너(role=alert). 초안 여부를 모르는 첫 렌더에서는 "답은 그대로" 문장을 붙이지 않는다', () => {
  const html = render({ serverError: 'consent-outdated' });
  expect(html).toMatch(/role="alert"[^>]*>동의 안내가 바뀌었어요/);
  expect(text(html)).toContain(OUTDATED_ERROR_COPY.base);
  expect(text(html)).not.toContain(OUTDATED_ERROR_COPY.answersKept);
  expect(checkbox(html, 'consentSensitive')).not.toContain('checked');
});

test.each(['validation', 'incomplete', 'submit-failed'] as const)('기존 오류 %s 배너 유지', (code) => {
  expect(text(render({ serverError: code }))).toContain(SUBMIT_ERROR_COPY[code]);
});

test('폼은 noValidate(브라우저 말풍선 대신 화면 오류)', () => {
  expect(render()).toMatch(/<form[^>]*novalidate=""/i);
});
