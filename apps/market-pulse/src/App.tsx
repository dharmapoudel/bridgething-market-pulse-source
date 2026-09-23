import { useCallback, useEffect, useState } from 'react';
import { getClient } from './client';
import {
  fmtBps,
  fmtPct,
  fmtPrice,
  timeAgo,
  useMarket,
  type Coin,
  type Section,
  type SentimentDay,
  type YieldCurve,
} from './market';

// built-in launcher (hub) webapp id: the sdk cannot list the launcher,
// so exiting goes through this well-known id.
const HUB_WEBAPP_ID = '019693c0-5c6a-71f0-a89d-7e2a4d9c0a01';

type View = 'crypto' | 'sentiment' | 'yields';

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: 'crypto', label: 'Crypto', key: '1' },
  { id: 'sentiment', label: 'Sentiment', key: '2' },
  { id: 'yields', label: 'Yields', key: '3' },
];

function Sparkline({
  data,
  w = 132,
  h = 40,
  className = '',
}: {
  data: number[];
  w?: number;
  h?: number;
  className?: string;
}) {
  if (data.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const up = data[data.length - 1] >= data[0];
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`)
    .join(' ');
  const color = up ? '#3ddc84' : '#dc3d3d';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className={className}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ChangePill({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-block min-w-20 rounded-sm px-2 py-1 text-center font-mono text-hint font-semibold ${
        up ? 'bg-ok-soft text-ok' : 'bg-err-soft text-err'
      }`}>
      {up ? '▲' : '▼'} {fmtPct(value)}
    </span>
  );
}

// portrait (480x800) row style, modeled on the user's reference screenshot:
// circular coin icon, bold name + dimmed symbol, price with ▲/▼ change line,
// thin divider, subtle chevron. landscape rows are untouched.
const COIN_COLORS: Record<string, string> = {
  bitcoin: '#f7931a',
  ethereum: '#627eea',
  solana: '#9945ff',
  binancecoin: '#f0b90b',
  ripple: '#5b7fa6',
  dogecoin: '#c2a633',
};

function CoinIcon({ coin }: { coin: Coin }) {
  const bg = COIN_COLORS[coin.id] ?? '#4b5563';
  const glyph = (coin.symbol || '?').charAt(0);
  return (
    <div
      aria-hidden
      className="grid h-14 w-14 shrink-0 place-items-center rounded-full font-display text-title font-bold text-white"
      style={{ backgroundColor: bg }}>
      {glyph}
    </div>
  );
}

function fmtDollarDelta(c: Coin): string {
  const d = (c.price * c.change24h) / 100;
  const abs = Math.abs(d);
  const opts: Intl.NumberFormatOptions =
    abs >= 100 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `${d >= 0 ? '+' : '-'}$${abs.toLocaleString('en-US', opts)}`;
}

function CryptoRowPortrait({ c }: { c: Coin }) {
  const up = c.change24h >= 0;
  return (
    <div className="hidden items-center gap-4 px-2 py-4 portrait:flex">
      <CoinIcon coin={c} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-row-lg font-bold text-off-white">{c.name}</div>
        <div className="font-mono text-hint text-dim">{c.symbol}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-display text-title font-bold tabular-nums text-off-white">{fmtPrice(c.price)}</div>
        <div className={`mt-0.5 font-mono text-hint font-semibold tabular-nums ${up ? 'text-ok' : 'text-err'}`}>
          {fmtDollarDelta(c)} {up ? '▲' : '▼'} {Math.abs(c.change24h).toFixed(2)}%
        </div>
      </div>
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden className="shrink-0 text-dim">
        <path
          d="M1.5 1.5 8 8l-6.5 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function UpdatedLine({ section, onRetry }: { section: Section<unknown>; onRetry: () => void }) {
  if (section.loading && !section.data) {
    return <span className="animate-pulse font-mono text-hint text-dim">updating…</span>;
  }
  if (section.error && !section.data) {
    return (
      <button onClick={onRetry} className="font-mono text-hint text-warn underline underline-offset-2">
        couldn't reach markets — tap to retry
      </button>
    );
  }
  return <span className="font-mono text-hint text-dim">updated {timeAgo(section.updatedAt)}</span>;
}

function CryptoView({ section, onRetry }: { section: Section<Coin[]>; onRetry: () => void }) {
  if (!section.data) {
    return (
      <div className="grid h-full place-items-center">
        <UpdatedLine section={section} onRetry={onRetry} />
      </div>
    );
  }
  return (
    <div data-knob-scroll className="h-full overflow-y-hidden px-6 portrait:px-4">
      {section.data.map(c => (
        <div key={c.id} className="border-b border-rule last:border-0">
          <div className="flex items-center gap-5 px-1 py-2 portrait:hidden">
            <div className="w-24 shrink-0">
              <div className="font-display text-row-lg font-bold tracking-tight-1">{c.symbol}</div>
              <div className="truncate font-mono text-hint text-dim">{c.name}</div>
            </div>
            <div className="shrink-0 opacity-90">
              <Sparkline data={c.spark} />
            </div>
            <div className="flex-1" />
            <div className="text-right">
              <div className="font-display text-title font-semibold tabular-nums tracking-tight-1">
                {fmtPrice(c.price)}
              </div>
            </div>
            <div className="w-24 shrink-0 text-right">
              <ChangePill value={c.change24h} />
            </div>
          </div>
          <CryptoRowPortrait c={c} />
        </div>
      ))}
    </div>
  );
}

function gaugeColor(v: number): string {
  if (v < 25) return '#dc3d3d';
  if (v < 45) return '#ff7070';
  if (v < 55) return '#ffb066';
  if (v < 75) return '#d4e157';
  return '#3ddc84';
}

function Gauge({ value }: { value: number }) {
  const w = 320;
  const h = 190;
  const cx = w / 2;
  const cy = 165;
  const r = 130;
  const arc = (a0: number, a1: number) => {
    const x0 = cx - r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx - r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  // needle: value 0..100 maps left..right along the arc
  const t = (Math.max(0, Math.min(100, value)) / 100) * Math.PI;
  const px = cx - r * Math.cos(t);
  const py = cy - r * Math.sin(t);
  const bands: [number, number, string][] = [
    [0, 0.25, '#dc3d3d'],
    [0.25, 0.45, '#ff7070'],
    [0.45, 0.55, '#ffb066'],
    [0.55, 0.75, '#d4e157'],
    [0.75, 1, '#3ddc84'],
  ];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {bands.map(([a, b, col], i) => (
        <path key={i} d={arc(a * Math.PI, b * Math.PI)} fill="none" stroke={col} strokeWidth="16" opacity="0.85" />
      ))}
      <line x1={cx} y1={cy} x2={px.toFixed(1)} y2={py.toFixed(1)} stroke="#efefef" strokeWidth="4" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="10" fill="#efefef" />
    </svg>
  );
}

function SentimentView({ section, onRetry }: { section: Section<SentimentDay[]>; onRetry: () => void }) {
  const days = section.data;
  if (!days || days.length === 0) {
    return (
      <div className="grid h-full place-items-center">
        <UpdatedLine section={section} onRetry={onRetry} />
      </div>
    );
  }
  const now = days[0];
  const history = days.slice(0, 7);
  const color = gaugeColor(now.value);
  return (
    <div className="flex h-full items-center gap-8 px-8 portrait:flex-col portrait:justify-center portrait:gap-4 portrait:px-4">
      <div className="flex w-80 shrink-0 flex-col items-center">
        <Gauge value={now.value} />
        <div className="text-center">
          <div className="font-display text-screen-title font-bold tabular-nums" style={{ color }}>
            {now.value}
          </div>
          <div className="font-display text-hero font-semibold uppercase tracking-display" style={{ color }}>
            {now.label}
          </div>
        </div>
      </div>
      <div className="flex-1 portrait:w-full portrait:flex-none">
        <div className="mb-3 font-mono text-eyebrow uppercase tracking-[0.2em] text-dim">fear &amp; greed · 7 days</div>
        <div className="flex items-end gap-3" style={{ height: 170 }}>
          {history.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div className="font-mono text-hint tabular-nums text-soft">{d.value}</div>
              <div
                className="w-full rounded-sm"
                style={{
                  height: Math.max(6, (d.value / 100) * 120),
                  backgroundColor: gaugeColor(d.value),
                  opacity: i === 0 ? 1 : 0.45,
                }}
              />
              <div className="font-mono text-hint text-dim">{i === 0 ? 'now' : `-${i}d`}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 font-mono text-hint text-dim">crypto market sentiment · alternative.me</div>
      </div>
    </div>
  );
}

function YieldsView({ section, onRetry }: { section: Section<YieldCurve>; onRetry: () => void }) {
  const curve = section.data;
  if (!curve) {
    return (
      <div className="grid h-full place-items-center">
        <UpdatedLine section={section} onRetry={onRetry} />
      </div>
    );
  }
  const ten = curve.tenors.find(t => t.label === '10Y') ?? curve.tenors[0];
  const rest = curve.tenors.filter(t => t !== ten);
  const w = 340;
  const h = 120;
  const vals = curve.tenors.map(t => t.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const yOf = (v: number) => h - 14 - ((v - min) / span) * (h - 28);
  const pts = curve.tenors.map((t, i) => `${((i / (curve.tenors.length - 1)) * w).toFixed(1)},${yOf(t.value).toFixed(1)}`).join(' ');
  return (
    <div className="flex h-full items-center gap-8 px-8 portrait:flex-col portrait:items-stretch portrait:justify-center portrait:gap-3 portrait:px-4">
      <div className="w-64 shrink-0 portrait:w-auto">
        <div className="font-mono text-eyebrow uppercase tracking-[0.2em] text-dim">us 10-year</div>
        <div className="font-display text-screen-title font-bold tabular-nums tracking-tight-1">
          {ten.value.toFixed(2)}
          <span className="text-title text-dim">%</span>
        </div>
        <div className={`mt-1 font-mono text-row font-semibold ${ten.value >= ten.prev ? 'text-ok' : 'text-err'}`}>
          {ten.value >= ten.prev ? '▲' : '▼'} {fmtBps(ten.value, ten.prev)} <span className="font-normal text-dim">1d</span>
        </div>
        <div className="mt-4 font-mono text-hint text-dim">as of {curve.date}</div>
      </div>
      <div className="flex-1 portrait:w-full portrait:flex-none">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="w-full">
          <polyline points={pts} fill="none" stroke="#00a8e8" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {curve.tenors.map((t, i) => {
            const x = (i / (curve.tenors.length - 1)) * w;
            return (
              <g key={t.label}>
                <circle cx={x.toFixed(1)} cy={yOf(t.value).toFixed(1)} r="4" fill="#00a8e8" />
                <text x={x.toFixed(1)} y={h - 1} textAnchor="middle" fill="#a7adb5" fontSize="11" fontFamily="ui-monospace, monospace">
                  {t.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="mt-3 grid grid-cols-4 gap-3 portrait:mt-2 portrait:gap-2">
          {rest.map(t => (
            <div key={t.label} className="border border-rule px-3 py-2">
              <div className="font-mono text-hint text-dim">{t.label}</div>
              <div className="font-display text-title font-semibold tabular-nums">{t.value.toFixed(2)}%</div>
              <div className={`font-mono text-hint font-semibold ${t.value >= t.prev ? 'text-ok' : 'text-err'}`}>
                {t.value >= t.prev ? '▲' : '▼'} {fmtBps(t.value, t.prev)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('crypto');
  const { crypto, sentiment, yields, refresh } = useMarket();

  const exitApp = useCallback(() => {
    getClient()
      .webapp.activate({ id: HUB_WEBAPP_ID })
      .then(res => {
        if (!res.ok) console.warn('exit to launcher failed', res.kind, res.error);
      })
      .catch(() => {});
  }, []);

  // controls: presets 1-3 switch sections, esc exits, knob scrolls the list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        exitApp();
        return;
      }
      const hit = VIEWS.find(v => v.key === e.key);
      if (hit) setView(hit.id);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX === 0) return;
      const scroller = document.querySelector('[data-knob-scroll]');
      if (scroller) {
        e.preventDefault();
        scroller.scrollTop += e.deltaX;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [exitApp]);

  const sectionFor = (v: View) => (v === 'crypto' ? crypto : v === 'sentiment' ? sentiment : yields);

  return (
    <div className="flex h-full w-full flex-col bg-bg text-off-white">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-rule px-6 portrait:h-auto portrait:flex-wrap portrait:gap-x-4 portrait:gap-y-2 portrait:px-4 portrait:py-3">
        <div className="flex items-center gap-2 portrait:order-1">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-ok" />
          <span className="font-mono text-eyebrow font-semibold uppercase tracking-[0.25em] text-near">Market Pulse</span>
        </div>
        <nav className="flex gap-2 portrait:order-3 portrait:w-full">
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`min-w-28 px-4 py-2 font-mono text-row font-semibold transition portrait:min-w-0 portrait:flex-1 portrait:px-2 ${
                view === v.id ? 'bg-accent-soft text-accent' : 'text-dim active:bg-neutral-soft'
              }`}>
              <span className="mr-2 text-hint text-dim">{v.key}</span>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 portrait:hidden" />
        <div className="contents portrait:order-2 portrait:ml-auto portrait:block">
          <UpdatedLine section={sectionFor(view)} onRetry={refresh} />
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {view === 'crypto' && <CryptoView section={crypto} onRetry={refresh} />}
        {view === 'sentiment' && <SentimentView section={sentiment} onRetry={refresh} />}
        {view === 'yields' && <YieldsView section={yields} onRetry={refresh} />}
      </main>

      <footer className="flex h-10 shrink-0 items-center justify-between border-t border-rule px-6 font-mono text-hint text-dim portrait:gap-4 portrait:px-4">
        <span>knob scroll · 1 crypto · 2 sentiment · 3 yields</span>
        <span>esc back</span>
      </footer>
    </div>
  );
}
