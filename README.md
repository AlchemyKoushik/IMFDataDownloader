# 🌍 IMF Data Downloader

> Search IMF macroeconomic indicators, fetch data through a resilient FastAPI backend, and export clean Excel files without fragile browser-side proxy hacks.

![Next.js](https://img.shields.io/badge/Frontend-Next.js_15-000000?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/UI-React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/Code-TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Render](https://img.shields.io/badge/Deploy-Render-4E4EFD?style=for-the-badge&logo=render&logoColor=white)
![Vercel](https://img.shields.io/badge/Frontend_Deploy-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

## ✨ Overview

This project is an IMF data exploration and export tool built with a split architecture:

`Next.js frontend -> FastAPI backend -> IMF DataMapper API`

That means the frontend no longer talks directly to the IMF API, no longer depends on CORS proxies, and no longer generates Excel files in the browser.

## 🚀 Current Repo State

The repository currently includes:

- ✅ Searchable country and indicator selection UI
- ✅ Backend-driven IMF requests with retry logic
- ✅ Backend-generated Excel downloads
- ✅ In-memory caching for metadata and series requests
- ✅ Dataset compatibility checks and WEO fallback handling
- ✅ Production-oriented frontend API base URL config
- ✅ Render deployment config for the backend
- ✅ Favicon integrated into the Next.js app
- ✅ Stable scrollbar layout behavior to avoid page shift

## 🧠 Why This Exists

The old approach was unreliable because browser requests were hitting upstream IMF endpoints through proxy services and short-lived request timeouts.

This version moves the critical work into FastAPI so the app can:

- make direct upstream requests
- retry safely on network failures and IMF `5xx` responses
- control concurrency
- validate payloads on the server
- stream Excel files back to the browser

## 🌐 Live Frontend

Production frontend target:

`https://data.alchemy-research.com`

Important:

- The frontend must point to a real deployed backend through `NEXT_PUBLIC_API_BASE_URL`
- The repo currently contains a production env template, not a guaranteed live backend URL
- If that variable still points to a placeholder or invalid URL, the app will show a backend-unreachable error

## 🏗️ Architecture

```text
User
  ↓
Next.js frontend
  ↓
FastAPI backend
  ↓
IMF DataMapper API
```

Backend responsibilities:

- IMF API requests
- timeout and retry handling
- cache reuse
- dataset validation
- WEO fallback resolution
- Excel generation

Frontend responsibilities:

- UI rendering
- searchable dropdown interaction
- displaying status and errors
- download trigger flow

## 🎯 Features

- 🔎 Fast searchable country dropdown
- 📊 Searchable indicator dropdown with compatibility filtering
- 🧾 Excel export generated on the backend
- 🛡️ Retry logic with `tenacity`
- ⚡ Metadata and series caching
- 🌍 CORS setup for local and production frontend origins
- 🧰 One-click Windows launcher via `start-dev.bat`
- 🎨 Custom favicon and polished UI shell

## 🧱 Tech Stack

### Frontend

- `Next.js 15`
- `React 19`
- `TypeScript`

### Backend

- `FastAPI`
- `uvicorn`
- `httpx`
- `tenacity`
- `pandas`
- `openpyxl`

## 📁 Project Structure

```text
.
|- .gitignore
|- README.md
|- render.yaml
|- start-dev.bat
|- backend/
|  |- requirements.txt
|  `- app/
|     |- main.py
|     |- models/
|     |  `- request_models.py
|     |- routes/
|     |  `- data.py
|     |- services/
|     |  `- imf_service.py
|     `- utils/
|        |- excel.py
|        `- retry.py
`- imf-data-app/
   |- .env.production
   |- app/
   |  |- globals.css
   |  |- layout.tsx
   |  `- page.tsx
   |- components/
   |  |- AppReadyProvider.tsx
   |  `- LoadingScreen.tsx
   |- lib/
   |  |- backendClient.ts
   |  `- datasetValidation.ts
   |- public/
   |  `- favicon.ico
   |- types/
   |  `- imf.ts
   |- package.json
   `- tsconfig.json
```

## 🔌 Backend API

Available endpoints:

- `GET /`
- `GET /metadata`
- `POST /data`
- `POST /download`

Backend behavior:

- `30s` upstream timeout for IMF requests
- retries on timeouts, network errors, and IMF `5xx` responses
- max `3` concurrent upstream IMF calls
- CORS enabled for:
  - `https://data.alchemy-research.com`
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`

Render start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## ⚙️ Environment Setup

### Local Development

Frontend:

```bash
cd imf-data-app
npm install
npm run dev
```

Backend:

```bash
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open:

```text
http://localhost:3000
```

Optional local override:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### Windows Quick Start

If you are on Windows, you can launch everything with:

```bat
start-dev.bat
```

That script starts:

- the FastAPI backend
- the Next.js frontend
- your browser on the local app URL

### Production

Frontend production env template:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend-url.onrender.com
```

This template currently lives in:

- `imf-data-app/.env.production`

Render deployment config already exists in:

- `render.yaml`

## 🚢 Deployment Notes

### Backend

The backend is prepared for Render with:

- `pip install -r requirements.txt`
- `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

After deployment, FastAPI docs should be available at:

```text
https://your-backend-url.onrender.com/docs
```

### Frontend

The frontend should be deployed with:

- `NEXT_PUBLIC_API_BASE_URL` set to the real Render backend URL

If this variable is left unset in production, the frontend falls back to:

```text
http://localhost:8000
```

That fallback is correct for local development only.

## 🧪 Verification

Frontend checks:

```bash
cd imf-data-app
npm run typecheck
npm run build
```

Backend check:

```bash
cd backend
python -m compileall app
```

## 📝 Notes

- This repo reflects the current architecture and tooling state.
- The frontend depends on a reachable backend in staging and production.
- Swagger UI should be available on the deployed backend at `/docs`.
- The production env file in the repo is a template and may still need the final backend URL.

## 📜 License

MIT
