"""
Image upload handling with Bunny.net CDN Storage.

Bunny.net provides EU-based storage with built-in CDN and image optimization.
- Company location: Slovenia (EU)
- GDPR compliant
- Cost: ~€0.30/month for 10GB + 20GB bandwidth

API Documentation: https://docs.bunny.net/reference/storage-api
"""

from typing import Optional, Tuple
import requests
import uuid
from datetime import datetime
from fastapi import HTTPException, UploadFile
from PIL import Image
import io
from config import settings


def validate_bunny_config():
    """
    Validate that Bunny.net is properly configured.

    Raises:
        RuntimeError: If configuration is incomplete
    """
    if not all([
        settings.bunny_storage_zone,
        settings.bunny_api_key,
        settings.bunny_cdn_hostname
    ]):
        raise RuntimeError(
            "Bunny.net not configured. Set BUNNY_STORAGE_ZONE, BUNNY_API_KEY, "
            "and BUNNY_CDN_HOSTNAME in environment variables."
        )


def validate_image_file(file: UploadFile) -> Tuple[bool, Optional[str]]:
    """
    Validate uploaded image file metadata.

    Args:
        file: The uploaded file from FastAPI

    Returns:
        (is_valid, error_message)
    """
    # Check content type
    if file.content_type not in settings.allowed_image_types_list:
        return False, f"Invalid file type. Allowed: {', '.join(settings.allowed_image_types_list)}"

    # Check file size (if available)
    if file.size and file.size > settings.max_upload_size_bytes:
        return False, f"File too large. Max size: {settings.max_upload_size_mb}MB"

    return True, None


def validate_image_content(file_content: bytes) -> Tuple[bool, Optional[str]]:
    """
    Validate image content using PIL (deeper validation).
    Detects corrupted images and verifies it's actually an image.

    Args:
        file_content: Raw file bytes

    Returns:
        (is_valid, error_message)
    """
    try:
        image = Image.open(io.BytesIO(file_content))
        image.verify()  # Verify it's a valid image

        # Additional safety checks
        if image.width > 10000 or image.height > 10000:
            return False, "Image dimensions too large (max 10000x10000)"

        return True, None
    except Exception as e:
        return False, f"Invalid or corrupted image: {str(e)}"


async def upload_to_bunny(file: UploadFile, folder: str = "sightings") -> str:
    """
    Upload image to Bunny.net Storage and return CDN URL.

    Args:
        file: The uploaded file from FastAPI
        folder: Folder name in storage zone (for organization)

    Returns:
        CDN URL of uploaded image (e.g., https://catatlas.b-cdn.net/sightings/abc123.jpg)

    Raises:
        HTTPException: If validation fails or upload errors
    """
    # Validate configuration
    try:
        validate_bunny_config()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Validate file metadata
    is_valid, error = validate_image_file(file)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    # Read file content
    try:
        file_content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

    # Validate actual file size
    if len(file_content) > settings.max_upload_size_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {settings.max_upload_size_mb}MB"
        )

    # Validate image content
    is_valid, error = validate_image_content(file_content)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)

    # Generate unique filename
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    unique_id = uuid.uuid4().hex[:8]

    # Preserve original extension
    ext = ""
    if file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
            ext = "jpg"  # Default fallback
    else:
        # Detect from content type
        ext_map = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
            "image/gif": "gif",
        }
        ext = ext_map.get(file.content_type, "jpg")

    filename = f"{timestamp}_{unique_id}.{ext}"
    storage_path = f"{folder}/{filename}"

    # Upload to Bunny.net Storage
    storage_url = f"{settings.bunny_storage_url}/{storage_path}"

    headers = {
        "AccessKey": settings.bunny_api_key,
        "Content-Type": "application/octet-stream",
    }

    try:
        response = requests.put(
            storage_url,
            data=file_content,
            headers=headers,
            timeout=30  # 30 second timeout
        )

        if response.status_code not in [200, 201]:
            raise HTTPException(
                status_code=500,
                detail=f"Bunny.net upload failed: {response.status_code} - {response.text}"
            )

    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Upload timeout. Please try again.")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

    # Return CDN URL
    cdn_url = f"{settings.bunny_cdn_url}/{storage_path}"
    return cdn_url


async def delete_from_bunny(url: str) -> bool:
    """
    Delete image from Bunny.net Storage by URL.

    Args:
        url: CDN URL of image to delete (e.g., https://catatlas.b-cdn.net/sightings/file.jpg)

    Returns:
        True if successful, False otherwise
    """
    try:
        # Validate configuration
        validate_bunny_config()

        # Extract path from CDN URL
        # Example: https://catatlas.b-cdn.net/sightings/file.jpg -> sightings/file.jpg
        if settings.bunny_cdn_hostname not in url:
            print(f"Warning: URL doesn't match CDN hostname: {url}")
            return False

        # Get path after CDN hostname
        path = url.split(settings.bunny_cdn_hostname + "/", 1)[-1]

        # Delete from storage
        storage_url = f"{settings.bunny_storage_url}/{path}"

        headers = {
            "AccessKey": settings.bunny_api_key,
        }

        response = requests.delete(
            storage_url,
            headers=headers,
            timeout=10
        )

        # 200 = deleted, 404 = already gone (both OK)
        if response.status_code in [200, 404]:
            return True

        print(f"Warning: Failed to delete image: {response.status_code} - {response.text}")
        return False

    except Exception as e:
        print(f"Warning: Failed to delete image: {str(e)}")
        return False
