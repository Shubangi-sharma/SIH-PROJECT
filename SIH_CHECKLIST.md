# SIH Judging Checklist

Use this checklist to ensure all hackathon parameters are met before the final evaluation.

## 🎯 1. Problem Statement Coverage
- [x] Does the project solve the core issue defined by the ministry/organization?
- [x] Is the solution scalable to a national or global level? (Yes, NASA FIRMS provides global coverage).

## 💡 2. Innovation & USPs
- [x] **Not just another dashboard**: We don't just plot points; we use AI to explain them.
- [x] **Predictive ML**: Implementing GRU networks to predict timeline risk instead of just classifying static data.
- [x] **Generative AI Bridge**: Feeding numerical ML tensors into an LLM to generate plain-English intelligence.

## 🤖 3. AI/ML Contribution
- [x] Pre-trained Gradient Boosting Machine (GBM) model integrated.
- [x] Pre-trained Gated Recurrent Unit (GRU) time-series model integrated.
- [x] Models are fully containerized and loaded into memory on boot.

## 🚀 4. Deployment Status
- [x] Infrastructure-as-code `render.yaml` implemented.
- [x] Docker multi-container compose file works flawlessly.
- [x] Continuous Integration (`ci.yml`) validates builds.

## 🎥 5. Demo Readiness
- [x] Setup script (`scripts/setup.sh`) gets the project running in < 2 minutes.
- [x] Seed data (`SEED_ON_STARTUP=true`) ensures the map is populated for the judges immediately, regardless of live NASA API uptime.
- [x] UI loading states gracefully handle the 3-5 second GenAI response delays.
- [x] Complete 5-minute Demo Script is documented in `SIH_DEMO_GUIDE.md`.

## ⚠️ 6. Known Limitations (Honest Explanations for Judges)
- **Limitation**: The generative AI summaries can occasionally hallucinate specific road names.
  - *Explanation*: We rely on OpenRouter LLMs. In production, we would fine-tune a private Llama-3 model strictly constrained to GeoJSON bounding boxes.
- **Limitation**: The Node.js backend uses a local SQLite database, preventing horizontal scaling.
  - *Explanation*: This was an architectural choice for the hackathon to maximize caching speed and simplify deployment. In a true enterprise scale-out, we would point the backend to Redis and migrate caching state there.
