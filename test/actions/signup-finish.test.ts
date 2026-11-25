import { beforeEach, expect, test, vi } from 'vitest';

const completeSignup = vi.fn();
vi.mock('@/lib/db/auth', () => ({ completeSignup: (t: string, p: string) => completeSignup(t, p) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock('@/lib/site-origin', () => ({ getSiteOrigin: async () => 'https://bara-edu.kr' }));

import { finishSignup } from '@/app/actions/auth';

const form = (f: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(f)) fd.set(k, v);
  return fd;
};
const run = (f: Record<string, string>) => finishSignup(undefined, form(f)).then((r) => r, (e: Error) => e.message);

beforeEach(() => completeSignup.mockReset());

test('성공 → /my?welcome=1 (세션 쿠키는 completeSignup이 쓴다), 비밀번호는 앞뒤 공백 그대로 전달', async () => {
  completeSignup.mockResolvedValue({ ok: true });
  expect(await run({ token: 't1', password: ' pw 1 ' })).toBe('REDIRECT:/my?welcome=1');
  expect(completeSignup).toHaveBeenCalledWith('t1', ' pw 1 ');
});

test('틀림 → 남은 횟수만 상태에 담고, 비밀번호·토큰은 담지 않는다', async () => {
  completeSignup.mockResolvedValue({ ok: false, reason: 'wrong_password', attemptsLeft: 3 });
  const r = await run({ token: 't1', password: 'bad' });
  expect(r).toEqual({ kind: 'wrong_password', attemptsLeft: 3 });
  expect(JSON.stringify(r)).not.toMatch(/t1|bad/);
});

test.each([
  ['link_locked', 'locked'],
  ['link_expired', 'expired'],
  ['link_done', 'done'],
  ['invalid_token', 'invalid'],
])('%s → 상태 화면 %s', async (reason, status) => {
  completeSignup.mockResolvedValue({ ok: false, reason });
  expect(await run({ token: 't', password: 'x' })).toEqual({ kind: 'status', status });
});

test('연결 오류·429·기타 실패는 알림만(횟수 상태 없음)', async () => {
  completeSignup.mockResolvedValueOnce({ ok: false, reason: 'unavailable' });
  expect(await run({ token: 't', password: 'x' })).toEqual({ kind: 'error', error: 'unavailable' });
  completeSignup.mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
  expect(await run({ token: 't', password: 'x' })).toEqual({ kind: 'error', error: 'rate_limited' });
  completeSignup.mockResolvedValueOnce({ ok: false, reason: 'failed' });
  expect(await run({ token: 't', password: 'x' })).toEqual({ kind: 'error', error: 'failed' });
});

test('토큰이 없으면 invalid, 비밀번호가 비면 API를 부르지 않는다', async () => {
  expect(await run({ password: 'x' })).toEqual({ kind: 'status', status: 'invalid' });
  expect(await run({ token: 't', password: '' })).toEqual({ kind: 'error', error: 'empty' });
  expect(completeSignup).not.toHaveBeenCalled();
});
