import { describe, expect, test } from 'vitest';
import {
  applyOutcome,
  changedFields,
  messageForServerValidation,
  formFrom,
  historyFieldsLabel,
  initialState,
  lockedWhy,
  MSG,
  savedMessage,
  startEdit,
  validateForm,
  type EditorState,
} from '@/lib/admin-profile-edit';

const base = { name: '홍길순', phone: '010-1111-2222' };
const filled = (over: Partial<ReturnType<typeof formFrom>> = {}) => ({ ...formFrom(base), name: '홍길동', reason: 'member_request' as const, verified: true, ...over });

describe('validateForm', () => {
  test('고치는 이유는 기본값이 없다', () => {
    expect(formFrom(base).reason).toBe('');
    expect(validateForm(filled({ reason: '' }), base).errors.reason).toBe(MSG.reason);
  });

  test("'기타'를 고르면 메모가 필수(5자 이상)이고, 다른 이유는 메모가 없어도 된다", () => {
    expect(validateForm(filled({ reason: 'other', memo: '' }), base).errors.memo).toBe(MSG.memoRequired);
    expect(validateForm(filled({ reason: 'other', memo: '1234' }), base).errors.memo).toBe(MSG.memoRequired);
    expect(validateForm(filled({ reason: 'other', memo: '사유를 적었어요' }), base).errors.memo).toBeUndefined();
    expect(validateForm(filled({ reason: 'typo_fix', memo: '' }), base).errors.memo).toBeUndefined();
  });

  test('메모에 전화번호·이메일 형태가 있으면 거절한다', () => {
    expect(validateForm(filled({ memo: '010 1234 5678' }), base).errors.memo).toBe(MSG.memoPii);
    expect(validateForm(filled({ memo: 'a@b.kr 입니다' }), base).errors.memo).toBe(MSG.memoPii);
    expect(validateForm(filled({ memo: '01012345678' }), base).errors.memo).toBe(MSG.memoPii);
    for (const memo of ['900101-1234567', '+82 10-1234-5678', '10-1234-5678', '０１０-１２３４-５６７８', '0 1 0 1 2 3 4 5 6 7 8', '110-123-456789', 'abc @ naver.com', 'abc (at) naver.com', 'abc[at]naver.com']) {
      expect(validateForm(filled({ memo }), base).errors.memo, memo).toBe(MSG.memoPii);
    }
    expect(validateForm(filled({ memo: '이모지 \ud83d' }), base).errors.memo).toBe(MSG.memoPii); // 짝 없는 서로게이트
    // 날짜는 허용(서버 규칙과 동일)
    expect(validateForm(filled({ memo: '2026-11-26 전화로 요청' }), base).errors.memo).toBeUndefined();
  });

  test('본인 확인 체크가 없으면 오류', () => {
    expect(validateForm(filled({ verified: false }), base).errors.verified).toBe(MSG.verified);
  });

  test('이름 규칙: 2~100자, 제어문자, 탈퇴한 회원', () => {
    expect(validateForm(filled({ name: '김' }), base).errors.name).toBe(MSG.nameLength);
    expect(validateForm(filled({ name: 'a'.repeat(101) }), base).errors.name).toBe(MSG.nameLength);
    expect(validateForm(filled({ name: '홍\n길동' }), base).errors.name).toBe(MSG.nameLength);
    expect(validateForm(filled({ name: '탈퇴한  회원' }), base).errors.name).toBe(MSG.nameReserved);
    expect(validateForm(filled({ name: '😀😀' }), base).errors.name).toBeUndefined();
  });

  test('휴대전화: 비워도 되고, 문자·자릿수·가려진 번호는 거절', () => {
    expect(validateForm(filled({ phone: '' }), base).errors.phone).toBeUndefined();
    expect(validateForm(filled({ phone: '010-abcd' }), base).errors.phone).toBe(MSG.phone);
    expect(validateForm(filled({ phone: '12345' }), base).errors.phone).toBe(MSG.phone);
    expect(validateForm(filled({ phone: '010-****-5678' }), base).errors.phone).toBe(MSG.phoneMasked);
    expect(validateForm(filled({ phone: '+82 10-1234-5678' }), base).errors.phone).toBeUndefined();
  });

  test('바뀐 게 없으면 hasChange=false이고 오류를 내지 않는다(기존 값이 규칙을 못 지켜도)', () => {
    const legacy = { name: '홍길순', phone: '전화 없음' };
    expect(validateForm({ ...formFrom(legacy), reason: '', verified: false }, legacy)).toEqual({ hasChange: false, errors: {} });
  });
});

describe('applyOutcome', () => {
  const editing = (): EditorState => {
    const s = startEdit(initialState(base));
    return { ...s, step: 'confirm', form: filled({ memo: '메모예요 메모', phone: '010-9999-0000' }) };
  };

  test('stale: 현재 값으로 다시 채우고 입력한 값을 알림에 담고 본인 확인 체크를 해제한다', () => {
    const next = applyOutcome(editing(), { status: 'stale', current: { name: '김철수', phone: '010-1111-2222' } });
    expect(next.step).toBe('edit');
    expect(next.baseline).toEqual({ name: '김철수', phone: '010-1111-2222' });
    expect(next.form.name).toBe('김철수');
    expect(next.form.phone).toBe('010-1111-2222');
    expect(next.form.verified).toBe(false);
    expect(next.form.reason).toBe('member_request'); // 이유·메모는 유지
    expect(next.form.memo).toBe('메모예요 메모');
    expect(next.notice).toEqual({ kind: 'stale', mine: { name: '홍길동', phone: '010-9999-0000' }, changedFields: ['name'] });
    expect(next.focus).toBe('notice');
  });

  test('stale: 전화가 비어 있는 현재 값은 빈 칸으로 채운다', () => {
    const next = applyOutcome(editing(), { status: 'stale', current: { name: '홍길순', phone: null } });
    expect(next.form.phone).toBe('');
    expect(next.notice).toMatchObject({ changedFields: ['phone'] });
  });

  test('validation: 서버가 지목한 칸에 문구를 두고 그 칸으로 포커스, 입력은 유지', () => {
    const next = applyOutcome(editing(), { status: 'validation', field: 'memo', code: 'memo_has_pii' });
    expect(next.step).toBe('edit');
    expect(next.errors.memo).toBe(MSG.memoPii);
    expect(next.focus).toBe('memo');
    expect(next.form.name).toBe('홍길동');
  });

  test('log_failed·failed: 확인 단계에 머물고 입력과 본인 확인 체크를 유지', () => {
    for (const status of ['log_failed', 'failed'] as const) {
      const next = applyOutcome(editing(), { status });
      expect(next.step).toBe('confirm');
      expect(next.form.verified).toBe(true);
      expect(next.form.name).toBe('홍길동');
      expect(next.notice).toEqual({ kind: status });
    }
  });

  test('ok: 보기로 돌아가 새 값을 기준으로 삼고 폼을 비운다', () => {
    const next = applyOutcome(editing(), { status: 'ok', changed: ['name', 'phone'], profile: { name: '홍길동', phone: '010-9999-0000' }, mailQueued: false });
    expect(next.step).toBe('view');
    expect(next.baseline.name).toBe('홍길동');
    expect(next.form.reason).toBe('');
    expect(next.form.verified).toBe(false);
    expect(next.banner).toEqual({ kind: 'saved', changed: ['name', 'phone'], mailQueued: false });
  });

  test('locked: 편집을 닫고 수정 불가 사유를 갖는다', () => {
    const next = applyOutcome(editing(), { status: 'locked', why: 'withdrawn' });
    expect(next.step).toBe('view');
    expect(next.locked).toBe('withdrawn');
  });
});

test('바뀐 칸은 원문으로 판정한다: 기존 이름이 규칙 밖이어도 손대지 않으면 바뀐 칸이 아니다', () => {
  const legacy = { name: '홍  길동', phone: '010-1111-2222' };
  const form = { ...formFrom(legacy), phone: '010-3333-4444' };
  expect(changedFields(form, legacy)).toEqual(['phone']);
  const v = validateForm({ ...form, reason: 'member_request', verified: true }, legacy);
  expect(v.errors).toEqual({});
  // 정규화하면 같아지는 입력(앞뒤 공백)은 바뀐 칸이 아니다
  expect(changedFields({ name: '홍길동 ', phone: '' }, { name: '홍길동', phone: null })).toEqual([]);
  // 바뀐 칸의 새 값은 정규화해 비교한다
  expect(changedFields({ name: '홍 길동 ', phone: '' }, legacy)).toEqual(['name', 'phone']);
});

test('이름에 줄/문단 구분 문자는 거절', () => {
  expect(validateForm(filled({ name: '홍\u2028길동' }), base).errors.name).toBe(MSG.nameLength);
  expect(messageForServerValidation('name', 'name_control')).toBe(MSG.nameLength);
});

test('수정 불가 사유 우선순위', () => {
  const ok = { status: 'active', role: 'learner', emailConfirmed: true, email: 'a@b.kr' };
  expect(lockedWhy(ok)).toBeNull();
  expect(lockedWhy({ ...ok, status: 'withdrawn', role: 'admin' })).toBe('withdrawn');
  expect(lockedWhy({ ...ok, role: 'admin', emailConfirmed: false })).toBe('target_is_admin');
  expect(lockedWhy({ ...ok, emailConfirmed: false })).toBe('not_confirmed');
  expect(lockedWhy({ ...ok, emailConfirmed: null })).toBe('unknown_confirm');
  expect(lockedWhy({ ...ok, email: null })).toBe('no_email');
});

test('성공 문구와 이력 항목 라벨', () => {
  expect(savedMessage(['name', 'phone'], true)).toBe('이름·연락처를 수정했어요. 가입 이메일로 안내 메일을 보내요. 메일이 안 왔다고 하시면 개발 담당에게 알려 주세요.');
  expect(savedMessage(['phone'], true)).toBe('휴대전화를 수정했어요. 가입 이메일로 안내 메일을 보내요. 메일이 안 왔다고 하시면 개발 담당에게 알려 주세요.');
  expect(savedMessage(['name'], false)).toBe('이름을 수정했어요.');
  expect(historyFieldsLabel(['phone', 'name'])).toBe('이름, 휴대전화');
});
