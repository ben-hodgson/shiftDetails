# Shift Details Dashboard

A Python + pandas + Plotly web dashboard that visualises the
`shift_details_24-25.csv` delivery shift data.

The data lives in a **SQLite database** (`data/shift_details.db`). The database
is built from the CSV with `import_db.py`, and the Flask app reads exclusively
from SQLite; the CSV is only touched when you regenerate the database.

## Setup

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# build (or rebuild) the SQLite database from the CSV
./venv/bin/python import_db.py

# run the app
./venv/bin/python app.py
```

Then open <http://127.0.0.1:5000> in your browser.

> If you start `app.py` before building the database, it imports the CSV
> automatically and then carries on.

## What you get

- **KPI cards** — shifts, total deliveries, drops per shift, average wait time, totes, van weight, top manager.
- **Charts** — deliveries over time (with rolling average), monthly totals, weekday distribution, wait-time and drops-per-shift histograms, average van weight by month, tote/weight relationship, manager leaderboard, van fleet usage, shift-length breakdown, drops-per-hour efficiency, and on-time returns.
- **Filters** — date range, manager, van registration, and shift length. Everything reacts instantly in the browser.
- **Add shifts** — an inline form writes new rows to the SQLite database via `POST /api/shifts` and refreshes every chart immediately.
- **Entries log** — `/entries` lists every shift (search by keyword, filter by manager or van). Each row can be **edited** in a modal or **deleted**, writing straight back to SQLite via `PUT` / `DELETE /api/shifts/<id>`.
- **Dark mode** — a toggle in the top bar, remembered across visits.

## Files

| File | Purpose |
| --- | --- |
| `app.py` | Flask server, serves the dashboard from the SQLite database |
| `data_loader.py` | Cleaning + SQLite read/write logic; derives every dashboard field |
| `import_db.py` | Builds `data/shift_details.db` from the source CSV |
| `templates/index.html` | Dashboard layout |
| `templates/entries.html` | Entries log page (list / edit / delete shifts) |
| `static/dashboard.js` | All chart rendering + filtering |
| `static/entries.js` | Entries table: search, filters, edit modal, delete |
| `static/style.css` | Styling (light + dark themes) |
| `data/shift_details_24-25.csv` | The source data |
| `data/shift_details.db` | SQLite database the app reads from |

## API

- `GET /api/data` — the cleaned records as JSON (read from SQLite).
- `POST /api/shifts` — validate and insert a new shift. Accepts a JSON object
  keyed by the database columns (`date`, `shift_start`, `shift_end`, `due_leave`,
  `wait_time`, `first_drop`, `last_drop`, `amount_of_drops`, `shift_length`,
  `back_at_store`, `weight_kg`, `van`, `managers`, `totes`). Only `date` is
  required; unknown fields or malformed values return `400` with a list of
  errors. On success returns the new row `id` and updates the in-memory dataset.
- `PUT /api/shifts/<id>` — replace every field of an existing shift (same JSON
  schema and validation as `POST`). Returns `404` if the id does not exist.
- `DELETE /api/shifts/<id>` — remove a shift. Returns `404` if the id does not exist.
- `GET /entries` — the entries log page.
- `GET /vendor/plotly.min.js` — bundled Plotly.js so the page works offline.

Shift `id`s correspond to the table's implicit SQLite `rowid`, so they are
stable across edits (entries carry their id through the `GET /api/data` payload).

## Data quirks handled

The CSV has blank rows, extra trailing fields, a few invalid dates (e.g. `31 Apr 2026`),
text in numeric columns, and unrecorded values. `data_loader.py` trims every row to the
known schema, coerces numbers, and leaves anything unusable as a null value rather than
crashing the dashboard.