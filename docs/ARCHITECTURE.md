# System Architecture

PyroSense utilizes a 3-tier microservice architecture to decouple the heavy Python Machine Learning models from the fast, real-time Node.js web server.

## Architecture Flow Diagram

```mermaid
graph TD
    %% Define users and external services
    User([First Responder / UI])
    NASA([NASA FIRMS API])
    LLM([OpenRouter GenAI])

    %% Define UI
    subgraph Frontend
        NextJS[Next.js 14 App Router]
        MapLibre[MapLibre GL Map]
    end

    %% Define Backend
    subgraph Backend [Backend BFF (Node.js/Express)]
        Express[Express API Gateway]
        RateLimiter[express-rate-limit]
        Cron[NASA Cron Ingestion Job]
        SQLite[(SQLite WAL Cache)]
    end

    %% Define ML Service
    subgraph ML_Service [Machine Learning (Python/FastAPI)]
        FastAPI[FastAPI Inference Server]
        GBM[Gradient Boosting Model]
        GRU[GRU Timeline Predictor]
        PostGIS[(PostgreSQL + PostGIS)]
    end

    %% Connections
    User -->|Views Map & Clicks| NextJS
    NextJS <-->|GeoJSON Data & Summaries| Express
    
    Express -->|Rate limits & validates| RateLimiter
    RateLimiter <--> SQLite

    %% Data Ingestion
    Cron -->|Pulls active fires| NASA
    Cron -->|Pushes raw data| FastAPI

    %% ML Pipeline
    Express <-->|Requests inference| FastAPI
    FastAPI <--> PostGIS
    FastAPI -->|Extracts Features| GBM
    FastAPI -->|Generates Timelines| GRU

    %% GenAI
    Express <-->|Feeds Risk Data for Briefing| LLM
```

## Component Breakdown

1. **Next.js Frontend**: Pure presentation layer. It manages the MapLibre GL context and maintains responsive performance by clustering massive GeoJSON payloads locally.
2. **Express Backend (BFF)**: The orchestrator. It shields the heavy ML service from the public web. It manages strict rate limiting, caches frequent GenAI queries in SQLite, and runs the CRON jobs that fetch from NASA.
3. **FastAPI ML Service**: The brain. It hosts the `.pkl` and `.keras` models loaded entirely into memory. It leverages PostGIS to perform rapid geospatial intersection queries before running the mathematical tensors through the trained models.
