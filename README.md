# IMF Data Downloader

A production-ready Next.js app that loads the live IMF metadata catalog, lets users search countries and indicators from themed dropdown search boxes, and downloads macroeconomic data as a clean Excel file.

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployable-000000?style=for-the-badge&logo=vercel)
![Excel](https://img.shields.io/badge/Export-XLSX-217346?style=for-the-badge&logo=microsoft-excel&logoColor=white)

## Current State

This is the current implemented version of the project:

- Live searchable country dropdown
- Live searchable indicator dropdown
- Indexed result lists with keyboard navigation
- Mouse-wheel scrolling and click selection
- Excel export through a Next.js route handler
- Retry logic with exponential backoff
- Timeout handling for IMF requests
- Structured backend and frontend error handling
- Vercel-friendly serverless architecture

## Current UI Behavior

Both search boxes currently work like this:

- Click the box
- Start typing immediately
- See filtered indexed results in a themed dropdown
- Scroll through results with mouse wheel or trackpad
- Use `ArrowUp`, `ArrowDown`, `PageUp`, `PageDown`, `Home`, and `End`
- Press `Enter` to select the highlighted row
- Click any result row to select it

## Tech Stack

- `Next.js` App Router
- `TypeScript`
- `Next.js` Route Handlers
- `xlsx`
- `Fetch API`
- `Vercel`

## Project Structure

```text
.
|- README.md
`- imf-data-app/
   |- app/
   |  |- api/
   |  |  |- download/
   |  |  |  `- route.ts
   |  |  `- metadata/
   |  |     `- route.ts
   |  |- globals.css
   |  |- layout.tsx
   |  `- page.tsx
   |- lib/
   |  |- dataParser.ts
   |  |- excelGenerator.ts
   |  |- imfClient.ts
   |  `- retryHandler.ts
   |- scripts/
   |  `- clean.mjs
   |- types/
   |  `- imf.ts
   |- utils/
   |  `- logger.ts
   |- next.config.ts
   |- package.json
   `- tsconfig.json
```

## API Endpoints

### `GET /api/metadata`

Returns the live IMF metadata catalog used by the frontend.

Example response shape:

```json
{
  "countries": [
    { "label": "India", "value": "IND" }
  ],
  "indicators": [
    {
      "label": "GDP per capita, current prices",
      "value": "NGDPDPC",
      "unit": "U.S. dollars per capita",
      "dataset": "WEO"
    }
  ],
  "lastUpdated": "2026-04-07T12:00:00.000Z"
}
```

### `GET /api/download`

Downloads IMF data as an Excel file.

Query params:

- `country`
- `indicator`

Example:

```text
/api/download?country=IND&indicator=NGDPDPC
```

Success behavior:

- Returns `IMF_Data.xlsx`
- Sets `Content-Disposition: attachment; filename="IMF_Data.xlsx"`

Example error shape:

```json
{
  "error": {
    "code": "NO_DATA",
    "message": "No data found for the selected country/region and indicator."
  }
}
```

## Resilience Features

- 3 retry attempts
- 10 second timeout per IMF request
- Exponential backoff: `500ms -> 1000ms -> 2000ms`
- Graceful handling for malformed JSON
- Safe handling when no data exists
- Structured JSON errors from the backend
- In-memory Excel generation using buffers only
- Metadata caching and in-flight request reuse

## IMF Data Source

This app uses the live IMF public DataMapper API:

- `https://www.imf.org/external/datamapper/api/v1/countries`
- `https://www.imf.org/external/datamapper/api/v1/indicators`
- `https://www.imf.org/external/datamapper/api/v1/{indicator}/{country}`

The frontend no longer relies on a tiny hardcoded list. It dynamically loads the official IMF metadata catalog and exposes the available country and indicator entries through searchable dropdowns.

## Local Development

### 1. Install dependencies

```bash
cd imf-data-app
npm install
```

### 2. Start the dev server

```bash
npm run dev
```

### 3. Open locally

```text
http://localhost:3000
```

## Important Build and Dev Note

This project isolates Next.js output directories to prevent stale chunk errors:

- `npm run dev` uses `.next-dev`
- `npm run build` uses the standard `.next`
- `npm run start` serves from the standard `.next`

Useful cleanup commands:

```bash
npm run clean
npm run clean:all
```

## Verification

Available checks:

```bash
npm run typecheck
npm run build
```

At the moment, ESLint is not configured yet, so there is no working lint command in the project right now.

## Deploying to Vercel

The Next.js app lives inside the `imf-data-app` folder, so set that as the Root Directory in Vercel.

### GitHub flow

1. Push this repository to GitHub
2. Import the repository into Vercel
3. Set Root Directory to `imf-data-app`
4. Keep the detected Next.js settings
5. Deploy

### CLI flow

```bash
cd imf-data-app
npx vercel
```

## Notes

- Metadata and data requests are fetched from official IMF public endpoints.
- Invalid or blank IMF metadata entries are filtered out before they reach the UI.
- Some country and indicator combinations may still return no data from IMF, which is handled as a clean app response rather than a crash.
- `xlsx` currently reports an upstream `npm audit` advisory with no published fix available at install time.

## Why This Repo Is Good to Publish

- Clean TypeScript structure
- Production-oriented error handling
- Searchable live IMF catalog
- Themed modern UI
- Isolated Next.js build and dev output handling
- Vercel-ready architecture
- GitHub-ready documentation

## License

MIT
