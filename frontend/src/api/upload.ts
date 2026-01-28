/**
 * Image upload utilities for CatAtlas with Bunny.net CDN
 */

import { ApiError } from "../types/errors";
import { handleHttpError, handleNetworkError } from "../utils/errors";
import type { Entry } from "./endpoints";

const API_BASE = import.meta.env.VITE_API_BASE;
if (!API_BASE) {
  throw new Error("VITE_API_BASE environment variable is not set");
}

export interface UploadImageResponse {
  url: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Validate image file before upload
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  // Check file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed: JPEG, PNG, WebP, GIF`,
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    return {
      valid: false,
      error: `File too large (${sizeMB}MB). Max size: 10MB`,
    };
  }

  return { valid: true };
}

/**
 * Upload image to backend (which uploads to Bunny.net)
 */
export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(`${API_BASE}/upload/image`, {
      method: "POST",
      body: formData,
      // Don't set Content-Type - browser will set it with boundary
    });

    if (!response.ok) {
      throw await handleHttpError(response, "/upload/image");
    }

    const data: UploadImageResponse = await response.json();
    return data.url;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw handleNetworkError(error, "/upload/image");
  }
}

/** Structured address fields for entry creation */
export interface AddressFields {
  street?: string | null;
  number?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
}

/**
 * Create entry with image upload
 */
export async function createEntryWithImage(
  text: string,
  nickname: string | null,
  address: AddressFields | null,
  image: File | null
): Promise<Entry> {
  const formData = new FormData();
  formData.append("text", text);
  if (nickname) formData.append("nickname", nickname);

  // Add structured address fields
  if (address) {
    if (address.street) formData.append("location_street", address.street);
    if (address.number) formData.append("location_number", address.number);
    if (address.zip) formData.append("location_zip", address.zip);
    if (address.city) formData.append("location_city", address.city);
    if (address.country) formData.append("location_country", address.country);
  }

  if (image) formData.append("image", image);

  try {
    const response = await fetch(`${API_BASE}/entries/with-image`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw await handleHttpError(response, "/entries/with-image");
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw handleNetworkError(error, "/entries/with-image");
  }
}

/**
 * Update entry image (add or replace)
 */
export async function updateEntryImage(entryId: number, image: File): Promise<Entry> {
  const formData = new FormData();
  formData.append("image", image);

  try {
    const response = await fetch(`${API_BASE}/entries/${entryId}/image`, {
      method: "PATCH",
      body: formData,
    });

    if (!response.ok) {
      throw await handleHttpError(response, `/entries/${entryId}/image`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw handleNetworkError(error, `/entries/${entryId}/image`);
  }
}
