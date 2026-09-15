import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { History, Plus, Volume2, VolumeX, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLabels } from "@/contexts/LabelsContext";
import { useProjects } from "@/contexts/ProjectContext";
import { tenantScope } from "@/lib/tenant-scope";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BuddyAvatar } from "./BuddyAvatar";
import { DailyBrief, ProjectSuggestions } from "./BuddyBrief";
import { Composer, type ComposerHandle } from "./Composer";
import { MessageView } from "./MessageView";
import { ThreadList } from "./ThreadList";
import { useBuddyChat } from "./useBuddyChat";
import { useVoice } from "./useVoice";
import { ACTION_ROLES, PORTFOLIO_ROLES, type BuddyPage, type Mention } from "./types";

interface Props {
  variant: "page" | "drawer";
  page: BuddyPage;
  onClose?: () => void;
}

interface Starter {
  label: string;
  prompt: string;
  acts?: boolean;
  /** Put in the composer to finish, rather than sending. */
  draft?: boolean;
}

export const BuddyChat = ({ variant, page, onClose }: Props) => {
  const { currentUser } = useAuth();
  const { projects } = useProjects();
  const { teamLabels } = useLabels();
  const navigate = useNavigate();
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [people, setPeople] = useState<Mention[]>([]);
  const drawer = variant === "drawer";

  const team = currentUser?.team || "";
  const canAct = ACTION_ROLES.has(team);
  const portfolio = PORTFOLIO_ROLES.has(team);

  const scoped = useMemo(
    () => (portfolio ? projects : projects.filter((p) => p.assignedOwner === currentUser?.id)).filter((p) => !p.archived),
    [projects, portfolio, currentUser?.id],
  );
  const pageProject = page.projectId ? projects.find((p) => p.id === page.projectId) : undefined;

  const voice = useVoice((text) => void chat.send(text));
  const chat = useBuddyChat({ page, onAnswer: (text) => voice.autoSpeak && voice.speak(text) });

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("profiles")
      .select("id, name, team")
      .eq("tenant_id", tenantScope(currentUser?.tenantId))
      .order("name")
      .then(({ data }) => {
        if (cancelled) return;
        setPeople(((data || []) as { id: string; name: string; team: string }[]).map((p) => ({
          kind: "person" as const,
          id: p.id,
          name: p.name,
          sub: teamLabels[p.team] || p.team,
        })));
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.tenantId, teamLabels]);

  const mentionables = useMemo<Mention[]>(
    () => [...scoped.map((p) => ({ kind: "project" as const, id: p.id, name: p.merchantName, sub: p.mid })), ...people],
    [scoped, people],
  );

  // Checklist items per project, for tagging with @ once a project is open or mentioned.
  const itemsByProject = useMemo(() => {
    const map = new Map<string, Mention[]>();
    for (const p of pageProject && !scoped.includes(pageProject) ? [...scoped, pageProject] : scoped) {
      map.set(
        p.id,
        (p.checklist || []).map((c) => ({ kind: "item" as const, id: c.id, name: c.title, sub: p.merchantName })),
      );
    }
    return map;
  }, [scoped, pageProject]);

  // Keep the newest message in view while an answer streams in.
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, last?.content, last?.actions?.length, last?.steps?.length]);

  const starters: { ask: Starter[]; act: Starter[] } = pageProject
    ? {
        ask: [
          { label: "Why is this slipping?", prompt: "Why is this project slipping, and what should I do today?" },
          { label: "Summarise this project", prompt: "Summarise this project." },
          { label: "What's overdue here?", prompt: "What's overdue on this project, and who holds each item?" },
        ],
        act: [
          { label: "Assign an owner", prompt: `Assign ${pageProject.merchantName} to @`, acts: true, draft: true },
          { label: "Change the state", prompt: `Change the state of ${pageProject.merchantName} to `, acts: true, draft: true },
          { label: "Add a note", prompt: `Add a note to ${pageProject.merchantName}: `, acts: true, draft: true },
        ],
      }
    : {
        ask: [
          { label: "What needs my attention today?", prompt: "What needs my attention today across my projects?" },
          { label: "Projects at risk", prompt: "Which projects are at risk and why?" },
          { label: "Go-lives in the next 30 days", prompt: "Which projects are expected to go live in the next 30 days, and are any at risk?" },
        ],
        act: [
          { label: "Assign an owner", prompt: "Assign @ to @", acts: true, draft: true },
          { label: "Put a project on hold", prompt: "Put @ on hold because ", acts: true, draft: true },
          { label: "Create a project", prompt: "Create a project for ", acts: true, draft: true },
        ],
      };

  const runStarter = (s: Starter) => (s.draft ? composerRef.current?.setText(s.prompt) : void chat.send(s.prompt));

  const scopeLabel = pageProject
    ? pageProject.merchantName
    : portfolio
      ? `All ${scoped.length} projects`
      : `Your ${scoped.length} assigned project${scoped.length === 1 ? "" : "s"}`;

  const lastAnswer = [...chat.messages].reverse().find((m) => m.role === "assistant" && !m.streaming);
  const mentionedInThread = useMemo(() => {
    const names = new Set<string>();
    const out: Mention[] = [];
    for (const m of chat.messages) {
      for (const s of m.sources || []) {
        if (s.kind === "project" && s.id && !names.has(s.id)) {
          names.add(s.id);
          out.push({ kind: "project", id: s.id, name: s.label });
        }
      }
    }
    return out.slice(0, 8);
  }, [chat.messages]);

  const empty = chat.historyLoaded && chat.messages.length === 0;

  const threadList = (
    <ThreadList
      threads={chat.threads}
      pins={chat.pins}
      activeId={chat.conversationId}
      onOpen={(id) => void chat.openThread(id)}
      onNew={chat.startNewChat}
      onDelete={chat.deleteThread}
      onTogglePin={chat.togglePin}
    />
  );

  const conversation = (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className={cn("flex shrink-0 items-center justify-between gap-2 border-b border-border", drawer ? "px-3 py-2" : "px-5 py-3")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <BuddyAvatar size={drawer ? 24 : 28} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Buddy</p>
            {!drawer && <p className="truncate text-2xs text-muted-foreground">{chat.isLoading ? "Working…" : `Looking at ${scopeLabel.toLowerCase().startsWith("all") || scopeLabel.startsWith("Your") ? scopeLabel.toLowerCase() : scopeLabel}`}</p>}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {drawer && <kbd className="mr-1 hidden rounded border border-b-2 border-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground sm:inline">⌘J</kbd>}
          <HeaderButton label={voice.autoSpeak ? "Stop reading answers aloud" : "Read answers aloud"} onClick={() => voice.setAutoSpeak(!voice.autoSpeak)}>
            {voice.autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </HeaderButton>
          {drawer && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" title="Chat history" aria-label="Chat history" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <History className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="flex h-96 w-72 flex-col p-0">
                  {threadList}
                </PopoverContent>
              </Popover>
              <HeaderButton label="New chat" onClick={chat.startNewChat}>
                <Plus className="h-4 w-4" />
              </HeaderButton>
              {onClose && (
                <HeaderButton label="Close Buddy" onClick={onClose}>
                  <X className="h-4 w-4" />
                </HeaderButton>
              )}
            </>
          )}
        </div>
      </div>

      {drawer && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-1.5 text-2xs text-muted-foreground">
          <span>Looking at</span>
          {pageProject ? (
            <button
              type="button"
              onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: pageProject.id } })}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {pageProject.merchantName}
            </button>
          ) : (
            <span className="font-medium text-foreground">{scopeLabel}</span>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background">
        <div className={cn("mx-auto w-full space-y-5", drawer ? "px-3 py-4" : "max-w-3xl px-5 py-6")}>
          {empty && (
            <div className="space-y-5 py-2">
              <div>
                <p className="heading-section text-foreground">{pageProject ? `About ${pageProject.merchantName}` : `Hi ${currentUser?.name?.split(" ")[0] || "there"}`}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pageProject
                    ? "Ask about this project, or tell Buddy what to change. You'll approve every change first."
                    : canAct
                      ? "Ask about your projects, or tell Buddy what to change. You'll approve every change first."
                      : "Ask about your projects, checklists, risks and next steps."}
                </p>
              </div>
              {pageProject ? (
                <ProjectSuggestions projectId={pageProject.id} onPick={(prompt, draft) => runStarter({ label: prompt, prompt, draft })} />
              ) : (
                <DailyBrief onPick={(prompt, draft) => runStarter({ label: prompt, prompt, draft })} />
              )}
              <StarterGroup title="Ask" items={starters.ask} onPick={runStarter} />
              {canAct && <StarterGroup title="Do" items={starters.act} onPick={runStarter} />}
            </div>
          )}
          {chat.messages.map((m, i) => (
            <MessageView
              key={m.id}
              message={m}
              compact={drawer}
              isLast={i === chat.messages.length - 1}
              onRetry={() => chat.retry(m.id)}
              onFeedback={(v) => chat.setFeedback(m.id, v)}
              onApprove={(callId, o) => void chat.approve(m.id, callId, o)}
              onCancel={(callId) => chat.cancel(m.id, callId)}
              onUndo={(callId) => void chat.undo(m.id, callId)}
            />
          ))}
        </div>
      </div>

      <Composer
        ref={composerRef}
        compact={drawer}
        isLoading={chat.isLoading}
        canAct={canAct}
        projectName={pageProject?.merchantName}
        projectId={pageProject?.id}
        mentionables={mentionables}
        itemsByProject={itemsByProject}
        listening={voice.listening}
        transcript={voice.transcript}
        voiceSupported={voice.supported}
        onSend={(text, mentions) => void chat.send(text, mentions)}
        onStop={chat.stop}
        onVoice={voice.listening ? voice.stop : voice.start}
      />
    </div>
  );

  if (drawer) return <div className="flex h-full min-h-0 flex-col bg-card">{conversation}</div>;

  return (
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_260px]">
      <aside className="hidden min-h-0 flex-col border-r border-border bg-muted/30 md:flex">{threadList}</aside>
      {conversation}
      <aside className="hidden min-h-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-4 xl:flex">
        <section className="space-y-2">
          <p className="eyebrow">Scope</p>
          <p className="text-sm text-foreground">{portfolio ? `All ${scoped.length} projects in this workspace` : `Your ${scoped.length} assigned projects`}</p>
          <p className="text-xs text-muted-foreground">{canAct ? "Buddy can propose changes. You approve each one." : "Buddy can answer questions. Changes need a manager or admin."}</p>
        </section>
        <section className="space-y-2">
          <p className="eyebrow">In this chat</p>
          {mentionedInThread.length ? (
            <div className="flex flex-wrap gap-1.5">
              {mentionedInThread.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => navigate({ to: "/projects/$projectId", params: { projectId: m.id } })}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {m.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Projects Buddy reads show up here.</p>
          )}
        </section>
        <section className="space-y-2">
          <p className="eyebrow">Last answer used</p>
          {lastAnswer?.steps?.length ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {lastAnswer.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing yet.</p>
          )}
        </section>
      </aside>
    </div>
  );
};

const HeaderButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    {children}
  </button>
);

const StarterGroup = ({ title, items, onPick }: { title: string; items: Starter[]; onPick: (s: Starter) => void }) => (
  <div className="space-y-2">
    <p className="eyebrow">{title}</p>
    <div className="flex flex-wrap gap-2">
      {items.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onPick(s)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft"
        >
          {s.label}
        </button>
      ))}
    </div>
  </div>
);
