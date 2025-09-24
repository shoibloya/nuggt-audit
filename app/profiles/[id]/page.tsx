// app/profiles/[id]/page.tsx
'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft, Loader2, Search, Info, FileText, PlusCircle, Wand2,
  BarChart3, ArrowUpRight, ArrowDownRight, Minus,
  Building2, Shield, Code2, AlertCircle, Trash2
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

// Recharts (for volume trend)
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';

// Firebase
import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, ref, onValue, off, DataSnapshot, remove, set } from 'firebase/database';

type ProfileStatus =
  | 'creating'
  | 'queued'
  | 'scraping'
  | 'generating_prompts'
  | 'serp_check'
  | 'done'
  | 'error';

type PromptCategory = 'brainstorming' | 'identified_problem' | 'solution_comparing' | 'info_seeking';
type StoredVolume = {
  value: number;
  monthly: { year: number; month: number; ai_search_volume: number }[];
  language_name?: string;
  location_code?: number;
  updatedAt?: number;
};
type PromptItem = { id: string; text: string; category: PromptCategory; volume?: StoredVolume };

type EngineResult = {
  status?: 'checking' | 'done' | 'error';
  top10?: string[];
  hasCompany?: boolean;
  competitorsHit?: string[];
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
  country?: string;     // optional
  region?: 'sg' | 'us'; // optional
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
  return ok ? <span className="text-emerald-600">✔</span> : <span className="text-rose-600">✘</span>;
}

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
  const b = normalizeBrand(brand).replace(/\s+/g, '');
  const d = (domain || '').toLowerCase();
  return b.length > 1 && d.includes(b);
}

// ====== Lightweight SVG charts (for report) ======
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

// ===== Volume helpers =====
type VolumeMonthly = { year: number; month: number; ai_search_volume: number };
function formatMonth(y: number, m: number) {
  try {
    return new Date(y, m - 1).toLocaleString('en', { month: 'short', year: '2-digit' });
  } catch {
    return `${y}-${String(m).padStart(2,'0')}`;
  }
}

function StatusText({ children }: { children: React.ReactNode }) {
  return <div className="text-stone-600 text-sm">{children}</div>;
}

/* ------------------------------------------------------------------ */

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

  // Volume state (only for "missing" fetch spinner)
  const [volLoading, setVolLoading] = React.useState(false);

  // Country/region → location_code
  const locationCode = React.useMemo(() => {
    const c = (profile?.country || profile?.region || '').toString().toLowerCase();
    if (c === 'us' || c === 'usa' || c === 'united states' || c === 'united states of america') return 2840;
    if (c === 'singapore' || c === 'sg') return 2702;
    return 2840; // default
  }, [profile?.country, profile?.region]);

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
            const volume: StoredVolume | undefined = v?.volume
              ? {
                  value: typeof v.volume.value === 'number' ? v.volume.value : (typeof v.volume.volume === 'number' ? v.volume.volume : 0),
                  monthly: Array.isArray(v.volume.monthly)
                    ? v.volume.monthly
                    : (Array.isArray(v.volume.ai_monthly_searches) ? v.volume.ai_monthly_searches : []),
                  language_name: v.volume.language_name,
                  location_code: v.volume.location_code,
                  updatedAt: v.volume.updatedAt,
                }
              : undefined;

            list.push({ id: `${cat}:${k}`, text: v.text, category: cat, volume });
          });
        }
      );

      // newest first within category
      list.sort((a, b) =>
        a.category === b.category ? b.id.localeCompare(a.id) : a.category.localeCompare(b.category)
      );

      // highlight newly added
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

      if (newlyAdded.length > 0 && scrollAreaRef.current) {
        try { (scrollAreaRef.current as any).scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
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

  /* ======== FETCH VOLUME ONLY FOR PROMPTS THAT DON'T HAVE IT STORED ======== */
  React.useEffect(() => {
    const missing = prompts.filter(
      (p) => !p.volume || (p.volume.location_code && p.volume.location_code !== locationCode)
    );
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      setVolLoading(true);
      try {
        const resp = await fetch('/api/volume', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            keywords: missing.map(p => p.text),
            language_name: 'English',
            location_code: locationCode,
          }),
        });
        const json = await resp.json();
        if (cancelled) return;

        const items: Array<{ keyword: string; volume: number; monthly: VolumeMonthly[] }> = json?.items || [];
        const now = Date.now();

        // write each result back under the corresponding prompt node
        await Promise.all(items.map(async (it) => {
          // one keyword may appear in multiple prompts; write to all matches
          const targets = prompts.filter(p => p.text === it.keyword);
          await Promise.all(targets.map(async (p) => {
            const [cat, key] = p.id.split(':', 2);
            const path = `profiles/${id}/prompts/${cat}/${key}/volume`;
            await set(ref(db, path), {
              value: it.volume,
              monthly: it.monthly || [],
              language_name: 'English',
              location_code: locationCode,
              updatedAt: now,
            });
          }));
        }));
      } catch {
        // swallow errors; UI will just show "—"
      } finally {
        if (!cancelled) setVolLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [prompts, locationCode, id]);

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
      // NOTE: do NOT re-run SERP for all prompts anymore.
      // The server route already runs SERP for the new prompt only.
    } finally {
      setAdding(false);
    }
  }

  async function handleGenerateMore() {
    if (!genCount || genCount < 1) return;
    setGenerating(true);
    setGenOpen(false);
    // Fire the generation request (assume server runs SERP per new prompt internally)
    fetch(`/api/profiles/${id}/prompts/generate-more`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: activeCat, count: Math.min(10, genCount), remarks: genRemarks }),
    }).finally(() => {
      setGenCount(5);
      setGenRemarks('');
      setGenerating(false);
    });
  }

  async function generateOverallReport() {
    setReportRunning(true);
    try {
      await fetch(`/api/profiles/${id}/report/overall`, { method: 'POST' });
    } finally {
      setReportRunning(false);
    }
  }

  const promptsMap = React.useMemo(() => {
    const m = new Map<string, { text: string; category: PromptCategory }>();
    prompts.forEach(p => m.set(p.id, { text: p.text, category: p.category }));
    return m;
  }, [prompts]);

  const sovFmt = (n: number | undefined) => typeof n === 'number' ? `${Math.round(n * 100)}%` : '—';

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

  // Category weights (display only)
  const categoryWeights: Record<PromptCategory, { weight: number; reason: string }> = {
    brainstorming: { weight: 1.0, reason: 'Early discovery (“how to”, frameworks) builds awareness and seeds future demand.' },
    identified_problem: { weight: 1.3, reason: 'Mid-funnel pain queries indicate active need and higher conversion potential.' },
    solution_comparing: { weight: 1.7, reason: 'Bottom-funnel comparison intent (“best”, “vs”) maps to purchase decisions.' },
    info_seeking: { weight: 0.9, reason: 'Foundational education solidifies authority and supports other intents.' },
  };

  const companyDomain = React.useMemo(() => hostnameFromUrl(profile?.websiteUrl || '') || undefined, [profile?.websiteUrl]);
  const competitorDomains = React.useMemo(
    () => (profile?.competitorUrls || []).map(u => hostnameFromUrl(u || '')).filter(Boolean) as string[],
    [profile?.competitorUrls]
  );

  async function handleDeletePrompt(p: PromptItem) {
    try {
      const [cat, key] = p.id.split(':', 2);
      await remove(ref(db, `profiles/${id}/prompts/${cat}/${key}`));
      await remove(ref(db, `profiles/${id}/results/${p.id}`));
    } catch (e) {
      console.warn('Failed to delete prompt', e);
    }
  }

  /* ============================== UI ============================== */

  // … (Everything below is unchanged except the Volume cell reads from p.volume) …

  // Derived report helpers
  const totalPrompts = prompts.length;
  const sovPct = overall ? sovFmt(overall.metrics?.sov) : '—';
  const pressurePct = overall ? sovFmt(overall.metrics?.competitorPressureIdx) : '—';
  const whitePct = overall ? sovFmt(overall.metrics?.whiteSpacePct) : '—';
  const sovBar = overall ? Math.round((overall.metrics?.sov || 0) * 100) : 0;

  // Viz derivations
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
            <Tabs value={viewTab} onValueChange={(v) => setViewTab(v as 'prompts' | 'report')}>
              <TabsList className="mb-2">
                <TabsTrigger value="prompts">Prompts</TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

              {/* PROMPTS TAB */}
              <TabsContent value="prompts" className="space-y-4">
                {/* Toolbar */}
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

                {/* Table */}
                {loading ? (
                  <div className="flex items-center gap-2 text-stone-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : filtered.length === 0 ? (
                  <StatusText>No prompts yet.</StatusText>
                ) : (
                  <div className="rounded-xl border border-stone-300 bg-white">
                    <div className="grid grid-cols-12 gap-0 border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-700">
                      <div className="col-span-6">Prompt</div>
                      <div className="col-span-1 text-center">ChatGPT</div>
                      <div className="col-span-1 text-center">Perplexity</div>
                      <div className="col-span-1 text-center">Google AIO</div>
                      <div className="col-span-1 text-center">Volume</div>
                      <div className="col-span-1 text-center">Details</div>
                      <div className="col-span-1 text-center">Competitors</div>
                    </div>

                    <ScrollArea className="h-[70vh]" ref={scrollAreaRef as any}>
                      {filtered.map((p) => {
                        const r = results[p.id] as PromptResult | undefined;
                        const g = r?.google;
                        const b = r?.bing;
                        const competitorCount = (g?.competitorsHit?.length ?? 0) + (b?.competitorsHit?.length ?? 0);
                        const isNew = highlightIds.has(p.id);
                        const gOk: boolean | undefined = g
  ? (g.hasCompany === true || g.immersive?.hasCompany === true)
  : undefined;

                        const gUrls = (g?.top10 || []).map(u => ({ url: u, host: hostnameFromUrl(u) }));
                        const brandList = (g?.immersive?.brands || []);

                        const companyDomain = hostnameFromUrl(profile?.websiteUrl || '');
                        const competitorDomains = (profile?.competitorUrls || []).map(hostnameFromUrl);

                        const volume = p.volume?.value ?? 0;
                        const trend = (p.volume?.monthly || [])
                          .slice()
                          .sort((a, b) => (a.year - b.year) || (a.month - b.month))
                          .slice(-12)
                          .map(m => ({ label: formatMonth(m.year, m.month), volume: m.ai_search_volume }));

                        return (
                          <div
                            key={p.id}
                            className={
                              "grid grid-cols-12 items-center gap-0 border-b border-stone-100 px-3 py-3 text-sm transition-colors " +
                              (isNew ? "bg-amber-50/70" : "bg-white")
                            }
                          >
                            <div className="col-span-6 pr-3 text-stone-900">
                              <div className="flex items-start justify-between gap-3">
                                <span className={isNew ? "font-medium" : ""}>{p.text}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-stone-500 hover:text-rose-700 hover:bg-rose-50"
                                  onClick={() => handleDeletePrompt(p)}
                                  title="Delete prompt"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div className="col-span-1 flex justify-center">
                              <EngineCell status={b?.status} ok={b?.hasCompany} />
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <EngineCell status={g?.status} ok={gOk} />
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <EngineCell status={g?.status} ok={gOk} />
                            </div>

                            {/* Volume */}
                            <div className="col-span-1 flex items-center justify-center">
                              {volLoading && !p.volume ? (
                                <Loader2 className="h-4 w-4 animate-spin text-stone-500" />
                              ) : (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 px-2">
                                      {typeof volume === 'number' ? volume.toLocaleString() : '—'}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[560px]">
                                    <div className="mb-2 text-sm font-medium text-stone-800">Trend (last 12 months)</div>
                                    {trend.length > 0 ? (
                                      <div className="h-56 w-full">
                                        <ResponsiveContainer width="100%" height="100%">
                                          <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                                            <Tooltip />
                                            <Line type="monotone" dataKey="volume" dot={false} />
                                          </LineChart>
                                        </ResponsiveContainer>
                                      </div>
                                    ) : (
                                      <div className="text-sm text-stone-500">No monthly data.</div>
                                    )}
                                  </PopoverContent>
                                </Popover>
                              )}
                            </div>

                            {/* Details popover */}
                            <div className="col-span-1 flex items-center justify-center">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2">
                                    <Info className="h-4 w-4 mr-1" />
                                    Details
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[560px] max-h-[70vh] overflow-auto p-4">
                                  {(() => {
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
                                    const company = companyDomain;
                                    const comps = competitorDomains;

                                    return (
                                      <div className="space-y-4">
                                        <div>
                                          <div className="text-xs font-medium text-stone-700 mb-1">Top 10 Citations</div>
                                          <div className="flex flex-wrap">
                                            {gTop10.length ? (
                                              gTop10.map((url: string) => {
                                                const host = hostnameFromUrl(url);
                                                const kind: 'you' | 'comp' | 'other' =
                                                  host === company || (company && host?.endsWith('.' + company))
                                                    ? 'you'
                                                    : comps?.some((cd) => host === cd || (cd && host?.endsWith('.' + cd)))
                                                    ? 'comp'
                                                    : 'other';
                                                return chip(host || '—', kind, url);
                                              })
                                            ) : (
                                              <span className="text-sm text-stone-500">No results.</span>
                                            )}
                                          </div>
                                        </div>
                                        <Separator />
                                        <div>
                                          <div className="text-xs font-medium text-stone-700 mb-1">Products mentioned</div>
                                          <div className="flex flex-wrap">
                                            {(brandList || []).length ? (
                                              (brandList || []).map((brand) => {
                                                const you = brandMatchesDomain(brand, company || '');
                                                const comp = (comps || []).some((cd) => brandMatchesDomain(brand, cd || ''));
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

                            {/* Competitor count */}
                            <div className="col-span-1 flex items-center justify-center">
                              {competitorCount > 0 ? (
                                <Badge className={"text-stone-900 " + (isNew ? "bg-amber-200" : "bg-stone-200")}>
                                  {competitorCount} hits
                                </Badge>
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
                        Add
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
                        Generate
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </TabsContent>

              {/* REPORT TAB (unchanged UI) */}
              <TabsContent value="report" className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-stone-900">GEO Audit Report</h3>
                  <Button onClick={generateOverallReport} disabled={reportRunning || !serpStatus.ready} className="bg-stone-950 text-amber-50 hover:bg-stone-800">
                    {reportRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                    Generate / Refresh
                  </Button>
                </div>
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
                            const presencePctStr = sovFmt(sum.presencePct);
                            const pressurePctStr = sovFmt(sum.pressure);
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
                                        const opp = (overall.opportunities || []).find(o => o.promptId === pid);
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
    </main>
  );
}
