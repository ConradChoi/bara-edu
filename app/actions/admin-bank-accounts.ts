'use server';

import { redirect } from 'next/navigation';
import { requireAdminClient } from '@/lib/supabase/require-admin';

// 'use server' 파일은 async 함수만 export할 수 있어 상수를 여기서 내보낼 수 없다 — 화면
// 쪽 표시용 상수는 app/(admin)/admin/bank-accounts/page.tsx에 별도로 둔다. 실제 제한은
// supabase/schema.sql의 enforce_bank_accounts_limit() 트리거가 강제하므로 두 값이 달라도
// 데이터 무결성에는 영향 없다(화면 문구만 부정확해질 뿐).

// 계좌번호는 신청자가 그대로 복사해 실제로 입금하는 값이라 형식을 최소한으로 검증한다
// (qa-reviewer 점검, 2026-08-28 — 원래는 빈 값 여부만 확인해 "abc" 같은 값도 그대로
// 저장됐었다). 은행마다 자릿수·하이픈 유무가 달라 숫자·하이픈만 허용하는 선에서 그친다.
function readBankAccountFields(formData: FormData) {
  const bankName = (formData.get('bankName') as string | null)?.trim();
  const accountNumber = (formData.get('accountNumber') as string | null)?.trim();
  const accountHolder = (formData.get('accountHolder') as string | null)?.trim();
  if (!bankName || !accountNumber || !accountHolder) return null;
  if (!/^[0-9-]{4,}$/.test(accountNumber)) return null;
  return { bank_name: bankName, account_number: accountNumber, account_holder: accountHolder };
}

export async function createBankAccount(formData: FormData) {
  const fields = readBankAccountFields(formData);
  if (!fields) redirect('/admin/bank-accounts?error=validation');

  const supabase = await requireAdminClient();
  // 화면에 보여줄 대략적인 순서값 계산용(실제 3개 제한은 DB 트리거
  // enforce_bank_accounts_limit()이 advisory lock으로 원자적으로 강제한다 — 여기서
  // count만 보고 막으면 동시 요청 사이의 TOCTOU로 4개 이상 생길 수 있었다,
  // qa-reviewer 점검 2026-08-28).
  const { count } = await supabase.from('bank_accounts').select('id', { count: 'exact', head: true });

  const { error } = await supabase.from('bank_accounts').insert({ ...fields!, order: count ?? 0 });
  if (error) {
    if (error.message.includes('bank account limit reached')) redirect('/admin/bank-accounts?error=max-reached');
    redirect('/admin/bank-accounts?error=failed');
  }
  redirect('/admin/bank-accounts?success=created');
}

export async function updateBankAccount(id: string, formData: FormData) {
  const fields = readBankAccountFields(formData);
  if (!fields) redirect('/admin/bank-accounts?error=validation');

  const supabase = await requireAdminClient();
  const { error } = await supabase.from('bank_accounts').update(fields!).eq('id', id);
  if (error) redirect('/admin/bank-accounts?error=failed');
  redirect('/admin/bank-accounts?success=updated');
}

export async function deleteBankAccount(id: string) {
  const supabase = await requireAdminClient();
  const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
  if (error) redirect('/admin/bank-accounts?error=failed');
  redirect('/admin/bank-accounts?success=deleted');
}
