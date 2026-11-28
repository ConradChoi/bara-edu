import { unstable_rethrow } from 'next/navigation';
import FooterBody from './FooterBody';
import { getLegalDocument } from '@/lib/supabase/queries';

// 환불정책은 CMS(legal_documents)에서 관리자가 실제로 작성·게시해야 존재하는 문서라 —
// 아직 만들어지지 않았거나 게시가 중단된 상태에서도 이 링크가 항상 보이면 클릭 시
// /legal/refund-policy가 404로 뜬다. 이용약관/개인정보처리방침과 달리 이 링크는 게시된
// 문서가 실제로 있을 때만 노출한다(대표 요청, 2026-09-15 — "등록된 환불정책은 Footer에
// 노출되어야 한다"). CMS에서 새 문서를 만들 때 slug는 반드시 `refund-policy`로 입력해야
// 이 링크가 찾는 문서와 연결된다.
const REFUND_POLICY_SLUG = 'refund-policy';

// 전자상거래법 제10조 표시사항 + 약관/처리방침 링크. 이전에는 "주식회사 일리아 · ylia.io"
// 한 줄뿐이었고 ComingSoon 화면에만 쓰여, 실제 서비스 화면(/courses, /my, /sign-in 등)
// 어디에도 법정 표시사항이 노출된 적이 없었다(홈 화면 작업 중 발견, 2026-08-10).
export default async function Footer() {
  // 조회가 실패해도 푸터(법정 표시사항)는 그려야 한다. 환불정책 링크만 빼고 화면은 그대로 둔다(QA Major-1, 2026-11-28).
  let hasRefundPolicy = false;
  try {
    hasRefundPolicy = Boolean(await getLegalDocument(REFUND_POLICY_SLUG));
  } catch (err) {
    unstable_rethrow(err);
    console.error('[footer] refund-policy lookup failed', err);
  }
  return <FooterBody hasRefundPolicy={hasRefundPolicy} />;
}
