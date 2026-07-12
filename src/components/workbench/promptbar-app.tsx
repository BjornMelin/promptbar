"use client";

import {
  BarChart3,
  Bot,
  Braces,
  CheckCircle2,
  Code2,
  CommandIcon,
  Download,
  FileSearch,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MessageResponse } from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_SEARCH_URL_STATE,
  parseSearchUrl,
  serializeSearchUrl,
  type SearchUrlState,
} from "@/lib/shared/search-url";
import { cn } from "@/lib/utils";
import type {
  AppSettings,
  CorpusStats,
  EvalRun,
  Facets,
  PromptDetail,
  PromptSummary,
  SearchMode,
  SearchResponse,
} from "@/lib/shared/types";
import { CodeEditor } from "./code-editor";

type BootstrapResponse = {
  stats: CorpusStats;
  facets: Facets;
  importReport: unknown;
};

type CorpusResponse = {
  stats: CorpusStats;
  facets: Facets;
  recent: PromptSummary[];
  evalRuns: EvalRun[];
};

type SearchHistoryMode = "none" | "push" | "replace";

type View = "dashboard" | "search" | "editor" | "chat" | "evals";

const navItems: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "search", label: "Search", icon: FileSearch },
  { id: "editor", label: "Editor", icon: Code2 },
  { id: "chat", label: "AI", icon: Bot },
  { id: "evals", label: "Evals", icon: BarChart3 },
];

const ALL_FILTER_OPTION = "all";
const FACET_FILTER_PREFIX = "facet:";

export function PromptbarApp() {
  const [view, setViewState] = useState<View>("dashboard");
  const [query, setQuery] = useState(DEFAULT_SEARCH_URL_STATE.query);
  const [mode, setMode] = useState<SearchMode>(DEFAULT_SEARCH_URL_STATE.mode);
  const [kind, setKind] = useState<SearchUrlState["kind"]>(
    DEFAULT_SEARCH_URL_STATE.kind,
  );
  const [status, setStatus] = useState<SearchUrlState["status"]>(
    DEFAULT_SEARCH_URL_STATE.status,
  );
  const [tag, setTag] = useState<SearchUrlState["tag"]>(
    DEFAULT_SEARCH_URL_STATE.tag,
  );
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [results, setResults] = useState<PromptSummary[]>([]);
  const [selected, setSelected] = useState<PromptDetail | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editorValue, setEditorValue] = useState("");
  const [rawVisible, setRawVisible] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([]);
  const [evalInput, setEvalInput] = useState("Summarize the intended use.");
  const [evalAssertions, setEvalAssertions] = useState("summary, prompt");
  const [chatInput, setChatInput] = useState("");
  const [codexTask, setCodexTask] = useState("");
  const [codexOutput, setCodexOutput] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [searchError, setSearchError] = useState("");
  const selectedRef = useRef<PromptDetail | null>(null);
  const editorValueRef = useRef("");
  const rawVisibleRef = useRef(false);
  const selectionVersionRef = useRef(0);
  const resultsAbortRef = useRef<AbortController | null>(null);
  const locationVersionRef = useRef(0);
  const viewRef = useRef<View>("dashboard");

  const setView = useCallback((nextView: View) => {
    viewRef.current = nextView;
    setViewState(nextView);
  }, []);

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { contextIds: selectedIds },
      }),
    [selectedIds],
  );
  const chat = useChat({ transport: chatTransport });

  useEffect(() => {
    selectedRef.current = selected;
    editorValueRef.current = editorValue;
    rawVisibleRef.current = rawVisible;
  }, [editorValue, rawVisible, selected]);

  const applySearchState = useCallback((state: SearchUrlState) => {
    setQuery(state.query);
    setMode(state.mode);
    setKind(state.kind);
    setStatus(state.status);
    setTag(state.tag);
  }, []);

  const beginResultsLoad = useCallback(() => {
    resultsAbortRef.current?.abort();
    const controller = new AbortController();
    resultsAbortRef.current = controller;
    selectionVersionRef.current += 1;
    return controller;
  }, []);

  const selectPrompt = useCallback(async (id: string) => {
    const current = selectedRef.current;
    if (
      current &&
      editorValueRef.current !==
        currentEditorSource(current, rawVisibleRef.current)
    ) {
      const confirmed = window.confirm("Discard unsaved editor changes?");
      if (!confirmed) {
        return;
      }
    }
    const selectionVersion = selectionVersionRef.current + 1;
    selectionVersionRef.current = selectionVersion;
    const data = await getJson<{ prompt: PromptDetail }>(`/api/prompts/${id}`);
    if (selectionVersion !== selectionVersionRef.current) {
      return;
    }
    setSelected(data.prompt);
    setRawVisible(false);
    setEditorValue(data.prompt.redactedContent ?? data.prompt.content);
    setSelectedIds((current) =>
      current.includes(id) ? current : [id, ...current].slice(0, 8),
    );
  }, []);

  const runSearch = useCallback(
    async (
      nextState: SearchUrlState,
      historyMode: SearchHistoryMode,
      announceRefreshError = false,
    ) => {
      const controller = beginResultsLoad();
      setSearchError("");
      if (historyMode !== "none") {
        applySearchState(nextState);
        setView("search");
        setResults([]);
        setNotice("");
        writeSearchHistory(nextState, historyMode);
      }

      const params = new URLSearchParams({
        q: nextState.query,
        mode: nextState.mode,
        limit: "40",
      });
      if (nextState.kind !== null) {
        params.set("kind", nextState.kind);
      }
      if (nextState.status !== null) {
        params.set("status", nextState.status);
      }
      if (nextState.tag !== null) {
        params.set("tag", nextState.tag);
      }

      try {
        const data = await getJson<SearchResponse>(`/api/search?${params}`, {
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          resultsAbortRef.current !== controller
        ) {
          return;
        }
        setResults(data.results);
        setStats(data.stats);
        setFacets(data.facets);
        setNotice(data.hybridReason);
        setSearchError("");
        if (!selectedRef.current && data.results[0]) {
          await selectPrompt(data.results[0].id);
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          resultsAbortRef.current === controller &&
          !isAbortError(error)
        ) {
          setResults([]);
          setNotice("");
          const message = errorMessage(error, "Unable to search corpus.");
          setSearchError(message);
          if (announceRefreshError && viewRef.current !== "search") {
            toast.error(message);
          }
        }
      } finally {
        if (resultsAbortRef.current === controller) {
          resultsAbortRef.current = null;
        }
      }
    },
    [applySearchState, beginResultsLoad, selectPrompt, setView],
  );

  const loadCorpusResults = useCallback(
    async (seed?: CorpusResponse, announceRefreshError = false) => {
      const controller = beginResultsLoad();
      setNotice("");
      setSearchError("");

      try {
        const data =
          seed ??
          (await getJson<CorpusResponse>("/api/corpus", {
            signal: controller.signal,
          }));
        if (
          controller.signal.aborted ||
          resultsAbortRef.current !== controller
        ) {
          return;
        }
        setResults(data.recent);
        setStats(data.stats);
        setFacets(data.facets);
        setEvalRuns(data.evalRuns);
        if (!selectedRef.current && data.recent[0]) {
          await selectPrompt(data.recent[0].id);
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          resultsAbortRef.current === controller &&
          !isAbortError(error)
        ) {
          const message = errorMessage(error, "Unable to open corpus.");
          setNotice(message);
          if (
            announceRefreshError &&
            viewRef.current !== "dashboard" &&
            viewRef.current !== "search"
          ) {
            toast.error(message);
          }
        }
      } finally {
        if (resultsAbortRef.current === controller) {
          resultsAbortRef.current = null;
        }
      }
    },
    [beginResultsLoad, selectPrompt],
  );

  const restoreDashboard = useCallback(
    (seed?: CorpusResponse) => {
      applySearchState(DEFAULT_SEARCH_URL_STATE);
      setView("dashboard");
      setResults([]);
      return loadCorpusResults(seed);
    },
    [applySearchState, loadCorpusResults, setView],
  );

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const [boot, appSettings] = await Promise.all([
        getJson<BootstrapResponse>("/api/bootstrap"),
        getJson<AppSettings>("/api/settings"),
      ]);
      setStats(boot.stats);
      setFacets(boot.facets);
      setSettings(appSettings);
      const locationVersion = locationVersionRef.current;
      const sharedSearch = parseSearchUrl(window.location.search);
      const searchPromise = sharedSearch
        ? runSearch(sharedSearch, "replace")
        : null;
      const corpus = await getJson<CorpusResponse>("/api/corpus");
      setEvalRuns(corpus.evalRuns);
      if (locationVersion !== locationVersionRef.current) {
        await searchPromise;
        return;
      }
      if (searchPromise) {
        await searchPromise;
      } else {
        await restoreDashboard(corpus);
      }
    } catch (error) {
      setNotice(errorMessage(error, "Unable to open corpus."));
    } finally {
      setLoading(false);
    }
  }, [restoreDashboard, runSearch]);

  useEffect(() => {
    const id = window.setTimeout(() => void bootstrap(), 0);
    return () => window.clearTimeout(id);
  }, [bootstrap]);

  useEffect(() => {
    const restoreLocation = () => {
      locationVersionRef.current += 1;
      const sharedSearch = parseSearchUrl(window.location.search);
      if (sharedSearch) {
        void runSearch(sharedSearch, "replace");
      } else {
        void restoreDashboard();
      }
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [restoreDashboard, runSearch]);

  useEffect(() => () => resultsAbortRef.current?.abort(), []);

  const draftSearch = useMemo<SearchUrlState>(
    () => ({ query, mode, kind, status, tag }),
    [kind, mode, query, status, tag],
  );

  const executeSearch = useCallback(
    () => runSearch(draftSearch, "push"),
    [draftSearch, runSearch],
  );

  const refreshCurrentResults = useCallback(() => {
    const committedSearch = parseSearchUrl(window.location.search);
    return committedSearch
      ? runSearch(committedSearch, "none", true)
      : loadCorpusResults(undefined, true);
  }, [loadCorpusResults, runSearch]);

  const copySearchLink = useCallback(async () => {
    writeSearchHistory(searchStateFromLocation(), "replace");
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Search link copied.");
    } catch {
      toast.error("Couldn’t copy link. Copy it from the address bar.");
    }
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function saveSelected() {
    if (!selected) {
      return;
    }
    if (!rawVisible) {
      setNotice("Reveal raw content before saving content edits.");
      return;
    }
    setBusy(true);
    try {
      const data = await patchJson<{ prompt: PromptDetail }>(
        `/api/prompts/${selected.id}`,
        { content: editorValue, reason: "Editor save" },
      );
      setSelected(data.prompt);
      setEditorValue(data.prompt.rawContent ?? editorValue);
      await refreshCurrentResults();
    } finally {
      setBusy(false);
    }
  }

  async function toggleRawVisible() {
    if (!selected) {
      return;
    }
    if (rawVisible) {
      setRawVisible(false);
      setEditorValue(selected.redactedContent ?? selected.content);
      return;
    }
    const promptId = selected.id;
    const selectionVersion = selectionVersionRef.current;
    setBusy(true);
    try {
      const data = await getJson<{ prompt: PromptDetail }>(
        `/api/prompts/${promptId}?raw=1`,
      );
      if (
        selectedRef.current?.id !== promptId ||
        selectionVersion !== selectionVersionRef.current
      ) {
        return;
      }
      setSelected(data.prompt);
      setRawVisible(true);
      setEditorValue(data.prompt.rawContent ?? data.prompt.content);
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(prompt: PromptSummary) {
    const data = await patchJson<{ prompt: PromptDetail }>(
      `/api/prompts/${prompt.id}`,
      { favorite: !prompt.favorite },
    );
    if (selectedRef.current?.id === prompt.id) {
      setSelected(data.prompt);
      if (!rawVisibleRef.current) {
        setEditorValue(currentEditorSource(data.prompt, false));
      }
    }
    await refreshCurrentResults();
  }

  async function runEval() {
    if (!selectedIds.length) {
      return;
    }
    setBusy(true);
    const assertions = evalAssertions
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const data = await postJson<{ run: EvalRun }>("/api/evals", {
      promptIds: selectedIds.slice(0, 4),
      cases: [
        {
          id: "default",
          name: "Default",
          input: evalInput,
          assertions,
        },
      ],
    });
    setEvalRuns((current) => [data.run, ...current].slice(0, 12));
    setStats((current) =>
      current ? { ...current, evalRuns: current.evalRuns + 1 } : current,
    );
    setBusy(false);
  }

  async function exportSelected() {
    if (!selectedIds.length) {
      return;
    }
    setBusy(true);
    const data = await postJson<{ filePath: string }>("/api/export", {
      promptIds: selectedIds,
    });
    setNotice(`Exported ${selectedIds.length} prompts to ${data.filePath}`);
    setBusy(false);
  }

  async function runCodex() {
    setBusy(true);
    const result = await postJson<{ ok: boolean; output: string }>(
      "/api/codex",
      {
        promptIds: selectedIds,
        task: codexTask || "Review selected prompts for reuse opportunities.",
      },
    ).catch((error: Error) => ({ ok: false, output: error.message }));
    setCodexOutput(result.output);
    setBusy(false);
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text) {
      return;
    }
    setChatInput("");
    await chat.sendMessage({ text });
  }

  const chartData = useMemo(() => {
    return (
      facets?.kinds.map((item) => ({
        name: item.value.replace("codex-", ""),
        count: item.count,
      })) ?? []
    );
  }, [facets]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#11120f]">
        <div className="flex items-center gap-3 text-[#f8f6ee]">
          <Loader2 className="size-5 animate-spin text-[#d1ff3c]" />
          <span className="text-sm">Opening Promptbar</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#11120f] text-[#f8f6ee]">
      <div className="grid h-screen grid-cols-[64px_minmax(0,1fr)]">
        <aside className="flex flex-col items-center gap-3 border-r border-white/10 bg-[#151611] px-2 py-4">
          <div className="grid size-10 place-items-center rounded-md border border-[#d1ff3c]/40 bg-[#d1ff3c] text-[#151611]">
            <CommandIcon className="size-5" />
          </div>
          <Separator className="bg-white/10" />
          {navItems.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={item.label}
                  onClick={() => setView(item.id)}
                  className={cn(
                    "size-10 text-[#aaa69a] hover:bg-white/8 hover:text-white",
                    view === item.id &&
                      "bg-[#f8f6ee] text-[#151611] hover:bg-[#f8f6ee]",
                  )}
                >
                  <item.icon className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ))}
          <div className="mt-auto flex flex-col gap-2">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Command"
              onClick={() => setCommandOpen(true)}
              className="size-10 text-[#aaa69a] hover:bg-white/8"
            >
              <Search className="size-5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              className="size-10 text-[#aaa69a] hover:bg-white/8"
            >
              <Settings className="size-5" />
            </Button>
          </div>
        </aside>

        <section className="grid min-w-0 grid-rows-[124px_minmax(0,1fr)] sm:grid-rows-[72px_minmax(0,1fr)]">
          <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#151611] px-3 py-3 sm:flex-nowrap sm:gap-4 sm:px-5 sm:py-0">
            <div className="min-w-0 flex-1 sm:flex-none">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-normal">
                  Promptbar
                </h1>
                <Badge className="bg-[#d1ff3c] text-[#151611]">local</Badge>
              </div>
              <p className="truncate text-xs text-[#aaa69a]">
                {stats?.documents ?? 0} prompts · {stats?.chunks ?? 0} chunks ·{" "}
                {settings?.apiEnabled ? "API enabled" : "local-only"}
              </p>
            </div>
            <div className="order-3 flex min-w-0 basis-full items-center gap-2 rounded-md border border-white/10 bg-[#0d0e0b] px-3 py-2 sm:order-none sm:flex-1 sm:basis-auto">
              <Search className="size-4 text-[#aaa69a]" />
              <Input
                aria-label="Search corpus"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void executeSearch();
                  }
                }}
                placeholder="Search corpus"
                className="h-8 border-0 bg-transparent px-0 text-base shadow-none md:text-sm"
              />
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as SearchMode)}
              >
                <SelectTrigger
                  aria-label="Search mode"
                  className="h-8 w-24 border-white/10 bg-white/5 sm:w-28"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="lexical">FTS</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Button
              aria-label="Search"
              onClick={() => void executeSearch()}
              className="bg-[#d1ff3c] text-[#151611] hover:bg-[#c3ef35]"
            >
              <Search data-icon="inline-start" />
              <span className="hidden sm:inline">Search</span>
            </Button>
          </header>

          <div className="min-h-0 overflow-hidden">
            <Tabs
              value={view}
              onValueChange={(value) => setView(value as View)}
              className="h-full"
            >
              <TabsList className="sr-only">
                {navItems.map((item) => (
                  <TabsTrigger key={item.id} value={item.id}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="dashboard" className="m-0 h-full">
                <Dashboard
                  stats={stats}
                  chartData={chartData}
                  notice={notice}
                  recent={results}
                  onSelect={selectPrompt}
                />
              </TabsContent>
              <TabsContent value="search" className="m-0 h-full">
                <SearchView
                  kind={kind}
                  status={status}
                  tag={tag}
                  notice={searchError || notice}
                  noticeIsError={Boolean(searchError)}
                  facets={facets}
                  results={results}
                  selectedId={selected?.id}
                  selectedIds={selectedIds}
                  onKind={setKind}
                  onStatus={setStatus}
                  onTag={setTag}
                  onRefresh={executeSearch}
                  onCopy={copySearchLink}
                  onSelect={selectPrompt}
                  onToggleFavorite={toggleFavorite}
                  onToggleContext={(id) => {
                    setSelectedIds((current) =>
                      current.includes(id)
                        ? current.filter((item) => item !== id)
                        : [id, ...current].slice(0, 8),
                    );
                  }}
                />
              </TabsContent>
              <TabsContent value="editor" className="m-0 h-full">
                <EditorView
                  selected={selected}
                  value={editorValue}
                  busy={busy}
                  rawVisible={rawVisible}
                  onChange={setEditorValue}
                  onToggleRaw={toggleRawVisible}
                  onSave={saveSelected}
                  onExport={exportSelected}
                />
              </TabsContent>
              <TabsContent value="chat" className="m-0 h-full">
                <ChatView
                  selected={selected}
                  selectedIds={selectedIds}
                  messages={chat.messages}
                  status={chat.status}
                  input={chatInput}
                  apiEnabled={settings?.apiEnabled ?? false}
                  codexAvailable={settings?.codexAvailable ?? false}
                  codexTask={codexTask}
                  codexOutput={codexOutput}
                  busy={busy}
                  onInput={setChatInput}
                  onSend={sendChat}
                  onCodexTask={setCodexTask}
                  onRunCodex={runCodex}
                />
              </TabsContent>
              <TabsContent value="evals" className="m-0 h-full">
                <EvalView
                  selectedIds={selectedIds}
                  runs={evalRuns}
                  input={evalInput}
                  assertions={evalAssertions}
                  busy={busy}
                  onInput={setEvalInput}
                  onAssertions={setEvalAssertions}
                  onRun={runEval}
                />
              </TabsContent>
            </Tabs>
          </div>
        </section>
      </div>
      <CommandDialog
        open={commandOpen}
        onOpen={setCommandOpen}
        onView={setView}
        onRefresh={refreshCurrentResults}
        onExport={exportSelected}
      />
      <SettingsSheet
        open={settingsOpen}
        onOpen={setSettingsOpen}
        settings={settings}
        stats={stats}
      />
    </main>
  );
}

function Dashboard({
  stats,
  chartData,
  notice,
  recent,
  onSelect,
}: {
  stats: CorpusStats | null;
  chartData: Array<{ name: string; count: number }>;
  notice: string;
  recent: PromptSummary[];
  onSelect: (id: string) => Promise<void>;
}) {
  return (
    <div className="grid h-full grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
      <ScrollArea className="min-h-0">
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label="Corpus" value={stats?.documents ?? 0} />
            <Metric label="Chunks" value={stats?.chunks ?? 0} />
            <Metric label="Embeddings" value={stats?.embeddedChunks ?? 0} />
            <Metric label="Evals" value={stats?.evalRuns ?? 0} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Panel className="h-80">
              <PanelHeader
                icon={BarChart3}
                title="Corpus shape"
                action={stats?.apiEnabled ? "API" : "FTS"}
              />
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={chartData}>
                  <CartesianGrid stroke="#2c2e27" vertical={false} />
                  <XAxis dataKey="name" stroke="#aaa69a" fontSize={12} />
                  <YAxis stroke="#aaa69a" fontSize={12} />
                  <ChartTooltip
                    cursor={{ fill: "rgba(209,255,60,0.08)" }}
                    contentStyle={{
                      background: "#151611",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  />
                  <Bar dataKey="count" fill="#d1ff3c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel className="h-80">
              <PanelHeader icon={ShieldCheck} title="Guardrails" />
              <div className="space-y-4 text-sm text-[#d9d5c8]">
                <StatusLine
                  label="Repo key"
                  active={Boolean(stats?.apiEnabled)}
                />
                <StatusLine
                  label="Codex bridge"
                  active={Boolean(stats?.codexAvailable)}
                />
                <StatusLine label="Managed corpus" active />
                <StatusLine label="Global key ignored" active />
                <Separator className="bg-white/10" />
                <p className="text-xs leading-5 text-[#aaa69a]">{notice}</p>
              </div>
            </Panel>
          </div>
          <Panel>
            <PanelHeader icon={GitBranch} title="Recent imports" />
            <PromptRows prompts={recent} onSelect={onSelect} />
          </Panel>
        </div>
      </ScrollArea>
      <aside className="hidden border-l border-white/10 bg-[#151611] p-5 lg:block">
        <Panel className="h-full">
          <PanelHeader icon={Gauge} title="Readiness" action="live" />
          <div className="space-y-5">
            <Readiness label="Corpus indexed" value={100} />
            <Readiness
              label="Embedding coverage"
              value={coverage(stats?.embeddedChunks, stats?.chunks)}
            />
            <Readiness
              label="Eval history"
              value={Math.min(100, (stats?.evalRuns ?? 0) * 20)}
            />
            <Readiness label="Risk review" value={stats?.risks ? 72 : 100} />
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function currentEditorSource(
  prompt: PromptDetail,
  rawVisible: boolean,
): string {
  return rawVisible
    ? (prompt.rawContent ?? prompt.content)
    : (prompt.redactedContent ?? prompt.content);
}

function SearchView(props: {
  kind: SearchUrlState["kind"];
  status: SearchUrlState["status"];
  tag: SearchUrlState["tag"];
  notice: string;
  noticeIsError: boolean;
  facets: Facets | null;
  results: PromptSummary[];
  selectedId: string | undefined;
  selectedIds: string[];
  onKind: (value: string | null) => void;
  onStatus: (value: SearchUrlState["status"]) => void;
  onTag: (value: string | null) => void;
  onRefresh: () => Promise<void>;
  onCopy: () => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onToggleFavorite: (prompt: PromptSummary) => Promise<void>;
  onToggleContext: (id: string) => void;
}) {
  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="max-h-64 overflow-auto border-b border-white/10 bg-[#151611] p-4 lg:max-h-none lg:border-r lg:border-b-0">
        <div className="space-y-4">
          <FilterSelect
            label="Kind"
            value={props.kind}
            values={props.facets?.kinds ?? []}
            onChange={props.onKind}
          />
          <FilterSelect
            label="Status"
            value={props.status}
            values={props.facets?.statuses ?? []}
            onChange={(value) =>
              props.onStatus(value as SearchUrlState["status"])
            }
          />
          <FilterSelect
            label="Tag"
            value={props.tag}
            values={props.facets?.tags ?? []}
            onChange={props.onTag}
          />
          <Button
            onClick={() => void props.onRefresh()}
            className="w-full bg-[#d1ff3c] text-[#151611]"
          >
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => void props.onCopy()}
            className="w-full border-white/10 bg-transparent"
          >
            <Link2 data-icon="inline-start" />
            Copy link
          </Button>
          {props.notice ? (
            <Notice role={props.noticeIsError ? "alert" : "status"}>
              {props.notice}
            </Notice>
          ) : null}
          <Separator className="bg-white/10" />
          <FacetCloud title="Risk" values={props.facets?.risks ?? []} />
        </div>
      </aside>
      <ScrollArea className="min-h-0">
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {props.results.map((prompt) => (
            <article
              key={prompt.id}
              className={cn(
                "group min-h-52 rounded-md border border-white/10",
                "bg-[#1d1e19] p-4 text-left transition hover:border-[#d1ff3c]/60",
                props.selectedId === prompt.id && "border-[#d1ff3c]",
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <Badge className="bg-white/8 text-[#f8f6ee]">
                  {prompt.kind}
                </Badge>
                <div className="flex gap-1">
                  <IconToggle
                    active={prompt.favorite}
                    label="Favorite"
                    onClick={(event) => {
                      event.stopPropagation();
                      void props.onToggleFavorite(prompt);
                    }}
                  />
                  <Switch
                    aria-label={`Include ${prompt.title} in AI context`}
                    checked={props.selectedIds.includes(prompt.id)}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={() => props.onToggleContext(prompt.id)}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => void props.onSelect(prompt.id)}
                className="block w-full text-left"
              >
                <h3 className="line-clamp-2 text-base font-semibold">
                  {prompt.title}
                </h3>
                <p className="mt-3 line-clamp-4 text-sm leading-6 text-[#aaa69a]">
                  {prompt.excerpt}
                </p>
                <div className="mt-4 flex flex-wrap gap-1">
                  {prompt.tags.slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-sm bg-[#f8f6ee]/8 px-2 py-1 text-[11px]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            </article>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function EditorView(props: {
  selected: PromptDetail | null;
  value: string;
  busy: boolean;
  rawVisible: boolean;
  onChange: (value: string) => void;
  onToggleRaw: () => void;
  onSave: () => Promise<void>;
  onExport: () => Promise<void>;
}) {
  if (!props.selected) {
    return <EmptyState label="No prompt selected" />;
  }
  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="grid min-w-0 grid-rows-[64px_minmax(0,1fr)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{props.selected.title}</h2>
            <p className="truncate text-xs text-[#aaa69a]">
              {props.selected.corpusPath}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={props.onToggleRaw}
              className="border-white/10 bg-white/5"
            >
              <ShieldCheck className="size-4" />
              {props.rawVisible ? "Hide raw" : "Reveal raw"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void props.onExport()}
              className="border-white/10 bg-white/5"
            >
              <Download className="size-4" />
              Export
            </Button>
            <Button
              disabled={props.busy || !props.rawVisible}
              onClick={() => void props.onSave()}
              className="bg-[#d1ff3c] text-[#151611]"
            >
              <Save className="size-4" />
              Save
            </Button>
          </div>
        </div>
        <div className="min-h-0 bg-[#f8f6ee]">
          <CodeEditor value={props.value} onChange={props.onChange} />
        </div>
      </section>
      <aside className="hidden space-y-4 border-l border-white/10 bg-[#151611] p-4 lg:block">
        <Panel>
          <PanelHeader icon={Braces} title="Metadata" />
          <dl className="space-y-3 text-sm">
            <Meta label="Kind" value={props.selected.kind} />
            <Meta label="Status" value={props.selected.status} />
            <Meta
              label="Versions"
              value={String(props.selected.versions.length)}
            />
            <Meta
              label="Hash"
              value={props.selected.contentHash.slice(0, 12)}
            />
          </dl>
        </Panel>
        <Panel>
          <PanelHeader icon={ShieldCheck} title="Privacy" />
          <dl className="space-y-3 text-sm">
            <Meta
              label="View"
              value={props.rawVisible ? "raw local" : "redacted"}
            />
            <Meta
              label="Risk"
              value={props.selected.riskFlags.join(", ") || "none"}
            />
          </dl>
        </Panel>
        <Panel>
          <PanelHeader icon={GitBranch} title="Related" />
          <div className="space-y-2">
            {props.selected.related.map((item) => (
              <div key={item.id} className="rounded-md bg-white/5 p-2 text-sm">
                {item.title}
              </div>
            ))}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function ChatView(props: {
  selected: PromptDetail | null;
  selectedIds: string[];
  messages: ReturnType<typeof useChat>["messages"];
  status: ReturnType<typeof useChat>["status"];
  input: string;
  apiEnabled: boolean;
  codexAvailable: boolean;
  codexTask: string;
  codexOutput: string;
  busy: boolean;
  onInput: (value: string) => void;
  onSend: () => Promise<void>;
  onCodexTask: (value: string) => void;
  onRunCodex: () => Promise<void>;
}) {
  return (
    <div className="grid h-full grid-cols-1 bg-[#f8f6ee] text-[#151611] lg:grid-cols-[320px_minmax(0,1fr)_360px]">
      <aside className="hidden border-r border-white/10 bg-[#151611] p-4 lg:block">
        <Panel className="h-full">
          <PanelHeader icon={Sparkles} title="Context" />
          <div className="space-y-3">
            <Badge className="bg-[#246bfe] text-white">
              {props.selectedIds.length} selected
            </Badge>
            {props.selected && (
              <div className="rounded-md bg-white/5 p-3 text-sm">
                <p className="font-medium">{props.selected.title}</p>
                <p className="mt-2 line-clamp-5 text-[#aaa69a]">
                  {props.selected.excerpt}
                </p>
              </div>
            )}
          </div>
        </Panel>
      </aside>
      <section className="grid min-w-0 grid-rows-[minmax(0,1fr)_124px]">
        <ScrollArea className="min-h-0 border-r border-[#dedacf] p-5">
          <div className="space-y-5">
            {!props.apiEnabled && (
              <Notice>
                Add `PROMPTBAR_OPENAI_API_KEY` to `.env.local` for chat.
              </Notice>
            )}
            {props.messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[82%] rounded-md p-4",
                  message.role === "user"
                    ? "ml-auto bg-[#d1ff3c] text-[#151611]"
                    : "border border-[#d8d2c3] bg-white text-[#151611]",
                )}
              >
                {message.parts.map((part, index) =>
                  part.type === "text" ? (
                    <MessageResponse key={index}>{part.text}</MessageResponse>
                  ) : null,
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t border-[#dedacf] bg-[#efede4] p-4">
          <Textarea
            value={props.input}
            onChange={(event) => props.onInput(event.target.value)}
            placeholder="Ask about selected prompts"
            className="h-16 resize-none border-[#d8d2c3] bg-white text-[#151611]"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-[#6f6c62]">{props.status}</span>
            <Button
              disabled={!props.apiEnabled || props.status !== "ready"}
              onClick={() => void props.onSend()}
              className="bg-[#d1ff3c] text-[#151611]"
            >
              <Bot className="size-4" />
              Send
            </Button>
          </div>
        </div>
      </section>
      <aside className="hidden border-l border-white/10 bg-[#151611] p-4 lg:block">
        <Panel className="h-full">
          <PanelHeader icon={TerminalSquare} title="Codex bridge" />
          <Textarea
            value={props.codexTask}
            onChange={(event) => props.onCodexTask(event.target.value)}
            placeholder="Run an explicit local Codex task"
            className="h-28 border-white/10 bg-[#0d0e0b] text-[#f8f6ee] placeholder:text-[#aaa69a]"
          />
          <Button
            disabled={!props.codexAvailable || props.busy}
            onClick={() => void props.onRunCodex()}
            className="mt-3 w-full bg-[#246bfe] text-white"
          >
            <TerminalSquare className="size-4" />
            Run Codex
          </Button>
          {props.codexOutput && (
            <ScrollArea className="mt-4 h-[calc(100%-210px)] rounded-md bg-black/30 p-3">
              <MessageResponse className="text-sm">
                {props.codexOutput}
              </MessageResponse>
            </ScrollArea>
          )}
        </Panel>
      </aside>
    </div>
  );
}

function EvalView(props: {
  selectedIds: string[];
  runs: EvalRun[];
  input: string;
  assertions: string;
  busy: boolean;
  onInput: (value: string) => void;
  onAssertions: (value: string) => void;
  onRun: () => Promise<void>;
}) {
  return (
    <div className="grid h-full grid-cols-1 bg-[#f8f6ee] text-[#151611] lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#151611] p-4 lg:border-r lg:border-b-0">
        <Panel>
          <PanelHeader icon={Play} title="Matrix" />
          <div className="space-y-3">
            <Textarea
              value={props.input}
              onChange={(event) => props.onInput(event.target.value)}
              className="h-28 border-white/10 bg-[#0d0e0b] text-[#f8f6ee] placeholder:text-[#aaa69a]"
            />
            <Input
              value={props.assertions}
              onChange={(event) => props.onAssertions(event.target.value)}
              className="border-white/10 bg-[#0d0e0b] text-[#f8f6ee] placeholder:text-[#aaa69a]"
            />
            <Button
              disabled={!props.selectedIds.length || props.busy}
              onClick={() => void props.onRun()}
              className="w-full bg-[#d1ff3c] text-[#151611]"
            >
              <Play className="size-4" />
              Run
            </Button>
          </div>
        </Panel>
      </aside>
      <ScrollArea className="min-h-0">
        <div className="space-y-4 p-5">
          {!props.runs.length && (
            <div className="grid h-[calc(100vh-160px)] place-items-center rounded-md border border-dashed border-[#d8d2c3] bg-white/70 text-sm text-[#6f6c62]">
              No eval runs yet.
            </div>
          )}
          {props.runs.map((run) => (
            <div
              key={run.id}
              className="rounded-md border border-[#d8d2c3] bg-white p-4"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-[#246bfe]" />
                  <h2 className="text-sm font-semibold">
                    {run.model} · {run.mode}
                  </h2>
                </div>
                <Badge className="bg-[#151611] text-[#f8f6ee]">
                  {new Date(run.createdAt).toLocaleTimeString()}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {run.results.map((result) => (
                  <div
                    key={`${result.promptId}-${result.caseId}`}
                    className={cn(
                      "rounded-md border p-3 text-sm",
                      result.failed
                        ? "border-[#ff6b57]/45 bg-[#fff0ed]"
                        : "border-[#8aa328]/35 bg-[#f5fadf]",
                    )}
                  >
                    <div className="font-medium">
                      {result.passed} pass · {result.failed} fail
                    </div>
                    <p className="mt-2 line-clamp-5 text-[#6f6c62]">
                      {result.output}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-[#1d1e19] p-4">
      <div className="text-2xl font-semibold text-[#f8f6ee]">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[#aaa69a]">
        {label}
      </div>
    </div>
  );
}

function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-white/10 bg-[#1d1e19] p-4 text-[#f8f6ee]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: typeof Gauge;
  title: string;
  action?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 text-[#d1ff3c]" />
        <h2 className="truncate text-sm font-semibold">{title}</h2>
      </div>
      {action && <Badge className="bg-white/8 text-[#d9d5c8]">{action}</Badge>}
    </div>
  );
}

function StatusLine({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <Badge className={active ? "bg-[#d1ff3c] text-[#151611]" : ""}>
        {active ? "on" : "off"}
      </Badge>
    </div>
  );
}

function Readiness({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-[#aaa69a]">{Math.round(value)}%</span>
      </div>
      <Progress value={value} className="h-2" />
    </div>
  );
}

function PromptRows({
  prompts,
  onSelect,
}: {
  prompts: PromptSummary[];
  onSelect: (id: string) => Promise<void>;
}) {
  return (
    <div className="divide-y divide-white/10">
      {prompts.slice(0, 8).map((prompt) => (
        <button
          key={prompt.id}
          onClick={() => void onSelect(prompt.id)}
          className="grid w-full grid-cols-[1fr_auto] gap-3 py-3 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {prompt.title}
            </span>
            <span className="block truncate text-xs text-[#aaa69a]">
              {prompt.sourcePath}
            </span>
          </span>
          <Badge className="bg-white/8 text-[#d9d5c8]">{prompt.kind}</Badge>
        </button>
      ))}
    </div>
  );
}

function FilterSelect(props: {
  label: string;
  value: string | null;
  values: Array<{ value: string; count: number }>;
  onChange: (value: string | null) => void;
}) {
  const values =
    props.value !== null &&
    !props.values.some((item) => item.value === props.value)
      ? [{ value: props.value, count: 0 }, ...props.values]
      : props.values;
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-[0.14em] text-[#aaa69a]">
        {props.label}
      </div>
      <Select
        value={encodeFilterOption(props.value)}
        onValueChange={(value) => props.onChange(decodeFilterOption(value))}
      >
        <SelectTrigger
          aria-label={props.label}
          className="border-white/10 bg-[#0d0e0b]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL_FILTER_OPTION}>All</SelectItem>
            {values.map((item) => (
              <SelectItem
                key={item.value}
                value={encodeFilterOption(item.value)}
              >
                {item.value} · {item.count}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function FacetCloud({
  title,
  values,
}: {
  title: string;
  values: Array<{ value: string; count: number }>;
}) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-[0.14em] text-[#aaa69a]">
        {title}
      </div>
      <div className="flex flex-wrap gap-1">
        {values.slice(0, 18).map((item) => (
          <Badge key={item.value} className="bg-white/8 text-[#d9d5c8]">
            {item.value}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function IconToggle(props: {
  active: boolean;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={props.label}
      onClick={props.onClick}
      className={cn("size-7 text-[#aaa69a]", props.active && "text-[#d1ff3c]")}
    >
      <Sparkles className="size-4" />
    </Button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[#aaa69a]">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

function Notice({
  children,
  role = "status",
}: {
  children: React.ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className="rounded-md border border-[#ffb657]/30 bg-[#ffb657]/10 p-3 text-sm text-[#ffcf8a]"
    >
      {children}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-sm text-[#aaa69a]">
      {label}
    </div>
  );
}

function CommandDialog(props: {
  open: boolean;
  onOpen: (open: boolean) => void;
  onView: (view: View) => void;
  onRefresh: () => Promise<void>;
  onExport: () => Promise<void>;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpen}>
      <DialogContent className="border-white/10 bg-[#151611] p-0 text-[#f8f6ee]">
        <DialogTitle className="sr-only">Command</DialogTitle>
        <DialogDescription className="sr-only">
          Navigate Promptbar or run a workbench action.
        </DialogDescription>
        <Command className="bg-transparent">
          <CommandInput placeholder="Command" />
          <CommandList>
            <CommandEmpty>No command found.</CommandEmpty>
            <CommandGroup heading="Navigation">
              {navItems.map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => {
                    props.onView(item.id);
                    props.onOpen(false);
                  }}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => {
                  props.onOpen(false);
                  void props.onRefresh();
                }}
              >
                <RefreshCw className="size-4" />
                Refresh index
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  props.onOpen(false);
                  void props.onExport();
                }}
              >
                <Download className="size-4" />
                Export context
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function SettingsSheet(props: {
  open: boolean;
  onOpen: (open: boolean) => void;
  settings: AppSettings | null;
  stats: CorpusStats | null;
}) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpen}>
      <SheetContent className="border-white/10 bg-[#151611] text-[#f8f6ee]">
        <SheetTitle className="text-[#f8f6ee]">Settings</SheetTitle>
        <div className="mt-6 space-y-4">
          <Panel>
            <PanelHeader icon={Settings} title="Runtime" />
            <dl className="space-y-3 text-sm">
              <Meta
                label="Key env"
                value={props.settings?.apiKeyEnv ?? "PROMPTBAR_OPENAI_API_KEY"}
              />
              <Meta label="Model" value={props.settings?.model ?? "unset"} />
              <Meta
                label="Embeddings"
                value={props.settings?.embeddingModel ?? "unset"}
              />
              <Meta label="DB" value={props.settings?.dbPath ?? "pending"} />
              <Meta
                label="State"
                value={
                  props.settings?.promptopsStateDir ??
                  props.settings?.corpusDir ??
                  "pending"
                }
              />
            </dl>
          </Panel>
          <Panel>
            <PanelHeader icon={ShieldCheck} title="Boundaries" />
            <StatusLine
              label="Repo-scoped API key"
              active={Boolean(props.settings?.apiEnabled)}
            />
            <StatusLine
              label="Codex available"
              active={Boolean(props.settings?.codexAvailable)}
            />
            <StatusLine
              label="Imported documents"
              active={Boolean(props.stats?.documents)}
            />
          </Panel>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function coverage(value = 0, total = 0): number {
  if (!total) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function writeSearchHistory(
  state: SearchUrlState,
  mode: Exclude<SearchHistoryMode, "none">,
) {
  const nextUrl = `${window.location.pathname}${serializeSearchUrl(state)}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) {
    return;
  }
  if (mode === "push") {
    window.history.pushState(null, "", nextUrl);
  } else {
    window.history.replaceState(null, "", nextUrl);
  }
}

function searchStateFromLocation(): SearchUrlState {
  return parseSearchUrl(window.location.search) ?? DEFAULT_SEARCH_URL_STATE;
}

function encodeFilterOption(value: string | null): string {
  return value === null ? ALL_FILTER_OPTION : `${FACET_FILTER_PREFIX}${value}`;
}

function decodeFilterOption(value: string): string | null {
  return value === ALL_FILTER_OPTION
    ? null
    : value.slice(FACET_FILTER_PREFIX.length);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}
