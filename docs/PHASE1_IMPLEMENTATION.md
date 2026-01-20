# Phase 1: Foundation - Detailed Implementation Guide

**Duration:** 10 days
**Objective:** Establish secure, production-ready foundation with authentication, environment management, and security hardening.

---

## Part 1: Environment Management (Days 1-2)

### Day 1: Backend Environment Setup

#### Task 1.1: Install Dependencies
```bash
cd /home/user/w40-week04-learninglog-api/backend

# Add to requirements.txt
echo "python-dotenv==1.0.0" >> requirements.txt
echo "pydantic-settings==2.1.0" >> requirements.txt

# Install
pip install -r requirements.txt
```

#### Task 1.2: Create Config Module

**File:** `backend/config.py`
```python
from pydantic_settings import BaseSettings
from typing import List, Optional
import os


class Settings(BaseSettings):
    """Application configuration with validation."""

    # Application
    app_name: str = "CatAtlas API"
    app_version: str = "1.0.0"
    debug: bool = False

    # Database
    database_path: str = "learninglog.db"

    # Authentication
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # Security
    allowed_origins: List[str] = ["http://localhost:5173"]
    rate_limit_per_minute: int = 100
    auth_rate_limit_per_minute: int = 5

    # Monitoring
    sentry_dsn: Optional[str] = None
    log_level: str = "INFO"

    # Feature Flags
    enable_registration: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = False

    def validate_production_settings(self):
        """Validate critical production settings."""
        if not self.debug:
            # Production mode - enforce strict requirements
            if self.jwt_secret == "change-me-in-production":
                raise ValueError("JWT_SECRET must be changed in production!")
            if "*" in self.allowed_origins:
                raise ValueError("ALLOWED_ORIGINS cannot include '*' in production!")

        return True


# Singleton instance
settings = Settings()

# Validate on import in production
if not settings.debug:
    settings.validate_production_settings()
```

#### Task 1.3: Create Environment Template

**File:** `backend/.env.example`
```bash
# Application
APP_NAME=CatAtlas API
APP_VERSION=1.0.0
DEBUG=True

# Database
DATABASE_PATH=learninglog.db

# Authentication (CHANGE IN PRODUCTION!)
JWT_SECRET=change-me-in-production-use-openssl-rand-hex-32
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# Security
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
RATE_LIMIT_PER_MINUTE=100
AUTH_RATE_LIMIT_PER_MINUTE=5

# Monitoring (Optional)
SENTRY_DSN=
LOG_LEVEL=INFO

# Feature Flags
ENABLE_REGISTRATION=True
```

**File:** `backend/.env` (for local development)
```bash
# Copy from .env.example and customize
cp .env.example .env

# Generate secure JWT secret
python3 -c "import secrets; print(f'JWT_SECRET={secrets.token_hex(32)}')" >> .env
```

#### Task 1.4: Update .gitignore

**File:** `.gitignore`
```bash
# Ensure these are present
.env
.env.local
.env.production
.env.*.local
backend/.env
frontend/.env
```

#### Task 1.5: Refactor main.py to Use Settings

**File:** `backend/main.py` (modifications)

```python
# Add at top of file (after imports)
from config import settings

# Update CORS middleware (around line 27)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,  # Changed from ["*"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Update database connection (around line 47)
DB_PATH = os.getenv("CATATLAS_DB_PATH", settings.database_path)

# Add startup event to log configuration
@app.on_event("startup")
async def startup_event():
    """Log configuration on startup (sanitized)."""
    print(f"🚀 Starting {settings.app_name} v{settings.app_version}")
    print(f"📊 Debug mode: {settings.debug}")
    print(f"🗄️  Database: {DB_PATH}")
    print(f"🔒 CORS allowed origins: {settings.allowed_origins}")
    print(f"⏱️  Rate limit: {settings.rate_limit_per_minute}/min")
    if settings.sentry_dsn:
        print(f"📡 Sentry monitoring: enabled")
```

### Day 2: Frontend Environment Setup & Testing

#### Task 1.6: Create Frontend Environment Template

**File:** `frontend/.env.example`
```bash
# API Configuration
VITE_API_BASE=http://localhost:8000

# Application
VITE_APP_NAME=CatAtlas
VITE_APP_VERSION=1.0.0

# Feature Flags
VITE_ENABLE_ANALYTICS=false
```

**File:** `frontend/.env` (for local development)
```bash
VITE_API_BASE=http://localhost:8000
VITE_APP_NAME=CatAtlas
VITE_APP_VERSION=1.0.0
VITE_ENABLE_ANALYTICS=false
```

#### Task 1.7: Create Environment Validation Tests

**File:** `backend/tests/test_config.py`
```python
import pytest
from pydantic import ValidationError
from config import Settings
import os


def test_settings_load_with_defaults():
    """Test settings load with default values."""
    # Set minimal required env vars
    os.environ["JWT_SECRET"] = "test-secret-key-at-least-32-characters-long"

    settings = Settings()

    assert settings.app_name == "CatAtlas API"
    assert settings.jwt_algorithm == "HS256"
    assert settings.rate_limit_per_minute == 100


def test_settings_require_jwt_secret():
    """Test that JWT_SECRET is required."""
    # Clear JWT_SECRET if set
    if "JWT_SECRET" in os.environ:
        del os.environ["JWT_SECRET"]

    with pytest.raises(ValidationError) as exc_info:
        Settings()

    assert "jwt_secret" in str(exc_info.value)


def test_settings_validate_production_mode():
    """Test production validation catches insecure defaults."""
    os.environ["JWT_SECRET"] = "change-me-in-production"
    os.environ["DEBUG"] = "False"

    settings = Settings()

    with pytest.raises(ValueError, match="JWT_SECRET must be changed"):
        settings.validate_production_settings()


def test_settings_from_env_file(tmp_path):
    """Test loading from .env file."""
    env_file = tmp_path / ".env"
    env_file.write_text("""
JWT_SECRET=secure-test-secret-key-32-chars
DEBUG=True
RATE_LIMIT_PER_MINUTE=200
""")

    settings = Settings(_env_file=str(env_file))

    assert settings.jwt_secret == "secure-test-secret-key-32-chars"
    assert settings.debug is True
    assert settings.rate_limit_per_minute == 200


def test_allowed_origins_parsing():
    """Test CORS origins can be set from comma-separated string."""
    os.environ["JWT_SECRET"] = "test-secret-32-characters-long-ok"
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:3000,https://example.com"

    settings = Settings()

    # Pydantic should parse comma-separated string to list
    assert len(settings.allowed_origins) >= 1
```

#### Task 1.8: Run Tests

```bash
cd backend
pytest tests/test_config.py -v

# Expected output:
# test_config.py::test_settings_load_with_defaults PASSED
# test_config.py::test_settings_require_jwt_secret PASSED
# test_config.py::test_settings_validate_production_mode PASSED
# test_config.py::test_settings_from_env_file PASSED
# test_config.py::test_allowed_origins_parsing PASSED
```

#### Task 1.9: Update Documentation

**File:** `README.md` (add Environment Setup section)
```markdown
## Environment Setup

### Backend

1. Copy the environment template:
   ```bash
   cd backend
   cp .env.example .env
   ```

2. Generate a secure JWT secret:
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```

3. Update `.env` with the generated secret:
   ```bash
   JWT_SECRET=<your-generated-secret>
   ```

4. Review and customize other settings as needed.

### Frontend

1. Copy the environment template:
   ```bash
   cd frontend
   cp .env.example .env
   ```

2. Verify `VITE_API_BASE` points to your backend (default: `http://localhost:8000`).

### Required Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `JWT_SECRET` | Secret key for JWT tokens | ✅ Yes | - |
| `DATABASE_PATH` | Path to SQLite database | No | `learninglog.db` |
| `ALLOWED_ORIGINS` | CORS allowed origins | No | `http://localhost:5173` |
| `DEBUG` | Enable debug mode | No | `False` |

See `.env.example` files for complete list.
```

---

## Part 2: Authentication (Days 3-7)

### Day 3: Authentication Module & User Models

#### Task 2.1: Install Authentication Dependencies

```bash
cd backend

# Add to requirements.txt
echo "python-jose[cryptography]==3.3.0" >> requirements.txt
echo "passlib[bcrypt]==1.7.4" >> requirements.txt
echo "python-multipart==0.0.6" >> requirements.txt

# Install
pip install -r requirements.txt
```

#### Task 2.2: Create Authentication Utilities

**File:** `backend/auth.py`
```python
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from config import settings
import sqlite3

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# Password utilities
def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


# JWT token utilities
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)

    to_encode.update({"exp": expire, "type": "access"})

    encoded_jwt = jwt.encode(
        to_encode,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm
    )

    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """Create a JWT refresh token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days)

    to_encode.update({"exp": expire, "type": "refresh"})

    encoded_jwt = jwt.encode(
        to_encode,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm
    )

    return encoded_jwt


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm]
        )

        # Verify token type
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )

        return payload

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


# User retrieval
def get_user_by_email(email: str, conn: sqlite3.Connection) -> Optional[dict]:
    """Get user by email from database."""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, email, hashed_password, role, is_active, created_at FROM users WHERE email = ?",
        (email,)
    )
    row = cursor.fetchone()

    if row:
        return {
            "id": row[0],
            "username": row[1],
            "email": row[2],
            "hashed_password": row[3],
            "role": row[4],
            "is_active": row[5],
            "created_at": row[6],
        }

    return None


def get_user_by_id(user_id: int, conn: sqlite3.Connection) -> Optional[dict]:
    """Get user by ID from database."""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, username, email, role, is_active, created_at FROM users WHERE id = ?",
        (user_id,)
    )
    row = cursor.fetchone()

    if row:
        return {
            "id": row[0],
            "username": row[1],
            "email": row[2],
            "role": row[3],
            "is_active": row[4],
            "created_at": row[5],
        }

    return None


# Authentication dependency
async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Dependency to get current authenticated user."""
    payload = decode_access_token(token)

    user_id: int = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )

    # Get user from database
    import os
    from config import settings
    DB_PATH = os.getenv("CATATLAS_DB_PATH", settings.database_path)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)

    user = get_user_by_id(user_id, conn)
    conn.close()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )

    if not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )

    return user


# Role-based authorization
def require_role(required_role: str):
    """Dependency to require specific role."""
    async def role_checker(current_user: dict = Depends(get_current_user)):
        user_role = current_user.get("role")

        # Role hierarchy: ADMIN > MODERATOR > USER
        role_hierarchy = {"USER": 0, "MODERATOR": 1, "ADMIN": 2}

        if role_hierarchy.get(user_role, -1) < role_hierarchy.get(required_role, 999):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {required_role}"
            )

        return current_user

    return role_checker
```

#### Task 2.3: Create User Models

**File:** `backend/models/user.py`
```python
from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    """User role enumeration."""
    USER = "USER"
    MODERATOR = "MODERATOR"
    ADMIN = "ADMIN"


class UserCreate(BaseModel):
    """Model for user registration."""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=100)

    @validator("username")
    def username_alphanumeric(cls, v):
        """Validate username is alphanumeric (with underscores/hyphens)."""
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("Username must be alphanumeric (underscores and hyphens allowed)")
        return v

    @validator("password")
    def password_strength(cls, v):
        """Validate password strength."""
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")

        has_upper = any(c.isupper() for c in v)
        has_lower = any(c.islower() for c in v)
        has_digit = any(c.isdigit() for c in v)

        if not (has_upper and has_lower and has_digit):
            raise ValueError("Password must contain uppercase, lowercase, and number")

        return v

    class Config:
        json_schema_extra = {
            "example": {
                "username": "catLover123",
                "email": "cat.lover@example.com",
                "password": "SecurePass123"
            }
        }


class UserLogin(BaseModel):
    """Model for user login."""
    email: EmailStr
    password: str

    class Config:
        json_schema_extra = {
            "example": {
                "email": "cat.lover@example.com",
                "password": "SecurePass123"
            }
        }


class UserResponse(BaseModel):
    """Model for user response (no password)."""
    id: int
    username: str
    email: EmailStr
    role: UserRole
    is_active: bool
    created_at: str

    class Config:
        json_schema_extra = {
            "example": {
                "id": 1,
                "username": "catLover123",
                "email": "cat.lover@example.com",
                "role": "USER",
                "is_active": True,
                "created_at": "2024-01-15T10:30:00"
            }
        }


class Token(BaseModel):
    """Model for authentication token response."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse

    class Config:
        json_schema_extra = {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer",
                "user": {
                    "id": 1,
                    "username": "catLover123",
                    "email": "cat.lover@example.com",
                    "role": "USER",
                    "is_active": True,
                    "created_at": "2024-01-15T10:30:00"
                }
            }
        }


class TokenRefresh(BaseModel):
    """Model for token refresh request."""
    refresh_token: str
```

### Day 4: Database Schema & Auth Endpoints

#### Task 2.4: Add Users Table to Database

**File:** `backend/main.py` (modify init_db function)

```python
def init_db():
    """Initialize database with required tables."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()

    # Existing tables (entries, analyses, cats, cat_insights)...
    # [Keep existing code]

    # Add users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'USER',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Create indexes for performance
    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    """)

    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
    """)

    # Alter entries table to add user_id (existing table migration)
    try:
        cursor.execute("ALTER TABLE entries ADD COLUMN user_id INTEGER")
    except sqlite3.OperationalError:
        # Column already exists
        pass

    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id)")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()

    print("✅ Database initialized successfully")
```

#### Task 2.5: Create Authentication Endpoints

**File:** `backend/main.py` (add after existing routes)

```python
from models.user import UserCreate, UserLogin, UserResponse, Token, UserRole
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_user_by_email,
    require_role
)
from datetime import datetime

# Authentication Endpoints

@app.post("/auth/register", response_model=Token, tags=["auth"])
async def register(user_data: UserCreate):
    """
    Register a new user.

    Returns JWT tokens and user information.
    """
    if not settings.enable_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is currently disabled"
        )

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()

    # Check if user already exists
    existing_user = get_user_by_email(user_data.email, conn)
    if existing_user:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Check if username is taken
    cursor.execute("SELECT id FROM users WHERE username = ?", (user_data.username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )

    # Hash password
    hashed_password = hash_password(user_data.password)

    # Insert user
    cursor.execute("""
        INSERT INTO users (username, email, hashed_password, role, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        user_data.username,
        user_data.email,
        hashed_password,
        UserRole.USER.value,
        1,
        datetime.utcnow().isoformat()
    ))

    user_id = cursor.lastrowid
    conn.commit()

    # Fetch created user
    new_user = get_user_by_id(user_id, conn)
    conn.close()

    # Create tokens
    access_token = create_access_token(data={"sub": user_id})
    refresh_token = create_refresh_token(data={"sub": user_id})

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse(**new_user)
    )


@app.post("/auth/login", response_model=Token, tags=["auth"])
async def login(credentials: UserLogin):
    """
    Login with email and password.

    Returns JWT tokens and user information.
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)

    # Get user by email
    user = get_user_by_email(credentials.email, conn)

    if not user:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # Verify password
    if not verify_password(credentials.password, user["hashed_password"]):
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # Check if active
    if not user["is_active"]:
        conn.close()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive"
        )

    conn.close()

    # Create tokens
    access_token = create_access_token(data={"sub": user["id"]})
    refresh_token = create_refresh_token(data={"sub": user["id"]})

    # Remove hashed_password from response
    user_response = {k: v for k, v in user.items() if k != "hashed_password"}

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse(**user_response)
    )


@app.get("/auth/me", response_model=UserResponse, tags=["auth"])
async def get_me(current_user: dict = Depends(get_current_user)):
    """
    Get current authenticated user information.

    Requires authentication.
    """
    return UserResponse(**current_user)


@app.post("/auth/refresh", response_model=Token, tags=["auth"])
async def refresh_token(refresh_token: str):
    """
    Refresh access token using refresh token.
    """
    from jose import JWTError, jwt

    try:
        payload = jwt.decode(
            refresh_token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm]
        )

        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )

        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        # Get user
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        from auth import get_user_by_id
        user = get_user_by_id(user_id, conn)
        conn.close()

        if not user or not user["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )

        # Create new tokens
        new_access_token = create_access_token(data={"sub": user_id})
        new_refresh_token = create_refresh_token(data={"sub": user_id})

        return Token(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            user=UserResponse(**user)
        )

    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate token"
        )
```

### Day 5: Protect Existing Endpoints

#### Task 2.6: Add Authentication to Entry Endpoints

**File:** `backend/main.py` (modify existing endpoints)

```python
# Modify POST /entries endpoint
@app.post("/entries", tags=["entries"])
async def create_entry(
    entry: EntryCreate,
    current_user: dict = Depends(get_current_user)  # ADD THIS
):
    """Create a new entry (sighting). Requires authentication."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()

    cursor.execute(
        """INSERT INTO entries (text, createdAt, isFavorite, nickname, location, photo_url, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            entry.text,
            entry.createdAt or datetime.now().isoformat(),
            0,
            entry.nickname,
            entry.location,
            entry.photo_url,
            current_user["id"]  # ADD THIS - link to authenticated user
        ),
    )

    entry_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {"id": entry_id, **entry.dict(), "isFavorite": False, "user_id": current_user["id"]}


# Modify POST /entries/{entry_id}/favorite
@app.post("/entries/{entry_id}/favorite", tags=["entries"])
async def toggle_favorite(
    entry_id: int,
    current_user: dict = Depends(get_current_user)  # ADD THIS
):
    """Toggle favorite status. Requires authentication and ownership."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()

    # Check ownership
    cursor.execute("SELECT user_id FROM entries WHERE id = ?", (entry_id,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Entry not found")

    entry_user_id = row[0]

    # Verify ownership (or admin)
    if entry_user_id != current_user["id"] and current_user["role"] != "ADMIN":
        conn.close()
        raise HTTPException(
            status_code=403,
            detail="Not authorized to modify this entry"
        )

    # Toggle favorite
    cursor.execute(
        "UPDATE entries SET isFavorite = NOT isFavorite WHERE id = ?",
        (entry_id,)
    )

    cursor.execute("SELECT isFavorite FROM entries WHERE id = ?", (entry_id,))
    new_favorite_status = cursor.fetchone()[0]

    conn.commit()
    conn.close()

    return {"isFavorite": bool(new_favorite_status)}


# Modify POST /entries/{entry_id}/analyze
@app.post("/entries/{entry_id}/analyze", tags=["entries"])
async def analyze_entry(
    entry_id: int,
    current_user: dict = Depends(get_current_user)  # ADD THIS
):
    """Analyze entry with baseline AI. Requires authentication."""
    # [Keep existing logic, no ownership check needed - analysis is read-only]
    # ...existing code...


# Modify POST /cats (require MODERATOR role)
@app.post("/cats", tags=["cats"])
async def create_cat(
    cat: CatCreate,
    current_user: dict = Depends(require_role("MODERATOR"))  # REQUIRE MODERATOR
):
    """Create a new cat profile. Requires MODERATOR role."""
    # ...existing code...


# Keep GET endpoints PUBLIC for community visibility
# GET /entries - public (show all)
# GET /cats - public
# GET /cats/{cat_id}/profile - public
# GET /health - public
```

#### Task 2.7: Add User Filter to GET /entries

**File:** `backend/main.py` (modify GET /entries)

```python
@app.get("/entries", tags=["entries"])
async def list_entries(
    my_entries: bool = False,  # NEW: filter by current user
    current_user: Optional[dict] = Depends(get_current_user)  # OPTIONAL auth
):
    """
    List all entries.

    - `my_entries=true`: Show only authenticated user's entries (requires auth)
    - `my_entries=false`: Show all public entries
    """
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()

    if my_entries:
        if not current_user:
            raise HTTPException(
                status_code=401,
                detail="Authentication required to view your entries"
            )

        cursor.execute(
            """SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url, user_id
               FROM entries
               WHERE user_id = ?
               ORDER BY createdAt DESC""",
            (current_user["id"],)
        )
    else:
        # Public entries - show all
        cursor.execute(
            """SELECT id, text, createdAt, isFavorite, nickname, location, cat_id, photo_url, user_id
               FROM entries
               ORDER BY createdAt DESC"""
        )

    entries = [
        {
            "id": row[0],
            "text": row[1],
            "createdAt": row[2],
            "isFavorite": bool(row[3]),
            "nickname": row[4],
            "location": row[5],
            "cat_id": row[6],
            "photo_url": row[7],
            "user_id": row[8],
        }
        for row in cursor.fetchall()
    ]

    conn.close()
    return entries
```

### Day 6: Frontend Authentication Integration

#### Task 2.8: Create Auth Context

**File:** `frontend/src/contexts/AuthContext.tsx`
```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  role: 'USER' | 'MODERATOR' | 'ADMIN';
  is_active: boolean;
  created_at: string;
}

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

  // Load tokens from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('access_token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setAccessToken(storedToken);
      setUser(JSON.parse(storedUser));
    }

    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }

    const data: AuthTokens = await response.json();

    // Store tokens
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    localStorage.setItem('user', JSON.stringify(data.user));

    setAccessToken(data.access_token);
    setUser(data.user);
  };

  const register = async (username: string, email: string, password: string) => {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }

    const data: AuthTokens = await response.json();

    // Store tokens
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    localStorage.setItem('user', JSON.stringify(data.user));

    setAccessToken(data.access_token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');

    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        login,
        register,
        logout,
        isAuthenticated: !!user,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

#### Task 2.9: Create Login/Register Components

**File:** `frontend/src/components/AuthModal.tsx`
```typescript
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'login' | 'register';
  onSwitchMode: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, mode, onSwitchMode }) => {
  const { login, register } = useAuth();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (mode === 'login') {
        await login(formData.email, formData.password);
      } else {
        await register(formData.username, formData.email, formData.password);
      }
      onClose();
      setFormData({ username: '', email: '', password: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '8px',
        maxWidth: '400px',
        width: '100%',
      }}>
        <h2>{mode === 'login' ? 'Login' : 'Register'}</h2>

        {error && (
          <div style={{
            padding: '0.75rem',
            backgroundColor: '#fee',
            color: '#c00',
            borderRadius: '4px',
            marginBottom: '1rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                Username
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
                minLength={3}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              Password
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              minLength={8}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
            {mode === 'register' && (
              <small style={{ color: '#666', fontSize: '0.875rem' }}>
                Must be 8+ characters with uppercase, lowercase, and number
              </small>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '0.75rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              marginBottom: '1rem',
            }}
          >
            {isLoading ? 'Please wait...' : (mode === 'login' ? 'Login' : 'Register')}
          </button>

          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              onClick={onSwitchMode}
              style={{
                background: 'none',
                border: 'none',
                color: '#007bff',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {mode === 'login'
                ? "Don't have an account? Register"
                : 'Already have an account? Login'}
            </button>
          </div>

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

### Day 7: Complete Frontend Integration

#### Task 2.10: Update App.tsx with Auth

**File:** `frontend/src/App.tsx` (modifications at the top)

```typescript
// Add imports
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AuthModal } from './components/AuthModal';

// Wrap entire app in AuthProvider
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

// Rename current App component to AppContent
function AppContent() {
  const { user, isAuthenticated, logout, accessToken } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // ... existing state ...

  // Update API calls to include Authorization header
  const createEntry = async (entryData: any) => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${API_BASE}/entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify(entryData),
    });

    if (response.status === 401) {
      // Token expired - show login modal
      setAuthModalOpen(true);
      throw new Error('Please login to continue');
    }

    if (!response.ok) {
      throw new Error('Failed to create entry');
    }

    return response.json();
  };

  // Add auth UI in header
  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header with Auth */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        borderBottom: '2px solid #333',
        paddingBottom: '1rem'
      }}>
        <h1>🐱 CatAtlas</h1>

        <div>
          {isAuthenticated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span>Welcome, {user?.username}!</span>
              <span style={{
                padding: '0.25rem 0.5rem',
                backgroundColor: user?.role === 'ADMIN' ? '#f00' : user?.role === 'MODERATOR' ? '#00f' : '#0a0',
                color: 'white',
                borderRadius: '4px',
                fontSize: '0.75rem'
              }}>
                {user?.role}
              </span>
              <button onClick={logout} style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}>
                Logout
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  setAuthMode('login');
                  setAuthModalOpen(true);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Login
              </button>
              <button
                onClick={() => {
                  setAuthMode('register');
                  setAuthModalOpen(true);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Register
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        mode={authMode}
        onSwitchMode={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
      />

      {/* Rest of existing UI */}
      {/* ... existing code ... */}
    </div>
  );
}

export default App;
```

#### Task 2.11: Test Authentication Flow

```bash
# Start backend
cd backend
uvicorn main:app --reload

# Start frontend (in another terminal)
cd frontend
npm run dev

# Manual test checklist:
# 1. Open http://localhost:5173
# 2. Click "Register" - create account
# 3. Verify redirect to logged-in state
# 4. Try creating an entry (should work with auth)
# 5. Logout
# 6. Try creating entry without auth (should show error)
# 7. Login with existing account
# 8. Verify token stored in localStorage (dev tools)
```

#### Task 2.12: Add Authentication Tests

**File:** `backend/tests/test_auth.py`
```python
import pytest
from fastapi.testclient import TestClient
from main import app
import sqlite3
import os


@pytest.fixture
def client(tmp_path):
    """Create test client with temporary database."""
    db_path = tmp_path / "test.db"
    os.environ["CATATLAS_DB_PATH"] = str(db_path)
    os.environ["JWT_SECRET"] = "test-secret-key-32-characters-long"

    # Import after setting env vars
    from main import init_db
    init_db()

    client = TestClient(app)
    yield client


def test_register_new_user(client):
    """Test user registration."""
    response = client.post("/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "SecurePass123"
    })

    assert response.status_code == 200
    data = response.json()

    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["username"] == "testuser"
    assert data["user"]["email"] == "test@example.com"
    assert data["user"]["role"] == "USER"


def test_register_duplicate_email(client):
    """Test registration with duplicate email fails."""
    # Register first user
    client.post("/auth/register", json={
        "username": "user1",
        "email": "duplicate@example.com",
        "password": "SecurePass123"
    })

    # Try to register with same email
    response = client.post("/auth/register", json={
        "username": "user2",
        "email": "duplicate@example.com",
        "password": "SecurePass456"
    })

    assert response.status_code == 400
    assert "already registered" in response.json()["detail"].lower()


def test_login_success(client):
    """Test successful login."""
    # Register user
    client.post("/auth/register", json={
        "username": "loginuser",
        "email": "login@example.com",
        "password": "SecurePass123"
    })

    # Login
    response = client.post("/auth/login", json={
        "email": "login@example.com",
        "password": "SecurePass123"
    })

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "login@example.com"


def test_login_wrong_password(client):
    """Test login with wrong password fails."""
    # Register user
    client.post("/auth/register", json={
        "username": "wrongpass",
        "email": "wrongpass@example.com",
        "password": "SecurePass123"
    })

    # Try wrong password
    response = client.post("/auth/login", json={
        "email": "wrongpass@example.com",
        "password": "WrongPassword456"
    })

    assert response.status_code == 401


def test_get_current_user(client):
    """Test getting current user info."""
    # Register and get token
    register_response = client.post("/auth/register", json={
        "username": "currentuser",
        "email": "current@example.com",
        "password": "SecurePass123"
    })
    token = register_response.json()["access_token"]

    # Get current user
    response = client.get("/auth/me", headers={
        "Authorization": f"Bearer {token}"
    })

    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "currentuser"
    assert data["email"] == "current@example.com"


def test_protected_endpoint_without_auth(client):
    """Test that protected endpoints require authentication."""
    response = client.post("/entries", json={
        "text": "Test entry",
        "nickname": "TestCat"
    })

    assert response.status_code == 401


def test_protected_endpoint_with_auth(client):
    """Test protected endpoint works with valid token."""
    # Register and get token
    register_response = client.post("/auth/register", json={
        "username": "entryuser",
        "email": "entry@example.com",
        "password": "SecurePass123"
    })
    token = register_response.json()["access_token"]

    # Create entry with auth
    response = client.post("/entries",
        json={
            "text": "Authenticated entry",
            "nickname": "AuthCat"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    data = response.json()
    assert "id" in data
```

```bash
# Run auth tests
cd backend
pytest tests/test_auth.py -v
```

---

## Part 3: Security Hardening (Days 8-10)

### Day 8: Rate Limiting & Input Sanitization

#### Task 3.1: Install Security Dependencies

```bash
cd backend

# Add to requirements.txt
echo "slowapi==0.1.9" >> requirements.txt
echo "bleach==6.1.0" >> requirements.txt
echo "validators==0.22.0" >> requirements.txt

pip install -r requirements.txt
```

#### Task 3.2: Implement Rate Limiting

**File:** `backend/middleware/rate_limit.py`
```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from config import settings


# Create limiter instance
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[f"{settings.rate_limit_per_minute}/minute"]
)


def setup_rate_limiting(app):
    """Set up rate limiting for FastAPI app."""
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    return limiter
```

**File:** `backend/main.py` (add rate limiting)
```python
from middleware.rate_limit import setup_rate_limiting, limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Setup rate limiting
setup_rate_limiting(app)

# Add stricter limits to auth endpoints
@app.post("/auth/login", response_model=Token, tags=["auth"])
@limiter.limit(f"{settings.auth_rate_limit_per_minute}/minute")
async def login(request: Request, credentials: UserLogin):
    # ... existing code ...

@app.post("/auth/register", response_model=Token, tags=["auth"])
@limiter.limit(f"{settings.auth_rate_limit_per_minute}/minute")
async def register(request: Request, user_data: UserCreate):
    # ... existing code ...
```

#### Task 3.3: Add Input Sanitization

**File:** `backend/utils/sanitize.py`
```python
import bleach
import validators
from typing import Optional


def sanitize_html(text: str, max_length: int = 5000) -> str:
    """
    Remove HTML/script tags from text.

    Args:
        text: Input text
        max_length: Maximum allowed length

    Returns:
        Sanitized text
    """
    # Remove HTML tags completely (no allowed tags)
    cleaned = bleach.clean(text, tags=[], strip=True)

    # Truncate to max length
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]

    return cleaned.strip()


def validate_url(url: Optional[str]) -> Optional[str]:
    """
    Validate URL format.

    Args:
        url: URL to validate

    Returns:
        Validated URL or None

    Raises:
        ValueError: If URL is invalid
    """
    if not url:
        return None

    # Strip whitespace
    url = url.strip()

    # Validate format
    if not validators.url(url):
        raise ValueError(f"Invalid URL format: {url}")

    # Only allow http/https
    if not url.startswith(('http://', 'https://')):
        raise ValueError("URL must start with http:// or https://")

    return url


def sanitize_location(location: Optional[str], max_length: int = 200) -> Optional[str]:
    """
    Sanitize location string.

    Args:
        location: Location text
        max_length: Maximum length

    Returns:
        Sanitized location
    """
    if not location:
        return None

    # Remove HTML
    cleaned = bleach.clean(location, tags=[], strip=True)

    # Truncate
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]

    return cleaned.strip()


def sanitize_nickname(nickname: Optional[str], max_length: int = 100) -> Optional[str]:
    """
    Sanitize nickname.

    Args:
        nickname: Nickname text
        max_length: Maximum length

    Returns:
        Sanitized nickname
    """
    if not nickname:
        return None

    # Remove HTML
    cleaned = bleach.clean(nickname, tags=[], strip=True)

    # Truncate
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length]

    return cleaned.strip()
```

#### Task 3.4: Apply Sanitization to Models

**File:** `backend/main.py` (update EntryCreate validation)
```python
from utils.sanitize import sanitize_html, validate_url, sanitize_location, sanitize_nickname

# Update EntryCreate model with validators
from pydantic import BaseModel, validator

class EntryCreate(BaseModel):
    text: str
    createdAt: Optional[str] = None
    nickname: Optional[str] = None
    location: Optional[str] = None
    photo_url: Optional[str] = None

    @validator("text")
    def sanitize_text(cls, v):
        """Sanitize entry text."""
        return sanitize_html(v, max_length=5000)

    @validator("nickname")
    def sanitize_nickname_field(cls, v):
        """Sanitize nickname."""
        return sanitize_nickname(v)

    @validator("location")
    def sanitize_location_field(cls, v):
        """Sanitize location."""
        return sanitize_location(v)

    @validator("photo_url")
    def validate_photo_url(cls, v):
        """Validate photo URL."""
        return validate_url(v)
```

### Day 9: Security Headers & Request Limits

#### Task 3.5: Add Security Headers Middleware

**File:** `backend/middleware/security_headers.py`
```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # XSS protection (legacy, but doesn't hurt)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # HTTPS only (in production)
        if not request.url.hostname in ["localhost", "127.0.0.1"]:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # Content Security Policy
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "font-src 'self' data:; "
            "connect-src 'self'"
        )

        # Referrer policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions policy
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        return response
```

**File:** `backend/main.py` (add middleware)
```python
from middleware.security_headers import SecurityHeadersMiddleware

# Add after CORS middleware
app.add_middleware(SecurityHeadersMiddleware)
```

#### Task 3.6: Add Request Size Limits

**File:** `backend/main.py` (add at app initialization)
```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Limit request body size."""

    def __init__(self, app, max_size: int = 1_000_000):  # 1MB default
        super().__init__(app)
        self.max_size = max_size

    async def dispatch(self, request: Request, call_next):
        # Check Content-Length header
        content_length = request.headers.get("content-length")

        if content_length:
            if int(content_length) > self.max_size:
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"Request body too large. Max size: {self.max_size} bytes"}
                )

        return await call_next(request)


# Add middleware (1MB limit)
app.add_middleware(RequestSizeLimitMiddleware, max_size=1_000_000)
```

### Day 10: Security Testing & Audit

#### Task 3.7: Create Security Tests

**File:** `backend/tests/test_security.py`
```python
import pytest
from fastapi.testclient import TestClient
from main import app
import os


@pytest.fixture
def client(tmp_path):
    """Create test client."""
    db_path = tmp_path / "test.db"
    os.environ["CATATLAS_DB_PATH"] = str(db_path)
    os.environ["JWT_SECRET"] = "test-secret-32-chars-long-enough"

    from main import init_db
    init_db()

    client = TestClient(app)
    yield client


def test_xss_sanitization(client):
    """Test that XSS attempts are sanitized."""
    # Register user
    auth_response = client.post("/auth/register", json={
        "username": "xsstest",
        "email": "xss@example.com",
        "password": "SecurePass123"
    })
    token = auth_response.json()["access_token"]

    # Try XSS in entry text
    response = client.post("/entries",
        json={
            "text": "<script>alert('XSS')</script>Innocent cat spotted",
            "nickname": "<img src=x onerror=alert('XSS')>"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    data = response.json()

    # Verify HTML tags removed
    assert "<script>" not in data["text"]
    assert "alert" not in data["text"]
    assert "<img" not in str(data.get("nickname", ""))


def test_sql_injection_protection(client):
    """Test SQL injection attempts are blocked."""
    # Register user
    auth_response = client.post("/auth/register", json={
        "username": "sqltest",
        "email": "sql@example.com",
        "password": "SecurePass123"
    })
    token = auth_response.json()["access_token"]

    # Try SQL injection in entry text
    response = client.post("/entries",
        json={
            "text": "'; DROP TABLE entries; --",
            "nickname": "Robert'; DROP TABLE students;--"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    # Should succeed (parameterized queries prevent injection)
    assert response.status_code == 200

    # Verify database still works
    list_response = client.get("/entries")
    assert list_response.status_code == 200


def test_invalid_url_rejected(client):
    """Test invalid URLs are rejected."""
    # Register user
    auth_response = client.post("/auth/register", json={
        "username": "urltest",
        "email": "url@example.com",
        "password": "SecurePass123"
    })
    token = auth_response.json()["access_token"]

    # Try invalid URL
    response = client.post("/entries",
        json={
            "text": "Cat photo",
            "photo_url": "javascript:alert('XSS')"
        },
        headers={"Authorization": f"Bearer {token}"}
    )

    # Should fail validation
    assert response.status_code == 422


def test_rate_limiting(client):
    """Test rate limiting works."""
    # Make many rapid requests to auth endpoint
    responses = []

    for i in range(10):
        response = client.post("/auth/login", json={
            "email": "test@example.com",
            "password": "test"
        })
        responses.append(response.status_code)

    # At least one should be rate limited (429)
    assert 429 in responses


def test_security_headers_present(client):
    """Test security headers are added to responses."""
    response = client.get("/health")

    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert "Content-Security-Policy" in response.headers


def test_cors_not_wildcard(client):
    """Test CORS doesn't allow wildcard origin in production."""
    # This is configured via environment
    # In production, settings.allowed_origins should not contain "*"
    from config import settings

    assert "*" not in settings.allowed_origins


def test_request_size_limit(client):
    """Test large requests are rejected."""
    # Register user
    auth_response = client.post("/auth/register", json={
        "username": "sizetest",
        "email": "size@example.com",
        "password": "SecurePass123"
    })
    token = auth_response.json()["access_token"]

    # Try very large text (over 1MB would be caught by middleware)
    # Over 5000 chars caught by validator
    large_text = "A" * 10000

    response = client.post("/entries",
        json={"text": large_text},
        headers={"Authorization": f"Bearer {token}"}
    )

    # Validator truncates to 5000
    assert response.status_code == 200
    assert len(response.json()["text"]) <= 5000
```

```bash
# Run security tests
cd backend
pytest tests/test_security.py -v
```

#### Task 3.8: Run Full Test Suite

```bash
cd backend

# Run all tests
pytest -v

# Check coverage
pip install pytest-cov
pytest --cov=. --cov-report=html

# View coverage report
open htmlcov/index.html
```

#### Task 3.9: Security Audit Checklist

Create **File:** `backend/docs/SECURITY_AUDIT.md`
```markdown
# Security Audit Checklist

## Phase 1 Completion Checklist

### Authentication ✅
- [x] JWT-based authentication implemented
- [x] Password hashing with bcrypt
- [x] Password strength validation (8+ chars, uppercase, lowercase, number)
- [x] User registration with email validation
- [x] Login with email/password
- [x] Protected endpoints require authentication
- [x] Role-based access control (USER, MODERATOR, ADMIN)
- [x] Refresh token support

### Input Validation ✅
- [x] HTML/script tag sanitization
- [x] URL validation (http/https only)
- [x] Text length limits (5000 chars)
- [x] Location/nickname sanitization
- [x] Pydantic model validation
- [x] SQL injection protection (parameterized queries)

### Rate Limiting ✅
- [x] Global rate limit (100 req/min)
- [x] Auth endpoint rate limit (5 req/min)
- [x] IP-based tracking

### Security Headers ✅
- [x] X-Content-Type-Options: nosniff
- [x] X-Frame-Options: DENY
- [x] X-XSS-Protection
- [x] Content-Security-Policy
- [x] Strict-Transport-Security (production)
- [x] Referrer-Policy

### Request Security ✅
- [x] Request size limits (1MB)
- [x] CORS whitelist (no wildcard in production)
- [x] HTTPS enforcement (production)

### Testing ✅
- [x] Authentication tests (7 tests)
- [x] Security tests (7 tests)
- [x] Configuration tests (5 tests)
- [x] All tests passing

## Remaining Vulnerabilities

### Medium Priority
- [ ] Session management (currently stateless JWT)
- [ ] Account lockout after failed login attempts
- [ ] Email verification for registration
- [ ] Password reset functionality
- [ ] Two-factor authentication (2FA)
- [ ] Audit logging for sensitive operations

### Low Priority
- [ ] Database encryption at rest
- [ ] API versioning
- [ ] GraphQL query depth limiting (if GraphQL added)
- [ ] Webhook signature verification (if webhooks added)

## Production Readiness

Before deploying to production:
1. Change JWT_SECRET to secure random value (32+ bytes)
2. Set DEBUG=False
3. Configure ALLOWED_ORIGINS to specific domains
4. Enable HTTPS only
5. Set up monitoring (Sentry)
6. Configure database backups
7. Review all environment variables
8. Run security scan (OWASP ZAP, etc.)
```

---

## Phase 1 Complete! 🎉

### Summary

**Days 1-2: Environment Management**
- ✅ Pydantic Settings with validation
- ✅ .env templates for backend and frontend
- ✅ Configuration tests
- ✅ Documentation updated

**Days 3-7: Authentication**
- ✅ JWT-based authentication
- ✅ User registration and login
- ✅ Password hashing with bcrypt
- ✅ Role-based access control
- ✅ Protected API endpoints
- ✅ Frontend auth UI (login/register)
- ✅ Auth context and token management
- ✅ Comprehensive auth tests

**Days 8-10: Security Hardening**
- ✅ Rate limiting (slowapi)
- ✅ Input sanitization (bleach)
- ✅ URL validation
- ✅ Security headers middleware
- ✅ Request size limits
- ✅ Security tests
- ✅ XSS/SQL injection protection

### Files Created/Modified

**Backend:**
- Created: `config.py`, `auth.py`, `models/user.py`
- Created: `middleware/rate_limit.py`, `middleware/security_headers.py`
- Created: `utils/sanitize.py`
- Created: `tests/test_config.py`, `tests/test_auth.py`, `tests/test_security.py`
- Modified: `main.py` (auth endpoints, protected routes, middleware)
- Created: `.env.example`
- Updated: `requirements.txt`

**Frontend:**
- Created: `src/contexts/AuthContext.tsx`
- Created: `src/components/AuthModal.tsx`
- Modified: `src/App.tsx` (auth integration)
- Created: `.env.example`

**Documentation:**
- Created: `docs/PHASE1_IMPLEMENTATION.md`
- Created: `docs/SECURITY_AUDIT.md`
- Updated: `README.md`

### Next Steps

Ready to proceed to **Phase 2: Infrastructure** which includes:
- Database Migrations (Alembic)
- Automated Deployment (Railway/Render)
- Monitoring & Logging (Sentry)

Let me know when you're ready to start Phase 2!
