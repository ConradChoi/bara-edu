import Link from 'next/link';

export default function FilterChip({ label, href, active = false }: { label: string; href: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-pill border px-3.5 py-1.5 text-[12.5px] font-medium transition ${
        active ? 'border-pink bg-pink text-white' : 'border-n-3 bg-n-0 text-n-7 hover:border-pink hover:text-pink'
      }`}
    >
      {label}
    </Link>
  );
}
