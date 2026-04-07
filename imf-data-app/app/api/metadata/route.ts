import { NextResponse } from "next/server";

import { ApiErrorPayload } from "@/types/imf";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiErrorPayload>> {
  return NextResponse.json(
    {
      error: true,
      code: "CLIENT_SIDE_FETCH_ONLY",
      message: "IMF metadata is now fetched directly from the frontend through a public proxy.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
