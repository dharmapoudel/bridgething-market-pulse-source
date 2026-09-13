// market data: coingecko (crypto), alternative.me (fear and greed),
// home.treasury.gov xml (daily par yield curve). all free and keyless.
// aggressive localstorage cache with stale-while-revalidate; crypto
// refreshes every 5 minutes, sentiment and yields every 12 hours.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_COINS, DEMO_SENTIMENT, DEMO_YIELDS } from './fixtures';

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  spark: number[];
}

export interface SentimentDay {
  value: number;
  label: string;
}

export interface YieldTenor {
  label: string;
  value: number;
  prev: number;
}

export interface YieldCurve {
  date: string;
  tenors: YieldTenor[];
}

const COIN_IDS = 'bitcoin,ethereum,solana,binancecoin,ripple,dogecoin';
const CG_URL = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${COIN_IDS}&sparkline=true&price_change_percentage=24h`;
const FNG_URL = 'https://api.alternative.me/fng/?limit=7';

function treasuryUrl(d: Date): string {
  const m = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${m}`;
}

const CACHE_PREFIX = 'market-pulse:v1:';
const TTL = { crypto: 5 * 60 * 1000, sentiment: 12 * 3600 * 1000, yields: 12 * 3600 * 1000 };

export const isDemo = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

interface CacheEntry<T> {
  ts: number;
  data: T;
}

function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // storage full or unavailable: the app still works, it just refetches
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

interface RawCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  sparkline_in_7d?: { price?: number[] };
  last_updated: string;
}

export function normalizeCoins(raw: unknown): Coin[] {
  const arr = Array.isArray(raw) ? (raw as RawCoin[]) : [];
  return arr
    .filter(c => c && typeof c.current_price === 'number')
    .map(c => ({
      id: String(c.id),
      symbol: String(c.symbol || '').toUpperCase(),
      name: String(c.name || ''),
      price: c.current_price,
      change24h: Number(c.price_change_percentage_24h) || 0,
      spark: Array.isArray(c.sparkline_in_7d?.price)
        ? c.sparkline_in_7d.price.filter(p => typeof p === 'number')
        : [],
    }));
}

interface RawFng {
  data?: { value: string; value_classification: string }[];
}

export function normalizeSentiment(raw: unknown): SentimentDay[] {
  const data = (raw as RawFng)?.data;
  if (!Array.isArray(data)) throw new Error('bad sentiment payload');
  return data.map(d => ({ value: Number(d.value), label: String(d.value_classification || '') }));
}

const YIELD_TENORS: { label: string; field: string }[] = [
  { label: '1Y', field: 'BC_1YEAR' },
  { label: '2Y', field: 'BC_2YEAR' },
  { label: '5Y', field: 'BC_5YEAR' },
  { label: '10Y', field: 'BC_10YEAR' },
  { label: '30Y', field: 'BC_30YEAR' },
];

export function parseYieldXml(xml: string): { date: string; values: Record<string, number> }[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rows: { date: string; values: Record<string, number> }[] = [];
  doc.querySelectorAll('entry').forEach(entry => {
    const text = (name: string): string | null => {
      const el = Array.from(entry.getElementsByTagName('*')).find(
        e => e.localName === name || e.tagName.endsWith(':' + name),
      );
      return el?.textContent?.trim() || null;
    };
    const rawDate = text('NEW_DATE');
    if (!rawDate) return;
    const values: Record<string, number> = {};
    for (const t of YIELD_TENORS) {
      const v = text(t.field);
      if (v != null && v !== '') values[t.label] = Number(v);
    }
    if (Object.keys(values).length === 0) return;
    rows.push({ date: rawDate.slice(0, 10), values });
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows;
}

async function fetchYields(): Promise<YieldCurve> {
  // current month first; pull the prior month too when the month just turned
  const now = new Date();
  const months = [now, new Date(now.getFullYear(), now.getMonth() - 1, 1)];
  const rows: { date: string; values: Record<string, number> }[] = [];
  for (const m of months) {
    const res = await fetch(treasuryUrl(m), { headers: { accept: 'application/xml' } });
    if (!res.ok) throw new Error(`http ${res.status}`);
    rows.push(...parseYieldXml(await res.text()));
    if (rows.length >= 2) break;
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (rows.length < 1) throw new Error('no yield data');
  const latest = rows[rows.length - 1];
  const prev = rows[rows.length - 2] ?? latest;
  return {
    date: latest.date,
    tenors: YIELD_TENORS.map(t => ({
      label: t.label,
      value: latest.values[t.label],
      prev: prev.values[t.label] ?? latest.values[t.label],
    })).filter(t => typeof t.value === 'number'),
  };
}

function demoCurve(): YieldCurve {
  const rows = DEMO_YIELDS.filter(r => r.date);
  const latest = rows[rows.length - 1];
  const prev = rows[rows.length - 2] ?? latest;
  return {
    date: latest.date as string,
    tenors: YIELD_TENORS.map(t => ({
      label: t.label,
      value: Number((latest as Record<string, string | null>)[t.label]),
      prev: Number((prev as Record<string, string | null>)[t.label]),
    })),
  };
}

export interface Section<T> {
  data: T | null;
  updatedAt: number | null;
  loading: boolean;
  error: string | null;
}

const idle = <T,>(): Section<T> => ({ data: null, updatedAt: null, loading: true, error: null });

async function loadSection<T>(
  key: keyof typeof TTL,
  fetcher: () => Promise<T>,
  set: (s: Section<T>) => void,
  demoData: () => T,
): Promise<void> {
  if (isDemo()) {
    set({ data: demoData(), updatedAt: Date.now(), loading: false, error: null });
    return;
  }
  const cached = readCache<T>(key);
  if (cached) set({ data: cached.data, updatedAt: cached.ts, loading: false, error: null });
  try {
    const data = await fetcher();
    writeCache(key, data);
    set({ data, updatedAt: Date.now(), loading: false, error: null });
  } catch (e) {
    if (!cached) {
      set({ data: null, updatedAt: null, loading: false, error: e instanceof Error ? e.message : 'fetch failed' });
    }
    // stale cache stays on screen; the next interval retries
  }
}

export function useMarket() {
  const [crypto, setCrypto] = useState<Section<Coin[]>>(idle);
  const [sentiment, setSentiment] = useState<Section<SentimentDay[]>>(idle);
  const [yields, setYields] = useState<Section<YieldCurve>>(idle);
  const timers = useRef<number[]>([]);

  const refresh = useCallback(() => {
    void loadSection<Coin[]>('crypto', () => fetchJson(CG_URL).then(normalizeCoins), setCrypto, () =>
      DEMO_COINS.map(c => ({ ...c, spark: [...c.spark] })),
    );
    void loadSection<SentimentDay[]>('sentiment', () => fetchJson(FNG_URL).then(normalizeSentiment), setSentiment, () =>
      DEMO_SENTIMENT.map(s => ({ ...s })),
    );
    void loadSection<YieldCurve>('yields', fetchYields, setYields, demoCurve);
  }, []);

  useEffect(() => {
    refresh();
    if (!isDemo()) {
      timers.current = [
        window.setInterval(() => {
          void loadSection<Coin[]>('crypto', () => fetchJson(CG_URL).then(normalizeCoins), setCrypto, () => []);
        }, TTL.crypto),
        window.setInterval(() => {
          void loadSection<SentimentDay[]>('sentiment', () => fetchJson(FNG_URL).then(normalizeSentiment), setSentiment, () => []);
          void loadSection<YieldCurve>('yields', fetchYields, setYields, demoCurve);
        }, TTL.sentiment),
      ];
    }
    return () => timers.current.forEach(clearInterval);
  }, [refresh]);

  return { crypto, sentiment, yields, refresh };
}

// formatting

export function fmtPrice(p: number): string {
  const opts: Intl.NumberFormatOptions =
    p >= 1000 ? { maximumFractionDigits: 0 }
    : p >= 100 ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
    : p >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { minimumFractionDigits: 4, maximumFractionDigits: 4 };
  return '$' + p.toLocaleString('en-US', opts);
}

export function fmtPct(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
}

export function fmtBps(cur: number, prev: number): string {
  const bps = Math.round((cur - prev) * 100);
  return `${bps >= 0 ? '+' : ''}${bps} bp`;
}

export function timeAgo(ts: number | null): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
