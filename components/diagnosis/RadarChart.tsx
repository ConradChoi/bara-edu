// 6축 Radar 차트(F-DIAG-11). 신규 차트 라이브러리를 도입하지 않고 인라인 SVG polygon으로
// 직접 그린다(F-ADM-5 선례 — 의존성 5개 유지 원칙). Radar는 보조 시각화일 뿐이라 스크린리더용
// 수치 표(ScoreBar 목록)를 항상 함께 렌더해야 한다 — 이 컴포넌트 단독으로는 접근성이 없다.
export default function RadarChart({ labels, values }: { labels: string[]; values: number[] }) {
  const size = 220;
  const center = size / 2;
  const maxR = 85;
  const count = labels.length;

  const pointFor = (i: number, r: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  };

  const gridRings = [1, 2, 3, 4].map((ring) => {
    const r = (maxR * ring) / 4;
    const pts = Array.from({ length: count }, (_, i) => pointFor(i, r).join(',')).join(' ');
    return <polygon key={ring} points={pts} fill="none" stroke="#e6e6ea" strokeWidth={1} />;
  });

  const axisLines = Array.from({ length: count }, (_, i) => {
    const [x, y] = pointFor(i, maxR);
    return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="#e6e6ea" strokeWidth={1} />;
  });

  const dataPoints = values.map((v, i) => pointFor(i, maxR * (Math.max(0, Math.min(100, v)) / 100)).join(',')).join(' ');

  const labelPositions = labels.map((label, i) => {
    const [x, y] = pointFor(i, maxR + 18);
    return { label, x, y };
  });

  return (
    <svg width={size} height={size + 20} viewBox={`0 0 ${size} ${size + 20}`} role="img" aria-label="6개 영역 점수 Radar 차트">
      <g transform="translate(0, 10)">
        {gridRings}
        {axisLines}
        <polygon points={dataPoints} fill="#e11e8733" stroke="#e11e87" strokeWidth={2} />
        {labelPositions.map(({ label, x, y }) => (
          <text key={label} x={x} y={y} fontSize={10} textAnchor="middle" fill="#6b6b7c">
            {label}
          </text>
        ))}
      </g>
    </svg>
  );
}
