/** Slash commands: a quick way to start a common request without typing it out. */
export interface SlashCommand {
  command: string;
  label: string;
  /** Text placed in the composer. "{project}" becomes the open project's name, or "@". */
  template: string;
  /** Changes data, so only offered to roles that can act. */
  acts?: boolean;
  /** Sends immediately instead of waiting for the rest of the sentence. */
  sendNow?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: "summary", label: "Summarise a project", template: "Summarise {project}", sendNow: false },
  { command: "overdue", label: "What's overdue on my projects", template: "What's overdue on my projects, and who holds each item?", sendNow: true },
  { command: "risks", label: "Projects at risk and why", template: "Which projects are at risk and why?", sendNow: true },
  { command: "assign", label: "Assign an owner", template: "Assign {project} to @", acts: true },
  { command: "state", label: "Change a project's state", template: "Change the state of {project} to ", acts: true },
  { command: "note", label: "Add a note to a project", template: "Add a note to {project}: ", acts: true },
];
