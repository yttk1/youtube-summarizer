#!/usr/bin/env bash
set -euo pipefail

# setup.sh
# - Installs system deps (node, npm, python if missing)
# - Creates Python venv and installs backend requirements
# - Installs frontend npm deps and builds frontend
# - Prompts for OPENAI_API_KEY and writes .env
# - Writes frontend/runtime config (frontend/dist/config.json)

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "Project root: $REPO_ROOT"

# 1) update apt and install basic packages if missing
echo "Checking system dependencies..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Installing..."
  sudo apt-get update
  sudo apt-get install -y python3 python3-venv python3-dev build-essential
fi

if ! command -v pip3 >/dev/null 2>&1; then
  echo "pip3 not found. Installing..."
  sudo apt-get update
  sudo apt-get install -y python3-pip
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "node/npm not found. Installing Node.js 20.x from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 2) Create Python venv and install backend requirements
echo "Setting up Python virtual environment..."
cd "$REPO_ROOT/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
# activate and install
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel

if [ -f "requirements.txt" ]; then
  echo "Installing backend Python requirements..."
  pip install -r requirements.txt
else
  echo "Warning: backend/requirements.txt not found. Please create it with your deps."
fi

deactivate
cd "$REPO_ROOT"

# 3) Install frontend deps and build production bundle
if [ -d "$REPO_ROOT/frontend" ]; then
  echo "Installing frontend dependencies and building static bundle..."
  cd "$REPO_ROOT/frontend"
  npm ci
  npm run build
  cd "$REPO_ROOT"
else
  echo "Warning: frontend/ folder not found. Skipping frontend build."
fi

# 4) .env handling for OPENAI_API_KEY
if [ -f "$REPO_ROOT/.env" ]; then
  echo ".env already exists. Skipping creation. (It will be used by the backend)"
else
  echo ".env not found. Creating .env from .env.example if available..."
  if [ -f "$REPO_ROOT/.env.example" ]; then
    cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  else
    touch "$REPO_ROOT/.env"
  fi

  # Prompt for API key
  echo "Enter your OpenAI API key (will be saved to .env)."
  read -s -p "OPENAI_API_KEY: " APIKEY
  echo
  if [ -z "$APIKEY" ]; then
    echo "No key entered. Leaving .env empty. You can edit .env manually later."
  else
    # remove existing OPENAI_API_KEY lines then append
    sed -i '/^OPENAI_API_KEY=/d' "$REPO_ROOT/.env" || true
    echo "OPENAI_API_KEY=${APIKEY}" >> "$REPO_ROOT/.env"
    echo ".env created with your OPENAI_API_KEY (local file). Do NOT commit .env"
  fi
fi

# 5) Write runtime config into frontend/dist/config.json so frontend knows backend base
# Use localhost backend URL by default
API_BASE="http://localhost:8000"
if [ -d "$REPO_ROOT/frontend/dist" ]; then
  echo "Writing runtime config to frontend/dist/config.json with backend = $API_BASE"
  cat > "$REPO_ROOT/frontend/dist/config.json" <<EOF
{
  "VITE_API_BASE": "${API_BASE}"
}
EOF
else
  echo "frontend/dist not found (frontend build may have failed). Create config after building."
fi

# 6) Add .env and runtime config to .gitignore if not present
GITIGNORE="$REPO_ROOT/.gitignore"
if [ ! -f "$GITIGNORE" ]; then
  touch "$GITIGNORE"
fi

if ! grep -qF ".env" "$GITIGNORE"; then
  echo ".env" >> "$GITIGNORE"
fi
if ! grep -qF "frontend/dist/config.json" "$GITIGNORE"; then
  echo "frontend/dist/config.json" >> "$GITIGNORE"
fi

echo "Setup complete."
echo "Next: run './run.sh' to start backend and frontend locally."
