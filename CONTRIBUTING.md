# Contributing to PyroSense

First off, thank you for considering contributing to PyroSense! It's people like you that make open-source a great community.

## 1. Where do I go from here?

If you've noticed a bug or have a feature request, make sure to check our [Issues](https://github.com/Shubangi-sharma/SIH-PROJECT/issues) first. If you don't see it, feel free to open a new issue.

## 2. Setting up your environment

1. Fork the repo and clone it locally.
2. Follow the Quick Start instructions in the `README.md` to get your local environment running via Docker Compose.
3. Ensure you have Node.js v20+ and Python 3.12+ installed if you plan to run components natively.

## 3. Pull Request Process

1. **Branch Naming**: Use the format `type/short-description` (e.g., `feat/add-new-map-layer` or `fix/genai-timeout`).
2. **Linting & Formatting**: Ensure all code passes linting.
   - For Node.js (Frontend & Backend): Run `npm run typecheck` and verify no ESLint errors exist.
   - For Python (ML Service): We use `uv` and standard linting.
3. **Commit Messages**: Write clear, concise commit messages.
4. **Submit PR**: Open a pull request against the `main` branch. Ensure the CI actions pass before requesting a review.

## 4. Code Style

- **TypeScript**: We use strict TypeScript. Avoid `any` where possible.
- **Python**: Follow PEP 8 guidelines.

Thank you for helping us protect the planet from wildfires! 🔥🌍
