'use client';

import { useEffect, useState } from 'react';
import { loadMemberProfileEdits } from '@/app/actions/admin-members';
import { formatKst, historyFieldsLabel, historyReasonLabel } from '@/lib/admin-profile-edit';
import type { ProfileEditItem } from '@/lib/db/admin-profile';

// 저장·충돌 뒤 에디터가 보내는 신호. 페이지를 다시 열지 않고 목록만 다시 가져온다.
export const PROFILE_EDITS_RELOAD = 'bara:profile-edits-reload';

const SHOWN = 5;

// 최근 수정 이력(값 없음). [더 보기]는 서버 액션으로 목록만 가져온다 — 페이지를 다시 열면 '조회' 접속 기록이 또 남는다.
export default function ProfileEditHistory({
  memberId,
  initialItems,
  initialHasMore,
  loadFailed,
  withdrawn,
}: {
  memberId: string;
  initialItems: ProfileEditItem[];
  initialHasMore: boolean;
  loadFailed: boolean;
  withdrawn: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [failed, setFailed] = useState(loadFailed);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await loadMemberProfileEdits(memberId, 50);
      if (r.ok) {
        setItems(r.items);
        setHasMore(r.hasMore);
        setFailed(false);
        return true;
      }
    } catch {
      // 아래 실패 문구로
    } finally {
      setLoading(false);
    }
    setFailed(true);
    return false;
  }

  useEffect(() => {
    const h = () => {
      void load();
    };
    window.addEventListener(PROFILE_EDITS_RELOAD, h);
    return () => window.removeEventListener(PROFILE_EDITS_RELOAD, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- memberId만 바뀐다
  }, [memberId]);

  const total = items.length;
  const canExpand = !expanded && (total > SHOWN || hasMore);
  const visible = expanded ? items : items.slice(0, SHOWN);

  async function more() {
    // 이미 받은 게 5건 이하(hasMore)라면 서버에서 전체를 가져온다
    if (total <= SHOWN && !(await load())) return;
    setExpanded(true);
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="profile-edits-title">
      <h2 id="profile-edits-title" className="text-[15px] font-semibold text-n-9">
        정보 수정 이력
      </h2>
      {withdrawn && <p className="text-[14px] text-n-6">탈퇴한 회원은 이력만 볼 수 있어요.</p>}
      {failed ? (
        <p role="alert" className="text-[14px] text-n-8">
          정보 수정 이력을 불러오지 못했어요. 잠시 후 화면을 다시 열어 주세요.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-[14px] text-n-6">수정한 적이 없어요.</p>
      ) : (
        <ul id="profile-edits-list" className="flex flex-col gap-2">
          {visible.map((it, i) => (
            <li key={`${it.at}-${i}`} className="flex flex-col gap-1 rounded-lg border border-n-3 p-3 text-[14px] sm:flex-row sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-n-9">
                  {historyFieldsLabel(it.fields)} 수정 · {historyReasonLabel(it.reason)}
                </span>
                {it.memo && <span className="break-words text-n-6">메모: {it.memo}</span>}
              </div>
              <span className="shrink-0 tabular-nums text-n-6">
                <time dateTime={it.at}>{formatKst(it.at)}</time> · {it.adminName ?? '(탈퇴)'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!failed && (canExpand || expanded) && total > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="profile-edits-list"
          aria-disabled={loading}
          onClick={() => {
            if (loading) return;
            if (expanded) setExpanded(false);
            else void more();
          }}
          className="inline-flex min-h-12 w-full items-center justify-center self-start rounded-pill border border-n-3 bg-n-0 px-5 text-[15px] font-medium text-n-8 hover:bg-n-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo sm:w-auto"
        >
          {expanded ? '처음 5건만 보기' : loading ? '불러오는 중이에요' : '더 보기'}
        </button>
      )}
      <p className="text-[14px] text-n-6">접속 기록은 1년 동안 보관돼요. 이전·이후 값은 기록하지 않아요.</p>
    </section>
  );
}
