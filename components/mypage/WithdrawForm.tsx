'use client';

export default function WithdrawForm({ action }: { action: () => void }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('정말 탈퇴하시겠어요? 이 작업은 되돌릴 수 없어요.')) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" className="text-[12.5px] font-medium text-danger">
        회원 탈퇴
      </button>
    </form>
  );
}
