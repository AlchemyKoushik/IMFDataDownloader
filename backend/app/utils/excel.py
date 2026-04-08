from __future__ import annotations

from io import BytesIO
from typing import Sequence

import pandas as pd
from openpyxl.utils import get_column_letter

from app.models.request_models import GridObservation, Observation
from app.models.worldbank_models import WorldBankRow


def _measure_width(values: Sequence[str | int | float]) -> int:
    return min(max(max(len(str(value)) for value in values), 12) + 2, 42)


def _sanitize_file_segment(value: str) -> str:
    sanitized = []
    for character in value:
        if character in '<>:"/\\|?*' or ord(character) < 32:
            sanitized.append(" ")
        else:
            sanitized.append(character)
    return "_".join(" ".join("".join(sanitized).split()).split())


def build_excel_workbook(country: str, indicator: str, observations: Sequence[Observation]) -> tuple[BytesIO, str]:
    if not observations:
        raise ValueError("No data available.")

    buffer = BytesIO()
    rows = [{"Year": observation.year, "Value": observation.value} for observation in observations]
    dataframe = pd.DataFrame(rows)

    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        metadata_frame = pd.DataFrame([["Country", country], ["Indicator", indicator]])
        metadata_frame.to_excel(writer, sheet_name="IMF Data", index=False, header=False)
        dataframe.to_excel(writer, sheet_name="IMF Data", index=False, startrow=3)

        worksheet = writer.sheets["IMF Data"]
        worksheet.freeze_panes = "A5"
        worksheet.auto_filter.ref = f"A4:B{len(rows) + 4}"
        worksheet.column_dimensions[get_column_letter(1)].width = _measure_width(["Year", *[entry["Year"] for entry in rows]])
        worksheet.column_dimensions[get_column_letter(2)].width = _measure_width(["Value", *[entry["Value"] for entry in rows]])

    buffer.seek(0)
    file_name = f"{_sanitize_file_segment(country)}_{_sanitize_file_segment(indicator)}.xlsx"
    return buffer, file_name


def build_imf_grid_workbook(rows: Sequence[GridObservation]) -> tuple[BytesIO, str]:
    if not rows:
        raise ValueError("No data available.")

    buffer = BytesIO()
    records = [
        {
            "Country": row.country,
            "Indicator": row.indicator,
            "Year": row.year,
            "Value": row.value,
        }
        for row in rows
    ]
    dataframe = pd.DataFrame(records, columns=["Country", "Indicator", "Year", "Value"])

    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        dataframe.to_excel(writer, sheet_name="IMF Data", index=False)

        worksheet = writer.sheets["IMF Data"]
        worksheet.freeze_panes = "A2"
        worksheet.auto_filter.ref = f"A1:D{len(records) + 1}"
        worksheet.column_dimensions[get_column_letter(1)].width = _measure_width(
            ["Country", *[entry["Country"] for entry in records]]
        )
        worksheet.column_dimensions[get_column_letter(2)].width = _measure_width(
            ["Indicator", *[entry["Indicator"] for entry in records]]
        )
        worksheet.column_dimensions[get_column_letter(3)].width = _measure_width(
            ["Year", *[entry["Year"] for entry in records]]
        )
        worksheet.column_dimensions[get_column_letter(4)].width = _measure_width(
            ["Value", *[entry["Value"] for entry in records]]
        )

    buffer.seek(0)
    file_name = f"imf_data_grid_{pd.Timestamp.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return buffer, file_name


def build_world_bank_workbook(rows: Sequence[WorldBankRow]) -> tuple[BytesIO, str]:
    if not rows:
        raise ValueError("No data available.")

    buffer = BytesIO()
    records = [
        {
            "Country": row.country,
            "Indicator": row.indicator,
            "Year": row.year,
            "Value": row.value,
        }
        for row in rows
    ]
    dataframe = pd.DataFrame(records, columns=["Country", "Indicator", "Year", "Value"])

    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        dataframe.to_excel(writer, sheet_name="World Bank Data", index=False)

        worksheet = writer.sheets["World Bank Data"]
        worksheet.freeze_panes = "A2"
        worksheet.auto_filter.ref = f"A1:D{len(records) + 1}"
        worksheet.column_dimensions[get_column_letter(1)].width = _measure_width(
            ["Country", *[entry["Country"] for entry in records]]
        )
        worksheet.column_dimensions[get_column_letter(2)].width = _measure_width(
            ["Indicator", *[entry["Indicator"] for entry in records]]
        )
        worksheet.column_dimensions[get_column_letter(3)].width = _measure_width(
            ["Year", *[entry["Year"] for entry in records]]
        )
        worksheet.column_dimensions[get_column_letter(4)].width = _measure_width(
            ["Value", *[entry["Value"] for entry in records]]
        )

    buffer.seek(0)
    file_name = f"world_bank_data_{pd.Timestamp.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return buffer, file_name
