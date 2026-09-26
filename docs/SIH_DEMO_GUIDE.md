# PyroSense Demo Guide (SIH Live Presentation)

This script is designed for a **5-minute live demonstration** to SIH Judges.

## Preparation (5 mins before demo)
1. Run `./scripts/setup.sh` and ensure Docker containers are healthy.
2. Open `http://localhost:3000` in Google Chrome (Full Screen).
3. Have the [Live Architecture Diagram](ARCHITECTURE.md) open in a separate tab.
4. Open the Network tab in Chrome DevTools to prove real-time API calls if judges ask.

---

## 🕒 Minute 1: The Problem & The Hook
**Action:** Keep the dashboard open on a high-level view showing active global hotspots.
**Script:**
> "Good morning judges. We are Team [Name], and this is PyroSense.
> Every year, wildfires cause billions in damages. The problem isn't a lack of satellite data—it's that disaster management agencies are overwhelmed by raw latitude/longitude coordinates without actionable context. 
> PyroSense solves this by acting as an AI-powered intelligence bridge between raw NASA satellite data and the first responders on the ground."

## 🕒 Minute 2: Core ML & Detection
**Action:** Zoom into a specific region (e.g., California or Australia). Click on a dense cluster of fire points.
**Script:**
> "Right now, you are looking at live telemetry pulled from NASA FIRMS. 
> But we don't just show dots on a map. When I click this region, our backend triggers our Python FastAPI ML Service. 
> Behind the scenes, a Gradient Boosting model (GBM) classifies the immediate severity of the fire, while a Gated Recurrent Unit (GRU) model predicts how this specific cluster will evolve over the next 1, 3, and 7 days.
> This allows us to predict the trajectory of the disaster before it scales."

## 🕒 Minute 3: Generative AI Intelligence
**Action:** Click the "Generate Intelligence Briefing" button on the UI.
**Script:**
> "But a first responder doesn't have time to interpret math and graphs. 
> Here is where PyroSense shines. By clicking this, our system feeds the mathematical risk timelines into a Generative AI LLM. 
> As you can see, it instantly generates a plain-English, actionable intelligence briefing—prioritizing evacuation zones and summarizing the mathematical threat into human language."

## 🕒 Minute 4: Architecture & Reliability
**Action:** Switch to the `ARCHITECTURE.md` Mermaid diagram tab.
**Script:**
> "To handle this at scale, we built a highly robust 3-tier microservice architecture. 
> We have a Next.js Edge frontend, a Node.js 'Backend-for-Frontend' that handles aggressive rate-limiting and SQLite WAL caching, and an isolated Python PostGIS ML service. 
> This is not a prototype—it is fully containerized with Docker, heavily secured with Helmet headers, and deployed via Infrastructure-as-Code on Render."

## 🕒 Minute 5: Closing & Future Scope
**Action:** Switch back to the Dashboard.
**Script:**
> "PyroSense turns satellite data into survival data. In the future, we plan to integrate live IoT weather station telemetry to refine our GRU models further.
> Thank you. We are now open for questions."
