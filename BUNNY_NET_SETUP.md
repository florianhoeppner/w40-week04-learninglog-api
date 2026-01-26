# Bunny.net Setup Guide for CatAtlas Image Upload

This guide will help you set up Bunny.net CDN Storage for image uploads in CatAtlas.

## Why Bunny.net?

- **EU-based**: Company located in Slovenia 🇸🇮
- **GDPR compliant**: All data can be stored in EU data centers
- **Cost-effective**: ~€0.30/month for 10GB storage + 20GB bandwidth
- **Fast**: Built-in CDN with image optimization
- **Simple**: Easy REST API integration

## Step 1: Create Bunny.net Account

1. Go to: https://bunny.net/
2. Click "Sign Up" (top right)
3. Enter your email and create a password
4. Verify your email address
5. Log in to the Bunny.net dashboard

**Cost**: Free to create account, pay-as-you-go pricing

## Step 2: Create a Storage Zone

1. In Bunny.net dashboard, go to **Storage** (left sidebar)
2. Click **"Add Storage Zone"** button
3. Configure your storage zone:
   - **Storage Zone Name**: `catatlas` (or your preferred name)
   - **Region**: Select **Frankfurt, Germany (de)** for EU storage
     - Other EU options: London (uk), Stockholm (se), Paris (fr)
   - **Replication**: Leave disabled (not needed for MVP)
   - **Edge Replication**: Leave disabled (optional, costs extra)
4. Click **"Add Storage Zone"**

**What you get:**
- Storage endpoint: `https://de.storage.bunnycdn.com/catatlas/`
- CDN hostname: `catatlas.b-cdn.net`

## Step 3: Get Your API Key

1. On the Storage Zone page, find your storage zone (`catatlas`)
2. Click on it to open details
3. Look for **"FTP & API Access"** section
4. Find **"Password / API Key"**:
   - Click the "eye" icon to reveal
   - Click "Copy" to copy the API key
5. **Save this key securely** - you'll need it for Railway

**Note**: This is the **Storage API Key**, different from your account API key.

## Step 4: Configure Railway Environment Variables

Now add the Bunny.net credentials to your Railway backend service:

1. Go to: https://railway.app
2. Select your **CatAtlas backend project**
3. Click on your **backend service**
4. Go to the **Variables** tab
5. Add these environment variables:

```bash
BUNNY_STORAGE_ZONE=catatlas
BUNNY_API_KEY=your-storage-api-key-from-step-3
BUNNY_STORAGE_REGION=de
BUNNY_CDN_HOSTNAME=catatlas.b-cdn.net
```

**Replace**:
- `catatlas` with your actual storage zone name (if different)
- `your-storage-api-key-from-step-3` with the API key you copied
- `de` with your region code if you chose a different region
- `catatlas.b-cdn.net` with your actual CDN hostname

6. Click **"Add"** or **"Save"** for each variable
7. Railway will **automatically redeploy** your backend

## Step 5: Verify Configuration

After Railway finishes deploying (takes ~30 seconds):

1. Check Railway deployment logs
2. Look for this line in the startup logs:
   ```
   ☁️  Bunny.net: configured (de region)
   ```
3. If you see this, configuration is successful!
4. If you see `⚠️  Bunny.net: not configured`, double-check your environment variables

## Step 6: Test Image Upload

### Test from Command Line (Backend Only)

```bash
# Test upload endpoint
curl -X POST https://your-backend.up.railway.app/upload/image \
  -F "file=@/path/to/test-image.jpg"

# Should return:
# {"url":"https://catatlas.b-cdn.net/sightings/20260126_abc123.jpg"}
```

### Test from Frontend

1. Deploy your frontend (or run locally with `npm run dev`)
2. Open the CatAtlas app
3. Click "Add cat sighting"
4. Click the file input and select an image
5. See the preview appear
6. Fill in the form and submit
7. Image should appear in the sighting list

## Region Codes Reference

Choose the region closest to your users:

| Region | Code | Location |
|--------|------|----------|
| Germany | `de` | Frankfurt 🇩🇪 |
| United Kingdom | `uk` | London 🇬🇧 |
| Sweden | `se` | Stockholm 🇸🇪 |
| France | `fr` | Paris 🇫🇷 |
| Poland | `pl` | Warsaw 🇵🇱 |
| Spain | `es` | Madrid 🇪🇸 |
| Italy | `it` | Milan 🇮🇹 |

**US/Other regions** also available if needed (ny, la, sg, syd, br, af)

## Pricing Estimate

**For CatAtlas usage** (10GB storage, 20GB bandwidth/month):

```
Storage: 10GB × €0.01 = €0.10/month
Bandwidth: 20GB × €0.01 = €0.20/month
─────────────────────────────────────
Total: ~€0.30/month (~$0.33 USD)
```

**Free tier**: None, but pricing is so cheap it doesn't matter!

**Comparison**:
- Cloudinary free: $0 (but 10GB limit)
- Cloudinary paid: $99/month
- Bunny.net: €0.30/month (unlimited within budget)

## Troubleshooting

### "Bunny.net: not configured" in logs

**Problem**: Environment variables not set correctly

**Solution**:
1. Check all 4 variables are set in Railway
2. Verify no typos in variable names
3. Ensure API key is the **Storage API Key**, not account API key
4. Redeploy manually if needed

### "Upload failed: 401 Unauthorized"

**Problem**: API key is incorrect

**Solution**:
1. Go back to Bunny.net Storage Zone
2. Copy the API key again (FTP & API Access section)
3. Update `BUNNY_API_KEY` in Railway
4. Wait for redeploy

### "Upload failed: 404 Not Found"

**Problem**: Storage zone name or region mismatch

**Solution**:
1. Verify storage zone name matches `BUNNY_STORAGE_ZONE`
2. Verify region code matches `BUNNY_STORAGE_REGION`
3. Check storage zone exists in Bunny.net dashboard

### Images upload but don't display

**Problem**: CDN hostname incorrect

**Solution**:
1. Check `BUNNY_CDN_HOSTNAME` matches your Storage Zone's CDN hostname
2. In Bunny.net, go to Storage Zone details
3. Find "CDN Hostname" (e.g., `catatlas.b-cdn.net`)
4. Update variable in Railway (without `https://`)

### Images take long time to appear

**Normal**: First access can take 1-2 seconds as CDN caches the image
**After that**: Should load instantly from CDN edge servers

## Security Notes

1. **API Key Security**:
   - Never commit API keys to git
   - Only store in Railway environment variables
   - Rotate keys if exposed

2. **Access Control**:
   - Storage zone is private (only accessible via API key)
   - CDN URLs are public (anyone with URL can view)
   - This is normal for user-uploaded images

3. **File Validation**:
   - Backend validates file type (JPEG, PNG, WebP, GIF only)
   - Backend validates file size (max 10MB)
   - PIL validates actual image content (detects fake images)

## Monitoring Usage

1. Go to Bunny.net dashboard
2. Click **"Storage"** in sidebar
3. Click on your storage zone
4. View **"Statistics"** tab:
   - Total storage used
   - Bandwidth used this month
   - Number of files
   - Traffic by region

**Set alerts**:
- Monitor when approaching 10GB storage
- Monitor bandwidth usage
- Bunny.net will email if you exceed budget (can set in account settings)

## Next Steps

Once configured:

1. ✅ **Test locally**: Run backend + frontend locally
2. ✅ **Deploy backend**: Railway auto-deploys when you add env vars
3. ✅ **Deploy frontend**: Vercel/Netlify deployment
4. ✅ **Test production**: Upload image in production
5. ✅ **Monitor**: Check Bunny.net dashboard after first uploads

## Support

- **Bunny.net Docs**: https://docs.bunny.net/reference/storage-api
- **Bunny.net Support**: support@bunny.net
- **CatAtlas Issues**: https://github.com/florianhoeppner/w40-week04-learninglog-api/issues

---

**Estimated setup time**: 10-15 minutes

**Cost**: ~€0.30/month (~$0.33 USD) for typical usage

**Region**: EU-based, GDPR compliant ✅
