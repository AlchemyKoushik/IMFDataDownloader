# IMF Data Downloader

IMF macroeconomic data downloader built with a Next.js frontend and a FastAPI backend.

## Current State

This repository is not a browser-only IMF client anymore.

The project currently runs as:

`Next.js frontend -> FastAPI backend -> IMF DataMapper API`

The frontend UI keeps the searchable country and indicator workflow, while the backend now owns:

- IMF API requests
- retry and timeout handling
- cache reuse
- dataset validation and WEO fallback handling
- Excel generation and file streaming

## Live Frontend

The production frontend is intended to run at:

`https://data.alchemy-research.com`

For production to work correctly, the frontend must point to a deployed FastAPI backend through:

`NEXT_PUBLIC_API_BASE_URL`

The repo currently includes:

- local dev fallback: `http://localhost:8000`
- production env template in `imf-data-app/.env.production`
- Render service config in `render.yaml`

## What Works Right Now

- Searchable country dropdown
- Searchable indicator dropdown
- Region-specific indicator filtering on the frontend
- Backend validation for invalid or empty requests
- Backend retry logic using `tenacity`
- Backend concurrency limit for IMF requests
- In-memory metadata and series caching
- Backend-generated Excel downloads
- Stable layout with reserved scrollbar space
- App favicon integrated through the Next.js App Router

## Project Structure

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

## Backend

Backend stack:

- `FastAPI`
- `uvicorn`
- `httpx`
- `tenacity`
- `pandas`
- `openpyxl`

Backend behavior:

- `30s` upstream IMF timeout
- retries on timeouts, network errors, and IMF `5xx` responses
- max `3` concurrent IMF requests
- CORS enabled for:
  - `https://data.alchemy-research.com`
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`

Backend endpoints:

- `GET /`
- `GET /metadata`
- `POST /data`
- `POST /download`

Render start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## Frontend

Frontend stack:

- `Next.js 15`
- `React 19`
- `TypeScript`

Frontend behavior:

- fetches metadata and downloads through the backend only
- uses `NEXT_PUBLIC_API_BASE_URL` when present
- falls back to `http://localhost:8000` for local development
- no proxy URLs
- no direct IMF calls
- no browser-side Excel generation

## Environment

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

App URL:

```text
http://localhost:3000
```

Optional local frontend env:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### Windows Launcher

Use the root script below to open backend, frontend, and the local site automatically:

```bat
start-dev.bat
```

### Production

Frontend production env template:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend-url.onrender.com
```

This value currently lives in:

- `imf-data-app/.env.production`

Before deploying, replace the placeholder URL with the real Render backend URL, or set the same variable in Vercel.

Render deployment config already exists in:

- `render.yaml`

## Verification

Frontend:

```bash
cd imf-data-app
npm run typecheck
npm run build
```

Backend:

```bash
cd backend
python -m compileall app
```

## Notes

- The frontend depends on a reachable backend in both staging and production.
- If `NEXT_PUBLIC_API_BASE_URL` still points to a placeholder or invalid URL, the app will show a backend-unreachable error.
- The repo tracks a production env template, not a guaranteed live backend URL.
- Swagger UI should be available on the deployed backend at `/docs`.

## License

MIT
