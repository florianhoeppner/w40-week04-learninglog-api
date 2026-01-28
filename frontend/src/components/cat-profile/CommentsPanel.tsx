import { useState, useEffect } from "react";
import {
  getCatComments,
  createComment,
  deleteComment,
  type Comment,
  type CommentCreatePayload,
} from "../../api/endpoints";

interface CommentsPanelProps {
  catId: number;
}

/**
 * CommentsPanel Component
 * Displays and manages community comments on a cat's profile.
 */
export function CommentsPanel({ catId }: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [authorName, setAuthorName] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const ITEMS_PER_PAGE = 10;

  // Fetch comments
  const fetchComments = async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getCatComments(catId, pageNum, ITEMS_PER_PAGE);
      setComments(response.comments);
      setTotal(response.total);
      setTotalPages(response.totalPages);
      setPage(response.page);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load comments";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchComments(1);
  }, [catId]);

  // Handle submit new comment
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!authorName.trim() || !content.trim()) {
      setSubmitError("Name and comment are required");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload: CommentCreatePayload = {
        author_name: authorName.trim(),
        content: content.trim(),
      };
      const newComment = await createComment(catId, payload);

      // Add to top of list (newest first)
      setComments((prev) => [newComment, ...prev]);
      setTotal((prev) => prev + 1);

      // Clear form
      setAuthorName("");
      setContent("");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to post comment";
      setSubmitError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle delete comment
  const handleDelete = async (commentId: number) => {
    if (!confirm("Are you sure you want to delete this comment?")) {
      return;
    }

    setDeletingId(commentId);
    try {
      await deleteComment(catId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setTotal((prev) => prev - 1);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete comment";
      alert(errorMessage);
    } finally {
      setDeletingId(null);
    }
  };

  // Format date
  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="comments-panel">
      <h2 className="comments-title">
        Community Comments {total > 0 && <span className="comment-count">({total})</span>}
      </h2>

      {/* Add Comment Form */}
      <form onSubmit={handleSubmit} className="comment-form">
        <div className="form-row">
          <input
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="Your name"
            maxLength={100}
            disabled={submitting}
            className="comment-author-input"
          />
        </div>
        <div className="form-row">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share your thoughts about this cat..."
            maxLength={2000}
            rows={3}
            disabled={submitting}
            className="comment-content-input"
          />
        </div>
        {submitError && <div className="comment-error">{submitError}</div>}
        <button
          type="submit"
          disabled={submitting || !authorName.trim() || !content.trim()}
          className="comment-submit-btn"
        >
          {submitting ? "Posting..." : "Post Comment"}
        </button>
      </form>

      {/* Comments List */}
      {loading && comments.length === 0 ? (
        <div className="comments-loading">Loading comments...</div>
      ) : error ? (
        <div className="comments-error">
          <p>{error}</p>
          <button onClick={() => fetchComments(page)}>Try Again</button>
        </div>
      ) : comments.length === 0 ? (
        <div className="comments-empty">
          <p>No comments yet. Be the first to share your thoughts!</p>
        </div>
      ) : (
        <>
          <div className="comments-list">
            {comments.map((comment) => (
              <div key={comment.id} className="comment-card">
                <div className="comment-header">
                  <span className="comment-author">{comment.author_name}</span>
                  <span className="comment-date">{formatDate(comment.createdAt)}</span>
                </div>
                <p className="comment-content">{comment.content}</p>
                <button
                  type="button"
                  onClick={() => handleDelete(comment.id)}
                  disabled={deletingId === comment.id}
                  className="comment-delete-btn"
                  title="Delete comment"
                >
                  {deletingId === comment.id ? "..." : "Delete"}
                </button>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="comments-pagination">
              <button
                onClick={() => fetchComments(page - 1)}
                disabled={page <= 1 || loading}
                className="pagination-btn"
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => fetchComments(page + 1)}
                disabled={page >= totalPages || loading}
                className="pagination-btn"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
