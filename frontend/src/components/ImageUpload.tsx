import { useState, useRef, type ChangeEvent } from "react";
import { validateImageFile } from "../api/upload";

interface ImageUploadProps {
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  previewUrl?: string | null;
}

export function ImageUpload({ value: _value, onChange, disabled, previewUrl }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(previewUrl || null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;

    if (!file) {
      onChange(null);
      setPreview(null);
      setError(null);
      return;
    }

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || "Invalid file");
      onChange(null);
      setPreview(null);
      return;
    }

    setError(null);
    onChange(file);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    onChange(null);
    setPreview(null);
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ display: "block", fontWeight: 600 }}>
        Photo (optional)
      </label>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileChange}
        disabled={disabled}
        style={{
          marginTop: 6,
          display: "block",
          width: "100%",
        }}
      />

      {error && (
        <div style={{ color: "crimson", marginTop: 6, fontSize: "0.9rem" }}>
          {error}
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 10 }}>
          <img
            src={preview}
            alt="Preview"
            style={{
              maxWidth: "100%",
              maxHeight: 300,
              borderRadius: 8,
              border: "1px solid #eee",
            }}
          />
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            style={{ marginTop: 8 }}
          >
            Remove image
          </button>
        </div>
      )}

      <p style={{ marginTop: 6, color: "#666", fontSize: "0.85rem" }}>
        Max 10MB. Supported: JPEG, PNG, WebP, GIF
      </p>
    </div>
  );
}
