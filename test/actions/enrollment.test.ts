import { beforeEach, expect, test, vi } from 'vitest';

type Op = { table: string; action: 'select' | 'update' | 'insert'; values?: Record<string, unknown>; filters: [string, unknown][] };
type Result = { data: unknown; error: { message: string } | null };

const ops: Op[] = [];
let user: { id: string } | null;
let handlers: Record<string, (op: Op) => Result>;
let seatsTaken: Record<string, number>;
let upload: { path: string } | { error: 'too-large' | 'invalid' | 'failed' };
const uploadMemberPhoto = vi.fn(async (_f: File) => upload);

function builder(table: string) {
  const op: Op = { table, action: 'select', filters: [] };
  const run = () => {
    ops.push(op);
    return Promise.resolve((handlers[`${op.action}:${table}`] ?? (() => ({ data: null, error: null })))(op));
  };
  const b = {
    select: () => b,
    update: (values: Record<string, unknown>) => ((op.action = 'update'), (op.values = values), b),
    insert: (values: Record<string, unknown>) => ((op.action = 'insert'), (op.values = values), run()),
    eq: (k: string, v: unknown) => (op.filters.push([k, v]), b),
    maybeSingle: () => run(),
    then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  };
  return b;
}
vi.mock('@/lib/db/server', () => ({
  createClient: async () => ({ from: builder, auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}));
let applyResult: string;
const applyEnrollment = vi.fn(async (_id: string) => applyResult);
vi.mock('@/lib/db/enrollment', () => ({ applyEnrollment: (id: string) => applyEnrollment(id) }));
vi.mock('@/lib/db/storage', () => ({ uploadMemberPhoto: (f: File) => uploadMemberPhoto(f) }));
vi.mock('@/lib/supabase/queries', () => ({ getApprovedSeatsTaken: async () => seatsTaken }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { applyToCourse } from '@/app/actions/enrollment';

const CID = 'course-1';
const SLUG = 'my-course';
const DAY = 24 * 60 * 60 * 1000;
const ok = (data: unknown): Result => ({ data, error: null });
const fail: Result = { data: null, error: { message: 'boom' } };
const form = (fields: Record<string, string | File> = { agree: 'on' }) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const run = (fd = form()) => applyToCourse(CID, SLUG, fd).then(() => 'no redirect', (e: Error) => e.message);
const writes = (table: string) => ops.filter((o) => o.table === table && o.action !== 'select');
const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'me.jpg', { type: 'image/jpeg' });

let profile: Record<string, unknown>;
let course: Record<string, unknown> | null;
let existing: Record<string, unknown> | null;

beforeEach(() => {
  ops.length = 0;
  user = { id: 'u1' };
  seatsTaken = {};
  upload = { path: 'u1/photo' };
  uploadMemberPhoto.mockClear();
  applyEnrollment.mockClear();
  applyResult = 'ok';
  profile = { status: 'active', address: '서울', photo_path: 'u1/photo' };
  course = { status: 'active', seats: 10, requires_certificate_info: true };
  existing = null;
  handlers = {
    'select:profiles': () => ok(profile),
    'select:courses': () => ok(course),
    'select:enrollments': () => ok(existing),
    'update:profiles': () => ok(null),
  };
});

test('로그인 안 함 → /sign-in?redirect=/courses/slug', async () => {
  user = null;
  expect(await run()).toBe(`REDIRECT:/sign-in?redirect=/courses/${SLUG}`);
  expect(ops).toHaveLength(0);
});

test('프로필이 active가 아니거나(탈퇴) 없으면 /sign-in, 아무것도 쓰지 않는다', async () => {
  profile = { status: 'withdrawn', address: null, photo_path: null };
  expect(await run()).toBe('REDIRECT:/sign-in');
  handlers['select:profiles'] = () => ok(null);
  expect(await run()).toBe('REDIRECT:/sign-in');
  expect(ops.filter((o) => o.action !== 'select')).toHaveLength(0);
});

const applyCalls = () => applyEnrollment.mock.calls.length;
const wrote = () => ops.filter((o) => o.action !== 'select');

test('약관 동의가 없으면 agree-required', async () => {
  expect(await run(form({}))).toBe(`REDIRECT:/courses/${SLUG}/apply?error=agree-required`);
  expect(applyCalls()).toBe(0);
});

test('강좌가 없으면 강좌 페이지로', async () => {
  course = null;
  expect(await run()).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(applyCalls()).toBe(0);
});

test('신규 신청: API 오퍼레이션을 courseId로 한 번 부르고 강좌 페이지로 (프로필은 그대로면 갱신하지 않는다)', async () => {
  expect(await run()).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(applyEnrollment).toHaveBeenCalledWith(CID);
  expect(applyCalls()).toBe(1);
  expect(wrote()).toHaveLength(0);
  expect(uploadMemberPhoto).not.toHaveBeenCalled();
});

test('이미 승인됐거나 입금 기한이 남은 신청은 사진·프로필·API 쓰기 전에 강좌 페이지로(중복 방지)', async () => {
  existing = { id: 'e1', status: 'approved', payment_due_at: new Date(Date.now() - DAY).toISOString() };
  expect(await run(form({ agree: 'on', address: '새 주소', photo: photo() }))).toBe(`REDIRECT:/courses/${SLUG}`);
  existing = { id: 'e1', status: 'pending', payment_due_at: new Date(Date.now() + DAY).toISOString() };
  expect(await run(form({ agree: 'on', address: '새 주소', photo: photo() }))).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(applyCalls()).toBe(0);
  expect(uploadMemberPhoto).not.toHaveBeenCalled();
  expect(wrote()).toHaveLength(0);
});

test.each([
  ['rejected', new Date(Date.now() + DAY).toISOString()],
  ['expired', new Date(Date.now() - DAY).toISOString()],
  ['pending', new Date(Date.now() - DAY).toISOString()], // 입금 기한 초과
])('재신청(%s)은 막지 않고 API로 넘긴다', async (status, due) => {
  existing = { id: 'e1', status, payment_due_at: due };
  expect(await run()).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(applyCalls()).toBe(1);
});

test('모집 상태가 아니거나(closed) 정원이 찼으면 사진·프로필·API 쓰기 전에 거절', async () => {
  const input = () => form({ agree: 'on', address: '새 주소', photo: photo() });
  course = { status: 'closed', seats: 10, requires_certificate_info: true };
  expect(await run(input())).toBe(`REDIRECT:/courses/${SLUG}`);
  course = { status: 'active', seats: 2, requires_certificate_info: true };
  seatsTaken = { [CID]: 2 };
  expect(await run(input())).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(applyCalls()).toBe(0);
  expect(uploadMemberPhoto).not.toHaveBeenCalled();
  expect(wrote()).toHaveLength(0);
  seatsTaken = { [CID]: 1 };
  await run(form({ agree: 'on' }));
  course = { status: 'upcoming', seats: 5, requires_certificate_info: false };
  seatsTaken = {};
  await run();
  expect(applyCalls()).toBe(2);
});

test('API의 최종 판단: closed·full·already_active·course_not_found는 강좌 페이지, inactive는 /sign-in, conflict·failed는 conflict', async () => {
  for (const r of ['closed', 'full', 'already_active', 'course_not_found']) {
    applyResult = r;
    expect(await run(), r).toBe(`REDIRECT:/courses/${SLUG}`);
  }
  for (const r of ['inactive', 'unauthenticated']) {
    applyResult = r;
    expect(await run(), r).toBe('REDIRECT:/sign-in');
  }
  for (const r of ['conflict', 'failed']) {
    applyResult = r;
    expect(await run(), r).toBe(`REDIRECT:/courses/${SLUG}/apply?error=conflict`);
  }
});

test('자격증 정보가 필요 없는 강좌는 주소·사진을 묻지 않는다', async () => {
  course = { status: 'active', seats: 10, requires_certificate_info: false };
  profile = { status: 'active', address: null, photo_path: null };
  expect(await run()).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(applyCalls()).toBe(1);
  expect(uploadMemberPhoto).not.toHaveBeenCalled();
});

test('자격증 정보 필요: 주소가 어디에도 없으면 address-required, 사진이 없으면 photo-required', async () => {
  profile = { status: 'active', address: null, photo_path: 'u1/photo' };
  expect(await run()).toBe(`REDIRECT:/courses/${SLUG}/apply?error=address-required`);
  profile = { status: 'active', address: '서울', photo_path: null };
  expect(await run()).toBe(`REDIRECT:/courses/${SLUG}/apply?error=photo-required`);
  expect(applyCalls()).toBe(0);
});

test('새 주소·사진을 보내면 업로드 후 프로필을 갱신하고 그 다음에 신청한다 (주소는 앞뒤 공백 제거)', async () => {
  profile = { status: 'active', address: null, photo_path: null };
  expect(await run(form({ agree: 'on', address: '  부산시 1  ', photo: photo() }))).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(uploadMemberPhoto).toHaveBeenCalledTimes(1);
  const [upd] = writes('profiles');
  expect(upd.values).toEqual({ address: '부산시 1', photo_path: 'u1/photo' });
  expect(upd.filters).toEqual([['id', 'u1']]);
  expect(applyCalls()).toBe(1);
});

test('저장된 주소·사진이 있으면 새 입력 없이도 재사용한다', async () => {
  expect(await run(form({ agree: 'on', address: '   ' }))).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(writes('profiles')).toHaveLength(0);
  expect(applyCalls()).toBe(1);
});

test('빈 파일(size 0)은 업로드하지 않는다', async () => {
  expect(await run(form({ agree: 'on', photo: new File([], 'empty.jpg') }))).toBe(`REDIRECT:/courses/${SLUG}`);
  expect(uploadMemberPhoto).not.toHaveBeenCalled();
});

test('사진 오류 매핑: too-large, invalid, failed(→photo-failed)', async () => {
  const withPhoto = () => form({ agree: 'on', photo: photo() });
  upload = { error: 'too-large' };
  expect(await run(withPhoto())).toBe(`REDIRECT:/courses/${SLUG}/apply?error=photo-too-large`);
  upload = { error: 'invalid' };
  expect(await run(withPhoto())).toBe(`REDIRECT:/courses/${SLUG}/apply?error=photo-invalid`);
  upload = { error: 'failed' };
  expect(await run(withPhoto())).toBe(`REDIRECT:/courses/${SLUG}/apply?error=photo-failed`);
  expect(applyCalls()).toBe(0);
  expect(writes('profiles')).toHaveLength(0);
});

test('프로필 갱신 실패 → conflict, 신청은 하지 않는다', async () => {
  handlers['update:profiles'] = () => fail;
  expect(await run(form({ agree: 'on', address: '새 주소' }))).toBe(`REDIRECT:/courses/${SLUG}/apply?error=conflict`);
  expect(applyCalls()).toBe(0);
});
