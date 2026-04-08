# Alchemy's Open Data Grid

Unified open data platform for IMF and World Bank downloads.

## What this repo now contains

- `open-data-grid/`
  Next.js frontend with two routes:
  - `/imf`
  - `/worldbank`
- `backend/`
  FastAPI backend for both providers
- `WorldBank-Data-Downloader/`
  Original cloned World Bank project kept as a reference source, not the active app

## Product summary

Alchemy's Open Data Grid presents both data sources inside one shared UI system:

- floating top navigation
- matching visual layout across IMF and World Bank pages
- searchable dropdowns
- backend-powered data fetching
- Excel export

## Routes

- `/imf`
  Existing IMF downloader flow, preserved and moved into the unified app shell
- `/worldbank`
  Upgraded World Bank downloader with multi-country, multi-indicator, optional date range, pagination handling, and Excel export

## Backend API

### IMF

- `GET /metadata`
- `POST /data`
- `POST /download`

### World Bank

- `GET /worldbank/metadata`
- `POST /worldbank/data`
- `POST /worldbank/download`

## World Bank behavior

The backend now:

- loads countries from `https://api.worldbank.org/v2/country`
- loads indicators from `https://api.worldbank.org/v2/indicator`
- walks paginated responses
- caches metadata in memory
- supports multiple countries and indicators
- normalizes rows to:

```ts
{
  country: string;
  indicator: string;
  year: number;
  value: number;
}
```

- exports `.xlsx` files with:
  - `Country`
  - `Indicator`
  - `Year`
  - `Value`

## Local development

### Frontend

```powershell
cd open-data-grid
npm install
npm run dev
```

### Backend

```powershell
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:3000`.

The frontend uses `NEXT_PUBLIC_API_BASE_URL`, defaulting locally to `http://localhost:8000`.

## Verification

Frontend:

```powershell
cd open-data-grid
npm run typecheck
npm run build
```

Backend:

```powershell
cd backend
python -m compileall app
```

## Notes

- The active application is the Next.js app plus the FastAPI backend.
- The legacy `WorldBank-Data-Downloader/` folder is not required for runtime.
- Existing IMF logic was preserved while its UI was moved onto shared components.
