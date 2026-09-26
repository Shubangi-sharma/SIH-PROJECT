# PyroSense 🔥🌎

> **Smart India Hackathon (SIH) Submission**
> 
> **Team:** [Insert Team Name] | **Problem Statement Code:** [Insert Problem Code]

PyroSense is an AI-powered wildfire analytics platform that predicts, detects, and explains wildfire risks globally. By combining real-time NASA FIRMS satellite data, Gradient Boosting, Gated Recurrent Units (GRUs), and Generative AI, PyroSense transforms overwhelming geospatial data into actionable intelligence for disaster management authorities.

![PyroSense Dashboard](docs/assets/dashboard_placeholder.png)

## 🚨 Problem Statement

Wildfires are causing unprecedented environmental and economic damage globally. Disaster response agencies face three major challenges:
1. **Data Overload:** Satellite data provides thousands of coordinates, but lacks context.
2. **Predictive Capability:** It is difficult to forecast where a fire will spread over the next 1-7 days.
3. **Actionability:** First responders need plain-English intelligence, not just a spreadsheet of latitude and longitudes.

## 💡 Proposed Solution

PyroSense solves this by implementing an end-to-end intelligent pipeline:
- **Detection**: Live ingestion of NASA FIRMS telemetry via scheduled CRON jobs.
- **Prediction**: Machine learning models (GBM for immediate classification, GRU for 7-day risk timelines) analyze geospatial anomalies.
- **Explanation**: Generative AI (via OpenRouter) consumes the raw mathematical risk scores and generates plain-English intelligence briefings and evacuation priorities.

## ✨ Key Features

- 🛰️ **Real-Time Data Ingestion:** Automated fetching of active fire data.
- 🧠 **Predictive ML Pipelines:** 
  - *Gradient Boosting (GBM)*: Classifies hotspots instantly.
  - *Gated Recurrent Units (GRU)*: Predicts timeline risk.
- 💬 **Generative AI Insights:** Translates complex geospatial clusters into intelligence briefings.
- 🗺️ **Interactive Dashboard:** Next.js 14 responsive map based on MapLibre GL for snappy KD-Tree clustering.

## 🏗️ System Architecture

*See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full flow diagrams.*

1. **Frontend**: Next.js 14 App Router.
2. **Backend**: Node.js/Express + SQLite (WAL mode). Handles rate limiting, GenAI API orchestration, and NASA FIRMS chron jobs.
3. **ML Service**: FastAPI + PostgreSQL/PostGIS. Loads Python models, manages geospatial clustering, and executes inference pipelines.

## 🛠️ Tech Stack

- **Frontend:** Next.js, React, Tailwind CSS, MapLibre GL
- **Backend:** Node.js, Express, better-sqlite3, Zod
- **Machine Learning / DB:** Python 3.12, FastAPI, PostGIS, TensorFlow, scikit-learn
- **Infrastructure:** Docker, Docker Compose, Render Blueprint

## 📁 Folder Structure

```text
├── backend/            # Express BFF (Backend-for-Frontend)
├── frontend/           # Next.js Application
├── pyrosense_ml/       # FastAPI + ML Inference Service
├── data_science/       # Model training scripts and raw Jupyter notebooks
├── docs/               # Architecture, API, and Demo Guides
├── render.yaml         # Render Deployment Blueprint
└── scripts/setup.sh    # Automated setup script
```

## 🚀 Setup Instructions

For judges testing the application locally, we have provided an automated setup script.

### Prerequisites
- Docker & Docker Compose
- Node.js (v20+)

### One-Command Setup
```bash
# 1. Clone the repository
git clone https://github.com/Shubangi-sharma/SIH-PROJECT.git pyrosense
cd pyrosense

# 2. Run the interactive setup script
./scripts/setup.sh
```
*Note: The script will prompt you to add your NASA FIRMS API key and OpenRouter key to the `.env` files. Once provided, it spins up the entire Docker stack.*

## 🌐 Deployment Links

- **Live Application:** [Insert Vercel URL]
- **API Health Endpoint:** [Insert Render URL]/health
- **SIH Demo Video:** [Insert YouTube URL]

## 👥 Team Details

- **[Name]** - Team Leader / Full Stack Developer
- **[Name]** - ML / AI Engineer
- **[Name]** - Backend / Cloud Infrastructure
- **[Name]** - UI/UX Designer

## 🔮 Future Scope

- **IoT Integration:** Direct ingestion of telemetry from local ground-based weather stations.
- **Evacuation Routing:** Integration with Google Maps API to draw safe evacuation corridors dynamically.
- **Mobile Application:** A React Native companion app for on-the-ground first responders.
