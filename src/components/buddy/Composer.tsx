import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ArrowUp, Mic, MicOff, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLASH_COMMANDS } from "./commands";
import type { Mention } from "./types";

export interface ComposerHandle {
  setText: (text: string, focus?: boolean) => void;
  focus: () => void;
}

interface Props {
  isLoading: boolean;
  canAct: boolean;
  projectName?: string | null;
  mentionables: Mention[];
  listening: boolean;
  transcript: string;
  voiceSupported: boolean;
  onSend: (text: string, mentions: Mention[]) => void;
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

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { isLoading, canAct, projectName, mentionables, listening, transcript, voiceSupported, onSend, onStop, onVoice, compact },
  ref,
) {
  const [value, setValue] = useState("");
  const [menu, setMenu] = useState<{ kind: "mention" | "command"; term: string } | null>(null);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chosen = useRef(new Map<string, Mention>());

  const resize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  useImperativeHandle(ref, () => ({
    setText: (text, focus = true) => {
      setValue(text);
      requestAnimationFrame(() => {
        resize();
        if (focus) {
          inputRef.current?.focus();
          inputRef.current?.setSelectionRange(text.length, text.length);
        }
      });
    },
    focus: () => inputRef.current?.focus(),
  }));

  const options = useMemo(() => {
    if (!menu) return [];
    const q = menu.term.toLowerCase();
    if (menu.kind === "command") {
      return SLASH_COMMANDS.filter((c) => (canAct || !c.acts) && c.command.startsWith(q)).map((c) => ({
        key: c.command,
        primary: `/${c.command}`,
        secondary: c.label,
        apply: () => {
          const text = c.template.replace("{project}", projectName ? projectName : "@");
          if (c.sendNow) {
            submit(text);
          } else {
            setValue(text);
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              inputRef.current?.setSelectionRange(text.length, text.length);
              resize();
            });
          }
        },
      }));
    }
    return mentionables
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((m) => ({
        key: `${m.kind}-${m.id}`,
        primary: m.name,
        secondary: m.kind === "project" ? `Project${m.sub ? ` · ${m.sub}` : ""}` : `Person${m.sub ? ` · ${m.sub}` : ""}`,
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
          });
        },
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, mentionables, canAct, projectName, value]);

  const submit = (text = value) => {
    const t = text.trim();
    if (!t || isLoading) return;
    const mentions = Array.from(chosen.current.values()).filter((m) => t.includes(`@${m.name}`));
    onSend(t, mentions);
    setValue("");
    setMenu(null);
    chosen.current.clear();
    requestAnimationFrame(resize);
  };

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
        <div role="listbox" className="absolute bottom-full left-3 right-3 z-20 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
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
              <span className={cn("truncate font-medium", menu.kind === "command" && "font-mono text-xs")}>{o.primary}</span>
              <span className="shrink-0 truncate text-xs text-muted-foreground">{o.secondary}</span>
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

      <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40">
        <textarea
          id={compact ? "buddy-drawer-input" : "buddy-page-input"}
          ref={inputRef}
          value={value}
          rows={1}
          disabled={listening}
          aria-label="Message Buddy"
          placeholder={projectName ? `Ask about ${projectName}, or type / for commands` : "Ask Buddy, or type / for commands and @ to mention"}
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
            disabled={!value.trim()}
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
        <span>@ mention</span>
        <span>Shift + Enter for a new line</span>
      </p>
    </div>
  );
});
