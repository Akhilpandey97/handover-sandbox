import { useRouterState } from "@tanstack/react-router";
import { BuddyChat } from "@/components/buddy/BuddyChat";

/**
 * The Buddy tab: chat history, the conversation, and what Buddy is looking at.
 * The implementation lives in components/buddy; this keeps the dashboard's
 * existing import working.
 */
export const AiChatBot = () => {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <BuddyChat variant="page" page={{ path: pathname }} />;
};
