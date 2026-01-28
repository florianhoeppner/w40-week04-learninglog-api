import { useState, useRef, useEffect } from "react";
import { updateCat, type CatUpdateResponse } from "../../api/endpoints";

interface EditableCatNameProps {
  catId: number;
  initialName: string | null | undefined;
  onNameUpdated?: (response: CatUpdateResponse) => void;
}

/**
 * Inline editable cat name component.
 * Click to edit, Enter to save, Escape to cancel.
 */
export function EditableCatName({
  catId,
  initialName,
  onNameUpdated,
}: EditableCatNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(initialName || "");
  const [displayName, setDisplayName] = useState(initialName || `Cat #${catId}`);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Update local state when prop changes
  useEffect(() => {
    setName(initialName || "");
    setDisplayName(initialName || `Cat #${catId}`);
  }, [initialName, catId]);

  const handleStartEditing = () => {
    setIsEditing(true);
    setError(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setName(initialName || "");
    setError(null);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();

    // If name hasn't changed, just exit edit mode
    if (trimmedName === (initialName || "")) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await updateCat(catId, {
        name: trimmedName || null, // Empty string becomes null
      });

      setDisplayName(response.name || `Cat #${catId}`);
      setIsEditing(false);
      onNameUpdated?.(response);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to update name";
      setError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="editable-name-container">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Small delay to allow button clicks to register
            setTimeout(() => {
              if (!isSaving) handleCancel();
            }, 150);
          }}
          disabled={isSaving}
          className="editable-name-input"
          placeholder="Enter cat name..."
          maxLength={100}
        />
        <div className="editable-name-actions">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="editable-name-save"
            title="Save (Enter)"
          >
            {isSaving ? "..." : "Save"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="editable-name-cancel"
            title="Cancel (Escape)"
          >
            Cancel
          </button>
        </div>
        {error && <div className="editable-name-error">{error}</div>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleStartEditing}
      className="editable-name-display"
      title="Click to edit name"
    >
      <span className="editable-name-text">{displayName}</span>
      <span className="editable-name-icon">&#9998;</span>
    </button>
  );
}
