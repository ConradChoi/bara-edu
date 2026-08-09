import ComingSoon from "@/components/home/ComingSoon";
import RecoveryRedirect from "@/components/auth/RecoveryRedirect";

export default function RootPage() {
  const isOpen = process.env.NEXT_PUBLIC_IS_OPEN === "true";

  if (!isOpen) {
    return (
      <>
        <RecoveryRedirect />
        <ComingSoon />
      </>
    );
  }

  // TODO: 정식 오픈 후 HomePage 컴포넌트로 교체
  return (
    <>
      <RecoveryRedirect />
      <ComingSoon />
    </>
  );
}
