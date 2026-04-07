import { NextRequest, NextResponse } from "next/server";

import { parseImfData } from "@/lib/dataParser";
import { generateExcelBuffer } from "@/lib/excelGenerator";
import { fetchImfCountries, fetchImfData, fetchImfIndicators } from "@/lib/imfClient";
import { RequestError } from "@/lib/retryHandler";
import { ApiErrorPayload } from "@/types/imf";
import { logger } from "@/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const createErrorResponse = (status: number, code: string, message: string, details?: string): NextResponse<ApiErrorPayload> =>
  NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );

const normalizeQueryValue = (value: string | null): string => value?.trim().toUpperCase() ?? "";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const country = normalizeQueryValue(request.nextUrl.searchParams.get("country"));
  const indicator = normalizeQueryValue(request.nextUrl.searchParams.get("indicator"));

  if (!country || !indicator) {
    return createErrorResponse(400, "VALIDATION_ERROR", "Country and indicator are required.");
  }

  try {
    try {
      const [countries, indicators] = await Promise.all([fetchImfCountries(), fetchImfIndicators()]);
      const countrySet = new Set(countries.map((option) => option.value));
      const indicatorSet = new Set(indicators.map((option) => option.value));

      if (!countrySet.has(country)) {
        return createErrorResponse(400, "UNSUPPORTED_COUNTRY", "The selected country is not supported.");
      }

      if (!indicatorSet.has(indicator)) {
        return createErrorResponse(400, "UNSUPPORTED_INDICATOR", "The selected indicator is not supported.");
      }
    } catch (error) {
      logger.warn("Metadata validation skipped because IMF metadata could not be loaded.", {
        country,
        indicator,
        error,
      });
    }

    const rawResponse = await fetchImfData(country, indicator);
    const rows = parseImfData(rawResponse);

    if (!rows.length) {
      return createErrorResponse(404, "NO_DATA", "No data found for the selected country and indicator.");
    }

    const excelBuffer = generateExcelBuffer(rows);

    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="IMF_Data.xlsx"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("Download route failed.", error, {
      country,
      indicator,
    });

    if (error instanceof RequestError) {
      return createErrorResponse(error.status, error.code, error.message);
    }

    return createErrorResponse(
      500,
      "INTERNAL_SERVER_ERROR",
      "Unable to generate the Excel file right now. Please try again shortly.",
    );
  }
}
