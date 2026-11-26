import { deleteMyDiagnosisResult } from '@/app/actions/diagnosis';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { DELETE_RESULT_COPY } from '@/data/diagnosis/consent-copy';

// 진단 기록 지우기(민감정보 동의 철회) 확인 대화상자. 마이페이지 자가진단내역과 결과 상세가 같이 쓴다(디자인 스펙 D4).
// hasLead: get_my_diagnosis_results의 has_lead(API 계약 C3). true일 때만 "강사과정 상담 문의도 함께 지우기"(기본 체크).
// 성공하면 액션이 /my?tab=diagnosis&deleted=1로 보낸다(어디서 지웠든 같다).
export default function DeleteDiagnosisResultDialog({
  token,
  hasLead,
  triggerLabel,
  triggerAriaLabel,
  triggerClassName,
}: {
  token: string;
  hasLead: boolean;
  triggerLabel: string;
  triggerAriaLabel?: string;
  triggerClassName: string;
}) {
  return (
    <ConfirmDialog
      triggerLabel={triggerLabel}
      triggerAriaLabel={triggerAriaLabel}
      triggerClassName={triggerClassName}
      title={DELETE_RESULT_COPY.title}
      description={DELETE_RESULT_COPY.body}
      confirmLabel={DELETE_RESULT_COPY.confirm}
      cancelLabel={DELETE_RESULT_COPY.cancel}
      pendingLabel={DELETE_RESULT_COPY.busy}
      tone="danger"
      size="lg"
      describe
      initialFocus="cancel"
      extraCheckbox={hasLead ? { name: 'deleteLeads', label: DELETE_RESULT_COPY.withLeads, help: DELETE_RESULT_COPY.withLeadsHelp, defaultChecked: true } : undefined}
      action={deleteMyDiagnosisResult.bind(null, token)}
    />
  );
}
