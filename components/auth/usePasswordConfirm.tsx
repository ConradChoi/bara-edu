'use client';

import { useRef, useState } from 'react';
import { AlertIcon, CheckIcon } from '@/components/error/icons';
import { MSG_PASSWORD_MISMATCH_CLIENT } from '@/lib/form-messages';

// 비밀번호 확인 칸의 안내(가입 폼·재설정 폼 공용, 디자인 스펙 V-1.2 · 비밀번호 찾기 P-2·P-6).
// 'empty'·'mismatch'는 오류, 'match'는 한 번 불일치가 뜬 뒤 고쳤을 때만.
export type ConfirmNoteKind = 'none' | 'empty' | 'mismatch' | 'match';

export function usePasswordConfirm() {
  const [note, setNote] = useState<ConfirmNoteKind>('none');
  const [warned, setWarned] = useState(false); // 한 번이라도 불일치 안내가 떴는지 — 이후에는 입력할 때마다 다시 비교
  const pwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // 입력 도중에는 불일치를 띄우지 않는다. blur·제출 때 비교하고, 한 번 뜬 뒤에는 입력할 때마다 비교한다.
  function compare(opts: { emptyIsError: boolean }): ConfirmNoteKind {
    const a = pwRef.current?.value ?? '';
    const b = confirmRef.current?.value ?? '';
    let next: ConfirmNoteKind;
    if (!b) next = opts.emptyIsError ? 'empty' : 'none';
    else if (a !== b) next = 'mismatch';
    else next = warned ? 'match' : 'none';
    if (next === 'mismatch' || next === 'empty') setWarned(true);
    setNote(next);
    return next;
  }

  return { note, warned, compare, pwRef, confirmRef, invalid: note === 'mismatch' || note === 'empty' };
}

export function ConfirmNote({ id, note }: { id: string; note: ConfirmNoteKind }) {
  return (
    <div aria-live="polite">
      {(note === 'mismatch' || note === 'empty') && (
        <p id={id} className="flex gap-2 text-base leading-[1.6] text-n-9 break-keep">
          <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
          {note === 'empty' ? '비밀번호를 한 번 더 입력해 주세요' : MSG_PASSWORD_MISMATCH_CLIENT}
        </p>
      )}
      {note === 'match' && (
        <p className="flex gap-2 text-base leading-[1.6] text-n-8">
          <CheckIcon className="mt-0.5 size-5 shrink-0 text-success" />
          비밀번호가 같아요
        </p>
      )}
    </div>
  );
}
