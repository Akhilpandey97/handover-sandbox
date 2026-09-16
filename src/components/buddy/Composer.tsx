import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUp, FileSpreadsheet, Loader2, Mic, MicOff, Paperclip, Square, X } from "lucide-react";
import { SPREADSHEET_ACCEPT, readSpreadsheet, sheetToCsv } from "@/lib/spreadsheet";
import { README_SHEET, isFilledRow } from "@/data/onboardingTemplate";
import { cn } from "@/lib/utils";
import { SLASH_COMMANDS } from "./commands";
import type { BuddyAttachment, Mention } from "./types";

export interface ComposerHandle {
  setText: (text: string, focus?: boolean) => void;
  focus: () => void;
}

interface Props {
  isLoading: boolean;
  canAct: boolean;
  projectName?: string | null;
  /** The project Buddy is opened on; its checklist items are taggable with @. */
  projectId?: string | null;
  mentionables: Mention[];
  /** Checklist items per project id, offered after that project is open or @-mentioned. */
  itemsByProject: Map<string, Mention[]>;
  listening: boolean;
  transcript: string;
  voiceSupported: boolean;
  onSend: (text: string, mentions: Mention[], attachments: BuddyAttachment[]) => void;
  onStop: () => void;
  onVoice: () => void;
  compact?: boolean;
}

/** The "@word" or "/word" being typed at the caret, or null. */
const tokenAt = (value: string, caret: number, sigil: "@" | "/") => {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf(sigil);
  if (at === -1) return null;
  if (sigil === "/" && at !== 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  const term = upto.slice(at + 1);
  if (/\s/.test(term)) return null;
  return { at, term };
};

/** Budget for attached sheets sent to Buddy, across all sheets in one message. */
const ATTACHMENT_CHARS = 60_000;
const MAX_SHEETS = 16;

const KIND_LABEL: Record<Mention["kind"], string> = { project: "Project", person: "Person", item: "Checklist" };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    isLoading,
    canAct,
    projectName,
    projectId,
    mentionables,
    itemsByProject,
    listening,
    transcript,
    voiceSupported,
    onSend,
    onStop,
    onVoice,
    compact,
  },
  ref,
) {
  const [value, setValue] = useState("");
  const [menu, setMenu] = useState<{ kind: "mention" | "command"; term: string } | null>(null);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chosen = useRef(new Map<string, Mention>());
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<BuddyAttachment[]>([]);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setFileError("");
    try {
      // Onboarding-sheet conventions: skip the instructions tab, example rows,
      // hint rows and rows left blank after their label, then any tab left empty.
      const sheets = (await readSpreadsheet(file))
        .filter((sheet) => sheet.name.trim().toLowerCase() !== README_SHEET.toLowerCase())
        .map((sheet) => ({
          ...sheet,
          rows: sheet.rows.filter((row) => isFilledRow(sheet.name, row)),
        }))
        .filter((sheet) => sheet.rows.length > 0)
        .slice(0, MAX_SHEETS);
      if (sheets.length === 0) throw new Error("Nothing is filled in yet. Add your values (example rows starting with “e.g.” are ignored) and attach it again.");
      const budget = Math.floor(ATTACHMENT_CHARS / sheets.length);
      setAttachments(
        sheets.map((sheet) => {
          const { csv, rowsIncluded } = sheetToCsv(sheet, budget);
          return { name: file.name, sheet: sheet.name, rows: sheet.rows.length, columns: sheet.headers, csv, rowsIncluded };
        }),
      );
      inputRef.current?.focus();
    } catch (err) {
      setFileError((err as Error).message);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const resize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const placeCaretAtEnd = (text: string) =>
    requestAnimationFrame(() => {
      resize();
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(text.length, text.length);
    });

  useImperativeHandle(ref, () => ({
    setText: (text, focus = true) => {
      setValue(text);
      if (focus) placeCaretAtEnd(text);
      else requestAnimationFrame(resize);
    },
    focus: () => inputRef.current?.focus(),
  }));

  const submit = (text = value) => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || isLoading || reading) return;
    const mentions = Array.from(chosen.current.values()).filter((m) => t.includes(`@${m.name}`));
    onSend(t, mentions, attachments);
    setAttachments([]);
    setFileError("");
    setValue("");
    setMenu(null);
    chosen.current.clear();
    requestAnimationFrame(resize);
  };

  const options = useMemo(() => {
    if (!menu) return [];
    const q = menu.term.toLowerCase();

    if (menu.kind === "command") {
      return SLASH_COMMANDS.filter((c) => (canAct || !c.acts) && c.command.startsWith(q)).map((c) => ({
        key: c.command,
        primary: `/${c.command}`,
        secondary: c.label,
        mono: true,
        apply: () => {
          const text = c.template.replace("{project}", projectName ? projectName : "@");
          if (c.sendNow) submit(text);
          else {
            setValue(text);
            placeCaretAtEnd(text);
          }
        },
      }));
    }

    // Checklist items of the open project, and of any project already tagged in this message.
    const projectIds = new Set<string>();
    if (projectId) projectIds.add(projectId);
    for (const m of chosen.current.values()) if (m.kind === "project" && value.includes(`@${m.name}`)) projectIds.add(m.id);
    const items = Array.from(projectIds).flatMap((id) => itemsByProject.get(id) || []);

    const match = (m: Mention) => !q || m.name.toLowerCase().includes(q);
    const pool = [
      ...mentionables.filter((m) => m.kind === "project" && match(m)).slice(0, 5),
      ...items.filter(match).slice(0, 8),
      ...mentionables.filter((m) => m.kind === "person" && match(m)).slice(0, 5),
    ];

    return pool.map((m) => ({
      key: `${m.kind}-${m.id}`,
      primary: m.name,
      secondary: `${KIND_LABEL[m.kind]}${m.sub ? ` · ${m.sub}` : ""}`,
      mono: false,
      apply: () => {
        const el = inputRef.current;
        const caret = el?.selectionStart ?? value.length;
        const token = tokenAt(value, caret, "@");
        if (!token) return;
        const next = `${value.slice(0, token.at)}@${m.name} ${value.slice(caret)}`;
        chosen.current.set(m.name, m);
        setValue(next);
        requestAnimationFrame(() => {
          const pos = token.at + m.name.length + 2;
          el?.focus();
          el?.setSelectionRange(pos, pos);
          resize();
        });
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, mentionables, itemsByProject, projectId, canAct, projectName, value]);

  const onChange = (next: string, caret: number) => {
    setValue(next);
    const cmd = tokenAt(next, caret, "/");
    const mention = cmd ? null : tokenAt(next, caret, "@");
    setMenu(cmd ? { kind: "command", term: cmd.term } : mention ? { kind: "mention", term: mention.term } : null);
    setIndex(0);
    resize();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && options.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => (i + 1) % options.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => (i - 1 + options.length) % options.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); options[index]?.apply(); setMenu(null); return; }
      if (e.key === "Escape") { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={cn("relative border-t border-border bg-card", compact ? "px-3 py-2.5" : "px-4 py-3")}>
      {menu && options.length > 0 && (
        <div role="listbox" className="absolute bottom-full left-3 right-3 z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          {options.map((o, i) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={i === index}
              onMouseDown={(e) => {
                e.preventDefault();
                o.apply();
                setMenu(null);
              }}
              onMouseEnter={() => setIndex(i)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm",
                i === index ? "bg-primary-soft text-foreground" : "hover:bg-muted",
              )}
            >
              <span className={cn("min-w-0 truncate font-medium", o.mono && "font-mono text-xs")}>{o.primary}</span>
              <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{o.secondary}</span>
            </button>
          ))}
        </div>
      )}

      {listening && (
        <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
          <span className="truncate">{transcript || "Listening…"}</span>
        </div>
      )}

      {(attachments.length > 0 || fileError) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          {attachments.map((a) => (
            <span key={a.sheet} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2 py-1 text-xs text-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">{attachments.length > 1 ? `${a.name} · ${a.sheet}` : a.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {a.rows} row{a.rows === 1 ? "" : "s"}{a.rowsIncluded < a.rows ? `, first ${a.rowsIncluded} sent` : ""}
              </span>
            </span>
          ))}
          {attachments.length > 0 && (
            <button type="button" onClick={() => setAttachments([])} aria-label="Remove attachment" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {fileError && <span className="text-xs text-destructive-strong">{fileError}</span>}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40">
        {canAct && (
          <>
            <input
              ref={fileRef}
              id={compact ? "buddy-drawer-file" : "buddy-page-file"}
              type="file"
              accept={SPREADSHEET_ACCEPT}
              className="hidden"
              onChange={(e) => void attach(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isLoading || reading}
              title="Attach an Excel or CSV file"
              aria-label="Attach an Excel or CSV file"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </button>
          </>
        )}
        <textarea
          id={compact ? "buddy-drawer-input" : "buddy-page-input"}
          ref={inputRef}
          value={value}
          rows={1}
          disabled={listening}
          aria-label="Message Buddy"
          placeholder={
            attachments.length
              ? "Say what this file is for, or just send it"
              : projectName
                ? `Ask about ${projectName}, or type / for commands`
                : "Ask Buddy, or type / for commands and @ to tag"
          }
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setMenu(null), 120)}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
        />
        {voiceSupported && (
          <button
            type="button"
            onClick={onVoice}
            disabled={isLoading}
            title={listening ? "Stop listening" : "Speak your message"}
            aria-label={listening ? "Stop listening" : "Speak your message"}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50",
              listening ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            aria-label="Stop"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90"
          >
            <Square className="h-3.5 w-3.5" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => submit()}
            disabled={!value.trim() && attachments.length === 0}
            title="Send"
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-1.5 hidden gap-3 px-1 text-2xs text-muted-foreground sm:flex">
        <span>/ commands</span>
        <span>@ projects, people and checklist items</span>
        <span>Shift + Enter for a new line</span>
        {canAct && <span>Attach Excel or CSV to set things up in bulk</span>}
      </p>
    </div>
  );
});
