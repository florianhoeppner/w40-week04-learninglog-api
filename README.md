# CatAtlas - Learning Log API

A community-driven platform for tracking feral/stray cat sightings with AI-powered insights.

> **Note:** Next week, we'll make the backend URL stable via actual hosting and pipeline-driven deployment.

---

## Description

CatAtlas helps communities track and care for feral and stray cats by:
- Logging cat sightings with notes, photos, locations, and nicknames
- Creating cat identities and linking sightings
- Generating AI-powered insights (summaries, tags, temperament analysis)
- Finding potential duplicate sightings
- Building comprehensive cat profiles from multiple sightings

## Features

- **Sighting Management**: Create, view, and analyze cat sightings
- **Cat Profiles**: Track individual cats across multiple sightings
- **AI Analysis**: Automated tag generation, temperament detection, and insights
- **Duplicate Detection**: Find similar sightings using text and location matching
- **Care Recommendations**: Generate actionable insights for cat care
- **RESTful API**: Full-featured FastAPI backend with automatic documentation

## Tech Stack

### Backend
- **FastAPI** - Modern async web framework
- **SQLite** - Lightweight database
- **Pydantic** - Data validation
- **pytest** - Testing framework

### Frontend
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Fast build tool

## Prerequisites

- **Backend**: Python 3.11+
- **Frontend**: Node.js 18+
- Docker (optional, for containerized deployment)

## Installation

### Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt  # For development
```

### Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install
```

## Usage

### Running the Backend

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at:
- **API**: http://localhost:8000
- **Interactive Docs**: http://localhost:8000/docs
- **Alternative Docs**: http://localhost:8000/redoc

### Running the Frontend

```bash
cd frontend
npm run dev
```

The frontend will be available at http://localhost:5173

### Running Tests

```bash
cd backend
source .venv/bin/activate
pytest -v
```

### Docker Deployment

```bash
# Build and run backend
cd backend
docker build -t catatlas-backend .
docker run -p 8000:8000 catatlas-backend
```

## API Endpoints

### Health
- `GET /health` - Health check

### Sightings
- `GET /entries` - List all sightings
- `POST /entries` - Create new sighting
- `POST /entries/{id}/analyze` - Generate AI analysis
- `GET /entries/{id}/analysis` - Get cached analysis
- `POST /entries/{id}/favorite` - Mark as favorite
- `GET /entries/{id}/matches` - Find similar sightings

### Cats
- `POST /cats` - Create cat identity
- `GET /cats` - List all cats
- `GET /cats/{id}/profile` - Get cat profile
- `POST /cats/{id}/insights` - Generate AI insights
- `POST /cats/{id}/entries/{entry_id}` - Link sighting to cat

## Environment Variables

### Backend

Create a `.env` file in the `backend/` directory:

```bash
# CORS Configuration
CORS_ORIGINS=http://localhost:5173,https://your-frontend-domain.com

# Database
CATATLAS_DB_PATH=./learninglog.db
```

### Frontend

Create a `.env` file in the `frontend/` directory:

```bash
# API Base URL
VITE_API_BASE=http://localhost:8000
```

## Step 8 — Verify the Full Pipeline (Launch Runbook)

### 8.1 Local Verification (before pushing)

**Backend:**
```bash
cd backend
source .venv/bin/activate
pytest -q
uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend
npm run lint
npm run build
npm run preview
```

### 8.2 Push and Deploy

```bash
git add .
git commit -m "Your commit message"
git push origin main
```

GitHub Actions will automatically:
- Run backend tests
- Build frontend
- Deploy to GitHub Pages (frontend)

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/florianhoeppner/w40-week04-learninglog-api/issues).

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pytest` for backend, `npm run lint` for frontend)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Contact

For questions or feedback, please open an issue on GitHub or contact the maintainer.

---

**Project Status**: Active Development 🚧
