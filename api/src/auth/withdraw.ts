import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { withService } from '../db/context.js';
import { hashPassword } from './passwords.js';
import { invalidateEmailTokensIn, lockUserSignupIn } from './tokens.js';
import { revokeAllSessionsIn } from './sessions.js';
import { clearUserMfaIn, lockUserMfaIn } from './mfa.js';

// 학습 이력 파기 대상(회원 본인 행만). 거래(enrollments)·수료(certificates)는 법정 보존이라 지우지 않는다.
const DELETE_TABLES = ['progress', 'quiz_submissions', 'assignment_submissions', 'course_exam_submissions', 'course_exam_attempt_resets', 'diagnosis_leads'];

export type WithdrawInput = { reason: string; detail: string | null };
export type WithdrawResult = 'ok' | 'active_enrollment' | 'not_found';

// 진행 중 수강: 입금 기한이 남은 입금 대기, 또는 승인됐는데 강의가 없거나 전부 완료하지 않은 강좌.
const ACTIVE_ENROLLMENT_SQL = `
  select exists (
    select 1 from enrollments e
     where e.user_id = $1
       and (
         (e.status = 'pending' and e.payment_due_at >= now())
         or (e.status = 'approved' and (
           not exists (select 1 from lessons l where l.course_id = e.course_id)
           or exists (
             select 1 from lessons l
              where l.course_id = e.course_id
                and not exists (select 1 from progress p where p.user_id = e.user_id and p.lesson_id = l.id and p.completed_at is not null)
           )
         ))
       )
  ) as blocked`;

// 탈퇴의 DB 부분을 한 트랜잭션으로 처리한다 — 중간에 실패하면 전부 롤백되어 반쯤 탈퇴된 상태가 남지 않는다.
// 사진(S3) 삭제는 호출한 쪽이 커밋 뒤에 한다.
export async function withdrawAccount(pool: pg.Pool, userId: string, input: WithdrawInput): Promise<WithdrawResult> {
  // bcrypt는 느리므로 트랜잭션(행 잠금) 밖에서 미리 계산한다
  const hash = await hashPassword(randomBytes(32).toString('base64url'));
  const anonymizedEmail = `withdrawn+${userId}@deleted.invalid`;
  return withService(pool, async (tx) => {
    // 락 순서: 이메일 토큰 -> 가입 시도 -> 사용자 -> profiles (가입 확정·resetPassword와 같은 방향)
    await lockUserSignupIn(tx, userId);
    // 같은 회원의 동시 탈퇴 요청을 직렬화한다
    const locked = await tx.query('select 1 from auth.users where id = $1 for update', [userId]);
    if (locked.rowCount === 0) return 'not_found';

    // 락 순서: 사용자 -> mfa_* -> profiles. 지우는 것은 진행 중 수강 확인 뒤(그 전에 끝나면 이 트랜잭션은 아무것도 바꾸지 않고 커밋된다).
    await lockUserMfaIn(tx, userId);

    // 프로필 행을 잠가 둔다: enrollments.apply가 profiles를 FOR SHARE로 읽으므로, 이미 신청이 진행 중이면 그 커밋을 기다린 뒤
    // 아래 진행 중 수강 확인에 그 신청이 보이고, 반대로 탈퇴가 먼저면 신청이 탈퇴 후 상태(inactive)를 본다.
    await tx.query('select 1 from profiles where id = $1 for update', [userId]);

    if ((await tx.query<{ blocked: boolean }>(ACTIVE_ENROLLMENT_SQL, [userId])).rows[0].blocked) return 'active_enrollment';

    for (const t of DELETE_TABLES) await tx.query(`delete from "${t}" where user_id = $1`, [userId]);
    // 자가진단 결과는 행째 지운다(응답·점수·동의 기록 포함, 응답은 FK cascade). 이름·연락처만 비우면 user_id로 계속 이어지는
    // 가명 민감정보가 남는다(대표 결정 2026-11-26, 민감정보 동의 기획 Q2). 위에서 이 회원의 문의는 이미 지웠다.
    await tx.query('delete from diagnosis_results where user_id = $1', [userId]);

    await tx.query(
      "update auth.users set email = $2, encrypted_password = $3, raw_user_meta_data = '{}'::jsonb, updated_at = now() where id = $1",
      [userId, anonymizedEmail, hash],
    );
    await invalidateEmailTokensIn(tx, userId);
    await tx.query('delete from auth.signup_attempts where user_id = $1', [userId]); // 이름·연락처·비밀번호 해시 파기

    // profiles.email은 auth.users.email의 복제본이라 같은 값으로 맞춘다
    await tx.query(
      `update profiles
          set name = '탈퇴한 회원', phone = null, email = $2, address = null, photo_path = null,
              status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = $3, withdrawal_reason_detail = $4
        where id = $1 and status = 'active'`,
      [userId, anonymizedEmail, input.reason, input.detail],
    );
    // 2단계 인증 데이터(등록·대기·복구 코드·대기표·등록 코드)와 계정 이력을 함께 지운다(기획서 2.7.4). auth.users 행은 남으므로 cascade로는 지워지지 않는다.
    await clearUserMfaIn(tx, userId);
    await tx.query('delete from auth.mfa_account_state where user_id = $1', [userId]);
    await tx.query("delete from auth.rate_events where key = $1 and bucket like 'mfa-%'", [userId]);
    await revokeAllSessionsIn(tx, userId);
    return 'ok';
  });
}
