'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isNameChanged, isPhoneChanged, normalizeName, normalizePhone, REASONS, type ProfileSaveInput, type SaveOutcome } from '@/lib/admin-profile-edit';
import { listMemberProfileEditsApi, updateMemberProfileApi, type ProfileEditItem, type UpdateMemberProfileInput, type UpdateMemberProfileResult } from '@/lib/db/admin-profile';
import { adminConfirmEmail, adminSendReset } from '@/lib/db/auth';
import { getSiteOrigin } from '@/lib/site-origin';
import { logAdminAccess } from '@/lib/supabase/admin-queries';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 회원이 가입 인증 메일을 못 받았거나 잃어버린 경우, 관리자가 직접 인증 완료 처리를 하고
// 비밀번호 재설정 메일을 보내줄 수 있어야 한다는 요청(2026-10-02). "임시비밀번호를 문자열로
// 발급해 관리자가 직접 전달"하는 방식도 검토했으나, 이 프로젝트에 이메일 발송 인프라가 없어
// (당시 모든 메일은 Supabase Auth 자체 템플릿으로만 나갔다) 새 인프라 없이 쓸 수 있는
// 기존 "비밀번호 재설정" 메일 발송으로 대체하기로 확정(대표 결정, 지금은 API가 SES로 보낸다).
// 회원은 그 메일의 링크를 눌러 새 비밀번호를 직접 설정한 뒤 바로 로그인할 수 있다 — 기존 /reset-password 화면을
// 그대로 재사용하므로 신규 화면이 필요 없다.

export async function confirmMemberEmail(memberId: string) {
  const supabase = await requireAdminClient();
  const { data: member } = await supabase.from('profiles').select('email').eq('id', memberId).maybeSingle();
  if (!member?.email) redirect(`/admin/members/${memberId}?error=failed`);

  // API 연결 실패로 예외가 나도 액션 전체가 죽지 않고 기존 실패 배너로 끝낸다(withdraw()와 동일).
  const confirmed = await adminConfirmEmail(memberId).catch(() => ({ ok: false, reason: 'failed' }) as const);
  if (!confirmed.ok) redirect(`/admin/members/${memberId}?error=${confirmed.reason === 'password_not_set' ? 'password_not_set' : 'failed'}`);

  await logAdminAccess(supabase, memberId, '수정', '이메일 인증 수동 완료 처리');
  redirect(`/admin/members/${memberId}?success=email-confirmed`);
}

export async function sendPasswordResetEmail(memberId: string) {
  const supabase = await requireAdminClient();
  const { data: member } = await supabase.from('profiles').select('email').eq('id', memberId).maybeSingle();
  if (!member?.email) redirect(`/admin/members/${memberId}?error=failed`);

  // 관리자 세션으로 API의 관리자 경로를 부르지만, 메일은 회원 본인 주소로 발송된다
  // (기존 /reset-password 화면이 받는 링크와 동일한 종류).
  const sent = await adminSendReset(memberId, await getSiteOrigin()).catch(() => false);
  if (!sent) redirect(`/admin/members/${memberId}?error=failed`);

  await logAdminAccess(supabase, memberId, '수정', '비밀번호 재설정 메일 발송');
  redirect(`/admin/members/${memberId}?success=reset-email-sent`);
}

// ---- 이름·연락처 수정 (docs/02-design/features/bara-edu-lms.admin-profile-edit.api.md) ----
// 접속 기록(action '정보수정')은 API가 같은 트랜잭션에서 남긴다 — 여기서 logAdminAccess를 부르지 않는다.
// 클라이언트 IP(x-bara-client-ip)는 apiFetch가 요청 헤더에서 읽어 붙인다(다른 액션과 같은 경로).
// 실패는 redirect가 아니라 값으로 돌려줘 화면이 입력값을 유지한다.

function toOutcome(r: UpdateMemberProfileResult): SaveOutcome {
  if (r.ok) {
    return r.unchanged ? { status: 'unchanged', profile: r.profile } : { status: 'ok', changed: r.changed, profile: r.profile, mailQueued: r.mailQueued };
  }
  switch (r.reason) {
    case 'stale':
      return { status: 'stale', current: r.current };
    case 'validation': {
      const f = r.field;
      if (f === 'name' || f === 'phone' || f === 'reason' || f === 'memo') return { status: 'validation', field: f, ...(r.code ? { code: r.code } : {}) };
      if (f === 'identityChecked') return { status: 'validation', field: 'verified', code: 'not_checked' };
      if (r.code === 'none') return { status: 'validation', field: 'none' };
      return { status: 'failed' }; // expected 누락 등 화면이 만들 수 없는 모양 오류
    }
    case 'withdrawn':
    case 'not_confirmed':
    case 'target_is_admin':
    case 'no_email':
      return { status: 'locked', why: r.reason };
    case 'not_found':
      return { status: 'not_found' };
    case 'forbidden':
      return { status: 'forbidden' };
    case 'log_failed':
      return { status: 'log_failed' };
    case 'unauthenticated':
      redirect('/sign-in');
    default:
      return { status: 'failed' };
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string';

function isInput(v: ProfileSaveInput): boolean {
  return (
    !!v &&
    isStr(v.name) &&
    isStr(v.phone) &&
    isStr(v.memo) &&
    (REASONS as readonly string[]).includes(v.reason) &&
    !!v.expected &&
    isStr(v.expected.name) &&
    (v.expected.phone === null || isStr(v.expected.phone))
  );
}

export async function updateMemberProfile(memberId: string, input: ProfileSaveInput): Promise<SaveOutcome> {
  await requireAdminClient();
  if (!isStr(memberId) || !isInput(input)) return { status: 'failed' };
  if (input.identityChecked !== true) return { status: 'validation', field: 'verified', code: 'not_checked' };

  // 바뀐 칸만 보낸다(API는 보낸 필드만 고친다). expected는 보낸 칸의 편집 시작 값.
  const name = normalizeName(input.name);
  const phone = normalizePhone(input.phone);
  const body: UpdateMemberProfileInput = { memberId, expected: {}, reason: input.reason, memo: input.memo.trim() || null, identityChecked: true };
  if (isNameChanged(input.name, input.expected.name)) {
    body.name = name;
    body.expected.name = input.expected.name;
  }
  if (isPhoneChanged(input.phone, input.expected.phone)) {
    body.phone = phone;
    body.expected.phone = input.expected.phone;
  }
  if (body.name === undefined && body.phone === undefined) return { status: 'unchanged', profile: input.expected };

  const outcome = toOutcome(await updateMemberProfileApi(body));
  if (outcome.status === 'ok' || outcome.status === 'unchanged') revalidatePath(`/admin/members/${memberId}`);
  return outcome;
}

// "더 보기": 페이지를 다시 열면 '조회' 접속 기록이 또 남으므로 목록만 가져온다(이 조회 자체는 기록하지 않는다).
export type ProfileEditsLoad = { ok: true; items: ProfileEditItem[]; hasMore: boolean } | { ok: false };

export async function loadMemberProfileEdits(memberId: string, limit = 50): Promise<ProfileEditsLoad> {
  await requireAdminClient();
  if (!isStr(memberId)) return { ok: false };
  const r = await listMemberProfileEditsApi(memberId, Math.min(Math.max(Math.trunc(Number(limit)) || 5, 1), 50));
  if (r.ok) return { ok: true, items: r.items, hasMore: r.hasMore };
  if (r.reason === 'unauthenticated') redirect('/sign-in');
  return { ok: false };
}
