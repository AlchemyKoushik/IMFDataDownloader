import { NextRequest, NextResponse } from "next/server";

import { generateExcelBuffer } from "@/lib/excelGenerator";
import { ApiErrorPayload, DownloadObservation } from "@/types/imf";

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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const normalizeDownloadRows = (payload: unknown): DownloadObservation[] => {
  if (!Array.isArray(payload)) {
    throw new Error("Request body must be an array of data rows.");
  }

  return payload.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("Each data row must be an object.");
    }

    const year = typeof entry.year === "number" ? String(entry.year) : typeof entry.year === "string" ? entry.year.trim() : "";
    const country = typeof entry.country === "string" ? entry.country.trim().toUpperCase() : "";
    const indicator = typeof entry.indicator === "string" ? entry.indicator.trim().toUpperCase() : "";
    const rawValue = typeof entry.value === "number" ? entry.value : Number.parseFloat(String(entry.value ?? ""));

    if (!year || !country || !indicator || !Number.isFinite(rawValue)) {
      throw new Error("Each row must include valid year, value, country, and indicator fields.");
    }

    return {
      year,
      value: rawValue,
      country,
      indicator,
    };
  });
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as unknown;
    const rows = normalizeDownloadRows(payload);

    if (!rows.length) {
      return createErrorResponse(400, "EMPTY_DATASET", "At least one data row is required to generate the Excel file.");
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
    if (error instanceof Error) {
      return createErrorResponse(400, "DOWNLOAD_GENERATION_FAILED", error.message);
    }

    return createErrorResponse(500, "INTERNAL_SERVER_ERROR", "Unable to generate the Excel file right now.");
  }
}
