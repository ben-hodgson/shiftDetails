"""Loader for the shift details dataset.

The authoritative source is a messy, semicolon-separated CSV. All cleaning logic
lives here and is shared by two paths:

1. ``import_db.py``  - parses the CSV and writes the cleaned rows into SQLite
   (``data/shift_details.db``).
2. ``load_shifts()`` - reads that SQLite database and derives the fields the
   dashboard needs.

Reading from SQLite means the web app runs entirely off the database; the CSV is
only touched when you regenerate the database.

The CSV itself contains a number of quirks that are handled defensively:
- fully blank rows
- extra trailing fields on a handful of rows
- a few impossible dates (e.g. 31 Apr 2026)
- occasional text in numeric columns
"""

from __future__ import annotations

import os
import re
import sqlite3
from datetime import date, datetime

import pandas as pd

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)
CSV_PATH = os.environ.get("CSV_PATH", os.path.join(DATA_DIR, "shift_details_24-25.csv"))
DB_PATH = os.environ.get("DB_PATH", os.path.join(DATA_DIR, "shift_details.db"))

TABLE = "shifts"

# Raw CSV schema (the file header).
COLUMNS = [
    "Date",
    "Shift Start",
    "Shift End",
    "Time due to leave",
    "Wait Time (minutes)",
    "First Drop Time",
    "Last Drop Time",
    "Amount of Drops",
    "Shift Length (hours)",
    "Back at Store",
    "Weight of Van (kg)",
    "Van Registration",
    "Managers Name",
    "Totes",
]

NUMERIC_COLUMNS = [
    "Wait Time (minutes)",
    "Amount of Drops",
    "Shift Length (hours)",
    "Weight of Van (kg)",
    "Totes",
]

TIME_COLUMNS = [
    "Shift Start",
    "Shift End",
    "Time due to leave",
    "First Drop Time",
    "Last Drop Time",
    "Back at Store",
]

# Maps the SQLite column name to the in-memory column name used by the API.
DB_MAP = {
    "date": "date",
    "shift_start": "Shift Start",
    "shift_end": "Shift End",
    "due_leave": "Time due to leave",
    "wait_time": "Wait Time (minutes)",
    "first_drop": "First Drop Time",
    "last_drop": "Last Drop Time",
    "amount_of_drops": "Amount of Drops",
    "shift_length": "Shift Length (hours)",
    "back_at_store": "Back at Store",
    "weight_kg": "Weight of Van (kg)",
    "van": "Van Registration",
    "managers": "Managers Name",
    "totes": "Totes",
}

# Column order used when creating / rewriting the table.
DB_COLUMNS = list(DB_MAP.keys())

# Field categories used by the form / API endpoint validation.
TIME_FIELDS = {
    "shift_start",
    "shift_end",
    "due_leave",
    "first_drop",
    "last_drop",
    "back_at_store",
}
NUMERIC_FIELDS = {"wait_time", "amount_of_drops", "shift_length", "weight_kg", "totes"}
TEXT_FIELDS = {"van", "managers"}

_TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")


# ---------------------------------------------------------------------------
# CSV -> cleaned DataFrame
# ---------------------------------------------------------------------------

def _read_raw_rows(path: str = CSV_PATH) -> pd.DataFrame:
    """Read the CSV line by line, trimming each row to the expected width."""
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        lines = handle.read().splitlines()

    records: list[list[str]] = []
    for line in lines[1:]:  # skip header
        parts = line.split(";")
        if not any(part.strip() for part in parts):
            continue
        parts = (parts + [""] * len(COLUMNS))[: len(COLUMNS)]
        records.append(parts)

    return pd.DataFrame(records, columns=COLUMNS)


def _finalize(df: pd.DataFrame) -> pd.DataFrame:
    """Add the derived columns the dashboard consumes."""
    df["managers"] = df["Managers Name"].astype(str).str.strip()
    df["manager_list"] = df["managers"].apply(
        lambda value: [name.strip() for name in value.split(",") if name.strip()]
    )
    df["manager_label"] = df["managers"].replace({"": "Unassigned"})

    # A "full" shift row is one that actually has a drop count recorded.
    df["has_shift_data"] = df["Amount of Drops"].notna()

    df["weekday"] = df["date"].dt.day_name()
    df["weekday_num"] = df["date"].dt.weekday
    df["month"] = df["date"].dt.to_period("M")
    df["month_label"] = df["month"].astype(str)
    df["drops_per_hour"] = df["Amount of Drops"] / df["Shift Length (hours)"].replace(0, pd.NA)
    df["weight_per_tote"] = df["Weight of Van (kg)"] / df["Totes"].replace(0, pd.NA)

    return df


def _clean_raw(df: pd.DataFrame) -> pd.DataFrame:
    """Type conversion + validation shared by the CSV and SQLite paths."""
    for column in df.columns:
        df[column] = df[column].astype(str).str.strip()

    df["date"] = pd.to_datetime(df["Date"], format="%d %b %Y", errors="coerce")

    for column in TIME_COLUMNS:
        df[column] = pd.to_datetime(df[column], format="%H:%M", errors="coerce")

    for column in NUMERIC_COLUMNS:
        cleaned = (
            df[column]
            .astype(str)
            .str.replace(",", "", regex=False)
            .str.replace(r"[^0-9.\-]", "", regex=True)
        )
        df[column] = pd.to_numeric(cleaned, errors="coerce")

    df = df[df["date"].notna()].reset_index(drop=True)
    return _finalize(df)


def load_from_csv(path: str = CSV_PATH) -> pd.DataFrame:
    """Parse + fully clean the CSV into a dashboard-ready DataFrame."""
    return _clean_raw(_read_raw_rows(path))


# ---------------------------------------------------------------------------
# SQLite read / write
# ---------------------------------------------------------------------------

def _time_to_db(value) -> str | None:
    if pd.isna(value):
        return None
    return value.strftime("%H:%M")


def _to_db_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Build a DataFrame whose columns match the ``shifts`` table schema."""
    rows: list[dict] = []
    for _, row in df.iterrows():
        rows.append(
            {
                "date": row["date"].strftime("%Y-%m-%d"),
                "shift_start": _time_to_db(row["Shift Start"]),
                "shift_end": _time_to_db(row["Shift End"]),
                "due_leave": _time_to_db(row["Time due to leave"]),
                "wait_time": _num(row["Wait Time (minutes)"]),
                "first_drop": _time_to_db(row["First Drop Time"]),
                "last_drop": _time_to_db(row["Last Drop Time"]),
                "amount_of_drops": _num(row["Amount of Drops"]),
                "shift_length": _num(row["Shift Length (hours)"]),
                "back_at_store": _time_to_db(row["Back at Store"]),
                "weight_kg": _num(row["Weight of Van (kg)"]),
                "van": str(row["Van Registration"]),
                "managers": str(row["Managers Name"]),
                "totes": _num(row["Totes"]),
            }
        )
    return pd.DataFrame(rows, columns=DB_COLUMNS)


def write_to_sqlite(df: pd.DataFrame, db_path: str = DB_PATH, table: str = TABLE) -> int:
    """Write the cleaned DataFrame into SQLite, replacing any existing rows."""
    db_df = _to_db_frame(df)
    with sqlite3.connect(db_path) as conn:
        db_df.to_sql(table, conn, if_exists="replace", index=False)
    return len(db_df)


def normalise_shift_input(data: dict) -> tuple[dict, list[str]]:
    """Validate form input and turn it into a row dict keyed by DB_COLUMNS.

    Returns ``(row, errors)``. ``row`` only ever contains allowed keys, so it is
    safe to pass to :func:`insert_shift` as ``**row``.
    """
    errors: list[str] = []
    row: dict = {}

    raw_date = str(data.get("date") or "").strip()
    if not raw_date:
        errors.append("date is required")
    else:
        try:
            datetime.strptime(raw_date, "%Y-%m-%d")
            row["date"] = raw_date
        except ValueError:
            errors.append(f"date '{raw_date}' is not a valid date (expected YYYY-MM-DD)")

    for field in TIME_FIELDS:
        raw = str(data.get(field) or "").strip()
        if not raw:
            row[field] = None
        elif _TIME_RE.fullmatch(raw):
            row[field] = raw
        else:
            errors.append(f"{field} must be a time in HH:MM, got '{raw}'")

    for field in NUMERIC_FIELDS:
        raw = str(data.get(field) or "").strip()
        if not raw:
            row[field] = None
        else:
            try:
                row[field] = float(raw.replace(",", ""))
            except ValueError:
                errors.append(f"{field} must be a number, got '{raw}'")

    for field in TEXT_FIELDS:
        row[field] = str(data.get(field) or "").strip()

    unknown = set(data) - set(DB_COLUMNS)
    if unknown:
        errors.append("unknown fields: " + ", ".join(sorted(unknown)))

    return row, errors


def insert_shift(db_path: str = DB_PATH, table: str = TABLE, **row) -> int:
    """Insert one shift row. Keys must be DB_COLUMNS. Returns the new rowid."""
    values = [row.get(column) for column in DB_COLUMNS]
    columns = ", ".join(f'"{column}"' for column in DB_COLUMNS)
    placeholders = ", ".join("?" for _ in DB_COLUMNS)
    sql = f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})'
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(sql, values)
        return cursor.lastrowid


def update_shift(shift_id: int, row: dict, db_path: str = DB_PATH, table: str = TABLE) -> bool:
    """Update every data column of a shift. Keys must be DB_COLUMNS."""
    assignments = ", ".join(f'"{column}" = ?' for column in DB_COLUMNS)
    values = [row.get(column) for column in DB_COLUMNS] + [shift_id]
    sql = f'UPDATE "{table}" SET {assignments} WHERE rowid = ?'
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(sql, values)
        return cursor.rowcount > 0


def delete_shift(shift_id: int, db_path: str = DB_PATH, table: str = TABLE) -> bool:
    """Delete a shift by row id. Returns True if a row was removed."""
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(f'DELETE FROM "{table}" WHERE rowid = ?', (shift_id,))
        return cursor.rowcount > 0


def load_shifts(db_path: str = DB_PATH, table: str = TABLE) -> pd.DataFrame:
    """Load shifts from the SQLite database and derive the dashboard fields."""
    if not os.path.exists(db_path):
        raise FileNotFoundError(
            f"Database not found: {db_path}. "
            "Run `python import_db.py` first to build it from the CSV."
        )

    with sqlite3.connect(db_path) as conn:
        query = f'SELECT rowid AS id, * FROM "{table}" ORDER BY rowid'
        raw = pd.read_sql_query(query, conn)

    df = pd.DataFrame()
    for db_column, display in DB_MAP.items():
        if db_column in raw.columns:
            df[display] = raw[db_column]

    if "id" in raw.columns:
        df["id"] = raw["id"].astype("int64")
    else:
        df["id"] = range(1, len(df) + 1)

    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d", errors="coerce")
    df["Date"] = df["date"].dt.strftime("%d %b %Y")

    # The DB only stores calendar/clock values; promote them to datetimes so the
    # API payload is byte-identical to the CSV path. Missing values stay NULL.
    for column in TIME_COLUMNS:
        df[column] = pd.to_datetime(df[column], format="%H:%M", errors="coerce")

    return _finalize(df)


def database_info(db_path: str = DB_PATH) -> dict:
    """Row count and date range, for sanity checking the imported database."""
    shifts = load_shifts(db_path)
    valid_dates = shifts["date"].dropna()
    return {
        "rows": len(shifts),
        "min_date": valid_dates.min().strftime("%Y-%m-%d") if len(valid_dates) else None,
        "max_date": valid_dates.max().strftime("%Y-%m-%d") if len(valid_dates) else None,
    }


# ---------------------------------------------------------------------------
# Dashboard helpers
# ---------------------------------------------------------------------------

def _num(value) -> float | None:
    return None if pd.isna(value) else float(value)


def _time_str(value) -> str | None:
    if pd.isna(value):
        return None
    return value.strftime("%H:%M")


def to_records(df: pd.DataFrame) -> list[dict]:
    """Serialise the DataFrame into JSON friendly primitives for the frontend."""
    records: list[dict] = []
    for _, row in df.iterrows():
        van = row["Van Registration"]
        records.append(
            {
                "id": int(row["id"]),
                "date": row["date"].strftime("%Y-%m-%d"),
                "month": row["month_label"],
                "weekday": row["weekday"],
                "weekdayNum": int(row["weekday_num"]),
                "shiftStart": _time_str(row["Shift Start"]),
                "shiftEnd": _time_str(row["Shift End"]),
                "dueLeave": _time_str(row["Time due to leave"]),
                "waitTime": _num(row["Wait Time (minutes)"]),
                "firstDrop": _time_str(row["First Drop Time"]),
                "lastDrop": _time_str(row["Last Drop Time"]),
                "drops": _num(row["Amount of Drops"]),
                "shiftLength": _num(row["Shift Length (hours)"]),
                "backAtStore": _time_str(row["Back at Store"]),
                "weight": _num(row["Weight of Van (kg)"]),
                "van": van if van not in ("", "nan") else "Unknown",
                "managers": row["Managers Name"],
                "managerLabel": row["manager_label"],
                "managerList": row["manager_list"],
                "totes": _num(row["Totes"]),
                "dropsPerHour": _num(row["drops_per_hour"]),
                "weightPerTote": _num(row["weight_per_tote"]),
            }
        )
    return records


def dataset_meta(df: pd.DataFrame) -> dict:
    """Small summary object used to build the filter controls."""
    valid_dates = df["date"].dropna()
    return {
        "totalRows": int(len(df)),
        "minDate": valid_dates.min().strftime("%Y-%m-%d") if len(valid_dates) else None,
        "maxDate": valid_dates.max().strftime("%Y-%m-%d") if len(valid_dates) else None,
        "generated": date.today().isoformat(),
    }


def unique_values(df: pd.DataFrame) -> dict:
    managers: set[str] = set()
    for names in df["manager_list"]:
        managers.update(names)
    vans = sorted({v for v in df["Van Registration"] if v and v != "nan"})
    return {
        "managers": sorted(managers),
        "vans": vans,
    }


if __name__ == "__main__":
    print("database:", DB_PATH)
    print(pd.DataFrame([database_info()]).to_string(index=False))
    sample = load_shifts()
    print(sample[["date", "Amount of Drops", "Weight of Van (kg)", "Totes", "manager_label"]].head().to_string(index=False))