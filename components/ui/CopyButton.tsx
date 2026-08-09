'use client';

import { useState } from 'react';

export default function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-pill border border-n-3 px-2 py-0.5 text-[11px] text-n-6"
    >
      {copied ? '복사됨' : '복사'}
    </button>
  );
}
