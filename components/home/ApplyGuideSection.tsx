const STEPS = [
  { title: '회원가입', description: '이메일과 비밀번호로 회원가입을 해요.' },
  { title: '강좌 신청', description: '원하는 강좌를 선택하고 신청해요.' },
  {
    title: '무통장입금 (3일 이내)',
    description:
      '안내받은 계좌로 3일 안에 입금해요. 입금자명을 강좌 안내와 동일하게 입력해 주세요. 3일 안에 입금하지 않으면 신청이 자동으로 취소되며, 이후에는 다시 신청할 수 있어요.',
  },
  {
    title: '운영자 승인 후 강의실 이용',
    description: '입금을 확인하면 운영자가 승인해요. 승인이 끝나면 바로 강의실을 이용할 수 있어요.',
  },
];

// 헤더 "신청방법" 링크(/#apply-guide)의 실제 목적지 — id 철자가 정확히 일치해야 한다.
export default function ApplyGuideSection() {
  return (
    <section id="apply-guide" className="w-full bg-n-0">
      <div className="mx-auto max-w-[1200px] px-5 py-14 md:px-6 md:py-20">
        <h2 className="text-center text-[22px] font-bold text-n-9 md:text-[28px]">신청 방법</h2>
        <p className="mt-2 text-center text-[16px] text-n-6">회원가입부터 강의실 이용까지, 네 단계로 안내해 드려요.</p>

        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col gap-3 rounded-lg bg-n-1 p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo text-[15px] font-bold text-n-0">
                {i + 1}
              </span>
              <h3 className="text-[17px] font-semibold text-n-9 md:text-[18px]">{step.title}</h3>
              <p className="text-[16px] leading-[1.6] text-n-7">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
