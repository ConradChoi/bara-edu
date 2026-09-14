import { submitDiagnosisLead } from '@/app/actions/diagnosis';
import { INSTRUCTOR_CANDIDATE_DISCLAIMER } from '@/data/diagnosis/config';

const ERROR_MESSAGE: Record<string, string> = {
  validation: '이름·연락처와 연락 수신 동의를 확인해주세요.',
  failed: '문의 접수에 실패했어요. 잠시 후 다시 시도해주세요.',
};

// 강사과정 관심 문의 폼(F-DIAG-15). tier=instructor_candidate 결과 화면에서만 렌더된다
// (호출부에서 조건 확인). 다른 액션들과 동일하게 redirect + 쿼리파라미터로 성공/실패를
// 표시하는 이 프로젝트의 기본 패턴을 그대로 따른다 — 페이지 전환 없이 그 자리에서 보여주는
// 인라인 상태가 필요하다면(flows.md 1.7 제안) 이후 useActionState로 바꿀 수 있지만,
// 이번 구현은 기존 admin-exam-bank.ts 등과 동일한 단순한 패턴을 우선한다.
export default function LeadForm({
  token,
  prefillName,
  prefillContact,
  leadSuccess,
  leadError,
}: {
  token: string;
  prefillName?: string;
  prefillContact?: string;
  leadSuccess?: boolean;
  leadError?: string;
}) {
  if (leadSuccess) {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-n-1 p-4">
        <p className="text-[12px] font-semibold text-pink">강사과정 사전 적합 후보</p>
        <p className="text-[13px] text-n-9">문의가 접수됐어요. 강사과정 소식이 준비되면 안내드릴게요.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-n-1 p-4">
      <p className="text-[12px] font-semibold text-pink">강사과정 사전 적합 후보</p>
      <p className="text-[15px] font-semibold text-n-9">강사과정이 열리면 안내받기</p>
      <p className="text-[12px] text-n-6">
        아직 강사과정은 별도 문의로만 안내드리고 있어요. 연락처를 남겨주시면 준비되는 대로 안내해드릴게요.
      </p>
      {leadError && ERROR_MESSAGE[leadError] && <p className="text-[12px] text-danger">{ERROR_MESSAGE[leadError]}</p>}
      <form action={submitDiagnosisLead.bind(null, token)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[12px] text-n-7">
          이름 *
          <input
            name="name"
            required
            defaultValue={prefillName}
            className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-n-7">
          연락처(휴대전화 또는 이메일) *
          <input
            name="contact"
            required
            defaultValue={prefillContact}
            placeholder="01012345678"
            className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-n-7">
          한 줄 메모 (선택)
          <input
            name="message"
            maxLength={100}
            placeholder="궁금한 점이나 하고 싶은 말을 남겨주세요"
            className="h-9 rounded-md border border-n-3 bg-n-0 px-2.5 text-[13px] text-n-9 outline-none focus:border-pink"
          />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-n-7">
          <input type="checkbox" name="consentContact" required className="h-4 w-4" />
          연락 수신에 동의합니다 (필수)
        </label>
        <button type="submit" className="h-10 rounded-pill bg-pink text-[13px] font-semibold text-white">
          안내받기 신청
        </button>
      </form>
      <p className="text-[10.5px] text-n-6">{INSTRUCTOR_CANDIDATE_DISCLAIMER}</p>
    </div>
  );
}
