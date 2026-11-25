import { isIP } from 'node:net';

// Amplify(CloudFront) 운영 실측(2026-11-25):
//   x-forwarded-for = <위조 가능한 값...>, <실제 클라이언트>, <CloudFront 엣지 IP>
//   cloudfront-viewer-address = <실제 클라이언트 IP>:<포트>   (신뢰 가능)
// 맨 앞 값은 위조할 수 있고 맨 끝 값은 엣지라서, XFF에서는 끝에서 두 번째 값을 쓴다.
const valid = (v: string | undefined): string | null => (v && isIP(v) !== 0 ? v : null);

function fromViewerAddress(raw: string): string | null {
  const v = raw.trim();
  if (v.startsWith('[')) return valid(v.slice(1, v.indexOf(']') === -1 ? undefined : v.indexOf(']')));
  const i = v.lastIndexOf(':');
  return i === -1 ? valid(v) : valid(v.slice(0, i));
}

export function clientIpFrom(get: (name: string) => string | null): string | null {
  const viewer = get('cloudfront-viewer-address');
  if (viewer) {
    const ip = fromViewerAddress(viewer);
    if (ip) return ip;
  }
  const xff = get('x-forwarded-for');
  if (!xff) return null;
  const parts = xff.split(',').map((s) => s.trim());
  return valid(parts.length === 1 ? parts[0] : parts[parts.length - 2]);
}
