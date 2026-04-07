import * as XLSX from "xlsx";

import type { NormalizedObservation } from "@/types/imf";

const measureWidth = (values: Array<string | number>): number =>
  Math.min(
    Math.max(
      ...values.map((value) => String(value).length),
      12,
    ) + 2,
    42,
  );

const sanitizeFileSegment = (value: string): string =>
  value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_");

export function generateExcel(data: NormalizedObservation[], country: string, indicator: string): void {
  if (!data.length) {
    throw new Error("No data available.");
  }

  const worksheetData = [
    ["Country", country],
    ["Indicator", indicator],
    [],
    ["Year", "Value"],
    ...data.map((entry) => [entry.year, entry.value]),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();

  worksheet["!cols"] = [
    { wch: measureWidth(["Year", ...data.map((entry) => entry.year)]) },
    { wch: measureWidth(["Value", ...data.map((entry) => entry.value)]) },
  ];
  worksheet["!autofilter"] = {
    ref: `A4:B${data.length + 4}`,
  };

  XLSX.utils.book_append_sheet(workbook, worksheet, "IMF Data");

  const fileName = `${sanitizeFileSegment(country)}_${sanitizeFileSegment(indicator)}_${new Date().getFullYear()}.xlsx`;

  XLSX.writeFile(workbook, fileName);
}
