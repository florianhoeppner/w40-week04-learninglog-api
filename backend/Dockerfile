# Production image for FastAPI with PostgreSQL support
FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffer issues
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies
# Note: psycopg2-binary is used for simplicity. For production at scale,
# consider using psycopg2 with: apt-get install -y libpq-dev gcc
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Force cache invalidation for code changes
# Build timestamp: 2026-01-24_cursor_fix_v2
ARG CACHEBUST=2
RUN echo "Cache bust: $CACHEBUST"

# Copy app
COPY . /app

# Expose port (Railway uses $PORT env var, but default to 8000 for local testing)
EXPOSE 8000

# Start server
# Railway automatically sets PORT env var, uvicorn will use it via --port $PORT
# For local Docker testing, defaults to port 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
