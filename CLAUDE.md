# Handover Sandbox

> **Always read this file first before doing anything in this repo.**

## Stack

- TypeScript + React (TanStack Router, TanStack Query)
- Vite dev server
- Supabase backend (Postgres, Edge Functions)
- Radix UI + Tailwind CSS
- Deployed on Railway (manual deploy via `railway up`)

## Code Generation Rules

1. **Search before writing.** Before creating a new utility, component, hook, or helper, grep `src/` for existing solutions. This codebase is 59K+ lines — duplication is the biggest risk.
2. **Use installed deps first.** Check `package.json` before adding a new dependency. Prefer what's already installed.
3. **Disclose gaps.** When completing a task, note anything skipped, not checked, or left as a known shortcut.
4. **Mark conscious shortcuts.** When taking a deliberate shortcut, add a `// DEBT: <reason>` comment so it's greppable later.
5. **Read full props before wiring.** When reusing an existing component in a new call site, read its complete props interface before calling it done. Optional props that feed dropdowns, assignees, or lookups (e.g. `profiles`) fail silently with empty UI — always check and pass them.
6. **"All places X appears" means enumerate first.** For any task that says "add Y to every place X is rendered": run two greps — (a) every file that renders the data type, (b) every file that already has the action — then diff the lists and name every location out loud before writing code. Never search only for files that already have the action; that misses components with no prior actions.
7. **Rename/remove means grep all files first.** Before renaming or removing any string (label, field name, constant), run a codebase-wide grep across `src/` — not just the file you're editing. The same string often appears in route definitions, nav configs, dashboard panels, and comments in unrelated files.
8. **"Make X configurable" means audit the full block.** When replacing a hardcoded value, scan the entire component for other hardcoded brand/product-specific strings (URLs, names, defaults) in the same pass. At the end of the task, explicitly disclose anything still hardcoded that probably shouldn't be.
9. **Use codebase nomenclature.** Never invent business labels, state names, or category names. Use the exact strings from the codebase (`ProjectState`, enum values, `projectStateLabels`, etc.). If a human-readable label is needed, derive it from the existing label map — do not coin one.

## Deploy

- Pushing to `main` does NOT auto-deploy. Run `railway up` and verify production.
- Before re-editing a UI fix that "doesn't work," confirm which origin/bundle the user is actually viewing (localhost vs Railway).

## Security

- When investigating data leaks (email, Slack, webhook), read every send call end-to-end (`bcc`, `cc`, `to` literals). Don't stop at the config layer.
- Search patterns: `bcc`, `@.*\.slack\.com`, hardcoded email strings, `to:\s*\[`.

## Testing

- No test framework is configured yet. When one is added, test risky logic (branches, parsers, security, money handling) and skip trivial code.
