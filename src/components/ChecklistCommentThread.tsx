import { useState, useRef } from "react";
import { useChecklistComments, useAddChecklistComment } from "@/hooks/useChecklistComments";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  Send,
  Paperclip,
  FileText,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";

interface ChecklistCommentThreadProps {
  checklistItemId: string;
}

export const ChecklistCommentThread = ({ checklistItemId }: ChecklistCommentThreadProps) => {
  const { currentUser } = useAuth();
  const { data: comments = [], isLoading } = useChecklistComments(checklistItemId);
  const addComment = useAddChecklistComment();
  const [isExpanded, setIsExpanded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (!commentText.trim() && !selectedFile) return;

    addComment.mutate(
      {
        checklistItemId,
        comment: commentText.trim() || (selectedFile ? `Attached: ${selectedFile.name}` : ""),
        file: selectedFile || undefined,
      },
      {
        onSuccess: () => {
          setCommentText("");
          setSelectedFile(null);
          setIsExpanded(true);
        },
      }
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // 10MB limit
      if (file.size > 10 * 1024 * 1024) {
        alert("File size must be less than 10MB");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  const commentCount = comments.length;

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      {/* Comment count & toggle */}
      {commentCount > 0 && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <MessageSquare className="h-3 w-3" />
          <span className="font-medium">{commentCount} comment{commentCount !== 1 ? "s" : ""}</span>
          {isExpanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      )}

      {/* Expanded comment list */}
      {isExpanded && commentCount > 0 && (
        <ScrollArea className="mb-3 max-h-[240px] overflow-y-auto">
          <div className="space-y-2 pr-2">
            {comments.map((c) => (
              <CommentBubble key={c.id} comment={c} currentUserId={currentUser?.id} />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Add comment form */}
      <div className="flex gap-2">
        <div className="flex-1 space-y-2">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment... (Ctrl+Enter to send)"
            className="min-h-[40px] text-xs resize-none"
            rows={1}
          />
          {selectedFile && (
            <div className="flex items-center gap-2 text-xs bg-muted/50 rounded-md px-2 py-1">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="truncate flex-1">{selectedFile.name}</span>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={(!commentText.trim() && !selectedFile) || addComment.isPending}
            className="h-7 px-2"
          >
            {addComment.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            className="h-7 px-2"
            title="Attach document"
          >
            <Paperclip className="h-3 w-3" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.zip"
          />
        </div>
      </div>
    </div>
  );
};

const CommentBubble = ({
  comment,
  currentUserId,
}: {
  comment: {
    id: string;
    user_name: string;
    user_id: string | null;
    comment: string;
    attachment_url: string | null;
    attachment_name: string | null;
    created_at: string;
  };
  currentUserId?: string;
}) => {
  const isOwn = currentUserId && comment.user_id === currentUserId;

  return (
    <div
      className={`text-xs p-2.5 rounded-lg ${
        isOwn ? "bg-primary/10 border border-primary/20" : "bg-muted/50"
      }`}
    >
      <div className="flex items-center gap-1 text-muted-foreground mb-1">
        <span className="font-medium text-foreground">{comment.user_name}</span>
        <span>•</span>
        <span>{new Date(comment.created_at).toLocaleDateString()}</span>
        <span>{new Date(comment.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <p className="text-foreground whitespace-pre-wrap">{comment.comment}</p>
      {comment.attachment_url && (
        <a
          href={comment.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-1.5 text-primary hover:underline"
        >
          <FileText className="h-3 w-3" />
          <span>{comment.attachment_name || "Attachment"}</span>
        </a>
      )}
    </div>
  );
};
