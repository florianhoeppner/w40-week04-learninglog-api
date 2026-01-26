"""
Image upload handling with Bunny.net CDN Storage.

Bunny.net provides EU-based storage with built-in CDN and image optimization.
- Company location: Slovenia (EU)
- GDPR compliant
- Cost: ~€0.30/month for 10GB + 20GB bandwidth

API Documentation: https://docs.bunny.net/reference/storage-api

Resiliency Patterns:
- Retry logic with exponential backoff (3 attempts)
- Circuit breaker to prevent cascading failures
- Timeout handling (30s for uploads)
- Graceful degradation (allows entries without images)
"""

from typing import Optional, Tuple
import requests
import uuid
import time
from datetime import datetime, timedelta
from fastapi import HTTPException, UploadFile
from PIL import Image
import io
from config import settings


# Circuit Breaker State
class CircuitBreaker:
    """
    Circuit breaker pattern to prevent cascading failures.

    States:
    - CLOSED: Normal operation, requests pass through
    - OPEN: Too many failures, reject requests immediately
    - HALF_OPEN: Testing if service recovered
    """

    def __init__(self, failure_threshold: int = 5, timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout  # seconds until retry
        self.failures = 0
        self.last_failure_time: Optional[datetime] = None
        self.state = "CLOSED"

    def call_failed(self):
        """Record a failure."""
        self.failures += 1
        self.last_failure_time = datetime.utcnow()
        if self.failures >= self.failure_threshold:
            self.state = "OPEN"
            print(f"⚠️  Circuit breaker OPEN after {self.failures} failures")

    def call_succeeded(self):
        """Record a success."""
        self.failures = 0
        self.state = "CLOSED"

    def can_attempt(self) -> bool:
        """Check if we should attempt the call."""
        if self.state == "CLOSED":
            return True

        if self.state == "OPEN":
            # Check if timeout elapsed
            if self.last_failure_time:
                elapsed = (datetime.utcnow() - self.last_failure_time).total_seconds()
                if elapsed >= self.timeout:
                    self.state = "HALF_OPEN"
                    print("🔄 Circuit breaker HALF_OPEN, testing recovery...")
                    return True
            return False

        # HALF_OPEN: allow one test request
        return True


# Global circuit breaker for Bunny.net API
bunny_circuit_breaker = CircuitBreaker(failure_threshold=5, timeout=60)


def retry_with_backoff(max_attempts: int = 3, base_delay: float = 1.0):
    """
    Decorator for retry logic with exponential backoff.

    Args:
        max_attempts: Maximum number of retry attempts
        base_delay: Initial delay in seconds (doubles each retry)
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except (requests.exceptions.ConnectionError,
                        requests.exceptions.Timeout) as e:
                    last_exception = e
                    if attempt < max_attempts - 1:
                        delay = base_delay * (2 ** attempt)  # Exponential backoff
                        print(f"🔄 Retry attempt {attempt + 1}/{max_attempts} after {delay}s...")
                        time.sleep(delay)
                    else:
                        # Last attempt failed
                        raise
                except Exception as e:
                    # Don't retry on non-transient errors
                    raise
            raise last_exception
        return wrapper
    return decorator


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

    # Check circuit breaker
    if not bunny_circuit_breaker.can_attempt():
        raise HTTPException(
            status_code=503,
            detail="Image upload service temporarily unavailable. Please try again later."
        )

    # Upload to Bunny.net Storage with retry logic
    storage_url = f"{settings.bunny_storage_url}/{storage_path}"

    headers = {
        "AccessKey": settings.bunny_api_key,
        "Content-Type": "application/octet-stream",
    }

    @retry_with_backoff(max_attempts=3, base_delay=1.0)
    def upload_with_retry():
        response = requests.put(
            storage_url,
            data=file_content,
            headers=headers,
            timeout=30  # 30 second timeout
        )

        if response.status_code not in [200, 201]:
            error_detail = f"Bunny.net upload failed: {response.status_code}"
            if response.text:
                # Log full error for debugging
                print(f"❌ Bunny.net API Error: {response.text}")
                error_detail += f" - {response.text[:500]}"  # Show more details
            raise requests.exceptions.RequestException(error_detail)

        return response

    try:
        upload_with_retry()
        bunny_circuit_breaker.call_succeeded()  # Mark success

    except requests.exceptions.Timeout:
        bunny_circuit_breaker.call_failed()
        raise HTTPException(status_code=504, detail="Upload timeout. Please try again.")
    except (requests.exceptions.ConnectionError, requests.exceptions.RequestException) as e:
        bunny_circuit_breaker.call_failed()
        raise HTTPException(status_code=503, detail=f"Upload failed: {str(e)}")
    except Exception as e:
        bunny_circuit_breaker.call_failed()
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

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

    Note: This function fails gracefully - returns False instead of raising exceptions.
    """
    try:
        # Validate configuration
        validate_bunny_config()

        # Check circuit breaker (but don't fail hard for deletes)
        if not bunny_circuit_breaker.can_attempt():
            print("⚠️  Skipping delete due to circuit breaker (will retry later)")
            return False

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

        @retry_with_backoff(max_attempts=2, base_delay=0.5)
        def delete_with_retry():
            response = requests.delete(
                storage_url,
                headers=headers,
                timeout=10
            )

            # 200 = deleted, 404 = already gone (both OK)
            if response.status_code in [200, 404]:
                return True

            # Other errors
            if response.status_code >= 500:
                # Server error - worth retrying
                raise requests.exceptions.RequestException(
                    f"Server error: {response.status_code}"
                )

            # Client error - don't retry
            return False

        result = delete_with_retry()
        if result:
            bunny_circuit_breaker.call_succeeded()
        return result

    except Exception as e:
        print(f"Warning: Failed to delete image: {str(e)}")
        bunny_circuit_breaker.call_failed()
        return False
