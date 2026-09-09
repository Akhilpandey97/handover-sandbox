-- Group chat messages into conversations.
--
-- Messages were a single flat list per user, so there was one endless thread
-- and "clear history" was the only way out of it. A nullable conversation id
-- is enough to separate threads without a second table: existing rows keep
-- NULL and read as one earlier conversation, so nothing is lost or migrated.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

-- The list is always "this user's recent messages, newest first".
CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx
  ON public.chat_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx
  ON public.chat_messages (conversation_id, created_at);
