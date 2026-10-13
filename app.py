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


# The app serves straight from SQLite. If the database hasn't been built yet,
# import the CSV once, then carry on.
if not os.path.exists(data_loader.DB_PATH):
    import import_db

    import_db.main()

_PAYLOAD = _build_payload()


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

    new_id = data_loader.insert_shift(**row)
    _PAYLOAD = _build_payload()
    return jsonify({"ok": True, "id": new_id, "meta": _PAYLOAD["meta"]}), 201


@app.route("/api/shifts/<int:shift_id>", methods=["PUT"])
def update_shift(shift_id: int):
    """Replace every field of an existing shift."""
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
    app.run(debug=True, host="127.0.0.1", port=5000)
