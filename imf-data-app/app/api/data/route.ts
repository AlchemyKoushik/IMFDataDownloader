import { NextRequest, NextResponse } from "next/server";

import { parseImfData } from "@/lib/dataParser";
import { fetchImfData } from "@/lib/imfClient";
import { RequestError } from "@/lib/retryHandler";
import { ApiErrorPayload, DataResponsePayload } from "@/types/imf";
import { logger } from "@/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const createErrorResponse = (status: number, code: string, message: string, details?: string): NextResponse<ApiErrorPayload> =>
  NextResponse.json(
    {
      error: true,
      code,
      message,
      ...(details ? { details } : {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

const normalizeQueryValue = (value: string | null): string => value?.trim().toUpperCase() ?? "";

export async function GET(request: NextRequest): Promise<NextResponse<DataResponsePayload | ApiErrorPayload>> {
  const country = normalizeQueryValue(request.nextUrl.searchParams.get("country"));
  const indicator = normalizeQueryValue(request.nextUrl.searchParams.get("indicator"));

  if (!country || !indicator) {
    return createErrorResponse(400, "VALIDATION_ERROR", "Country and indicator are required.");
  }

  try {
    const rawResponse = await fetchImfData(country, indicator);
    const rows = parseImfData(rawResponse);

    if (!rows.length) {
      return createErrorResponse(404, "NO_DATA", "No data available for selected country and indicator.");
    }

    return NextResponse.json(
      {
        country,
        indicator,
        rows,
        lastUpdated: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    logger.error("Data route failed.", error, {
      country,
      indicator,
    });

    if (error instanceof RequestError) {
      return createErrorResponse(error.status, error.code, error.message);
    }

    return createErrorResponse(500, "INTERNAL_SERVER_ERROR", "Unable to fetch IMF data right now.");
  }
}
