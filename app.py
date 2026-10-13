"""Flask dashboard for the delivery shift details dataset.

Run with:  python app.py
Then open: http://127.0.0.1:5000
"""

from __future__ import annotations

import json
import os

from flask import Flask, Response, jsonify, render_template, request

import data_loader

app = Flask(__name__)


def _build_payload() -> dict:
    """Read the database once and shape it into the dashboard payload."""
    frame = data_loader.load_shifts()
    return {
        "records": data_loader.to_records(frame),
        "meta": data_loader.dataset_meta(frame),
        "filters": data_loader.unique_values(frame),
    }


_PAYLOAD = None


def _init_payload():
    global _PAYLOAD
    try:
        _PAYLOAD = _build_payload()
    except Exception:
        # If database is empty or missing, create empty payload
        _PAYLOAD = {
            "records": [],
            "meta": {
                "total_rows": 0,
                "full_shift_rows": 0,
                "earliest_date": None,
                "latest_date": None,
                "weight_kg_total": 0,
                "weight_kg_mean": 0,
                "totes_total": 0,
                "totes_mean": 0,
                "amount_of_drops_total": 0,
                "amount_of_drops_mean": 0,
                "shift_length_hours_total": 0,
                "shift_length_hours_mean": 0,
                "wait_time_minutes_total": 0,
                "wait_time_minutes_mean": 0,
                "van_count": 0,
                "manager_count": 0,
                "shifts_with_drops": 0,
            },
            "filters": {
                "managers": [],
                "manager_list": [],
                "vans": [],
                "months": [],
                "years": [],
                "weekdays": [],
            },
        }


# Ensure database exists (create empty one if needed)
if not os.path.exists(data_loader.DB_PATH):
    # Create empty database with schema
    import sqlite3

    os.makedirs(data_loader.DATA_DIR, exist_ok=True)
    with sqlite3.connect(data_loader.DB_PATH) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS shifts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                shift_start TEXT,
                shift_end TEXT,
                due_leave TEXT,
                wait_time REAL,
                first_drop TEXT,
                last_drop TEXT,
                amount_of_drops REAL,
                shift_length REAL,
                back_at_store TEXT,
                weight_kg REAL,
                van TEXT,
                managers TEXT,
                totes REAL
            )"""
        )

_init_payload()


@app.route("/")
def index():
    return render_template(
        "index.html",
        data_json=json.dumps(_PAYLOAD).replace("<", "\\u003c"),
        meta=_PAYLOAD["meta"],
    )


@app.route("/api/data")
def api_data():
    return jsonify(_PAYLOAD)


@app.route("/api/upload", methods=["POST"])
def upload_csv():
    """Upload a CSV file and import it into the database."""
    global _PAYLOAD

    if "file" not in request.files:
        return jsonify({"ok": False, "errors": ["no file provided"]}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"ok": False, "errors": ["no file selected"]}), 400

    if not file.filename.lower().endswith(".csv"):
        return jsonify({"ok": False, "errors": ["file must be a CSV"]}), 400

    os.makedirs(data_loader.DATA_DIR, exist_ok=True)
    upload_path = os.path.join(data_loader.DATA_DIR, file.filename)
    file.save(upload_path)

    try:
        frame = data_loader.load_from_csv(upload_path)
        rows = data_loader.write_to_sqlite(frame)
        _PAYLOAD = _build_payload()
        return jsonify({"ok": True, "rows": int(rows), "meta": _PAYLOAD["meta"]})
    except Exception as e:
        return jsonify({"ok": False, "errors": [str(e)]}), 400


@app.route("/api/shifts", methods=["POST"])
def add_shift():
    """Validate and insert a new shift, then serve the refreshed dataset."""
    global _PAYLOAD

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"ok": False, "errors": ["expected a JSON object"]}), 400

    row, errors = data_loader.normalise_shift_input(body)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400

    shift_id = data_loader.insert_shift(row)
    _PAYLOAD = _build_payload()
    return jsonify({"ok": True, "id": shift_id, "meta": _PAYLOAD["meta"]})


@app.route("/api/shifts/<int:shift_id>", methods=["PUT"])
def update_shift(shift_id: int):
    """Validate and update an existing shift, then serve the refreshed dataset."""
    global _PAYLOAD

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"ok": False, "errors": ["expected a JSON object"]}), 400

    row, errors = data_loader.normalise_shift_input(body)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400

    if not data_loader.update_shift(shift_id, row):
        return jsonify({"ok": False, "errors": ["shift not found"]}), 404

    _PAYLOAD = _build_payload()
    return jsonify({"ok": True, "id": shift_id, "meta": _PAYLOAD["meta"]})


@app.route("/api/shifts/<int:shift_id>", methods=["DELETE"])
def delete_shift(shift_id: int):
    """Delete a shift by id."""
    global _PAYLOAD

    if not data_loader.delete_shift(shift_id):
        return jsonify({"ok": False, "errors": ["shift not found"]}), 404

    _PAYLOAD = _build_payload()
    return jsonify({"ok": True, "id": shift_id, "meta": _PAYLOAD["meta"]})


@app.route("/entries")
def entries():
    return render_template("entries.html", meta=_PAYLOAD["meta"])


@app.route("/vendor/plotly.min.js")
def plotly_js():
    """Serve the bundled plotly.js so the dashboard works fully offline."""
    from plotly.offline import get_plotlyjs

    return Response(get_plotlyjs(), mimetype="application/javascript")


if __name__ == "__main__":
    host = os.environ.get("FLASK_HOST", "0.0.0.0")
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug, host=host, port=5000)
