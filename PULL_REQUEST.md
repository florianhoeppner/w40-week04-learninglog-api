# feat: Add image upload with Bunny.net CDN integration

## Summary

Implements complete image upload functionality for cat sightings using **Bunny.net CDN Storage** (EU-based, GDPR compliant). This PR includes full backend/frontend implementation, comprehensive test coverage, and production-ready resiliency patterns.

---

## Backend Changes

### New Dependencies
- `requests==2.31.0` - HTTP client for Bunny.net API
- `pillow==11.2.0` - Image validation and processing
- `pytest-asyncio>=0.25.2` - Async test support

### Configuration (`backend/config.py`)
Added Bunny.net configuration properties:
- `bunny_storage_zone` - Storage zone name (e.g., "catatlas")
- `bunny_api_key` - Storage API key for authentication
- `bunny_storage_region` - EU region code (de/uk/se/fr)
- `bunny_cdn_hostname` - CDN hostname for serving images
- `max_upload_size_mb` - Maximum upload size (10MB default)
- `allowed_image_types` - Allowed MIME types

### Image Upload Module (`backend/image_upload.py`) - NEW
**Resiliency Patterns:**
- ✅ **Circuit Breaker** - Prevents cascading failures (opens after 5 failures, 60s timeout)
- ✅ **Retry Logic** - Exponential backoff (3 attempts: 1s, 2s, 4s delays)
- ✅ **Timeout Handling** - 30s for uploads, 10s for deletes
- ✅ **Graceful Degradation** - Deletes fail softly without exceptions

**Functions:**
- `validate_bunny_config()` - Validates environment configuration
- `validate_image_file()` - Validates file metadata (type, size)
- `validate_image_content()` - Deep validation using PIL (detects fake images)
- `upload_to_bunny()` - Uploads to Bunny.net Storage, returns CDN URL
- `delete_from_bunny()` - Deletes images when replaced

### API Endpoints (`backend/main.py`)
**3 new endpoints:**
1. `POST /upload/image` - Standalone image upload
   - Returns: `{"url": "https://catatlas.b-cdn.net/sightings/abc123.jpg"}`
2. `POST /entries/with-image` - Create cat sighting with image (multipart)
   - Form fields: `text`, `nickname`, `location`, `image`
3. `PATCH /entries/{id}/image` - Add/replace image on existing entry
   - Automatically deletes old image if present

### Test Coverage (`backend/tests/test_image_upload.py`) - NEW
**21 tests, all passing:**
- Validation tests (7) - File type, size, content, dimensions
- Circuit breaker tests (4) - State transitions, failure recovery
- Upload tests (6) - Success flow, retries, error handling
- Delete tests (3) - Deletion, idempotency, graceful failures
- Integration test (1) - End-to-end upload flow

---

## Frontend Changes

### New Dependencies
- `@tanstack/react-query@5.66.3` - Data fetching and caching
- `vitest@3.0.2` - Testing framework
- `@testing-library/react@16.2.0` - React component testing
- `@testing-library/user-event@14.6.1` - User interaction testing
- `jsdom@26.0.0` - DOM environment for tests

### Resilient API Client (`frontend/src/api/client.ts`) - NEW
**Features:**
- ✅ **Circuit Breaker** - Prevents hammering failing APIs
- ✅ **Retry Logic** - Exponential backoff with jitter
- ✅ **Timeout Handling** - Configurable per-request timeouts
- ✅ **Error Classification** - Distinguishes transient vs permanent errors
- ✅ **Request Deduplication** - Prevents duplicate in-flight requests

### Upload Utilities (`frontend/src/api/upload.ts`) - NEW
**Functions:**
- `validateImageFile()` - Client-side validation (10MB max, allowed types)
- `uploadImage()` - Standalone image upload
- `createEntryWithImage()` - Create entry with image (multipart)
- `updateEntryImage()` - Update existing entry's image

**Constants:**
- `MAX_FILE_SIZE = 10MB`
- `ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]`

### ImageUpload Component (`frontend/src/components/ImageUpload.tsx`) - NEW
**Features:**
- ✅ File input with validation
- ✅ Live image preview using FileReader
- ✅ Error display with user-friendly messages
- ✅ Remove button to clear selection
- ✅ Disabled state during upload
- ✅ Shows file size and type restrictions

### Updated App Component (`frontend/src/App.tsx`)
- Integrated `ImageUpload` component into cat sighting form
- Added `photoFile` state management
- Updated `addSighting()` to use multipart endpoint when image present
- Fallback to JSON endpoint when no image attached

### Frontend Test Coverage
**270+ tests across 6 test suites:**
- API client tests - Retry, circuit breaker, timeout, deduplication
- Error handling tests - Classification, user messages, recovery
- Hook tests - `useApi`, `useMutation` with loading states
- Utility tests - Retry logic, timeout handling, error utilities

---

## Documentation

### Setup Guide (`BUNNY_NET_SETUP.md`) - NEW
Complete step-by-step guide including:
- Account creation
- Storage zone setup in EU region
- API key retrieval
- Railway environment variable configuration
- Testing instructions
- Troubleshooting guide
- Region codes reference
- Pricing breakdown

---

## Configuration Required

### Railway Environment Variables
Add these 4 variables to deploy:
```
BUNNY_STORAGE_ZONE=catatlas
BUNNY_API_KEY=<your-storage-api-key>
BUNNY_STORAGE_REGION=de
BUNNY_CDN_HOSTNAME=catatlas.b-cdn.net
```

**Cost:** ~€0.30/month (~$0.33 USD) for typical usage
**Region:** EU-based (Germany) - GDPR compliant

---

## Testing

### Backend Tests
```bash
cd backend
pytest tests/test_image_upload.py -v
# 21 tests, all passing ✅
```

### Frontend Tests
```bash
cd frontend
npm test
# 270+ tests, all passing ✅
```

### Manual Testing
1. Configure Bunny.net credentials in Railway
2. Deploy backend (Railway auto-deploys)
3. Deploy frontend (Vercel auto-deploys)
4. Open frontend, add cat sighting with image
5. Verify image uploads and displays correctly

---

## Architecture Decisions

### Why Bunny.net?
- ✅ EU-based company (Slovenia) - GDPR compliant
- ✅ Built-in CDN - Fast image delivery worldwide
- ✅ Low cost - €0.01/GB storage + €0.01/GB bandwidth
- ✅ REST API - Simple integration, no SDK required
- ✅ Multiple EU regions - de, uk, se, fr, pl, es, it

### Why Circuit Breaker + Retry?
- **Transient failures** (network glitches) are common in distributed systems
- **Circuit breaker** prevents cascading failures when Bunny.net is down
- **Retry with backoff** handles temporary issues automatically
- **Graceful degradation** keeps app working even if uploads fail

### Why Multipart Form Upload?
- Required for file uploads (can't send files as JSON)
- Allows combining image with text data in single request
- Standard approach for file uploads in REST APIs

---

## Breaking Changes

None. All changes are additive. Existing API endpoints remain unchanged.

---

## Next Steps After Merge

1. ✅ Configure Bunny.net account (5 minutes)
2. ✅ Add environment variables to Railway
3. ✅ Test image upload in production
4. ✅ Monitor Railway logs for "☁️  Bunny.net: configured (de region)"
5. ✅ (Optional) Add image display to entry list view

---

## Screenshots

### Before (no image upload):
- Text-only cat sightings

### After (with image upload):
- Form includes "Photo (optional)" section
- Live image preview before upload
- Images stored in Bunny.net CDN
- Fast loading via global CDN

---

## Files Changed
- **34 files changed**: 6,464 insertions, 343 deletions
- **New files**: 16 (modules, tests, docs)
- **Modified files**: 18 (integration updates)

See full diff for details.

---

## Branch Information
- **Source branch**: `claude/explain-codebase-mkesuqw6xcucck95-UHXbi`
- **Target branch**: `main`
- **Commits**: 6 commits (see git log for details)
