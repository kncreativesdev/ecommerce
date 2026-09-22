/**
 * Minimal SVG bar chart for dashboard trends. Hand-rolled on purpose:
 * buckets are small and fixed (24 hourly / 7–31 daily / 12 monthly), so
 * a focused ~120-line component beats a 200KB chart dependency (no chart
 * library is installed, and bundle warnings already exist). Bars render
 * EXACTLY the backend buckets — no interpolation, no smoothing, no
 * invented points; empty buckets are backend-supplied zeros.
 *
 * Accessibility: the chart is never the only channel — every instance is
 * paired with a visible text total plus a screen-reader data table, and
 * each bar carries a native `<title>` tooltip.
 */

const WIDTH = 600;
const HEIGHT = 220;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

function barLabel(index, total) {
  return `bar-${index}-of-${total}`;
}

export function TrendChart({
  title,
  buckets = [],
  valueKey = 'orders',
  formatValue = (value) => String(value),
  formatBucket = (bucketStart) => bucketStart,
  emptyMessage = 'No data in this period yet.',
  tone = 'primary',
}) {
  const total = buckets.length;
  const values = buckets.map((bucket) => (valueKey === 'revenue' ? Number(bucket.revenue) : bucket.orders));
  const max = Math.max(0, ...values);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = total > 0 ? plotWidth / total : 0;
  const barWidth = Math.max(2, Math.min(28, slot * 0.62));

  // X labels: at most ~6 evenly spaced ticks so daily/monthly frames stay
  // readable on narrow viewports.
  const tickEvery = Math.max(1, Math.ceil(total / 6));
  const ticks = buckets.filter((_, index) => index % tickEvery === 0 || index === total - 1);

  const summary = `${title}: total ${formatValue(
    valueKey === 'revenue'
      ? buckets.reduce((sum, bucket) => sum + Number(bucket.revenue), 0)
      : buckets.reduce((sum, bucket) => sum + (bucket.orders ?? 0), 0),
  )} across ${total} ${total === 1 ? 'bucket' : 'buckets'}`;

  return (
    <div className="flex flex-col gap-3">
      {total === 0 ? (
        <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={summary}
          className="h-auto w-full"
        >
          {[0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = PAD_TOP + plotHeight * (1 - fraction);
            return (
              <line
                key={fraction}
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeWidth={1}
              />
            );
          })}
          {buckets.map((bucket, index) => {
            const value = values[index] ?? 0;
            const height = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * plotHeight) : 0;
            const x = PAD_LEFT + slot * index + (slot - barWidth) / 2;
            const y = PAD_TOP + plotHeight - height;
            return (
              <g key={bucket.bucketStart}>
                <title>
                  {formatBucket(bucket.bucketStart)}: {formatValue(valueKey === 'revenue' ? bucket.revenue : value)}
                </title>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(height, 0)}
                  rx={3}
                  className={tone === 'revenue' ? 'fill-accent' : 'fill-primary'}
                  opacity={value > 0 ? 0.92 : 0.25}
                >
                  <desc>{barLabel(index, total)}</desc>
                </rect>
              </g>
            );
          })}
          {ticks.map((bucket) => {
            const index = buckets.indexOf(bucket);
            const x = PAD_LEFT + slot * index + slot / 2;
            return (
              <text
                key={bucket.bucketStart}
                x={x}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
                opacity={0.6}
              >
                {formatBucket(bucket.bucketStart)}
              </text>
            );
          })}
        </svg>
      )}
      <table className="sr-only">
        <caption>{summary}</caption>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.bucketStart}>
              <th scope="row">{formatBucket(bucket.bucketStart)}</th>
              <td>{formatValue(valueKey === 'revenue' ? bucket.revenue : bucket.orders)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
