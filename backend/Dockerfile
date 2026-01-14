# Simple production-ish image for FastAPI
FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffer issues
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy app
COPY . /app

# Expose port
EXPOSE 8000

# Start server
# Note: using a single worker for now (simple).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
