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
  { command: "brief", label: "What needs my attention today", template: "What needs my attention today across my projects?", sendNow: true },
  { command: "summary", label: "Summarise a project", template: "Summarise {project}" },
  { command: "overdue", label: "What's overdue on my projects", template: "What's overdue on my projects, and who holds each item?", sendNow: true },
  { command: "risks", label: "Projects at risk and why", template: "Which projects are at risk and why?", sendNow: true },
  { command: "report", label: "Build a report with a chart", template: "Build a report of " },
  { command: "handover", label: "Handover summary for the next team", template: "Write a handover summary of {project} for the next team" },
  { command: "prep", label: "Prep for the next meeting", template: "Prepare me for the next meeting on {project}" },
  { command: "recap", label: "Recap the last meeting", template: "Recap the last meeting on {project} and list the follow-ups" },
  { command: "email", label: "Draft and send an email", template: "Email the merchant contact for {project} about ", acts: true },
  { command: "notify", label: "Notify a teammate", template: "Notify @ about {project}: ", acts: true },
  { command: "link", label: "Create a meeting link", template: "Create a Google Meet link for {project} on ", acts: true },
  { command: "task", label: "Add a task", template: "Add a task on {project} for @: ", acts: true },
  { command: "risk", label: "Flag a risk", template: "Flag a risk on {project}: ", acts: true },
  { command: "assign", label: "Assign an owner", template: "Assign {project} to @", acts: true },
  { command: "state", label: "Change a project's state", template: "Change the state of {project} to ", acts: true },
  { command: "note", label: "Add a note to a project", template: "Add a note to {project}: ", acts: true },
  { command: "transfer", label: "Transfer to the next team", template: "Transfer {project} to the next team with a handover note", acts: true },
];
