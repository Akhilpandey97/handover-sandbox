-- Buddy chat history keeps what happened, not just what was said.
--
-- Actions Buddy proposed, whether they were approved, their results, the
-- steps Buddy took and the sources it used live in metadata, so a reloaded
-- thread still shows them. The app keeps working before this runs: it falls
-- back to saving text only.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Action status changes (approved, done, undone) update the message they belong to.
DROP POLICY IF EXISTS "Users update their own chat messages" ON public.chat_messages;
CREATE POLICY "Users update their own chat messages"
  ON public.chat_messages FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
