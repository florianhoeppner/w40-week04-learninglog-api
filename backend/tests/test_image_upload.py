"""
Tests for image upload functionality with Bunny.net CDN.

Tests cover:
- Image validation (file type, size, content)
- Upload with mocked Bunny.net API
- Delete functionality
- Circuit breaker pattern
- Retry logic with exponential backoff
- Error scenarios and recovery
"""

import pytest
import io
from unittest.mock import Mock, patch, MagicMock
from PIL import Image
from fastapi import UploadFile, HTTPException
import requests

from image_upload import (
    validate_bunny_config,
    validate_image_file,
    validate_image_content,
    upload_to_bunny,
    delete_from_bunny,
    CircuitBreaker,
    bunny_circuit_breaker,
)


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def mock_bunny_settings():
    """Mock Bunny.net settings for testing."""
    with patch("image_upload.settings") as mock_settings:
        mock_settings.bunny_storage_zone = "test-zone"
        mock_settings.bunny_api_key = "test-api-key"
        mock_settings.bunny_cdn_hostname = "test.b-cdn.net"
        mock_settings.bunny_storage_region = "de"
        mock_settings.bunny_storage_url = "https://de.storage.bunnycdn.com/test-zone"
        mock_settings.bunny_cdn_url = "https://test.b-cdn.net"
        mock_settings.max_upload_size_mb = 10
        mock_settings.max_upload_size_bytes = 10 * 1024 * 1024
        mock_settings.allowed_image_types = "image/jpeg,image/png,image/webp,image/gif"
        mock_settings.allowed_image_types_list = [
            "image/jpeg", "image/png", "image/webp", "image/gif"
        ]
        yield mock_settings


# ============================================================================
# Validation Tests
# ============================================================================

def test_validate_bunny_config_missing(monkeypatch):
    """Test validation fails when Bunny.net not configured."""
    monkeypatch.setenv("BUNNY_STORAGE_ZONE", "")
    monkeypatch.setenv("BUNNY_API_KEY", "")
    monkeypatch.setenv("BUNNY_CDN_HOSTNAME", "")

    with pytest.raises(RuntimeError, match="Bunny.net not configured"):
        validate_bunny_config()


def test_validate_bunny_config_success(monkeypatch):
    """Test validation passes when properly configured."""
    # Mock the settings object directly
    with patch("image_upload.settings") as mock_settings:
        mock_settings.bunny_storage_zone = "test-zone"
        mock_settings.bunny_api_key = "test-key"
        mock_settings.bunny_cdn_hostname = "test.b-cdn.net"

        # Should not raise
        validate_bunny_config()


def test_validate_image_file_valid_jpeg():
    """Test validation accepts valid JPEG."""
    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "image/jpeg"
    mock_file.size = 5 * 1024 * 1024  # 5MB

    is_valid, error = validate_image_file(mock_file)

    assert is_valid is True
    assert error is None


def test_validate_image_file_invalid_type():
    """Test validation rejects invalid file type."""
    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "application/pdf"
    mock_file.size = 1024

    is_valid, error = validate_image_file(mock_file)

    assert is_valid is False
    assert "Invalid file type" in error


def test_validate_image_file_too_large():
    """Test validation rejects files over 10MB."""
    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "image/jpeg"
    mock_file.size = 15 * 1024 * 1024  # 15MB

    is_valid, error = validate_image_file(mock_file)

    assert is_valid is False
    assert "too large" in error.lower()


def test_validate_image_content_valid():
    """Test content validation accepts valid image."""
    # Create a valid test image
    img = Image.new("RGB", (100, 100), color="red")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes = img_bytes.getvalue()

    is_valid, error = validate_image_content(img_bytes)

    assert is_valid is True
    assert error is None


def test_validate_image_content_invalid():
    """Test content validation rejects non-image data."""
    fake_content = b"This is not an image"

    is_valid, error = validate_image_content(fake_content)

    assert is_valid is False
    assert "Invalid or corrupted" in error


def test_validate_image_content_too_large_dimensions():
    """Test content validation rejects images with huge dimensions."""
    # PIL will prevent actually creating a 20000x20000 image in memory,
    # but we can test the check exists
    img = Image.new("RGB", (100, 100))
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_bytes = img_bytes.getvalue()

    # Mock the image to report huge dimensions
    with patch("image_upload.Image.open") as mock_open:
        mock_img = Mock()
        mock_img.width = 15000
        mock_img.height = 15000
        mock_open.return_value = mock_img

        is_valid, error = validate_image_content(img_bytes)

        assert is_valid is False
        assert "dimensions too large" in error.lower()


# ============================================================================
# Circuit Breaker Tests
# ============================================================================

def test_circuit_breaker_starts_closed():
    """Test circuit breaker starts in CLOSED state."""
    cb = CircuitBreaker(failure_threshold=3, timeout=60)

    assert cb.state == "CLOSED"
    assert cb.can_attempt() is True


def test_circuit_breaker_opens_after_failures():
    """Test circuit breaker opens after threshold failures."""
    cb = CircuitBreaker(failure_threshold=3, timeout=60)

    # Record failures
    cb.call_failed()
    assert cb.state == "CLOSED"
    cb.call_failed()
    assert cb.state == "CLOSED"
    cb.call_failed()  # This should open it

    assert cb.state == "OPEN"
    assert cb.can_attempt() is False


def test_circuit_breaker_resets_on_success():
    """Test circuit breaker resets failure count on success."""
    cb = CircuitBreaker(failure_threshold=3, timeout=60)

    cb.call_failed()
    cb.call_failed()
    cb.call_succeeded()

    assert cb.state == "CLOSED"
    assert cb.failures == 0


def test_circuit_breaker_half_open_after_timeout():
    """Test circuit breaker transitions to HALF_OPEN after timeout."""
    cb = CircuitBreaker(failure_threshold=2, timeout=0)  # 0 second timeout for testing

    # Open the circuit
    cb.call_failed()
    cb.call_failed()
    assert cb.state == "OPEN"

    # Wait and check if it allows attempt
    import time
    time.sleep(0.1)
    assert cb.can_attempt() is True
    assert cb.state == "HALF_OPEN"


# ============================================================================
# Upload Tests (with mocked Bunny.net API)
# ============================================================================

@pytest.mark.asyncio
async def test_upload_to_bunny_success(mock_bunny_settings):
    """Test successful image upload to Bunny.net."""
    # Reset circuit breaker
    bunny_circuit_breaker.state = "CLOSED"
    bunny_circuit_breaker.failures = 0

    # Create valid test image
    img = Image.new("RGB", (100, 100), color="blue")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_content = img_bytes.getvalue()

    # Mock UploadFile with async read
    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "image/jpeg"
    mock_file.size = len(img_content)
    mock_file.filename = "test.jpg"
    # Make read an async function
    async def async_read():
        return img_content
    mock_file.read = async_read

    # Mock requests.put
    with patch("image_upload.requests.put") as mock_put:
        mock_response = Mock()
        mock_response.status_code = 201
        mock_put.return_value = mock_response

        # Upload
        cdn_url = await upload_to_bunny(mock_file, folder="test")

        # Verify
        assert "test.b-cdn.net" in cdn_url
        assert "test/" in cdn_url
        assert cdn_url.endswith(".jpg")
        mock_put.assert_called_once()


@pytest.mark.asyncio
async def test_upload_to_bunny_invalid_file(mock_bunny_settings):
    """Test upload rejects invalid file type."""
    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "application/pdf"
    mock_file.size = 1024

    with pytest.raises(HTTPException) as exc_info:
        await upload_to_bunny(mock_file)

    assert exc_info.value.status_code == 400
    assert "Invalid file type" in exc_info.value.detail


@pytest.mark.asyncio
async def test_upload_to_bunny_circuit_breaker_open(mock_bunny_settings):
    """Test upload fails fast when circuit breaker is open."""
    # Open circuit breaker
    bunny_circuit_breaker.state = "OPEN"
    bunny_circuit_breaker.failures = 10

    # Create valid test image
    img = Image.new("RGB", (50, 50))
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG")
    img_content = img_bytes.getvalue()

    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "image/jpeg"
    mock_file.size = len(img_content)
    mock_file.filename = "test.jpg"
    # Make read async
    async def async_read():
        return img_content
    mock_file.read = async_read

    with pytest.raises(HTTPException) as exc_info:
        await upload_to_bunny(mock_file)

    assert exc_info.value.status_code == 503
    assert "temporarily unavailable" in exc_info.value.detail.lower()

    # Reset for other tests
    bunny_circuit_breaker.state = "CLOSED"
    bunny_circuit_breaker.failures = 0


@pytest.mark.asyncio
async def test_upload_to_bunny_retry_on_timeout(mock_bunny_settings):
    """Test upload retries on timeout errors."""
    bunny_circuit_breaker.state = "CLOSED"
    bunny_circuit_breaker.failures = 0

    # Create valid image
    img = Image.new("RGB", (50, 50))
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="PNG")
    img_content = img_bytes.getvalue()

    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "image/png"
    mock_file.size = len(img_content)
    mock_file.filename = "test.png"
    # Make read async
    async def async_read():
        return img_content
    mock_file.read = async_read

    # Mock requests to timeout first, then succeed
    with patch("image_upload.requests.put") as mock_put:
        with patch("image_upload.time.sleep"):  # Skip sleep delays in test
            mock_put.side_effect = [
                requests.exceptions.Timeout("Timeout"),
                Mock(status_code=201)
            ]

            cdn_url = await upload_to_bunny(mock_file)

            # Should have retried
            assert mock_put.call_count == 2
            assert "test.b-cdn.net" in cdn_url


@pytest.mark.asyncio
async def test_upload_to_bunny_retry_exhausted(mock_bunny_settings):
    """Test upload fails after retries exhausted."""
    bunny_circuit_breaker.state = "CLOSED"
    bunny_circuit_breaker.failures = 0

    # Create valid image
    img = Image.new("RGB", (50, 50))
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="PNG")
    img_content = img_bytes.getvalue()

    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "image/png"
    mock_file.size = len(img_content)
    mock_file.filename = "test.png"
    # Make read async
    async def async_read():
        return img_content
    mock_file.read = async_read

    # Mock requests to always timeout
    with patch("image_upload.requests.put") as mock_put:
        with patch("image_upload.time.sleep"):  # Skip sleep delays
            mock_put.side_effect = requests.exceptions.Timeout("Always timeout")

            with pytest.raises(HTTPException) as exc_info:
                await upload_to_bunny(mock_file)

            # Should have tried 3 times
            assert mock_put.call_count == 3
            assert exc_info.value.status_code == 504


# ============================================================================
# Delete Tests
# ============================================================================

@pytest.mark.asyncio
async def test_delete_from_bunny_success(mock_bunny_settings):
    """Test successful image deletion."""
    bunny_circuit_breaker.state = "CLOSED"
    bunny_circuit_breaker.failures = 0

    test_url = "https://test.b-cdn.net/sightings/test.jpg"

    with patch("image_upload.requests.delete") as mock_delete:
        mock_response = Mock()
        mock_response.status_code = 200
        mock_delete.return_value = mock_response

        result = await delete_from_bunny(test_url)

        assert result is True
        mock_delete.assert_called_once()


@pytest.mark.asyncio
async def test_delete_from_bunny_already_deleted(mock_bunny_settings):
    """Test delete succeeds even if file already gone (404)."""
    bunny_circuit_breaker.state = "CLOSED"

    test_url = "https://test.b-cdn.net/sightings/test.jpg"

    with patch("image_upload.requests.delete") as mock_delete:
        mock_response = Mock()
        mock_response.status_code = 404
        mock_delete.return_value = mock_response

        result = await delete_from_bunny(test_url)

        assert result is True  # 404 is OK for deletes


@pytest.mark.asyncio
async def test_delete_from_bunny_fails_gracefully(mock_bunny_settings):
    """Test delete fails gracefully without raising exceptions."""
    bunny_circuit_breaker.state = "CLOSED"

    test_url = "https://test.b-cdn.net/sightings/test.jpg"

    with patch("image_upload.requests.delete") as mock_delete:
        mock_delete.side_effect = requests.exceptions.ConnectionError("Network error")

        # Should not raise, just return False
        result = await delete_from_bunny(test_url)

        assert result is False


# ============================================================================
# Integration Tests
# ============================================================================

@pytest.mark.asyncio
async def test_upload_flow_end_to_end(mock_bunny_settings):
    """Test complete upload flow from file to CDN URL."""
    # Override some settings for this specific test
    mock_bunny_settings.bunny_storage_zone = "catatlas"
    mock_bunny_settings.bunny_cdn_hostname = "catatlas.b-cdn.net"
    mock_bunny_settings.bunny_storage_url = "https://de.storage.bunnycdn.com/catatlas"
    mock_bunny_settings.bunny_cdn_url = "https://catatlas.b-cdn.net"

    bunny_circuit_breaker.state = "CLOSED"
    bunny_circuit_breaker.failures = 0

    # Create realistic test image
    img = Image.new("RGB", (800, 600), color="green")
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="JPEG", quality=85)
    img_content = img_bytes.getvalue()

    mock_file = Mock(spec=UploadFile)
    mock_file.content_type = "image/jpeg"
    mock_file.size = len(img_content)
    mock_file.filename = "cat_sighting.jpg"
    # Make read async
    async def async_read():
        return img_content
    mock_file.read = async_read

    # Mock successful upload
    with patch("image_upload.requests.put") as mock_put:
        mock_response = Mock()
        mock_response.status_code = 201
        mock_put.return_value = mock_response

        # Execute
        cdn_url = await upload_to_bunny(mock_file, folder="sightings")

        # Verify URL structure
        assert cdn_url.startswith("https://catatlas.b-cdn.net/sightings/")
        assert cdn_url.endswith(".jpg")
        assert len(cdn_url.split("/")[-1]) > 20  # Has timestamp and UUID

        # Verify API call
        call_args = mock_put.call_args
        assert "de.storage.bunnycdn.com" in call_args[0][0]
        assert call_args[1]["headers"]["AccessKey"] == "test-api-key"
        assert call_args[1]["data"] == img_content
