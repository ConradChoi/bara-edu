import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

vi.mock('@/app/actions/admin-members', () => ({ updateMemberProfile: vi.fn(), loadMemberProfileEdits: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import MemberProfileEditor, { type MemberProfileView } from '@/components/admin/MemberProfileEditor';

const member: MemberProfileView = {
  id: 'm1',
  name: '홍길순',
  phone: '010-1111-2222',
  email: 'hong@bara.kr',
  address: '서울',
  status: 'active',
  role: 'learner',
  emailConfirmed: true,
  withdrawnAtLabel: null,
};
const html = (over: Partial<MemberProfileView> = {}, step: 'view' | 'edit' | 'confirm' = 'view', counts = { pending: 0, cert: 0 }) =>
  renderToStaticMarkup(createElement(MemberProfileEditor, { member: { ...member, ...over }, pendingCount: counts.pending, certificateCount: counts.cert, initialStep: step }));

test('보기: 수정 가능하면 활성 버튼, 사유 줄 없음', () => {
  const h = html();
  expect(h).toContain('이름·연락처 수정');
  expect(h).not.toContain('aria-disabled');
  expect(h).not.toContain('edit-disabled-reason');
});

test.each([
  [{ status: 'withdrawn' }, '탈퇴한 회원이라 고칠 수 없어요'],
  [{ role: 'admin' }, '운영자 계정은 이 화면에서 고칠 수 없어요'],
  [{ emailConfirmed: false }, '아직 가입을 마무리하지 않은 회원이에요'],
  [{ emailConfirmed: null }, '가입 상태를 확인하지 못했어요'],
  [{ email: null }, '가입 이메일이 없어 본인 확인을 할 수 없어요'],
])('수정 불가 %j: aria-disabled(HTML disabled 아님) + 사유를 글자로 표시', (over, text) => {
  const h = html(over);
  expect(h).toContain('aria-disabled="true"');
  expect(h).toContain('aria-describedby="edit-disabled-reason"');
  expect(h).toContain(text);
  expect(h).not.toMatch(/<button[^>]*\sdisabled[\s>=]/);
});

test('편집: 현재 값이 채워지고 고치는 이유는 아무것도 선택돼 있지 않다', () => {
  const h = html({}, 'edit');
  expect(h).toContain('value="홍길순"');
  expect(h).toContain('value="010-1111-2222"');
  expect((h.match(/type="radio"/g) ?? []).length).toBe(4);
  expect(h).not.toMatch(/type="radio"[^>]*checked/);
  expect(h).not.toMatch(/type="checkbox"[^>]*checked/);
  expect(h).toContain('바뀐 내용이 없어요.'); // 바꾼 게 없으면 확인 버튼 비활성 안내
  expect(h).toContain('메모 (선택)');
});

test('확인: 경고는 이름이 바뀔 때만(여기서는 변경 없음이라 안 보임)', () => {
  const h = html({}, 'confirm', { pending: 2, cert: 1 });
  expect(h).not.toContain('입금 대기 중인 신청');
  expect(h).not.toContain('수료 이력이');
});
