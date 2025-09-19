// app/profiles/[id]/page.tsx
'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft, Loader2, Search, Info, FileText, PlusCircle, Wand2,
  BarChart3, ArrowUpRight, ArrowDownRight, Minus,
  Building2, Shield, Code2, AlertCircle
} from 'lucide-react';
import { motion } from 'framer-motion';

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

// Firebase
import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, onValue, off, DataSnapshot } from 'firebase/database';

type ProfileStatus =
  | 'creating'
  | 'queued'
  | 'scraping'
  | 'generating_prompts'
  | 'serp_check'
  | 'done'
  | 'error';

type PromptCategory = 'brainstorming' | 'identified_problem' | 'solution_comparing' | 'info_seeking';
type PromptItem = { id: string; text: string; category: PromptCategory };

type EngineResult = {
  status?: 'checking' | 'done' | 'error';
  top10?: string[];
  hasCompany?: boolean;
  competitorsHit?: string[];
  // NEW: include immersive/shopping blocks written by backend (no other changes)
  immersive?: {
    hasCompany?: boolean;
    brands?: string[];
    competitorsHit?: string[];
    sellers?: string[];
  };
  shopping?: {
    hasCompany?: boolean;
    competitorsHit?: string[];
    sellers?: string[];
  };
};

type PromptResult = {
  google?: EngineResult;
  bing?: EngineResult;
};

type Profile = {
  id: string;
  companyName: string;
  websiteUrl: string;
  competitorUrls?: string[];
  remarks?: string;
  status: ProfileStatus;
  progress: number;
};

// ===== NEW report type to match backend (do not change) =====
type OverallReport = {
  generatedAt: number;
  metrics: {
    sov: number; // 0..1
    whiteSpacePct: number; // 0..1
    competitorPressureIdx: number; // 0..1
    topMoneyPrompts: Array<{ promptId: string; prompt: string; category: PromptCategory; opportunityScore: number }>;
  };
  categorySummaries: Record<
    PromptCategory,
    { presencePct: number; pressure: number; topGaps: string[] }
  >;
  clusters: Array<{
    title: string;
    icon?: 'building' | 'shield' | 'code' | 'search' | 'alert' | 'file' | string;
    items: string[]; // promptIds
    opportunitySum: number;
  }>;
  opportunities: Array<{
    promptId: string;
    prompt: string;
    category: PromptCategory;
    opportunityScore: number;
    competitorDomains: string[];
    missingPresence: number;
    competitorPressure: number;
    channels: { chatgpt: boolean; perplexity: boolean; googleAIO: boolean };
  }>;
  contentPlan: Array<{
    title: string;
    artifactType: 'answer_card' | 'comparison_matrix' | 'how_to_playbook' | 'integration_page' | 'glossary' | 'roi_calculator';
    objectives: string[];
    reasoning: string;
    targets: string[]; // promptIds
    relatedKeywords?: string[];
  }>;
  visualData: {
    heatmap: Array<{
      promptId: string;
      prompt: string;
      category: PromptCategory;
      channels: { chatgpt: boolean; perplexity: boolean; googleAIO: boolean };
      competitorCount: number;
    }>;
    bubbleMatrix: Array<{
      promptId: string;
      x_competitorPressure: number;
      y_missingPresenceWeighted: number;
      size: number;
      label: string;
      category: PromptCategory;
    }>;
    funnelSov: Array<{
      category: PromptCategory;
      presentPct: number;
      competitorOnlyPct: number;
      whiteSpacePct: number;
    }>;
    radarCategory: Array<{
      category: PromptCategory;
      presence: number;
      pressure: number;
    }>;
  };
  insights?: {
    strengths?: string[];
    weaknesses?: string[];
    competitiveNarrative?: string;
    categoryNarrative?: Partial<Record<PromptCategory, string>>;
  };
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getDatabase(app);

function StatusBadge({ status }: { status: ProfileStatus }) {
  const map: Record<ProfileStatus, { label: string; className: string }> = {
    creating: { label: 'Creating', className: 'bg-amber-200 text-amber-950' },
    queued: { label: 'Queued', className: 'bg-stone-200 text-stone-950' },
    scraping: { label: 'Scraping', className: 'bg-amber-300 text-amber-950' },
    generating_prompts: { label: 'Generating Prompts', className: 'bg-amber-300 text-amber-950' },
    serp_check: { label: 'SERP Check', className: 'bg-stone-300 text-stone-950' },
    done: { label: 'Ready', className: 'bg-emerald-200 text-emerald-950' },
    error: { label: 'Error', className: 'bg-rose-200 text-rose-950' },
  };
  return <Badge className={`rounded-full ${map[status].className}`}>{map[status].label}</Badge>;
}

// Per-engine cell with spinner/ok/error
function EngineCell({ status, ok }: { status?: string; ok?: boolean }) {
  if (status === "checking") {
    return (
      <div className="flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-stone-500" />
      </div>
    );
  }
  if (status === "error") {
    return <span className="text-rose-600 text-xs">error</span>;
  }
  if (ok === undefined) return <span className="text-stone-400">—</span>;
  return ok ? (
    <span className="text-emerald-600">✔</span>
  ) : (
    <span className="text-rose-600">✘</span>
  );
}

// Small helpers for Report tab animations
const fadeIn = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const staggerContainer = { animate: { transition: { staggerChildren: 0.1 } } };

function iconFor(name?: string) {
  switch ((name || "").toLowerCase()) {
    case "building": return <Building2 className="h-5 w-5" />;
    case "shield": return <Shield className="h-5 w-5" />;
    case "code": return <Code2 className="h-5 w-5" />;
    case "search": return <Search className="h-5 w-5" />;
    case "alert": return <AlertCircle className="h-5 w-5" />;
    case "file": return <FileText className="h-5 w-5" />;
    default: return <FileText className="h-5 w-5" />;
  }
}

// ===== Utility (client) to mirror backend logic for UI rendering =====
function hostnameFromUrl(u?: string): string | null {
  if (!u || typeof u !== 'string') return null;
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    const cleaned = u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    return cleaned.split('/')[0] || null;
  }
}
function matchesDomain(host: string | null, domain?: string | null) {
  if (!host || !domain) return false;
  if (host === domain) return true;
  return host.endsWith('.' + domain);
}
function normalizeBrand(s?: string) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function brandMatchesDomain(brand?: string, domain?: string) {
  if (!brand || !domain) return false;
  const b = normalizeBrand(brand).replace(/\s+/g, ''); // "vera bradley" -> "verabradley"
  const d = (domain || '').toLowerCase();
  return b.length > 1 && d.includes(b);
}

// ====== Lightweight SVG charts (no extra deps) ======
function StackedBars({
  rows,
}: {
  rows: Array<{ label: string; present: number; competitorOnly: number; white: number }>;
}) {
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const p = Math.max(0, Math.min(1, r.present)) * 100;
        const c = Math.max(0, Math.min(1, r.competitorOnly)) * 100;
        const w = Math.max(0, Math.min(1, r.white)) * 100;
        return (
          <div key={r.label}>
            <div className="flex items-center justify-between text-xs text-stone-600 mb-1">
              <span className="font-medium">{r.label}</span>
              <span>
                <span className="mr-2">You {Math.round(p)}%</span>
                <span className="mr-2">Competitors {Math.round(c)}%</span>
                <span>White-space {Math.round(w)}%</span>
              </span>
            </div>
            <div className="h-3 w-full rounded bg-stone-200 overflow-hidden flex">
              <div className="h-3 bg-emerald-500" style={{ width: `${p}%` }} />
              <div className="h-3 bg-amber-500" style={{ width: `${c}%` }} />
              <div className="h-3 bg-stone-400" style={{ width: `${w}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BubbleMatrix({
  data,
  height = 320,
}: {
  data: Array<{ id: string; x: number; y: number; r: number; label: string; category: string }>;
  height?: number;
}) {
  const pad = 36;
  const width = 640; // SVG width fixed for layout balance
  const xs = data.map(d => d.x);
  const ys = data.map(d => d.y);
  const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 1);
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - minY) / (maxY - minY || 1)) * (height - pad * 2);
  const rr = (r: number) => 6 + Math.sqrt(Math.max(0, r)) * 6;

  return (
    <div className="w-full overflow-x-auto">
      <svg width={width} height={height} className="min-w-[640px]">
        {/* Axes */}
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#bfbfbf" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#bfbfbf" />
        {/* Labels */}
        <text x={width / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="#525252">
          Competitor Pressure →
        </text>
        <text x={12} y={height / 2} transform={`rotate(-90 12 ${height / 2})`} fontSize="10" fill="#525252">
          Missing Presence × Category Weight ↑
        </text>
        {/* Grid dots */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const gx = pad + t * (width - pad * 2);
          return <line key={t} x1={gx} y1={pad} x2={gx} y2={height - pad} stroke="#eee" />;
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const gy = pad + t * (height - pad * 2);
          return <line key={'y' + t} x1={pad} y1={gy} x2={width - pad} y2={gy} stroke="#eee" />;
        })}
        {/* Bubbles */}
        {data.map((d) => (
          <g key={d.id}>
            <circle cx={sx(d.x)} cy={sy(d.y)} r={rr(d.r)} fill="rgba(16,185,129,0.35)" stroke="#10b981" />
            <text
              x={sx(d.x)}
              y={sy(d.y) - (rr(d.r) + 4)}
              fontSize="10"
              textAnchor="middle"
              fill="#444"
            >
              {d.label.slice(0, 24)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function Heatmap({
  rows,
  height = 420,
}: {
  rows: Array<{ prompt: string; chatgpt: boolean; perplexity: boolean; googleAIO: boolean; competitors: number }>;
  height?: number;
}) {
  return (
    <div className="rounded border border-stone-200">
      <div className="grid grid-cols-12 bg-stone-50 text-xs font-semibold text-stone-700 px-3 py-2">
        <div className="col-span-7">Prompt</div>
        <div className="col-span-1 text-center">ChatGPT</div>
        <div className="col-span-1 text-center">Perplexity</div>
        <div className="col-span-1 text-center">Google AIO</div>
        <div className="col-span-2 text-center">Competitors</div>
      </div>
      <ScrollArea className="w-full" style={{ height }}>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 items-center text-sm px-3 py-2 border-b border-stone-100">
            <div className="col-span-7 pr-3 truncate">{r.prompt}</div>
            <div className="col-span-1 text-center">{r.chatgpt ? '✔' : '✘'}</div>
            <div className="col-span-1 text-center">{r.perplexity ? '✔' : '✘'}</div>
            <div className="col-span-1 text-center">{r.googleAIO ? '✔' : '✘'}</div>
            <div className="col-span-2 text-center">
              {r.competitors > 0 ? (
                <Badge className="bg-stone-200 text-stone-900">{r.competitors}</Badge>
              ) : (
                <span className="text-stone-400">—</span>
              )}
            </div>
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}

function RadarPresence({
  items,
  radius = 110,
}: {
  items: Array<{ label: string; presence: number; pressure: number }>;
  radius?: number;
}) {
  const size = radius * 2 + 40;
  const cx = size / 2;
  const cy = size / 2;
  const angleStep = (Math.PI * 2) / items.length;
  const point = (i: number, value: number) => {
    const a = -Math.PI / 2 + i * angleStep;
    const r = 16 + value * radius;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const poly = (key: 'presence' | 'pressure') =>
    items.map((it, i) => point(i, Math.max(0, Math.min(1, it[key]))).join(',')).join(' ');

  return (
    <svg width={size} height={size}>
      {/* Axes */}
      {items.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e5e5" />;
      })}
      {/* Rings */}
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <circle key={t} cx={cx} cy={cy} r={16 + t * radius} fill="none" stroke="#f0f0f0" />
      ))}
      {/* Polygons */}
      <polygon points={poly('presence')} fill="rgba(16,185,129,0.25)" stroke="#10b981" />
      <polygon points={poly('pressure')} fill="rgba(234,179,8,0.20)" stroke="#f59e0b" />
      {/* Labels */}
      {items.map((it, i) => {
        const [x, y] = point(i, 1.12);
        return (
          <text key={i} x={x} y={y} fontSize="10" textAnchor="middle" fill="#525252">
            {it.label}
          </text>
        );
      })}
      <rect x={12} y={size - 34} width={10} height={10} fill="#10b981" />
      <text x={26} y={size - 25} fontSize="10" fill="#525252">Presence</text>
      <rect x={86} y={size - 34} width={10} height={10} fill="#f59e0b" />
      <text x={100} y={size - 25} fontSize="10" fill="#525252">Pressure</text>
    </svg>
  );
}

function ClusterStrip({
  clusters,
}: {
  clusters: Array<{ title: string; opportunitySum: number }>;
}) {
  const total = clusters.reduce((s, c) => s + Math.max(0, c.opportunitySum), 0) || 1;
  return (
    <div className="w-full rounded overflow-hidden border border-stone-200 flex">
      {clusters.map((c, i) => {
        const pct = (Math.max(0, c.opportunitySum) / total) * 100;
        return (
          <div
            key={c.title + i}
            className="h-10 flex items-center justify-center text-xs font-medium text-stone-900"
            style={{ width: `${pct}%`, background: i % 2 ? '#F1F5F9' : '#E2E8F0' }}
            title={`${c.title} — ${pct.toFixed(1)}%`}
          >
            {pct > 10 ? c.title : ''}
          </div>
        );
      })}
    </div>
  );
}

export default function ProfileDashboard() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [prompts, setPrompts] = React.useState<PromptItem[]>([]);
  const [results, setResults] = React.useState<Record<string, PromptResult>>({});
  const [loading, setLoading] = React.useState(true);

  // Prompts tab state
  const [activeCat, setActiveCat] = React.useState<PromptCategory>('brainstorming');
  const [query, setQuery] = React.useState('');
  const [addOpen, setAddOpen] = React.useState(false);
  const [addText, setAddText] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [genOpen, setGenOpen] = React.useState(false);
  const [genCount, setGenCount] = React.useState<number>(5);
  const [genRemarks, setGenRemarks] = React.useState('');
  const [generating, setGenerating] = React.useState(false);

  // Report tab state
  const [overall, setOverall] = React.useState<OverallReport | null>(null);
  const [reportRunning, setReportRunning] = React.useState(false);

  // Top-level view tab
  const [viewTab, setViewTab] = React.useState<'prompts' | 'report'>('prompts');

  // New prompts highlighting + scroll management
  const prevPromptIdsRef = React.useRef<Set<string>>(new Set());
  const [highlightIds, setHighlightIds] = React.useState<Set<string>>(new Set());
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const pRef = ref(db, `profiles/${id}`);
    const unsub1 = onValue(pRef, (snap: DataSnapshot) => {
      const val = snap.val();
      if (!val) return;
      setProfile({ id, ...val });
    });

    const promptsRef = ref(db, `profiles/${id}/prompts`);
    const unsub2 = onValue(promptsRef, (snap) => {
      const val = snap.val() || {};
      const list: PromptItem[] = [];
      (['brainstorming', 'identified_problem', 'solution_comparing', 'info_seeking'] as PromptCategory[]).forEach(
        (cat) => {
          const items = val?.[cat] || {};
          Object.entries(items).forEach(([k, v]: [string, any]) => {
            list.push({ id: `${cat}:${k}`, text: v.text, category: cat });
          });
        }
      );

      // Always add on top: newest first within category
      list.sort((a, b) =>
        a.category === b.category ? b.id.localeCompare(a.id) : a.category.localeCompare(b.category)
      );

      // Compute highlight set: new ids since last snapshot
      const currentIds = new Set(list.map((p) => p.id));
      const prevIds = prevPromptIdsRef.current;
      const newlyAdded: string[] = [];
      currentIds.forEach((pid) => {
        if (!prevIds.has(pid)) newlyAdded.push(pid);
      });
      setHighlightIds(new Set(newlyAdded));
      prevPromptIdsRef.current = currentIds;

      setPrompts(list);
      setLoading(false);

      // Scroll to top if there are new prompts
      if (newlyAdded.length > 0 && scrollAreaRef.current) {
        try {
          (scrollAreaRef.current as any).scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          // no-op
        }
      }
    });

    const resultsRef = ref(db, `profiles/${id}/results`);
    const unsub3 = onValue(resultsRef, (snap) => setResults(snap.val() || { }));

    const overallRef = ref(db, `profiles/${id}/reports/overall`);
    const unsub4 = onValue(overallRef, (snap) => setOverall(snap.val() || null));

    return () => {
      off(pRef, 'value', unsub1 as any);
      off(promptsRef, 'value', unsub2 as any);
      off(resultsRef, 'value', unsub3 as any);
      off(overallRef, 'value', unsub4 as any);
    };
  }, [id]);

  const filtered = prompts.filter(
    (p) => p.category === activeCat && p.text.toLowerCase().includes(query.toLowerCase())
  );

  async function handleAddPrompt() {
    if (!addText.trim()) return;
    setAdding(true);
    try {
      await fetch(`/api/profiles/${id}/prompts/add`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: activeCat, text: addText.trim() }),
      });
      setAddOpen(false);
      setAddText('');
      // Kick SERP for new prompt; fire-and-forget
      fetch(`/api/profiles/${id}/serp`, { method: 'POST' }).catch(() => {});
    } finally {
      setAdding(false);
    }
  }

  async function handleGenerateMore() {
    if (!genCount || genCount < 1) return;
    setGenerating(true);

    // Close the dialog immediately (don't wait for SERP)
    setGenOpen(false);

    // Fire the generation request
    fetch(`/api/profiles/${id}/prompts/generate-more`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: activeCat, count: Math.min(10, genCount), remarks: genRemarks }),
    })
      .then(() => {
        // Ensure competitor SERP runs for the new prompts as well
        fetch(`/api/profiles/${id}/serp`, { method: 'POST' }).catch(() => {});
      })
      .finally(() => {
        setGenCount(5);
        setGenRemarks('');
        setGenerating(false);
      });
  }

  async function generateOverallReport() {
    setReportRunning(true);
    try {
      await fetch(`/api/profiles/${id}/report/overall`, { method: 'POST' });
      // listener will populate `overall`
    } finally {
      setReportRunning(false);
    }
  }

  // ===== Helpers for new report rendering =====
  const promptsMap = React.useMemo(() => {
    const m = new Map<string, { text: string; category: PromptCategory }>();
    prompts.forEach(p => m.set(p.id, { text: p.text, category: p.category }));
    return m;
  }, [prompts]);

  const oppById = React.useMemo(() => {
    const m = new Map<string, OverallReport['opportunities'][number]>();
    (overall?.opportunities || []).forEach(o => m.set(o.promptId, o));
    return m;
  }, [overall]);

  const fmtPct = (n: number | undefined) =>
    typeof n === 'number' ? `${Math.round(n * 100)}%` : '—';

  const totalPrompts = prompts.length;
  const sovPct = overall ? fmtPct(overall.metrics?.sov) : '—';
  const pressurePct = overall ? fmtPct(overall.metrics?.competitorPressureIdx) : '—';
  const whitePct = overall ? fmtPct(overall.metrics?.whiteSpacePct) : '—';
  const sovBar = overall ? Math.round((overall.metrics?.sov || 0) * 100) : 0;

  // ==== Derive viz data ====
  const sovRows = React.useMemo(() => {
    if (!overall) return [];
    return overall.visualData.funnelSov.map((f) => ({
      label: f.category.replace('_', ' '),
      present: f.presentPct,
      competitorOnly: f.competitorOnlyPct,
      white: f.whiteSpacePct,
    }));
  }, [overall]);

  const bubbles = React.useMemo(() => {
    if (!overall) return [];
    // show top 24 by size
    return [...overall.visualData.bubbleMatrix]
      .sort((a, b) => b.size - a.size)
      .slice(0, 24)
      .map((d) => ({
        id: d.promptId,
        x: d.x_competitorPressure,
        y: d.y_missingPresenceWeighted,
        r: d.size,
        label: d.label,
        category: d.category,
      }));
  }, [overall]);

  const heatRows = React.useMemo(() => {
    if (!overall) return [];
    // top 30 by opportunity / competitor mix
    const byId = new Map(overall.opportunities.map(o => [o.promptId, o]));
    const sorted = [...overall.visualData.heatmap].sort((a, b) => {
      const oa = byId.get(a.promptId)?.opportunityScore ?? 0;
      const ob = byId.get(b.promptId)?.opportunityScore ?? 0;
      return ob - oa || b.competitorCount - a.competitorCount;
    }).slice(0, 30);
    return sorted.map((h) => ({
      prompt: h.prompt,
      chatgpt: h.channels.chatgpt,
      perplexity: h.channels.perplexity,
      googleAIO: h.channels.googleAIO,
      competitors: h.competitorCount,
    }));
  }, [overall]);

  const radarItems = React.useMemo(() => {
    if (!overall) return [];
    return overall.visualData.radarCategory.map((r) => ({
      label: r.category.replace('_', ' '),
      presence: r.presence,
      pressure: r.pressure,
    }));
  }, [overall]);

  const topActions = React.useMemo(() => {
    if (!overall) return [];
    return [...overall.opportunities]
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 10);
  }, [overall]);

  // ===== NEW: compute SERP completion status across all prompts =====
  const serpStatus = React.useMemo(() => {
    const total = prompts.length;
    let done = 0;

    prompts.forEach((p) => {
      const r = results[p.id] || {};
      const g = r.google?.status;
      const b = r.bing?.status;
      const gDone = g === 'done' || g === 'error';
      const bDone = b === 'done' || b === 'error';
      if (gDone && bDone) done++;
    });

    const ready = total > 0 && done === total;
    return { total, done, ready };
  }, [prompts, results]);

  // Category weights + generic reasons (display only)
  const categoryWeights: Record<PromptCategory, { weight: number; reason: string }> = {
    brainstorming: { weight: 1.0, reason: 'Early discovery (“how to”, frameworks) builds awareness and seeds future demand.' },
    identified_problem: { weight: 1.3, reason: 'Mid-funnel pain queries indicate active need and higher conversion potential.' },
    solution_comparing: { weight: 1.7, reason: 'Bottom-funnel comparison intent (“best”, “vs”) maps to purchase decisions.' },
    info_seeking: { weight: 0.9, reason: 'Foundational education solidifies authority and supports other intents.' },
  };

  // ===== Derived company & competitor domains for UI checks =====
  const companyDomain = React.useMemo(() => hostnameFromUrl(profile?.websiteUrl || '') || undefined, [profile?.websiteUrl]);
  const competitorDomains = React.useMemo(
    () => (profile?.competitorUrls || []).map(u => hostnameFromUrl(u || '')).filter(Boolean) as string[],
    [profile?.competitorUrls]
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 to-stone-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/')} className="text-stone-700 hover:text-stone-900">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </div>

        <Card className="border-stone-300 bg-white/60">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-stone-950">{profile?.companyName ?? 'Profile'}</CardTitle>
                <CardDescription className="text-stone-700">{profile?.websiteUrl}</CardDescription>
              </div>
              {profile && <StatusBadge status={profile.status} />}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Top-level tabs: Prompts | Report */}
            <Tabs value={viewTab} onValueChange={(v) => setViewTab(v as 'prompts' | 'report')}>
              <TabsList className="mb-2">
                <TabsTrigger value="prompts">Prompts</TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

              {/* ======================= PROMPTS TAB (with details popover) ======================= */}
              <TabsContent value="prompts" className="space-y-4">
                {/* Category toolbar */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <Tabs value={activeCat} onValueChange={(v) => setActiveCat(v as PromptCategory)}>
                    <TabsList>
                      <TabsTrigger value="brainstorming">Brainstorming</TabsTrigger>
                      <TabsTrigger value="identified_problem">Identified Problem</TabsTrigger>
                      <TabsTrigger value="solution_comparing">Solution Comparing</TabsTrigger>
                      <TabsTrigger value="info_seeking">Info Seeking</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                      <Input
                        id="q"
                        placeholder="Search prompts..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                    <Button variant="outline" onClick={() => setAddOpen(true)}>
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Add prompt
                    </Button>
                    <Button className="bg-stone-950 text-amber-50 hover:bg-stone-800" onClick={() => setGenOpen(true)}>
                      <Wand2 className="mr-2 h-4 w-4" />
                      Generate more
                    </Button>
                  </div>
                </div>

                <Separator className="bg-stone-300" />

                {/* Prompts table */}
                {loading ? (
                  <div className="flex items-center gap-2 text-stone-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-stone-600">No prompts yet.</div>
                ) : (
                  <div className="rounded-xl border border-stone-300 bg-white">
                    <div className="grid grid-cols-12 gap-0 border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700">
                      <div className="col-span-6">Prompt</div>
                      <div className="col-span-1 text-center">ChatGPT</div>
                      <div className="col-span-1 text-center">Perplexity</div>
                      <div className="col-span-1 text-center">Google AIO</div>
                      <div className="col-span-1 text-center">Details</div>
                      <div className="col-span-2 text-center">Competitors</div>
                    </div>

                    {/* Scrollable list */}
                    <ScrollArea className="h-[70vh]" ref={scrollAreaRef as any}>
                      {filtered.map((p) => {
                        const r = results[p.id] as PromptResult | undefined;
                        const g = r?.google;
                        const b = r?.bing;

                        const competitorCount =
                          (g?.competitorsHit?.length ?? 0) + (b?.competitorsHit?.length ?? 0);

                        const isNew = highlightIds.has(p.id);

                        // Google ok = organic OR immersive brand-based match
                        const gOk = (g?.hasCompany === true) || (g?.immersive?.hasCompany === true);

                        // ========= Build Details (URLs & Brands) =========
                        const gUrls = (g?.top10 || []).map(u => ({ url: u, host: hostnameFromUrl(u) }));
                        const bUrls = (b?.top10 || []).map(u => ({ url: u, host: hostnameFromUrl(u) }));

                        const brandList = (g?.immersive?.brands || []);
                        const companyMatchesBrand = (brand: string) => brandMatchesDomain(brand, companyDomain);
                        const competitorBrandHits = (brand: string) =>
                          competitorDomains.filter(cd => brandMatchesDomain(brand, cd));

                        const urlChip = (host: string | null) => {
                          const isYou = matchesDomain(host, companyDomain || null);
                          const comp = competitorDomains.find(cd => matchesDomain(host, cd));
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs mr-1 mb-1
                              border-stone-200 bg-stone-50 text-stone-700">
                              {host || '—'}
                              {isYou ? <span className="text-emerald-600">✔</span> : null}
                              {!isYou && comp ? <Badge className="bg-stone-200 text-stone-900">comp</Badge> : null}
                            </span>
                          );
                        };

                        return (
                          <div
                            key={p.id}
                            className={
                              "grid grid-cols-12 items-center gap-0 border-b border-stone-100 px-3 py-3 text-sm transition-colors " +
                              (isNew ? "bg-amber-50/70" : "bg-white")
                            }
                          >
                            <div className="col-span-6 pr-3 text-stone-900">
                              <span className={isNew ? "font-medium" : ""}>{p.text}</span>
                            </div>

                            {/* Mapping in SERP runner:
                                - ChatGPT column reflects Bing results
                                - Perplexity/Google columns reflect Google results */}
                            <div className="col-span-1 flex justify-center">
                              <EngineCell status={b?.status} ok={b?.hasCompany} />
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <EngineCell status={g?.status} ok={gOk} />
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <EngineCell status={g?.status} ok={gOk} />
                            </div>

                          
                           {/* ===== DETAILS POPOVER (scrollable + compact brands like URLs) ===== */}
<div className="col-span-1 flex items-center justify-center">
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="h-7 px-2">
        <Info className="h-4 w-4 mr-1" />
        Details
      </Button>
    </PopoverTrigger>

    {/* Force the popover body itself to scroll */}
    {/* Replace only the <PopoverContent>…</PopoverContent> block inside the Details popover with this */}
<PopoverContent className="w-[560px] max-h-[70vh] overflow-auto p-4">
  {(() => {
    // local helpers
    const hostnameFromUrl = (u: string) => {
      try {
        const h = new URL(u).hostname.toLowerCase();
        return h.startsWith('www.') ? h.slice(4) : h;
      } catch {
        const cleaned = u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
        return cleaned.split('/')[0];
      }
    };
    const normalizeBrand = (s: string) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const brandMatchesDomain = (brand: string, domain: string) => {
      if (!brand || !domain) return false;
      const b = normalizeBrand(brand).replace(/\s+/g, '');
      const d = String(domain || '').toLowerCase();
      return b.length > 1 && d.includes(b);
    };

    const companyDomain = hostnameFromUrl(profile?.websiteUrl || '');
    const competitorDomains = (profile?.competitorUrls || []).map(hostnameFromUrl);

    const chip = (
      label: string,
      kind: 'you' | 'comp' | 'other' = 'other',
      href?: string
    ) => {
      const base =
        kind === 'you'
          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
          : kind === 'comp'
          ? 'bg-amber-100 text-amber-900 border border-amber-300'
          : 'bg-stone-100 text-stone-800 border border-stone-300';
      const node = (
        <span className={`mr-1.5 mb-1.5 inline-flex items-center rounded px-2 py-0.5 text-xs ${base}`}>
          {label}
        </span>
      );
      return href ? (
        <a key={href} href={href} target="_blank" rel="noreferrer" className="no-underline">
          {node}
        </a>
      ) : (
        <span key={label}>{node}</span>
      );
    };

    const gTop10 = g?.top10 || [];
    const brands: string[] = g?.immersive?.brands || [];

    return (
      <div className="space-y-4">
        {/* Top 10 Citations (URLs) */}
        <div>
          <div className="text-xs font-medium text-stone-700 mb-1">Top 10 Citations</div>
          <div className="flex flex-wrap">
            {gTop10.length ? (
              gTop10.map((url: string) => {
                const host = hostnameFromUrl(url);
                const kind: 'you' | 'comp' | 'other' =
                  host === companyDomain || host.endsWith('.' + companyDomain)
                    ? 'you'
                    : competitorDomains.some((cd) => host === cd || host.endsWith('.' + cd))
                    ? 'comp'
                    : 'other';
                return chip(host, kind, url);
              })
            ) : (
              <span className="text-sm text-stone-500">No results.</span>
            )}
          </div>
        </div>

        <Separator />

        {/* Products mentioned (brands) */}
        <div>
          <div className="text-xs font-medium text-stone-700 mb-1">Products mentioned</div>
          <div className="flex flex-wrap">
            {brands.length ? (
              brands.map((brand) => {
                const you = brandMatchesDomain(brand, companyDomain);
                const comp = competitorDomains.some((cd) => brandMatchesDomain(brand, cd));
                const kind: 'you' | 'comp' | 'other' = you ? 'you' : comp ? 'comp' : 'other';
                return chip(brand, kind);
              })
            ) : (
              <span className="text-sm text-stone-500">No products captured.</span>
            )}
          </div>
        </div>
      </div>
    );
  })()}
</PopoverContent>

  </Popover>
</div>



                            {/* Competitor count popover (existing) */}
                            <div className="col-span-2 flex items-center justify-center">
                              {competitorCount > 0 ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Badge className={"cursor-pointer text-stone-900 " + (isNew ? "bg-amber-200" : "bg-stone-200")}>
                                      {competitorCount} hits
                                    </Badge>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72">
                                    <div className="mb-2 text-sm font-medium text-stone-800">
                                      Competitors for this prompt
                                    </div>
                                    <div className="text-xs text-stone-700 mb-1">Google:</div>
                                    {g?.competitorsHit?.length ? (
                                      <ul className="mb-2 list-disc pl-5 text-sm text-stone-800">
                                        {g.competitorsHit.map((c) => <li key={`g-${p.id}-${c}`}>{c}</li>)}
                                      </ul>
                                    ) : <div className="mb-2 text-sm text-stone-500">None</div>}
                                    <div className="text-xs text-stone-700 mb-1">Bing:</div>
                                    {b?.competitorsHit?.length ? (
                                      <ul className="list-disc pl-5 text-sm text-stone-800">
                                        {b.competitorsHit.map((c) => <li key={`b-${p.id}-${c}`}>{c}</li>)}
                                      </ul>
                                    ) : <div className="text-sm text-stone-500">None</div>}
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  </div>
                )}

                {/* Add Prompt dialog */}
                <Dialog open={addOpen} onOpenChange={setAddOpen}>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add prompt to “{activeCat.replace('_',' ')}”</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <Label htmlFor="addPrompt">Prompt</Label>
                      <Input
                        id="addPrompt"
                        placeholder="e.g., Compare X approaches for Y"
                        value={addText}
                        onChange={(e) => setAddText(e.target.value)}
                      />
                    </div>
                    <DialogFooter className="gap-2">
                      <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                      <Button onClick={handleAddPrompt} disabled={adding} className="bg-stone-950 text-amber-50 hover:bg-stone-800">
                        {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Add & run SERP
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Generate More dialog */}
                <Dialog open={genOpen} onOpenChange={setGenOpen}>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Generate more prompts — “{activeCat.replace('_',' ')}”</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 items-center gap-3">
                        <Label htmlFor="count" className="col-span-1">How many (max 10)</Label>
                        <Input
                          id="count"
                          type="number"
                          min={1}
                          max={10}
                          value={genCount}
                          onChange={(e) => setGenCount(Math.max(1, Math.min(10, Number(e.target.value || 1))))}
                          className="col-span-2"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="remarks">Additional remarks (optional)</Label>
                        <Textarea
                          id="remarks"
                          placeholder="Hints about ICP, use cases, tone, exclusions..."
                          value={genRemarks}
                          onChange={(e) => setGenRemarks(e.target.value)}
                          rows={4}
                        />
                      </div>
                    </div>
                    <DialogFooter className="gap-2">
                      <Button variant="outline" onClick={() => setGenOpen(false)}>Cancel</Button>
                      <Button onClick={handleGenerateMore} disabled={generating} className="bg-stone-950 text-amber-50 hover:bg-stone-800">
                        {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Generate & run SERP
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </TabsContent>

              {/* ======================= REPORT TAB (now with inner tabs) ======================= */}
              <TabsContent value="report" className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-stone-900">GEO Audit Report</h3>
                  <Button onClick={generateOverallReport} disabled={reportRunning || !serpStatus.ready} className="bg-stone-950 text-amber-50 hover:bg-stone-800">
                    {reportRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                    Generate / Refresh
                  </Button>
                </div>

                {/* NEW: wait message while SERP is not finished */}
                {!serpStatus.ready && (
                  <div className="text-xs rounded border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
                    Please wait for prompt SERP analysis to complete ({serpStatus.done}/{serpStatus.total} finished).
                  </div>
                )}

                {!overall ? (
                  serpStatus.ready ? (
                    <div className="text-stone-600 text-sm">
                      No report yet. Click “Generate / Refresh” to analyze all prompts & results.
                    </div>
                  ) : (
                    <div className="text-stone-600 text-sm">
                      Please wait for prompt SERP analysis to complete ({serpStatus.done}/{serpStatus.total} finished) before generating the report.
                    </div>
                  )
                ) : (
                  <Tabs defaultValue="sov" className="w-full">
                    <TabsList className="mb-4 grid grid-cols-3">
                      <TabsTrigger value="sov">Share of Voice</TabsTrigger>
                      <TabsTrigger value="topical">Topical Analysis</TabsTrigger>
                      <TabsTrigger value="actionables">Actionables</TabsTrigger>
                    </TabsList>

                    {/* --------- TAB 1: SHARE OF VOICE --------- */}
                    <TabsContent value="sov" className="space-y-8">
                      <motion.div className="space-y-8" initial="initial" animate="animate" variants={staggerContainer}>
                        {/* Executive Snapshot */}
                        <motion.div variants={fadeIn}>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <Card>
                              <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">Total Prompts</CardTitle>
                                <BarChart3 className="h-4 w-4 text-stone-500" />
                              </CardHeader>
                              <CardContent>
                                <div className="text-2xl font-bold">{totalPrompts}</div>
                                <p className="text-xs text-stone-500">Tracked intents</p>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">Share of Voice</CardTitle>
                                <ArrowUpRight className="h-4 w-4 text-emerald-600" />
                              </CardHeader>
                              <CardContent>
                                <div className="text-2xl font-bold">{sovPct}</div>
                                <div className="flex items-center">
                                  <div className="h-2 w-full rounded bg-stone-200 overflow-hidden">
                                    <div className="h-2 bg-emerald-500" style={{ width: `${sovBar}%` }} />
                                  </div>
                                  <span className="ml-2 text-xs text-stone-500">{sovPct}</span>
                                </div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">Competitor Pressure</CardTitle>
                                <Minus className="h-4 w-4 text-amber-600" />
                              </CardHeader>
                              <CardContent>
                                <div className="text-2xl font-bold">{pressurePct}</div>
                                <p className="text-xs text-stone-500">Avg competitive presence</p>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium">White-space</CardTitle>
                                <ArrowDownRight className="h-4 w-4 text-rose-600" />
                              </CardHeader>
                              <CardContent>
                                <div className="text-2xl font-bold">{whitePct}</div>
                                <p className="text-xs text-stone-500">No visible players</p>
                              </CardContent>
                            </Card>
                          </div>
                        </motion.div>

                        {/* SOV by Category */}
                        <motion.div className="grid grid-cols-1 lg:grid-cols-1 gap-6" variants={fadeIn}>
                          <Card className="lg:col-span-2">
                            <CardHeader>
                              <CardTitle className="text-base">Funnel Share of Voice by Category</CardTitle>
                              <CardDescription className="text-xs">
                                You vs competitors vs white-space per prompt intent
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <StackedBars rows={sovRows} />
                            </CardContent>
                          </Card>
                        </motion.div>

                       {/* Category narrative tiles + weights (improved readability) */}
<motion.div className="grid grid-cols-1 md:grid-cols-2 gap-6" variants={fadeIn}>
  {(['brainstorming','identified_problem','solution_comparing','info_seeking'] as PromptCategory[]).map((cat) => {
    const sum = overall.categorySummaries[cat] || { presencePct: 0, pressure: 0, topGaps: [] };
    const presence = Math.max(0, Math.min(1, sum.presencePct || 0));
    const pressure = Math.max(0, Math.min(1, sum.pressure || 0));
    const presencePctStr = fmtPct(sum.presencePct);
    const pressurePctStr = fmtPct(sum.pressure);
    const weight = categoryWeights[cat].weight;
    const reason = categoryWeights[cat].reason;

    return (
      <Card key={cat} className="border-stone-200">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="capitalize">{cat.replace('_',' ')}</CardTitle>
              <CardDescription className="text-xs">
                Presence {presencePctStr} · Pressure {pressurePctStr}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-amber-600 text-amber-50 shadow-sm">
                Weight {weight.toFixed(1)}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Narrative */}
          <p className="text-sm leading-relaxed text-stone-800">
            {overall?.insights?.categoryNarrative?.[cat] || '—'}
          </p>

          {/* Presence vs Pressure bars */}
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-stone-700">
                <span>Presence</span>
                <span>{presencePctStr}</span>
              </div>
              <div className="h-2 w-full rounded bg-stone-200 overflow-hidden">
                <div
                  className="h-2 bg-emerald-500"
                  style={{ width: `${Math.round(presence * 100)}%` }}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-stone-700">
                <span>Competitor Pressure</span>
                <span>{pressurePctStr}</span>
              </div>
              <div className="h-2 w-full rounded bg-stone-200 overflow-hidden">
                <div
                  className="h-2 bg-amber-500"
                  style={{ width: `${Math.round(pressure * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Weight explanation callout */}
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Why this weight
              </span>
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 border">
                {weight.toFixed(1)}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-amber-800">
              {reason}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  })}
</motion.div>

                      </motion.div>
                    </TabsContent>

                    {/* --------- TAB 2: TOPICAL ANALYSIS --------- */}
                    <TabsContent value="topical" className="space-y-8">
                      <motion.div className="space-y-8" initial="initial" animate="animate" variants={staggerContainer}>
                        {/* Insights */}
                        <motion.div className="grid grid-cols-1 lg:grid-cols-3 gap-6" variants={fadeIn}>
                          <Card className="border-l-4 border-l-emerald-500 lg:col-span-1">
                            <CardHeader>
                              <div className="flex items-center space-x-2">
                                <ArrowUpRight className="h-5 w-5 text-emerald-500" />
                                <CardTitle>Strengths</CardTitle>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              {overall?.insights?.strengths?.length
                                ? overall.insights?.strengths?.map((s, i) => (
                                    <div key={i} className="text-sm text-stone-800">• {s}</div>
                                  ))
                                : <div className="text-sm text-stone-500">No items.</div>}
                            </CardContent>
                          </Card>

                          <Card className="border-l-4 border-l-rose-500 lg:col-span-1">
                            <CardHeader>
                              <div className="flex items-center space-x-2">
                                <ArrowDownRight className="h-5 w-5 text-rose-500" />
                                <CardTitle>Weaknesses</CardTitle>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              {overall?.insights?.weaknesses?.length
                                ? overall.insights?.weaknesses?.map((w, i) => (
                                    <div key={i} className="text-sm text-stone-800">• {w}</div>
                                  ))
                                : <div className="text-sm text-stone-500">No items.</div>}
                            </CardContent>
                          </Card>

                          <Card className="lg:col-span-1">
                            <CardHeader>
                              <div className="flex items-center space-x-2">
                                <Info className="h-5 w-5 text-stone-500" />
                                <CardTitle>Competitive Context</CardTitle>
                              </div>
                              <CardDescription className="text-xs">
                                Narrative summary of who’s shaping AI answers
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                              <p className="text-sm text-stone-700">
                                {overall?.insights?.competitiveNarrative || '—'}
                              </p>
                            </CardContent>
                          </Card>
                        </motion.div>

                        {/* Cluster Cards */}
                        <motion.div className="space-y-4" variants={fadeIn}>
                          <div className="grid grid-cols-1  gap-6">
                            {overall.clusters?.map((cluster, idx) => {
                              const badgeClass =
                                cluster.opportunitySum >= 6
                                  ? "bg-rose-100 text-rose-800"
                                  : cluster.opportunitySum >= 3
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800";
                              const badgeLabel =
                                cluster.opportunitySum >= 6 ? "High Opportunity"
                                  : cluster.opportunitySum >= 3 ? "Medium Opportunity"
                                  : "Low Opportunity";

                              return (
                                <motion.div
                                  key={cluster.title + idx}
                                  initial={{ opacity: 0, y: 20 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                >
                                  <Card className="h-full hover:shadow-sm transition-shadow">
                                    <CardHeader className="pb-2">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2">
                                          <div className="p-1.5 rounded-full bg-stone-100">{iconFor(cluster.icon)}</div>
                                          <CardTitle className="text-base">{cluster.title}</CardTitle>
                                        </div>
                                        <Badge className={badgeClass}>{badgeLabel}</Badge>
                                      </div>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                      {(cluster.items || []).map((pid) => {
                                        const text = promptsMap.get(pid)?.text ?? pid;
                                        const opp = oppById.get(pid);
                                        return (
                                          <div
                                            key={pid}
                                            className="flex justify-between items-center text-sm py-1 border-b border-stone-100 last:border-0"
                                          >
                                            <span className="truncate mr-2">{text}</span>
                                            <div className="flex items-center gap-2">
                                              {opp ? (
                                                <>
                                                  <Badge className={opp.channels.chatgpt ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}>ChatGPT</Badge>
                                                  <Badge className={opp.channels.perplexity ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}>Perplexity</Badge>
                                                  <Badge className={opp.channels.googleAIO ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}>Google AIO</Badge>
                                                </>
                                              ) : (
                                                <Badge className="bg-stone-100 text-stone-800">—</Badge>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </CardContent>
                                  </Card>
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      </motion.div>
                    </TabsContent>

                    {/* --------- TAB 3: ACTIONABLES --------- */}
                    {/* ======================= TAB 3: ACTIONABLES (replace this whole tab content) ======================= */}
{/* ======================= TAB 3: ACTIONABLES (replace this whole tab content) ======================= */}
<TabsContent value="actionables" className="space-y-6">
  {!overall ? (
    <div className="text-stone-600 text-sm">
      Generate the report to view prioritized actions.
    </div>
  ) : (
    <motion.div className="space-y-6" initial="initial" animate="animate" variants={staggerContainer}>
      <motion.div variants={fadeIn}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-stone-900">Next 10 Actions</h3>
          <Badge className="bg-stone-200 text-stone-800">
            Ranked by opportunity
          </Badge>
        </div>
        <p className="text-xs text-stone-600 mt-1">
          Each action shows the score breakdown and a concrete <span className="font-medium">blog outline</span> to ship content LLMs can cite.
        </p>
      </motion.div>

      {(overall as any).nextActions?.map((item: any) => (
        <motion.div key={item.promptId} variants={fadeIn}>
          <Card className="overflow-hidden">
            <CardHeader className="bg-stone-50">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="bg-stone-900 text-amber-50">{String(item.rank).padStart(2, "0")}</Badge>
                    <Badge className="capitalize bg-stone-200 text-stone-900">
                      {item.category?.replace('_', ' ') || '—'}
                    </Badge>
                    <Badge className="bg-stone-100 text-stone-800">
                      {item.recommendedArtifactType?.replace('_', ' ') || 'blog post'}
                    </Badge>
                  </div>
                  {/* Full prompt, multi-line */}
                  <CardTitle className="text-base break-words whitespace-pre-wrap">
                    {item.prompt}
                  </CardTitle>
                </div>

                {/* Score & channels */}
                <div className="flex-shrink-0 space-y-2">
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-xs text-stone-500">Opportunity</span>
                    <Badge className="bg-amber-100 text-amber-800">
                      {Number(item.opportunityScore).toFixed(2)}
                    </Badge>
                  </div>

                  {/* Score bars: Missing Presence, Pressure, Weight */}
                  <div className="w-64">
                    <div className="mb-1 flex items-center justify-between text-[10px] text-stone-600">
                      <span>Missing presence</span>
                      <span>{Number(item.scoreBreakdown?.missingPresence ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="h-2 rounded bg-stone-200 overflow-hidden mb-2">
                      <div className="h-2 bg-rose-400" style={{ width: `${Math.min(1, (item.scoreBreakdown?.missingPresence ?? 0) / 2) * 100}%` }} />
                    </div>

                    <div className="mb-1 flex items-center justify-between text-[10px] text-stone-600">
                      <span>Competitor pressure</span>
                      <span>{Number(item.scoreBreakdown?.competitorPressure ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="h-2 rounded bg-stone-200 overflow-hidden mb-2">
                      <div className="h-2 bg-amber-400" style={{ width: `${Math.min(1, item.scoreBreakdown?.competitorPressure ?? 0) * 100}%` }} />
                    </div>

                    <div className="mb-1 flex items-center justify-between text-[10px] text-stone-600">
                      <span>Category weight</span>
                      <span>{Number(item.scoreBreakdown?.categoryWeight ?? 0).toFixed(1)}</span>
                    </div>
                    <div className="h-2 rounded bg-stone-200 overflow-hidden">
                      <div className="h-2 bg-emerald-500" style={{ width: `${Math.min(1, (item.scoreBreakdown?.categoryWeight ?? 0) / 1.7) * 100}%` }} />
                    </div>

                    <div className="mt-2 text-[10px] text-stone-500">
                      <span className="font-medium">Formula:</span> {item.scoreBreakdown?.formula || "missing × (1 + 0.6×pressure) × weight"}
                    </div>
                    <div className="mt-1 text-[10px] text-stone-500">
                      <span className="font-medium">Why this weight:</span> {item.scoreBreakdown?.categoryWeightReason || "—"}
                    </div>
                  </div>

                  {/* Channels */}
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Badge className={item.channels?.chatgpt ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}>ChatGPT</Badge>
                    <Badge className={item.channels?.perplexity ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}>Perplexity</Badge>
                    <Badge className={item.channels?.googleAIO ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}>Google AIO</Badge>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Why / rationale */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Why this matters</h4>
                  <ul className="list-disc pl-5 text-sm text-stone-700 space-y-1">
                    {(item.why || []).map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>

                 
                </div>

                {/* Outline – numbered steps (BLOG) */}
                <div className="lg:col-span-2">
                  <h4 className="text-sm font-medium mb-2">Blog outline to ship</h4>
                  <div className="rounded border border-stone-200">
                    <div className="bg-stone-50 px-3 py-2 text-xs text-stone-600 flex items-center justify-between">
                      <span>Recommended format: {item.recommendedArtifactType?.replace('_',' ') || 'blog post'}</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-4">
                      {/* Steps */}
                      <ol className="list-decimal pl-5 text-sm text-stone-800 space-y-2">
                        {(item.outlineSteps || []).map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>

                      {/* Structured sections (optional) */}
                      {Array.isArray(item.outlineSections) && item.outlineSections.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {item.outlineSections.map((sec: any, i: number) => (
                            <div key={i}>
                              <div className="text-xs font-semibold text-stone-700">{sec.heading}</div>
                              {Array.isArray(sec.bullets) && sec.bullets.length > 0 ? (
                                <ul className="list-disc pl-5 text-xs text-stone-600">
                                  {sec.bullets.map((b: string, j: number) => <li key={j}>{b}</li>)}
                                </ul>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  )}
</TabsContent>


                  </Tabs>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Add Prompt dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add prompt to “{activeCat.replace('_',' ')}”</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="addPrompt">Prompt</Label>
            <Input
              id="addPrompt"
              placeholder="e.g., Compare X approaches for Y"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddPrompt} disabled={adding} className="bg-stone-950 text-amber-50 hover:bg-stone-800">
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add & run SERP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate More dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate more prompts — “{activeCat.replace('_',' ')}”</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 items-center gap-3">
              <Label htmlFor="count" className="col-span-1">How many (max 10)</Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={10}
                value={genCount}
                onChange={(e) => setGenCount(Math.max(1, Math.min(10, Number(e.target.value || 1))))}
                className="col-span-2"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="remarks">Additional remarks (optional)</Label>
              <Textarea
                id="remarks"
                placeholder="Hints about ICP, use cases, tone, exclusions..."
                value={genRemarks}
                onChange={(e) => setGenRemarks(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerateMore} disabled={generating} className="bg-stone-950 text-amber-50 hover:bg-stone-800">
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Generate & run SERP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
