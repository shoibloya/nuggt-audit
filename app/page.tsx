// app/page.tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, Globe, Building2, Users, X, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

// --- Firebase (Client SDK, API-key based) ---
import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase,
  ref,
  onValue,
  off,
  push,
  set,
  serverTimestamp,
  DataSnapshot,
} from 'firebase/database';

// NEW: Accounts lib (username -> password)
import { accounts } from '@/lib/accounts';

// Initialize Firebase (client)
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

// Types
type ProfileStatus =
  | 'creating'
  | 'queued'
  | 'scraping'
  | 'generating_prompts'
  | 'serp_check'
  | 'done'
  | 'error';

type Profile = {
  id: string;
  companyName: string;
  websiteUrl: string;
  competitorUrls: string[];
  topics: string[];               // NEW: short-tail keywords/topics (comma-separated input)
  owner: string;                  // NEW: simple username for separation
  status: ProfileStatus;
  progress: number; // 0-100
  createdAt: number | { '.sv': 'timestamp' };
  updatedAt: number | { '.sv': 'timestamp' };
};

type Banner = { type: 'info' | 'success' | 'error'; message: string } | null;

function classNames(...s: (string | false | undefined)[]) {
  return s.filter(Boolean).join(' ');
}

function normalizeUrl(u: string) {
  if (!u) return '';
  try {
    const hasProtocol = /^https?:\/\//i.test(u);
    return hasProtocol ? new URL(u).toString() : new URL(`https://${u}`).toString();
  } catch {
    return u.trim();
  }
}

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
  return <Badge className={classNames('rounded-full', map[status].className)}>{map[status].label}</Badge>;
}

function BannerBar({ banner, onClose }: { banner: Banner; onClose: () => void }) {
  if (!banner) return null;
  const base = 'mb-4 flex items-start justify-between rounded-lg border p-3 text-sm';
  const style =
    banner.type === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
      : banner.type === 'error'
      ? 'bg-rose-50 border-rose-200 text-rose-900'
      : 'bg-amber-50 border-amber-200 text-amber-900';
  return (
    <div className={`${base} ${style}`}>
      <p className="pr-4">{banner.message}</p>
      <button
        aria-label="Close message"
        className="rounded p-1 text-current hover:bg-black/5"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------- Simple Login Gate (fixed credentials) ----------
function LoginScreen({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password.');
      return;
    }
    setLoading(true);
    // fixed credentials
    const ok = Boolean(accounts[username] && accounts[username] === password);
    setTimeout(() => {
      setLoading(false);
      if (ok) {
        try {
          localStorage.setItem('authUser', username);
        } catch {}
        onSuccess(username);
      } else {
        setError('Invalid credentials.');
      }
    }, 350);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 to-stone-100 flex items-center justify-center px-4">
      <Card className="w-full max-w-sm border-stone-300 bg-white/70">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-stone-600" />
            <CardTitle className="text-stone-900">Sign in</CardTitle>
          </div>
          <CardDescription className="text-stone-600">
            Enter your credentials to access Nuggt — GEO Audit
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="login-username">Username</Label>
              <Input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                required
              />
            </div>
            {error ? <div className="text-sm text-rose-600">{error}</div> : null}
            <Button type="submit" className="w-full bg-stone-950 text-amber-50 hover:bg-stone-800" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export default function HomePage() {
  const router = useRouter();

  // Simple auth gate
  const [authUser, setAuthUser] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('authUser');
      if (saved) setAuthUser(saved);
    } catch {}
  }, []);

  const [profiles, setProfiles] = React.useState<Profile[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Inline banner (replaces toast)
  const [banner, setBanner] = React.useState<Banner>(null);

  // Form state
  const [companyName, setCompanyName] = React.useState('');
  const [websiteUrl, setWebsiteUrl] = React.useState('');
  const [competitorInput, setCompetitorInput] = React.useState('');
  const [competitors, setCompetitors] = React.useState<string[]>([]);
  const [topicsInput, setTopicsInput] = React.useState(''); // NEW: comma-separated topics

  // Track a profile being created to show progress inline
  const [creatingProfileId, setCreatingProfileId] = React.useState<string | null>(null);
  const [creatingProgress, setCreatingProgress] = React.useState<number>(0);
  const [creatingStatus, setCreatingStatus] = React.useState<ProfileStatus>('creating');

  // Load profiles only after login
  React.useEffect(() => {
    if (!authUser) return;
    const r = ref(db, 'profiles');
    const unsub = onValue(
      r,
      (snap: DataSnapshot) => {
        const val = snap.val() || {};
        const list: Profile[] = Object.entries(val)
          .map(([id, p]: [string, any]) => ({ ...p, id })) // preserve doc id even if DB also has an 'id' field
          .filter((p: any) => p.owner === authUser); // show only current user's profiles
        // Sort newest first
        list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        setProfiles(list);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
        setBanner({ type: 'error', message: `Failed to load profiles: ${String(err)}` });
      }
    );
    return () => off(r, 'value', unsub as any);
  }, [authUser]);

  // When we’re creating, subscribe to that profile’s progress
  React.useEffect(() => {
    if (!creatingProfileId) return;
    const r = ref(db, `profiles/${creatingProfileId}`);
    const unsub = onValue(
      r,
      (snap) => {
        const p = snap.val();
        if (!p) return;
        setCreatingProgress(Number(p.progress ?? 0));
        setCreatingStatus(p.status as ProfileStatus);
        if (p.status === 'done' || p.status === 'error') {
          setTimeout(() => {
            setCreatingProfileId(null);
            setCreatingProgress(0);
          }, 600);
        }
      },
      (err) => console.error(err)
    );
    return () => off(r, 'value', unsub as any);
  }, [creatingProfileId]);

  function addCompetitorFromInput() {
    const raw = competitorInput.trim();
    if (!raw) return;
    const candidate = normalizeUrl(raw);
    if (competitors.includes(candidate)) {
      setCompetitorInput('');
      return;
    }
    setCompetitors((prev) => [...prev, candidate]);
    setCompetitorInput('');
  }

  function removeCompetitor(u: string) {
    setCompetitors((prev) => prev.filter((c) => c !== u));
  }

  const canSubmit =
    companyName.trim().length > 0 &&
    websiteUrl.trim().length > 0 &&
    competitors.length > 0 &&
    topicsInput.trim().length > 0;

  async function handleCreateProfile(e: React.FormEvent) {
    e.preventDefault();

    if (!canSubmit) {
      setBanner({ type: 'error', message: 'Please fill in all required fields (including at least one competitor and topics).' });
      return;
    }
    if (!authUser) {
      setBanner({ type: 'error', message: 'Not signed in.' });
      return;
    }

    setSaving(true);
    setBanner(null);
    try {
      const normalizedSite = normalizeUrl(websiteUrl);
      const topics = topicsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const data: Omit<Profile, 'id'> = {
        companyName: companyName.trim(),
        websiteUrl: normalizedSite,
        competitorUrls: competitors.map(normalizeUrl),
        topics,
        owner: authUser,
        status: 'creating',
        progress: 4,
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
      };

      const node = push(ref(db, 'profiles'));
      const newId = node.key!;
      await set(node, { ...data, id: authUser }); // NEW: also store username under 'id' in the DB

      // Kick off backend pipeline
      fetch(`/api/profiles/${newId}/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: newId }),
      }).catch(() => { /* server will update status/progress when it starts */ });

      setCreatingProfileId(newId);
      setDialogOpen(false);

      // Reset form
      setCompanyName('');
      setWebsiteUrl('');
      setCompetitors([]);
      setTopicsInput('');

      setBanner({ type: 'success', message: 'Profile created. We started the audit pipeline.' });
    } catch (err: any) {
      console.error(err);
      setBanner({ type: 'error', message: `Failed to create profile: ${String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  function goToProfile(p: Profile) {
    router.push(`/profiles/${p.id}`);
  }

  // ---------- Gate UI until logged in ----------
  if (!authUser) {
    return <LoginScreen onSuccess={(u) => setAuthUser(u)} />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 to-stone-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-950">Nuggt — GEO Audit</h1>
            <p className="text-sm text-stone-600">Audit prompts & discoverability for chat-first search.</p>
            <p className="mt-1 text-xs text-stone-500">Signed in as <span className="font-medium">{authUser}</span></p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-stone-950 text-amber-50 hover:bg-stone-800">
                <Plus className="mr-2 h-4 w-4" />
                New Profile
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Create Profile</DialogTitle>
              </DialogHeader>

              <form onSubmit={handleCreateProfile} className="space-y-4">
                <div className="grid gap-3">
                  <Label htmlFor="companyName">Company Name</Label>
                  <div className="relative">
                    <Input
                      id="companyName"
                      placeholder="Acme Inc."
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="bg-amber-50/60 border-stone-300 text-stone-900 placeholder:text-stone-400"
                      required
                    />
                    <Building2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  </div>
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="websiteUrl">Company Website URL</Label>
                  <div className="relative">
                    <Input
                      id="websiteUrl"
                      placeholder="https://www.example.com"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      className="bg-amber-50/60 border-stone-300 text-stone-900 placeholder:text-stone-400"
                      required
                    />
                    <Globe className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  </div>
                </div>

                <div className="grid gap-3">
                  <Label>Competitor URLs (at least one)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="https://competitor.com"
                      value={competitorInput}
                      onChange={(e) => setCompetitorInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addCompetitorFromInput();
                        }
                      }}
                      className="bg-amber-50/60 border-stone-300 text-stone-900 placeholder:text-stone-400"
                    />
                    <Button type="button" variant="secondary" onClick={addCompetitorFromInput}>
                      Add
                    </Button>
                  </div>
                  {competitors.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {competitors.map((c) => (
                        <span
                          key={c}
                          className="inline-flex items-center gap-2 rounded-full bg-stone-200 px-3 py-1 text-sm text-stone-900"
                        >
                          {c}
                          <button
                            type="button"
                            className="rounded-full border border-stone-400 px-2 text-xs text-stone-700 hover:bg-stone-300"
                            onClick={() => removeCompetitor(c)}
                            aria-label={`Remove ${c}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {competitors.length === 0 && (
                    <div className="text-xs text-amber-700">Please add at least one competitor URL.</div>
                  )}
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="topics">Short-tail keywords / topics (comma-separated)</Label>
                  <Textarea
                    id="topics"
                    rows={3}
                    placeholder="e.g., ai scheduling, meeting assistant, calendar automation"
                    value={topicsInput}
                    onChange={(e) => setTopicsInput(e.target.value)}
                    className="bg-amber-50/60 border-stone-300 text-stone-900 placeholder:text-stone-400"
                    required
                  />
                </div>

                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-stone-950 text-amber-50 hover:bg-stone-800"
                    disabled={saving || !canSubmit}
                  >
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </header>

        {/* Inline banner (success/error/info) */}
        <BannerBar banner={banner} onClose={() => setBanner(null)} />

        <Separator className="my-4 bg-stone-300" />

        {/* Progress overlay for the profile being created */}
        {creatingProfileId && (
          <Card className="mb-6 border-stone-300 bg-amber-50/80">
            <CardHeader>
              <CardTitle className="text-stone-900">Setting up your profile</CardTitle>
              <CardDescription className="text-stone-700">
                Status: <span className="font-medium">{creatingStatus.replace('_', ' ')}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={creatingProgress} className="h-3 bg-stone-200" />
              <div className="text-sm text-stone-700">{Math.round(creatingProgress)}%</div>
            </CardContent>
          </Card>
        )}

        {/* Profiles grid */}
        {loading ? (
          <div className="flex items-center gap-2 text-stone-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading profiles…
          </div>
        ) : profiles.length === 0 ? (
          <Card className="border-stone-300 bg-white/60">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <Users className="h-6 w-6 text-stone-400" />
              <p className="text-stone-700">No profiles yet. Create your first profile to start the audit.</p>
              <Button onClick={() => setDialogOpen(true)} className="bg-stone-950 text-amber-50 hover:bg-stone-800">
                <Plus className="mr-2 h-4 w-4" />
                New Profile
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((p) => (
              <Card
                key={p.id}
                className="group border-stone-300 bg-stone-50 transition hover:shadow-sm"
                role="button"
                onClick={() => goToProfile(p)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-1 text-stone-950">{p.companyName}</CardTitle>
                    <StatusBadge status={p.status} />
                  </div>
                  <CardDescription className="flex items-center gap-2 text-stone-700">
                    <Globe className="h-4 w-4 text-stone-500" />
                    <span className="truncate">{p.websiteUrl}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-stone-700">
                    Competitors: <span className="font-medium">{p.competitorUrls?.length || 0}</span>
                  </div>
                  <Progress value={Number(p.progress ?? 0)} className="h-2 bg-stone-200" />
                  <div className="flex items-center justify-between text-xs text-stone-600">
                    <span>{p.status === 'done' ? 'Complete' : 'In progress'}</span>
                    <span>{Math.round(Number(p.progress ?? 0))}%</span>
                  </div>
                  <Link
                    href={`/profiles/${p.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-block text-sm font-medium text-stone-900 underline-offset-2 hover:underline"
                  >
                    Open dashboard →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <footer className="mt-12 text-center text-xs text-stone-500">
          © {new Date().getFullYear()} Nuggt
        </footer>
      </div>
    </main>
  );
}
