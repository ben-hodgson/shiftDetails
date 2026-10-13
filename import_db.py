"""Build data/shift_details.db from the raw CSV.

Usage:
    ./venv/bin/python import_db.py

The cleaned rows are read from the CSV and written to SQLite, replacing any
previous database contents. The web app reads exclusively from the database.
"""

from __future__ import annotations

import os

import data_loader


def main() -> int:
    print(f"reading {data_loader.CSV_PATH}")
    frame = data_loader.load_from_csv()

    rows = data_loader.write_to_sqlite(frame)
    print(f"wrote {rows} rows to {data_loader.DB_PATH}")

    print(data_loader.database_info())
    if rows:
        print(
            "created",
            os.path.getsize(data_loader.DB_PATH) / 1024,
            "KiB database",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())