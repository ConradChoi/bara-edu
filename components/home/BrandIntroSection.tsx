export default function BrandIntroSection() {
  return (
    <section className="w-full bg-n-1">
      <div className="mx-auto flex max-w-[600px] flex-col items-center gap-6 px-5 py-14 text-center md:py-20">
        <h2 className="text-[20px] font-bold text-n-9 md:text-[24px]">
          <span dir="rtl" lang="he">
            בָּרָא
          </span>
          를 소개합니다
        </h2>
        <div className="flex flex-col gap-3">
          <p className="text-[16px] leading-[1.8] text-n-7 md:text-[17px]">
            <span dir="rtl" lang="he">
              בָּרָא
            </span>
            는 히브리어로 &ldquo;창조하다&rdquo;라는 뜻입니다.
          </p>
          <p className="text-[16px] leading-[1.8] text-n-7 md:text-[17px]">
            바라 평생교육원은 배움을 통해 누구나 새로운 자신을 만들어갈 수 있다고 생각합니다.
          </p>
          <p className="text-[16px] leading-[1.8] text-n-7 md:text-[17px]">
            나이와 경험에 상관없이, 필요한 순간에 필요한 배움을 시작할 수 있도록 돕겠습니다.
          </p>
        </div>
      </div>
    </section>
  );
}
