import { ACTION_TOOL_DEFS as CORE_ACTION_TOOL_DEFS, getAction as getCoreAction } from "@/lib/buddy/actions.server";
import { MORE_ACTIONS, MORE_ACTION_TOOL_DEFS } from "@/lib/buddy/more-actions.server";
import { SETUP_ACTIONS, SETUP_ACTION_TOOL_DEFS } from "@/lib/buddy/setup-actions.server";

/**
 * Every action Buddy can take, in one place.
 *
 * Imported by name on purpose. package.json marks modules side-effect free, so
 * a bare `import "./more-actions.server"` that registered actions as a side
 * effect was dropped from production bundles: the chat route then offered only
 * the core actions, and the model invented tool names for the rest.
 */
export const ALL_ACTION_TOOL_DEFS: any[] = [...CORE_ACTION_TOOL_DEFS, ...MORE_ACTION_TOOL_DEFS, ...SETUP_ACTION_TOOL_DEFS];

export const getAnyAction = (name: string) => SETUP_ACTIONS[name] || MORE_ACTIONS[name] || getCoreAction(name);

/** The lowest role that may run an action: managers unless the action says admin. */
export const actionRequires = (name: string): "manager" | "admin" => getAnyAction(name)?.requires || "manager";
