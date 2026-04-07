import { NextResponse } from "next/server";

import { fetchImfCountries, fetchImfIndicators } from "@/lib/imfClient";
import { RequestError } from "@/lib/retryHandler";
import { ApiErrorPayload, MetadataResponsePayload } from "@/types/imf";
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

export async function GET(): Promise<NextResponse<MetadataResponsePayload | ApiErrorPayload>> {
  try {
    const [countries, indicators] = await Promise.all([fetchImfCountries(), fetchImfIndicators()]);

    return NextResponse.json(
      {
        countries,
        indicators,
        lastUpdated: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    logger.error("Metadata route failed.", error);

    if (error instanceof RequestError) {
      return createErrorResponse(error.status, error.code, error.message);
    }

    return createErrorResponse(500, "INTERNAL_SERVER_ERROR", "Unable to load IMF metadata right now.");
  }
}
