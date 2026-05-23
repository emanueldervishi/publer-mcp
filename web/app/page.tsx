"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Workspace = {
  id: string;
  name: string;
  plan?: string;
  picture?: string;
  role?: string;
};

type ToolEvent = {
  kind: "call" | "result" | "error";
  name: string;
  args?: Record<string, unknown>;
  data?: unknown;
  error?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  tools?: ToolEvent[];
};

type StreamEvent =
  | { type: "thinking"; iteration: number }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; data: unknown }
  | { type: "tool_error"; name: string; error: string }
  | { type: "text"; content: string }
  | { type: "error"; error: string }
  | { type: "done" };

const SELECTED_WORKSPACE_KEY = "publerPilot.selectedWorkspaceId";

const STARTER_PROMPTS = [
  {
    eyebrow: "CreativeOps",
    title: "Build a full campaign",
    body: "Create a 3-post campaign for our AI-powered Publer MCP assistant. Draft only. Include teaser, value, and CTA."
  },
  {
    eyebrow: "Analytics",
    title: "Find best timing",
    body: "Pull campaign context for the next 7 days — accounts, scheduled posts, analytics availability, and best-time slots."
  },
  {
    eyebrow: "Operations",
    title: "Audit my workspace",
    body: "Give me a social manager overview: accessible accounts, scheduled posts, failed posts, analytics, and next actions."
  },
  {
    eyebrow: "Media",
    title: "Create visual post",
    body: "Create a Facebook photo draft from this image URL and write a bold caption for our hackathon demo."
  }
];

const CAPABILITY_PILLS = [
  "Campaign planning",
  "Media drafts",
  "Best-time scheduling",
  "Safe publishing",
  "Post verification",
  "Analytics"
];

export default function Page() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_WORKSPACE_KEY) : null;
    if (stored) setSelectedWorkspaceId(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/workspaces", { cache: "no-store" });
        const json = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setWorkspaceError(json.error ?? "Failed to load workspaces");
        } else {
          const list: Workspace[] = json.workspaces ?? [];
          setWorkspaces(list);

          const stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_WORKSPACE_KEY) : null;
          const storedExists = stored && list.some((w) => w.id === stored);

          if (storedExists) {
            setSelectedWorkspaceId(stored);
          } else if (list.length === 1) {
            selectWorkspace(list[0].id);
          }
        }
      } catch (error) {
        if (!cancelled) setWorkspaceError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamStatus]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
  }, [input]);

  function selectWorkspace(id: string) {
    setSelectedWorkspaceId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(SELECTED_WORKSPACE_KEY, id);
  }

  async function sendMessage(rawText?: string) {
    const trimmed = (rawText ?? input).trim();
    if (!trimmed || sending) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const assistantMessage: Message = { role: "assistant", content: "", tools: [] };
    const nextMessages = [...messages, userMessage];

    setMessages([...nextMessages, assistantMessage]);
    setInput("");
    setSending(true);
    setStreamStatus("Thinking");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          workspaceId: selectedWorkspaceId ?? undefined
        })
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;

          const json = line.slice(5).trim();
          if (!json) continue;

          try {
            applyEvent(JSON.parse(json) as StreamEvent);
          } catch {
            // ignore malformed streaming chunks
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") {
          last.content = (last.content + `\n\n${message}`).trim();
        }
        return copy;
      });
    } finally {
      setSending(false);
      setStreamStatus(null);
    }
  }

  function applyEvent(event: StreamEvent) {
    if (event.type === "thinking") {
      setStreamStatus(event.iteration === 0 ? "Thinking" : `Reasoning · step ${event.iteration + 1}`);
      return;
    }

    if (event.type === "tool_call") {
      setStreamStatus(`Calling ${event.name}`);
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          last.tools = [...(last.tools ?? []), { kind: "call", name: event.name, args: event.args }];
        }
        return copy;
      });
      return;
    }

    if (event.type === "tool_result") {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          last.tools = [...(last.tools ?? []), { kind: "result", name: event.name, data: event.data }];
        }
        return copy;
      });
      return;
    }

    if (event.type === "tool_error") {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          last.tools = [...(last.tools ?? []), { kind: "error", name: event.name, error: event.error }];
        }
        return copy;
      });
      return;
    }

    if (event.type === "text") {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          last.content = last.content ? `${last.content}\n\n${event.content}` : event.content;
        }
        return copy;
      });
      setStreamStatus(null);
      return;
    }

    if (event.type === "error") {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          last.content = (last.content + `\n\n${event.error}`).trim();
        }
        return copy;
      });
      setStreamStatus(null);
      return;
    }

    if (event.type === "done") setStreamStatus(null);
  }

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedWorkspaceId) ?? null,
    [workspaces, selectedWorkspaceId]
  );

  const canSend = !sending && input.trim().length > 0 && !!selectedWorkspaceId;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#05060a] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-40 h-96 w-96 rounded-full bg-indigo-500/20 blur-[110px]" />
        <div className="absolute -right-24 top-24 h-[32rem] w-[32rem] rounded-full bg-fuchsia-500/10 blur-[130px]" />
        <div className="absolute bottom-[-14rem] left-1/3 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.055),transparent_35%),linear-gradient(to_bottom,rgba(255,255,255,0.035),transparent_22%)]" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <div className="relative flex h-full">
        <Sidebar
          workspaces={workspaces}
          loading={workspaceLoading}
          error={workspaceError}
          selectedId={selectedWorkspaceId}
          onSelect={selectWorkspace}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar selectedWorkspace={selectedWorkspace} streamStatus={streamStatus} />

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-8">
            {messages.length === 0 ? (
              <EmptyState selectedWorkspace={selectedWorkspace} onPickPrompt={(p) => sendMessage(p)} />
            ) : (
              <div className="mx-auto w-full max-w-4xl space-y-8 py-10">
                {messages.map((m, idx) => (
                  <MessageView key={idx} message={m} />
                ))}
                {streamStatus && messages.length > 0 ? <ThinkingIndicator label={streamStatus} /> : null}
              </div>
            )}
          </div>

          <Composer
            input={input}
            setInput={setInput}
            onSend={() => sendMessage()}
            disabled={sending || !selectedWorkspaceId}
            canSend={canSend}
            placeholder={
              selectedWorkspace
                ? `Ask Publer Pilot to plan, draft, schedule, verify · ${selectedWorkspace.name}`
                : "Pick a workspace from the sidebar to start"
            }
            textareaRef={textareaRef}
          />
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  workspaces,
  loading,
  error,
  selectedId,
  onSelect
}: {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="hidden w-[310px] shrink-0 border-r border-white/10 bg-white/[0.035] shadow-2xl shadow-black/40 backdrop-blur-2xl lg:flex lg:flex-col">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3 shadow-xl shadow-black/20">
          <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-300 via-violet-400 to-fuchsia-400 shadow-[0_0_35px_-8px_rgba(168,85,247,0.75)]">
            <Sparkle />
            <div className="absolute inset-0 ring-1 ring-inset ring-white/30" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">Publer Pilot</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">
              CreativeOps Agent
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            Workspaces
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/45">
            {workspaces.length || "—"}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <SidebarSkeleton />
        ) : error ? (
          <div className="mx-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs leading-relaxed text-rose-100">
            {error}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="px-4 py-6 text-sm text-white/40">No workspaces found.</div>
        ) : (
          <ul className="space-y-1.5">
            {workspaces.map((ws) => {
              const active = ws.id === selectedId;
              return (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(ws.id)}
                    className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200 ${
                      active
                        ? "bg-white/[0.09] shadow-lg shadow-indigo-950/20 ring-1 ring-inset ring-indigo-300/30"
                        : "hover:bg-white/[0.055] hover:ring-1 hover:ring-inset hover:ring-white/10"
                    }`}
                  >
                    <Avatar name={ws.name} src={ws.picture} active={active} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[13.5px] font-semibold ${active ? "text-white" : "text-white/80"}`}>
                        {ws.name}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-white/35">
                        {ws.plan ?? ws.role ?? "workspace"}
                      </div>
                    </div>
                    {active ? (
                      <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_3px_rgba(110,231,183,0.35)]" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-white/10 p-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white/85">
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_3px_rgba(110,231,183,0.35)]" />
            MCP connected
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-white/45">
            <StatusChip label="Drafts" />
            <StatusChip label="Media" />
            <StatusChip label="Analytics" />
            <StatusChip label="Campaigns" />
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-1.5">
      {label}
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <ul className="space-y-2 px-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-2xl px-3 py-3">
          <div className="h-10 w-10 animate-pulse rounded-2xl bg-white/[0.06]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Avatar({ name, src, active }: { name: string; src?: string; active: boolean }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-10 w-10 rounded-2xl object-cover ring-1 ring-white/15" />;
  }

  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-2xl text-[12px] font-bold tracking-wide ${
        active
          ? "bg-gradient-to-br from-indigo-400/35 to-fuchsia-400/25 text-white ring-1 ring-inset ring-indigo-200/30"
          : "bg-white/[0.06] text-white/55 ring-1 ring-inset ring-white/[0.08]"
      }`}
    >
      {initials || "P"}
    </div>
  );
}

function TopBar({
  selectedWorkspace,
  streamStatus
}: {
  selectedWorkspace: Workspace | null;
  streamStatus: string | null;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#05060a]/65 px-4 py-3.5 backdrop-blur-2xl sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.055] shadow-lg shadow-black/20">
            <OrbitIcon />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
              Current workspace
            </div>
            <div className="truncate text-[15px] font-semibold tracking-tight text-white">
              {selectedWorkspace ? selectedWorkspace.name : "Select a workspace"}
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {CAPABILITY_PILLS.slice(0, 4).map((pill) => (
            <span
              key={pill}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-white/50"
            >
              {pill}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {streamStatus ? (
            <div className="flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1.5 text-[11.5px] font-medium text-indigo-100">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-300 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-300" />
              </span>
              {streamStatus}
            </div>
          ) : (
            <div className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] text-white/35">
              Ready
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function EmptyState({
  selectedWorkspace,
  onPickPrompt
}: {
  selectedWorkspace: Workspace | null;
  onPickPrompt: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col items-center justify-center py-10 text-center">
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45 shadow-xl shadow-black/20">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_14px_3px_rgba(110,231,183,0.35)]" />
        Publer CreativeOps Agent
      </div>

      <h1 className="max-w-4xl bg-gradient-to-b from-white via-white to-white/35 bg-clip-text text-[44px] font-semibold leading-[0.96] tracking-[-0.05em] text-transparent sm:text-[68px]">
        Run a full social campaign from one sentence.
      </h1>

      <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-white/52">
        {selectedWorkspace
          ? `You are working in ${selectedWorkspace.name}. Ask the agent to plan campaigns, save ideas, create media drafts, schedule posts, read analytics, and verify the result.`
          : "Pick a workspace to activate the agent. Then turn one prompt into drafts, media posts, scheduling, analytics, and verification."}
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {CAPABILITY_PILLS.map((pill) => (
          <span
            key={pill}
            className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[12px] font-medium text-white/50"
          >
            {pill}
          </span>
        ))}
      </div>

      <div className="mt-12 grid w-full grid-cols-1 gap-3 text-left md:grid-cols-2">
        {STARTER_PROMPTS.map((p) => (
          <button
            key={p.title}
            type="button"
            disabled={!selectedWorkspace}
            onClick={() => onPickPrompt(p.body)}
            className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-left shadow-2xl shadow-black/20 transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-indigo-400/10 blur-2xl transition group-hover:bg-fuchsia-400/10" />
            <div className="relative">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-200/60">
                {p.eyebrow}
              </div>
              <div className="text-[15px] font-semibold tracking-tight text-white">{p.title}</div>
              <div className="mt-2 text-[13px] leading-relaxed text-white/48">{p.body}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageView({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-[26px] rounded-tr-lg border border-indigo-300/20 bg-gradient-to-br from-indigo-400/20 via-violet-400/12 to-fuchsia-400/10 px-5 py-3.5 text-[14.5px] leading-relaxed text-white shadow-2xl shadow-indigo-950/25">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      <div className="mt-1 hidden h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.055] sm:flex">
        <SparkleSmall />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {(message.tools ?? []).map((tool, idx) => (
          <ToolCard key={idx} tool={tool} />
        ))}
        {message.content ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.035] px-5 py-4 text-[14.5px] leading-relaxed text-white/82 shadow-2xl shadow-black/20">
            {renderInline(message.content)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const lines = text.split("\n");

  return lines.map((line, lineIdx) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    const cleaned = bullet ? line.replace(/^\s*[-*]\s+/, "") : line;
    const parts: React.ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(cleaned))) {
      if (match.index > lastIndex) parts.push(cleaned.slice(lastIndex, match.index));
      const token = match[0];

      if (token.startsWith("**")) {
        parts.push(
          <strong key={`b-${lineIdx}-${match.index}`} className="font-semibold text-white">
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith("`")) {
        parts.push(
          <code
            key={`c-${lineIdx}-${match.index}`}
            className="rounded-lg border border-white/10 bg-black/30 px-1.5 py-0.5 text-[12.5px] text-indigo-100"
          >
            {token.slice(1, -1)}
          </code>
        );
      } else {
        parts.push(
          <em key={`i-${lineIdx}-${match.index}`} className="italic text-white/85">
            {token.slice(1, -1)}
          </em>
        );
      }

      lastIndex = match.index + token.length;
    }

    if (lastIndex < cleaned.length) parts.push(cleaned.slice(lastIndex));

    if (bullet) {
      return (
        <div key={lineIdx} className="flex gap-2.5">
          <span className="mt-2 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-300/80" />
          <div className="flex-1">{parts}</div>
        </div>
      );
    }

    return (
      <div key={lineIdx} className={line.length === 0 ? "h-2" : ""}>
        {parts}
      </div>
    );
  });
}

function ToolCard({ tool }: { tool: ToolEvent }) {
  const config =
    tool.kind === "error"
      ? {
          label: "error",
          ring: "border-rose-300/20 bg-rose-500/10",
          badge: "bg-rose-400/10 text-rose-100 ring-rose-300/20",
          dot: "bg-rose-300"
        }
      : tool.kind === "result"
        ? {
            label: "result",
            ring: "border-emerald-300/20 bg-emerald-500/10",
            badge: "bg-emerald-400/10 text-emerald-100 ring-emerald-300/20",
            dot: "bg-emerald-300"
          }
        : {
            label: "calling",
            ring: "border-indigo-300/20 bg-indigo-500/10",
            badge: "bg-indigo-400/10 text-indigo-100 ring-indigo-300/20",
            dot: "bg-indigo-300"
          };

  return (
    <details className={`group overflow-hidden rounded-2xl border ${config.ring} shadow-xl shadow-black/15`}>
      <summary className="flex cursor-pointer select-none items-center gap-2.5 px-4 py-3">
        <span className={`h-2 w-2 rounded-full ${config.dot} shadow-[0_0_14px_2px_rgba(255,255,255,0.15)]`} />
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ring-1 ring-inset ${config.badge}`}
        >
          {config.label}
        </span>
        <span className="truncate font-mono text-[12px] text-white/80">{tool.name}</span>
        <span className="ml-auto text-[11px] text-white/35 transition group-open:rotate-180">⌄</span>
      </summary>

      <pre className="mx-4 mb-4 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-[11.5px] leading-relaxed text-white/62">
        {tool.kind === "call"
          ? JSON.stringify(tool.args ?? {}, null, 2)
          : tool.kind === "result"
            ? JSON.stringify(tool.data, null, 2)
            : tool.error ?? "(unknown error)"}
      </pre>
    </details>
  );
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pl-1 text-[13px] text-white/55">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-300 opacity-70" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-300" />
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function Composer({
  input,
  setInput,
  onSend,
  disabled,
  canSend,
  placeholder,
  textareaRef
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  canSend: boolean;
  placeholder: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="border-t border-white/10 bg-[#05060a]/70 px-4 py-4 backdrop-blur-2xl sm:px-8 sm:py-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="mx-auto w-full max-w-4xl"
      >
        <div className="rounded-[30px] border border-white/10 bg-white/[0.045] p-2 shadow-2xl shadow-black/30 transition focus-within:border-indigo-300/35 focus-within:bg-white/[0.06]">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              placeholder={placeholder}
              disabled={disabled}
              className="max-h-[220px] flex-1 resize-none bg-transparent px-4 py-3 text-[14.5px] leading-relaxed text-white outline-none placeholder:text-white/32 disabled:cursor-not-allowed disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={!canSend}
              className={`mb-1 mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all ${
                canSend
                  ? "bg-white text-black shadow-[0_0_30px_-8px_rgba(255,255,255,0.9)] hover:scale-[1.03] active:scale-[0.97]"
                  : "bg-white/[0.06] text-white/25"
              }`}
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-center gap-2 text-[10.5px] text-white/28">
          <span>Enter to send</span>
          <span>·</span>
          <span>Shift + Enter for newline</span>
          <span>·</span>
          <span>Safe publish requires confirmation</span>
        </div>
      </form>
    </div>
  );
}

function Sparkle() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2.75l2.12 5.43 5.63 1.36-4.55 3.54 1.35 5.67L12 15.72 7.45 18.75l1.35-5.67-4.55-3.54 5.63-1.36L12 2.75z"
        fill="white"
        fillOpacity="0.94"
      />
    </svg>
  );
}

function SparkleSmall() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l2.09 5.26L19.5 9.5l-4.5 3.42L16.18 19 12 16.05 7.82 19l1.18-6.08L4.5 9.5l5.41-1.24L12 3z"
        fill="url(#smallSparkleGradient)"
      />
      <defs>
        <linearGradient id="smallSparkleGradient" x1="0" x2="24" y1="0" y2="24">
          <stop offset="0%" stopColor="#c7d2fe" />
          <stop offset="100%" stopColor="#f5d0fe" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function OrbitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" fill="#c7d2fe" />
      <path
        d="M4 12c2.2-5.6 13.8-5.6 16 0-2.2 5.6-13.8 5.6-16 0Z"
        stroke="#c4b5fd"
        strokeWidth="1.6"
      />
      <path
        d="M12 4c5.6 2.2 5.6 13.8 0 16-5.6-2.2-5.6-13.8 0-16Z"
        stroke="#f0abfc"
        strokeWidth="1.2"
        opacity="0.65"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l14-7-5 19-3-8-6-4z" />
    </svg>
  );
}