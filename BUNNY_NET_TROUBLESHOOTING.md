# Bunny.net Upload Troubleshooting Guide

## Current Issue
Image uploads are failing with 503 errors after retry attempts. The configuration appears correct but the actual API calls are failing.

## Quick Diagnosis

### Step 1: Verify Railway Environment Variables

Check these in Railway dashboard → Settings → Environment Variables:

```
BUNNY_STORAGE_ZONE=catatlas
BUNNY_API_KEY=223fa2de-3dba-40b0-b6b7949d7804-30b2-4077
BUNNY_STORAGE_REGION=de
BUNNY_CDN_HOSTNAME=catatlas.b-cdn.net
```

### Step 2: Check Bunny.net Dashboard

1. Go to https://dash.bunny.net/
2. Navigate to **Storage** → **Storage Zones**
3. Verify:
   - ✅ Storage zone `catatlas` exists
   - ✅ Region is set to `Germany (de)` - **NOT** Falkenstein
   - ✅ Zone is **Active** (not suspended)

### Step 3: Verify API Key Permissions

1. In Bunny.net dashboard: **Account** → **API Keys**
2. Find your Storage API key
3. Check:
   - ✅ Key has **Read & Write** permissions
   - ✅ Key is **not expired**
   - ✅ Using **Storage API Key** (NOT Account API Key)

## Common Issues & Fixes

### Issue 1: Wrong API Key Type ⚠️ **MOST COMMON**

**Problem**: Used Account API Key instead of Storage API Key

**Symptoms**: 401 Unauthorized or 403 Forbidden

**Fix**:
1. Go to Bunny.net → **Storage** → **Storage Zones** → Click `catatlas`
2. Click **"FTP & API Access"** tab
3. Copy the **Storage API Key** (under "Storage API Key" section)
4. Update `BUNNY_API_KEY` in Railway with this key
5. Redeploy

### Issue 2: Wrong Storage Zone Region

**Problem**: Zone is in different region than configured

**Symptoms**: 404 Not Found

**Fix**:
1. Check actual region in Bunny.net dashboard
2. Update `BUNNY_STORAGE_REGION` in Railway:
   - `de` = Germany (Frankfurt)
   - `ny` = New York
   - `la` = Los Angeles
   - `sg` = Singapore
   - `syd` = Sydney
   - `uk` = United Kingdom

### Issue 3: Storage Zone Doesn't Exist

**Problem**: Zone name typo or zone was deleted

**Symptoms**: 404 Not Found

**Fix**:
1. Verify exact zone name in Bunny.net dashboard
2. Check for typos in `BUNNY_STORAGE_ZONE`
3. Ensure zone matches CDN hostname (e.g., `catatlas` → `catatlas.b-cdn.net`)

### Issue 4: Insufficient Permissions

**Problem**: API key lacks write permissions

**Symptoms**: 403 Forbidden

**Fix**:
1. Generate new Storage API Key with Read & Write permissions
2. Update in Railway

### Issue 5: Network/Firewall Issues

**Problem**: Railway → Bunny.net connection blocked

**Symptoms**: Connection timeout, no response

**Fix**:
- This is rare with Railway
- Check Bunny.net status page: https://status.bunny.net/

## Debugging Steps

### 1. Check Railway Logs for Full Error

With the updated code, Railway logs should now show:
```
❌ Bunny.net API Error: [full error message]
```

Look for this line to see the actual error from Bunny.net.

### 2. Run Diagnostic Script Locally

```bash
cd backend
python debug_bunny.py
```

This will test:
- ✅ Configuration is set
- ✅ Can list files in storage zone
- ✅ Can upload a test file
- ✅ Can delete the test file

### 3. Test with curl

Test the API directly:

```bash
# Replace with your actual values
ZONE="catatlas"
API_KEY="your-api-key-here"
REGION="de"

# Test listing files
curl -X GET \
  "https://${REGION}.storage.bunnycdn.com/${ZONE}/" \
  -H "AccessKey: ${API_KEY}"

# Expected: 200 OK with JSON array of files
# If 401: Invalid API key
# If 404: Wrong zone name or region
```

## Expected Behavior (Working)

When working correctly, Railway logs should show:

```
☁️  Bunny.net: configured (de region)
INFO: "POST /entries/with-image HTTP/1.1" 200 OK
```

No retry attempts should appear.

## Next Steps

1. **Check API key type** - This is the #1 cause of failures
2. **Run diagnostic script** locally to test connection
3. **Check Railway logs** for the full error message (now included)
4. **Verify zone exists** in Bunny.net dashboard
5. **Test with curl** to isolate the issue

## Still Not Working?

If none of the above helps:

1. Create a **new storage zone** in Bunny.net dashboard
2. Generate a **new Storage API key** for that zone
3. Update all 4 environment variables in Railway
4. Redeploy

## Related Files

- `backend/image_upload.py` - Upload logic with retry/circuit breaker
- `backend/config.py` - Configuration loading
- `backend/debug_bunny.py` - Diagnostic script
- `BUNNY_NET_SETUP.md` - Initial setup guide
