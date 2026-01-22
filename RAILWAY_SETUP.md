# Railway Deployment Guide - Environment Variables

## Step 2: Configure Environment Variables in Railway

Once your PR is merged, set these environment variables in Railway:

### How to Add Variables:
1. Go to Railway dashboard: https://railway.app/dashboard
2. Select your project
3. Click on your service (backend)
4. Go to **"Variables"** tab
5. Click **"+ New Variable"** for each one below

---

## Required Environment Variables

### 1. JWT_SECRET (REQUIRED)
**Purpose:** Secures authentication tokens

**Value:**
```
129c32580a7a6feaacba8fc6f09b05ba7bbdfe227fc1dba548810273621dfdc3
```

**How to add:**
- Variable name: `JWT_SECRET`
- Value: Copy the value above

---

### 2. DEBUG (REQUIRED)
**Purpose:** Disables debug mode for production

**Value:**
```
False
```

**How to add:**
- Variable name: `DEBUG`
- Value: `False`

---

### 3. ALLOWED_ORIGINS (REQUIRED)
**Purpose:** CORS security - allows frontend to call API

**Value:**
```
https://florianhoeppner.github.io
```

**How to add:**
- Variable name: `ALLOWED_ORIGINS`
- Value: `https://florianhoeppner.github.io`

**Note:** If you deploy frontend elsewhere, add it comma-separated:
```
https://florianhoeppner.github.io,https://your-custom-domain.com
```

---

### 4. DATABASE_URL (Auto-configured by Railway)
**Purpose:** PostgreSQL connection string

**Value:**
```
${{Postgres.DATABASE_URL}}
```

**How to add:**
- Railway auto-adds this when you create a PostgreSQL database
- If not auto-added, use the value above (it's a Railway reference)

---

### 5. DATABASE_TYPE (REQUIRED after adding PostgreSQL)
**Purpose:** Tells app to use PostgreSQL instead of SQLite

**Value:**
```
postgresql
```

**How to add:**
- Variable name: `DATABASE_TYPE`
- Value: `postgresql`

**IMPORTANT:** Only add this AFTER you add the PostgreSQL database (Step 3)

---

## Optional Environment Variables

### 6. PORT (Auto-configured by Railway)
Railway automatically sets this. Don't manually add it.

---

### 7. SENTRY_DSN (Optional - for error monitoring)
**Purpose:** Send errors to Sentry for monitoring

**Value:**
```
(leave empty for now, or add your Sentry DSN if you have one)
```

---

### 8. LOG_LEVEL (Optional)
**Purpose:** Control logging verbosity

**Value:**
```
INFO
```

**How to add:**
- Variable name: `LOG_LEVEL`
- Value: `INFO`

---

## Summary of Variables to Add NOW (before PostgreSQL):

1. `JWT_SECRET` = `129c32580a7a6feaacba8fc6f09b05ba7bbdfe227fc1dba548810273621dfdc3`
2. `DEBUG` = `False`
3. `ALLOWED_ORIGINS` = `https://florianhoeppner.github.io`
4. `LOG_LEVEL` = `INFO` (optional)

## Summary of Variables to Add AFTER PostgreSQL:

5. `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (auto-added by Railway)
6. `DATABASE_TYPE` = `postgresql`

---

## Next Steps:

After adding these variables:
1. Railway will automatically trigger a new deployment
2. Wait for deployment to complete
3. Proceed to Step 3 (Add PostgreSQL Database)

---

## Verification:

Once deployed, test your API:
```bash
curl https://your-app.up.railway.app/health
```

Should return:
```json
{"status":"ok"}
```
