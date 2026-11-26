import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

// 기존 호출부(관리자 화면 다수)의 모양별로 렌더 결과를 고정한다. 자가진단 삭제용 선택 props
// (extraCheckbox, initialFocus, describe, triggerAriaLabel, pendingLabel)를 더한 뒤에도
// 이 스냅샷이 그대로여야 한다(디자인 열린 문제 처리 2: 기존 사용처 동작을 바꾸지 않는다).
// 스냅샷은 선택 props를 넣기 전의 ConfirmDialog로 만들었다.
const action = async () => {};
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ConfirmDialog, { action, ...props } as never));

describe('ConfirmDialog 기존 사용처 렌더 결과 고정', () => {
  test('기본(neutral, md)', () => {
    expect(render({ triggerLabel: '승인', title: '승인할까요?', description: '설명', confirmLabel: '승인' })).toMatchInlineSnapshot(`"<button type="button" class="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7">승인</button><dialog class="rounded-lg border border-n-3 p-0 shadow-lg backdrop:bg-n-9/40"><form class="flex flex-col gap-4 p-5 w-[320px]" action="javascript:throw new Error(&#x27;React form unexpectedly submitted.&#x27;)"><div class="flex flex-col gap-1"><h2 class="text-[15px] font-semibold text-n-9">승인할까요?</h2><p class="text-[12.5px] text-n-6">설명</p></div><div class="flex gap-2"><button type="button" class="h-[38px] flex-1 rounded-pill border border-n-3 text-[13px] font-medium text-n-7">취소</button><button type="submit" class="flex-1 rounded-pill font-semibold text-white h-[38px] text-[13px] bg-pink">승인</button></div></form></dialog><script>addEventListener("submit",function(a){if(!a.defaultPrevented){var c=a.target,d=a.submitter,e=c.action,b=d;if(d){var f=d.getAttribute("formAction");null!=f&&(e=f,b=null)}"javascript:throw new Error('React form unexpectedly submitted.')"===e&&(a.preventDefault(),b?(a=document.createElement("input"),a.name=b.name,a.value=b.value,b.parentNode.insertBefore(a,b),b=new FormData(c),a.parentNode.removeChild(a)):b=new FormData(c),a=c.ownerDocument||c,(a.$$reactFormReplay=a.$$reactFormReplay||[]).push(c,d,b))}});</script>"`);
  });

  test('danger + triggerClassName', () => {
    expect(render({ triggerLabel: '삭제', triggerClassName: 'x-trigger', title: '삭제할까요?', description: '되돌릴 수 없어요', confirmLabel: '삭제', tone: 'danger' })).toMatchInlineSnapshot(`"<button type="button" class="x-trigger">삭제</button><dialog class="rounded-lg border border-n-3 p-0 shadow-lg backdrop:bg-n-9/40"><form class="flex flex-col gap-4 p-5 w-[320px]" action="javascript:throw new Error(&#x27;React form unexpectedly submitted.&#x27;)"><div class="flex flex-col gap-1"><h2 class="text-[15px] font-semibold text-n-9">삭제할까요?</h2><p class="text-[12.5px] text-n-6">되돌릴 수 없어요</p></div><div class="flex gap-2"><button type="button" class="h-[38px] flex-1 rounded-pill border border-n-3 text-[13px] font-medium text-n-7">취소</button><button type="submit" class="flex-1 rounded-pill font-semibold text-white h-[38px] text-[13px] bg-danger">삭제</button></div></form></dialog><script>addEventListener("submit",function(a){if(!a.defaultPrevented){var c=a.target,d=a.submitter,e=c.action,b=d;if(d){var f=d.getAttribute("formAction");null!=f&&(e=f,b=null)}"javascript:throw new Error('React form unexpectedly submitted.')"===e&&(a.preventDefault(),b?(a=document.createElement("input"),a.name=b.name,a.value=b.value,b.parentNode.insertBefore(a,b),b=new FormData(c),a.parentNode.removeChild(a)):b=new FormData(c),a=c.ownerDocument||c,(a.$$reactFormReplay=a.$$reactFormReplay||[]).push(c,d,b))}});</script>"`);
  });

  test('reasonField(필수, 개인정보 검사) + cancelLabel', () => {
    expect(
      render({
        triggerLabel: '반려',
        title: '반려할까요?',
        confirmLabel: '반려',
        cancelLabel: '닫기',
        reasonField: { name: 'reason', label: '사유', placeholder: '사유 입력', checkPii: true },
      }),
    ).toMatchInlineSnapshot(`"<button type="button" class="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7">반려</button><dialog class="rounded-lg border border-n-3 p-0 shadow-lg backdrop:bg-n-9/40"><form class="flex flex-col gap-4 p-5 w-[320px]" action="javascript:throw new Error(&#x27;React form unexpectedly submitted.&#x27;)"><div class="flex flex-col gap-1"><h2 class="text-[15px] font-semibold text-n-9">반려할까요?</h2></div><label class="flex flex-col gap-1.5 text-[12.5px] text-n-7">사유<textarea name="reason" required="" placeholder="사유 입력" class="min-h-[72px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px] text-n-9 outline-none focus:border-pink"></textarea></label><div class="flex gap-2"><button type="button" class="h-[38px] flex-1 rounded-pill border border-n-3 text-[13px] font-medium text-n-7">닫기</button><button type="submit" class="flex-1 rounded-pill font-semibold text-white h-[38px] text-[13px] bg-pink">반려</button></div></form></dialog><script>addEventListener("submit",function(a){if(!a.defaultPrevented){var c=a.target,d=a.submitter,e=c.action,b=d;if(d){var f=d.getAttribute("formAction");null!=f&&(e=f,b=null)}"javascript:throw new Error('React form unexpectedly submitted.')"===e&&(a.preventDefault(),b?(a=document.createElement("input"),a.name=b.name,a.value=b.value,b.parentNode.insertBefore(a,b),b=new FormData(c),a.parentNode.removeChild(a)):b=new FormData(c),a=c.ownerDocument||c,(a.$$reactFormReplay=a.$$reactFormReplay||[]).push(c,d,b))}});</script>"`);
  });

  test('reasonField 선택 + size lg', () => {
    expect(render({ triggerLabel: '메모', title: '메모', size: 'lg', reasonField: { name: 'note', label: '메모', required: false } })).toMatchInlineSnapshot(`"<button type="button" class="rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-7">메모</button><dialog class="rounded-lg border border-n-3 p-0 shadow-lg backdrop:bg-n-9/40"><form class="flex flex-col gap-4 p-5 w-[min(320px,calc(100vw-32px))]" action="javascript:throw new Error(&#x27;React form unexpectedly submitted.&#x27;)"><div class="flex flex-col gap-1"><h2 class="text-[15px] font-semibold text-n-9">메모</h2></div><label class="flex flex-col gap-1.5 text-[12.5px] text-n-7">메모<textarea name="note" class="min-h-[72px] rounded-md border border-n-3 bg-n-1 p-2.5 text-[13px] text-n-9 outline-none focus:border-pink"></textarea></label><div class="flex gap-2"><button type="button" class="min-h-12 flex-1 rounded-pill border border-n-3 text-[15px] font-medium text-n-8">취소</button><button type="submit" class="flex-1 rounded-pill font-semibold text-white min-h-12 text-[15px] bg-indigo">확인</button></div></form></dialog><script>addEventListener("submit",function(a){if(!a.defaultPrevented){var c=a.target,d=a.submitter,e=c.action,b=d;if(d){var f=d.getAttribute("formAction");null!=f&&(e=f,b=null)}"javascript:throw new Error('React form unexpectedly submitted.')"===e&&(a.preventDefault(),b?(a=document.createElement("input"),a.name=b.name,a.value=b.value,b.parentNode.insertBefore(a,b),b=new FormData(c),a.parentNode.removeChild(a)):b=new FormData(c),a=c.ownerDocument||c,(a.$$reactFormReplay=a.$$reactFormReplay||[]).push(c,d,b))}});</script>"`);
  });

  test('disabled', () => {
    expect(render({ triggerLabel: '삭제', title: 't', disabled: true, disabledReason: '이유' })).toMatchInlineSnapshot(`"<span title="이유" class="cursor-not-allowed rounded-pill border border-n-3 px-3 py-1.5 text-[12px] font-medium text-n-4">삭제</span>"`);
  });
});

describe('ConfirmDialog 선택 props(자가진단 기록 지우기)', () => {
  const html = render({
    triggerLabel: '지우기',
    triggerAriaLabel: '2026. 12. 3. 진단 기록 지우기',
    title: '이 진단 기록을 지울까요?',
    description: '되돌릴 수 없어요',
    confirmLabel: '지우기',
    cancelLabel: '그대로 두기',
    tone: 'danger',
    size: 'lg',
    describe: true,
    initialFocus: 'cancel',
    pendingLabel: '지우는 중이에요',
    extraCheckbox: { name: 'deleteLeads', label: '강사과정 상담 문의도 함께 지우기', help: '체크를 풀면 1년 보관', defaultChecked: true },
  });

  test('트리거 접근성 이름, 대화상자 제목·설명 연결', () => {
    expect(html).toContain('aria-label="2026. 12. 3. 진단 기록 지우기"');
    const labelled = html.match(/<dialog[^>]*aria-labelledby="([^"]+)"/)?.[1];
    const described = html.match(/<dialog[^>]*aria-describedby="([^"]+)"/)?.[1];
    expect(labelled).toBeTruthy();
    expect(described).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelled}"`);
    expect(html).toContain(`<p id="${described}"`);
  });

  test('추가 체크박스는 기본 체크, 도움말과 연결, 취소가 확인보다 앞', () => {
    const input = html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('name="deleteLeads"');
    expect(input).toContain('checked=""');
    const helpId = input.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toContain(`<p id="${helpId}"`);
    expect(html).toContain('체크를 풀면 1년 보관');
    expect(html.indexOf('그대로 두기')).toBeLessThan(html.indexOf('>지우기</button></div>'));
  });

  test('추가 체크박스가 없으면 그리지 않는다', () => {
    expect(render({ triggerLabel: 'x', title: 't', describe: true })).not.toContain('type="checkbox"');
  });
});
