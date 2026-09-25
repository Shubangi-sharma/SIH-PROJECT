# Models Summary

The system orchestrates three distinct ML pipelines, managed by the FastAPI ML service. 

| Model | Purpose | Input Features | Key Metrics |
|---|---|---|---|
| **Gradient Boosting Classifier (old)** | Predicts contextual hotspot categories (4 classes). | 36 features | No verified accuracy or F1 metrics documented in the repository. |
| **MLP Classifier (new)** | Predicts contextual hotspot categories (5 classes). | 43 features | Training samples: NOT YET PROVIDED, Random-split accuracy: NOT YET PROVIDED. |
| **1/3/7-Day GRU Risk Models** | Predicts wildfire risk at 1-day, 3-day, and 7-day horizons over H3 resolution-7 cells. | 30 days × 17 features per day | Test accuracy, ROC-AUC, PR-AUC: NOT YET PROVIDED. |

### Model Cards
For the original model cards outlining feature specifications and data artifacts, see:
- [Classification Model Card](../data_science/classification/README.md)
- [Risk Prediction Model Card](../data_science/risk_prediction/README.md)
