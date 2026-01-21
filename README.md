# CatAtlas Learning Log API

> A community-driven platform for tracking and enriching feral/stray cat sightings using text-based AI analysis.

[![CI](https://github.com/florianhoeppner/w40-week04-learninglog-api/actions/workflows/ci.yml/badge.svg)](https://github.com/florianhoeppner/w40-week04-learninglog-api/actions/workflows/ci.yml)

---

## Overview

CatAtlas enables users to:
- 🐱 Log cat sightings with notes, locations, and photos
- 🤖 Enrich sightings with AI analysis (summaries, tags, temperament)
- 🔍 Find similar sightings through text-based matching
- 📊 Create cat profiles with aggregated insights
- 📈 Browse community statistics

## Tech Stack

### Backend
- **Framework:** FastAPI
- **Database:** SQLite
- **Configuration:** Pydantic Settings with environment validation
- **Testing:** pytest
- **Deployment:** Docker + GitHub Container Registry

### Frontend
- **Framework:** React 19 + TypeScript
- **Build Tool:** Vite
- **Deployment:** GitHub Pages

---

## Environment Setup

### Prerequisites
- **Backend:** Python 3.10+ (3.11 recommended)
- **Frontend:** Node.js 20+
- **Tools:** Git, pip, npm

### Backend Environment Configuration

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```

3. **Generate a secure JWT secret:**
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```

4. **Update `.env` with the generated secret:**
   ```bash
   # Open .env in your editor and replace the JWT_SECRET value
   JWT_SECRET=<your-generated-secret-from-step-3>
   ```

5. **Review and customize other settings** (optional):
   ```bash
   # .env file structure:
   DEBUG=True                                    # Set to False for production
   ALLOWED_ORIGINS=http://localhost:5173        # Frontend URL(s), comma-separated
   RATE_LIMIT_PER_MINUTE=100                    # API rate limit
   DATABASE_PATH=learninglog.db                 # SQLite database location
   ```

### Frontend Environment Configuration

1. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```

3. **Verify the API URL** (should point to your backend):
   ```bash
   # Default for local development:
   VITE_API_BASE=http://localhost:8000
   ```

### Environment Variables Reference

#### Backend (`backend/.env`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `JWT_SECRET` | Secret key for JWT tokens | ✅ Yes | - |
| `DEBUG` | Enable debug mode | No | `False` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | No | `http://localhost:5173` |
| `DATABASE_PATH` | SQLite database file path | No | `learninglog.db` |
| `RATE_LIMIT_PER_MINUTE` | Global API rate limit | No | `100` |
| `AUTH_RATE_LIMIT_PER_MINUTE` | Auth endpoints rate limit | No | `5` |
| `JWT_ALGORITHM` | JWT signing algorithm | No | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT token expiry time | No | `30` |
| `SENTRY_DSN` | Sentry error tracking DSN (optional) | No | - |

#### Frontend (`frontend/.env`)

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VITE_API_BASE` | Backend API URL | ✅ Yes | `http://localhost:8000` |
| `VITE_APP_NAME` | Application name | No | `CatAtlas` |
| `VITE_ENABLE_ANALYTICS` | Enable analytics | No | `false` |

---

## Installation

### Backend Setup

```bash
# 1. Navigate to backend
cd backend

# 2. Create virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Install dev dependencies (for testing)
pip install -r requirements-dev.txt

# 5. Configure environment (see Environment Setup section above)
cp .env.example .env
# Edit .env and set JWT_SECRET

# 6. Initialize database (automatic on first run)
# The database will be created when you start the server

# 7. Run the server
uvicorn main:app --reload
```

Backend will be available at: http://localhost:8000

API documentation: http://localhost:8000/docs

### Frontend Setup

```bash
# 1. Navigate to frontend
cd frontend

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Verify VITE_API_BASE points to your backend

# 4. Run development server
npm run dev
```

Frontend will be available at: http://localhost:5173

---

## Running Tests

### Backend Tests

```bash
cd backend

# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_config.py -v

# Run with coverage
pytest --cov=. --cov-report=html
```

**Current test coverage:** 12 tests covering:
- Configuration validation (5 tests)
- API endpoints (4 tests)
- AI insights (2 tests)
- Health check (1 test)

### Frontend Tests

Currently no frontend tests configured. Planned for Phase 3.

---

## Development Workflow

### Local Development

1. **Start backend:**
   ```bash
   cd backend
   uvicorn main:app --reload
   ```

2. **Start frontend** (in another terminal):
   ```bash
   cd frontend
   npm run dev
   ```

3. **Make changes** and test locally

4. **Run tests** before committing:
   ```bash
   cd backend
   pytest -q
   ```

### Creating a Commit

```bash
# Stage your changes
git add .

# Commit with conventional commit message
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in API"
git commit -m "docs: update README"

# Push to your branch
git push
```

---

## API Endpoints

### Health Check
```
GET /health
```

### Entries (Cat Sightings)
```
GET    /entries                    # List all sightings
POST   /entries                    # Create new sighting
POST   /entries/{id}/favorite      # Toggle favorite
POST   /entries/{id}/analyze       # AI enrichment (cached)
GET    /entries/{id}/analysis      # Get existing analysis
GET    /entries/{id}/matches       # Find similar sightings
POST   /entries/{id}/assign/{cat_id}  # Link to cat profile
```

### Cats (Profiles)
```
POST   /cats                       # Create cat profile
GET    /cats                       # List all cats
GET    /cats/{id}/profile          # Get cat profile with sightings
POST   /cats/{id}/insights         # Generate AI insights (4 modes)
```

Full API documentation available at: http://localhost:8000/docs

---

## Deployment

### Production Checklist

Before deploying to production:

- [ ] Set `DEBUG=False` in backend `.env`
- [ ] Generate secure `JWT_SECRET` (32+ characters)
- [ ] Configure `ALLOWED_ORIGINS` to your actual domain(s)
- [ ] Set up `SENTRY_DSN` for error tracking (optional)
- [ ] Verify all tests pass (`pytest`)
- [ ] Build frontend for production (`npm run build`)

### Backend Deployment

Docker image is automatically built and pushed to GitHub Container Registry:

```bash
# Pull the latest image
docker pull ghcr.io/florianhoeppner/catatlas-backend:latest

# Run with environment variables
docker run -p 8000:8000 \
  -e JWT_SECRET=your-production-secret \
  -e DEBUG=False \
  -e ALLOWED_ORIGINS=https://your-domain.com \
  ghcr.io/florianhoeppner/catatlas-backend:latest
```

**Recommended platforms:**
- Railway (easy deployment from Docker image)
- Render (supports Docker deployment)
- AWS/GCP/Azure (full control)

### Frontend Deployment

Automatically deployed to GitHub Pages on push to `main`:
- https://florianhoeppner.github.io/w40-week04-learninglog-api/

Update `VITE_API_BASE` in frontend `.env` before building for production.

---

## Project Structure

```
w40-week04-learninglog-api/
├── backend/
│   ├── main.py              # FastAPI application (1,157 lines)
│   ├── config.py            # Environment configuration
│   ├── requirements.txt     # Python dependencies
│   ├── .env.example         # Environment template
│   ├── Dockerfile           # Container definition
│   ├── tests/
│   │   ├── test_api.py      # API integration tests
│   │   ├── test_config.py   # Configuration tests
│   │   ├── test_health.py   # Health check tests
│   │   └── test_insights.py # AI insights tests
│   └── learninglog.db       # SQLite database (gitignored)
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Main React component (754 lines)
│   │   └── main.tsx         # React entry point
│   ├── package.json         # Node dependencies
│   ├── .env.example         # Environment template
│   └── vite.config.ts       # Vite configuration
│
├── .github/
│   └── workflows/
│       ├── ci.yml           # Test & build automation
│       ├── docker-backend.yml  # Docker image build
│       └── pages.yml        # GitHub Pages deployment
│
└── docs/
    ├── PHASE1_IMPLEMENTATION.md       # Phase 1 implementation guide
    └── PHASE1_PART1_DETAILED_PLAN.md  # Environment management plan
```

---

## Configuration Security

### Important Security Notes

1. **Never commit `.env` files** to version control
   - `.env.example` is safe (contains no secrets)
   - `.env` is gitignored and contains secrets

2. **JWT Secret Requirements:**
   - Must be at least 32 characters in production
   - Use `secrets.token_hex(32)` to generate secure secrets
   - Production mode validates and rejects weak secrets

3. **CORS Configuration:**
   - Development: `localhost:5173` is allowed by default
   - Production: Must set specific domain(s), no wildcards (`*`)
   - The app will refuse to start with wildcard CORS in production

4. **Environment Isolation:**
   - Development: `DEBUG=True`, weak secrets allowed
   - Production: `DEBUG=False`, strict validation enforced

---

## Troubleshooting

### Backend won't start

**Error: "Field required" for JWT_SECRET**
```bash
# Solution: Set JWT_SECRET in .env
cp .env.example .env
python3 -c "import secrets; print(secrets.token_hex(32))"
# Copy the output and set JWT_SECRET in .env
```

**Error: "JWT_SECRET must be changed in production"**
```bash
# Solution: Don't use placeholder value in production
# Set DEBUG=True for development, or generate new secret
```

### Frontend can't connect to backend

**Error: CORS policy blocking requests**
```bash
# Solution: Add frontend URL to ALLOWED_ORIGINS in backend/.env
ALLOWED_ORIGINS=http://localhost:5173
```

**Error: Network error**
```bash
# Solution: Verify backend is running and VITE_API_BASE is correct
# Backend should be at http://localhost:8000
# Check frontend/.env: VITE_API_BASE=http://localhost:8000
```

### Tests failing

**Error: "No module named 'pydantic'"**
```bash
# Solution: Install dependencies
cd backend
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Configure environment variables (copy `.env.example` to `.env`)
4. Make your changes
5. Run tests (`pytest -v`)
6. Commit your changes (`git commit -m 'feat: add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

---

## Roadmap

### Phase 1: Foundation ✅
- [x] Environment Management (Pydantic Settings)
- [ ] Authentication (JWT, user accounts)
- [ ] Security Hardening (rate limiting, input sanitization)

### Phase 2: Infrastructure
- [ ] Database Migrations (Alembic)
- [ ] Automated Deployment (Railway/Render)
- [ ] Monitoring & Logging (Sentry)

### Phase 3: Quality
- [ ] Code Refactoring (modular architecture)
- [ ] Frontend Tests (Vitest + Playwright)

### Phase 4: Polish
- [ ] CI/CD Enhancements (semantic versioning)
- [ ] API Documentation (comprehensive guides)

---

## License

This project is open source and available under the MIT License.

## Contact

- **GitHub:** [@florianhoeppner](https://github.com/florianhoeppner)
- **Issues:** [GitHub Issues](https://github.com/florianhoeppner/w40-week04-learninglog-api/issues)

---

**Next week:** Make the backend URL stable via actual hosting and pipeline-driven deployment.
