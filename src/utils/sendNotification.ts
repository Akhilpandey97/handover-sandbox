const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface NotificationPayload {
  type: "project_assignment" | "project_transfer" | "project_rejection";
  recipientEmail: string;
  recipientName: string;
  projectName: string;
  fromTeam?: string;
  toTeam?: string;
  notes?: string;
  assignedBy?: string;
  reason?: string;
  projectId?: string;
  checklistItemId?: string;
  taskId?: string;
  commentId?: string;
  cc?: string[];
}

export const sendNotification = async (payload: NotificationPayload) => {
  try {
    const res = await fetch(`/api/public/send-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("Notification error:", await res.text());
    }
  } catch (err) {
    // Non-blocking — don't break the flow if email fails
    console.error("Failed to send notification:", err);
  }
};
