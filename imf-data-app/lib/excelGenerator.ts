import * as XLSX from "xlsx";

import { NormalizedObservation } from "@/types/imf";

const measureWidth = (values: Array<string | number>): number =>
  Math.max(...values.map((value) => String(value).length), 10) + 2;

export function generateExcelBuffer(rows: NormalizedObservation[]): Buffer {
  if (!rows.length) {
    throw new Error("Cannot generate an Excel file without data rows.");
  }

  const worksheetData: Array<[string, string | number]> = [["Year", "Value"]];

  for (const row of rows) {
    worksheetData.push([row.year, row.value]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  worksheet["!cols"] = [
    { wch: measureWidth(["Year", ...rows.map((row) => row.year)]) },
    { wch: measureWidth(["Value", ...rows.map((row) => row.value)]) },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "IMF Data");

  const file = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  });

  if (Buffer.isBuffer(file)) {
    return file;
  }

  if (file instanceof Uint8Array) {
    return Buffer.from(file);
  }

  return Buffer.from(file as ArrayBuffer);
}
