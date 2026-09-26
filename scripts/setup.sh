#!/usr/bin/env bash
set -e

echo "🔥 Welcome to PyroSense Onboarding!"
echo "This script will set up your local development environment."

# 1. Check dependencies
command -v docker >/dev/null 2>&1 || { echo >&2 "Docker is required but not installed. Aborting."; exit 1; }
command -v node >/dev/null 2>&1 || { echo >&2 "Node.js is required but not installed. Aborting."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo >&2 "npm is required but not installed. Aborting."; exit 1; }

# 2. Copy .env files if they don't exist
echo "Copying environment files..."
for dir in frontend backend pyrosense_ml; do
    if [ ! -f "$dir/.env" ]; then
        cp "$dir/.env.example" "$dir/.env"
        echo "✅ Created $dir/.env"
    else
        echo "⚡ $dir/.env already exists"
    fi
done

echo ""
echo "⚠️ IMPORTANT: Please fill in FIRMS_MAP_KEY and OPENROUTER_API_KEY in the .env files before starting!"
echo ""

# 3. Prompt to start services
read -p "Do you want to start the Docker services now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Starting backend and ML services..."
    docker compose up -d --build
    echo "Services are starting! You can view logs with: docker compose logs -f"
    
    echo "Installing frontend dependencies..."
    cd frontend && npm install
    echo "Done! You can start the frontend by running: cd frontend && npm run dev"
else
    echo "Setup complete. You can start the backend services later with 'docker compose up -d'"
fi
