# IMF Data Downloader

A Next.js frontend paired with a FastAPI backend for reliably fetching IMF DataMapper data and exporting it as Excel.

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)

## Architecture

The app now uses:

`Next.js frontend -> FastAPI backend -> IMF API`

This replaces the old browser-side architecture that depended on public CORS proxies, 10 second request aborts, and client-side Excel generation.

## What Changed

- Removed all public proxy usage such as `api.allorigins.win` and `corsproxy.io`
- Removed direct IMF API calls from the frontend
- Removed browser-side Excel generation
- Added a FastAPI backend with:
  - `httpx.AsyncClient`
  - `30s` IMF timeout
  - `tenacity` retries with exponential backoff and jitter
  - in-memory caching for metadata and series responses
  - concurrency limiting with a max of `3` upstream IMF calls at a time
  - streaming Excel downloads using `pandas`
- Kept the existing Next.js UI intact and pointed it at the backend

## Project Structure

```text
.
|- README.md
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
   |- types/
   |  `- imf.ts
   |- package.json
   `- tsconfig.json
```

## Backend Endpoints

- `GET /metadata`
- `POST /data`
- `POST /download`

`POST /data` returns normalized data shaped like:

```json
{
  "country": "USA",
  "countryLabel": "United States",
  "indicator": "NGDP_RPCH",
  "indicatorLabel": "Real GDP Growth",
  "data": [
    { "year": 2022, "value": 1.9 }
  ],
  "usedFallback": false,
  "message": null,
  "lastUpdated": "2026-04-08T00:00:00Z"
}
```

## Reliability Improvements

- No proxy hops between the app and IMF
- Backend-side retries for timeouts, network errors, and IMF `5xx` responses
- Backend-side cache for repeated metadata and series requests
- Backend-side validation for empty payloads and invalid country/indicator combinations
- Backend-side fallback handling for region-specific datasets
- Excel generation moved off the browser, which fixes the download cancellation path caused by the old timeout-driven flow

## Local Development

### 1. Install frontend dependencies

```bash
cd imf-data-app
npm install
```

### 2. Install backend dependencies

```bash
cd backend
python -m pip install -r requirements.txt
```

### 3. Run the backend

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

### 4. Run the frontend

```bash
cd imf-data-app
npm run dev
```

### 5. Open locally

```text
http://localhost:3000
```

The frontend expects the backend at `http://localhost:8000` by default during local development.

If needed, set:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Production Deployment

### Backend on Render

The repo now includes `render.yaml` so Render can deploy the backend from the `backend` directory with the correct commands:

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

The backend CORS configuration now allows:

- `https://data.alchemy-research.com`
- `http://localhost:3000`
- `http://127.0.0.1:3000`

After the Render deploy finishes, verify:

```text
https://your-backend-url.onrender.com/docs
```

### Frontend on Vercel

The frontend now reads its backend URL from `imf-data-app/.env.production`:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend-url.onrender.com
```

Replace the placeholder with your real Render backend URL, or set the same variable in Vercel project settings before redeploying the frontend.

## Verification

Frontend checks:

```bash
cd imf-data-app
npm run typecheck
npm run build
```

Backend sanity check:

```bash
cd backend
python -m compileall app
```

## Notes

- The UI still uses the same country and indicator search experience.
- Indicator filtering remains on the frontend for responsiveness, and the backend validates compatibility again before calling IMF.
- Metadata is cached on both the backend and the browser to keep startup fast.
- Excel files are produced by the backend and streamed back to the browser for download.

## License

MIT
