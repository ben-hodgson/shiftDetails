/* Entries log: render, search, edit and delete shifts via the API. */
(function () {
  "use strict";

  var RECORDS = [];
  var FILTERS = { managers: [], vans: [] };
  var META = {};
  var state = { q: "", manager: "all", van: "all", limit: "all" };

  var COLUMN_KEYS = [
    ["date", "Date"],
    ["shiftStart", "Start"],
    ["shiftEnd", "End"],
    ["waitTime", "Wait (min)"],
    ["drops", "Drops"],
    ["shiftLength", "Length (h)"],
    ["weight", "Weight (kg)"],
    ["van", "Van"],
    ["managers", "Managers"],
    ["totes", "Totes"],
  ];

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function clean(value) {
    return value === null || value === undefined || String(value).trim() === "" ? "&ndash;" : esc(value);
  }

  function fmt(value) {
    if (value === null || value === undefined || isNaN(value)) return "&ndash;";
    return Number(value).toLocaleString("en-GB");
  }

  /* ---------- data ---------- */

  function loadData() {
    return fetch("/api/data")
      .then(function (response) { return response.json(); })
      .then(function (payload) {
        RECORDS = payload.records;
        FILTERS = payload.filters;
        META = payload.meta;
      });
  }

  function visible() {
    var q = state.q.toLowerCase();
    return RECORDS.filter(function (r) {
      if (state.manager !== "all" && r.managerList.indexOf(state.manager) === -1) return false;
      if (state.van !== "all" && r.van !== state.van) return false;
      if (!q) return true;
      var haystack = [r.date, r.weekday, r.van, r.managers, String(r.drops || "")]
        .join(" ").toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
  }

  /* ---------- rendering ---------- */

  function render() {
    var rows = visible();
    var limited = state.limit === "all" ? rows : rows.slice(0, Number(state.limit));
    var body = document.getElementById("entry-body");
    var empty = document.getElementById("entry-empty");

    body.innerHTML = limited.map(function (r, index) {
      var shift = (r.shiftStart ? esc(r.shiftStart) : "&ndash;") +
        " &rarr; " + (r.shiftEnd ? esc(r.shiftEnd) : "&ndash;");
      var waitColour = r.waitTime !== null && r.waitTime > 45
        ? ' style="color:var(--rose);font-weight:600"' : "";
      return '<tr>' +
        '<td class="cell-id">' + r.id + "</td>" +
        '<td>' + esc(r.date) + '<div class="cell-sub">' + esc(r.weekday) + "</div></td>" +
        "<td>" + shift + "</td>" +
        "<td" + waitColour + ">" + fmt(r.waitTime) + "</td>" +
        "<td>" + fmt(r.drops) + "</td>" +
        "<td>" + (r.shiftLength === null ? "&ndash;" : Number(r.shiftLength).toLocaleString("en-GB", { maximumFractionDigits: 1 })) + "</td>" +
        "<td>" + fmt(r.weight) + "</td>" +
        "<td>" + clean(r.van) + "</td>" +
        "<td>" + clean(r.managers) + "</td>" +
        "<td>" + fmt(r.totes) + "</td>" +
        '<td class="cell-actions">' +
        '<button type="button" class="btn-icon edit" data-action="edit" data-index="' + index + '">Edit</button>' +
        '<button type="button" class="btn-icon del" data-action="delete" data-index="' + index + '">Delete</button>' +
        "</td>" +
        "</tr>";
    }).join("");

    empty.classList.toggle("hidden", limited.length !== 0);
    document.getElementById("entry-count").innerHTML =
      "Showing <strong>" + limited.length + "</strong>" +
      (state.limit !== "all" && rows.length > limited.length
        ? " of " + rows.length
        : "") +
      " of <span>" + RECORDS.length + "</span> entries";
  }

  function populateFilters() {
    var manager = document.getElementById("entry-manager");
    var prevManager = state.manager;
    manager.innerHTML = '<option value="all">All managers</option>' +
      FILTERS.managers.map(function (m) { return '<option value="' + m + '">' + m + "</option>"; }).join("");
    state.manager = FILTERS.managers.indexOf(prevManager) !== -1 ? prevManager : "all";
    manager.value = state.manager;

    var van = document.getElementById("entry-van");
    var prevVan = state.van;
    van.innerHTML = '<option value="all">All vans</option>' +
      FILTERS.vans.map(function (v) { return '<option value="' + v + '">' + v + "</option>"; }).join("");
    state.van = FILTERS.vans.indexOf(prevVan) !== -1 ? prevVan : "all";
    van.value = state.van;
  }

  function renderMeta() {
    document.getElementById("meta-range").textContent = META.minDate + " to " + META.maxDate;
    document.getElementById("meta-rows").textContent = META.totalRows;
    document.getElementById("meta-generated").textContent = "Dashboard generated " + META.generated +
      " · Source: SQLite database (data/shift_details.db)";
  }

  function refresh() {
    return loadData().then(function () {
      populateFilters();
      renderMeta();
      render();
    });
  }

  /* ---------- edit modal ---------- */

  var backdrop = document.getElementById("edit-backdrop");
  var editForm = document.getElementById("edit-form");
  var editResult = document.getElementById("edit-result");
  var editSubmit = document.getElementById("edit-submit");
  var currentRecord = null;

  var FIELD_MAP = {
    date: "date",
    shift_start: "shiftStart",
    shift_end: "shiftEnd",
    due_leave: "dueLeave",
    wait_time: "waitTime",
    first_drop: "firstDrop",
    last_drop: "lastDrop",
    amount_of_drops: "drops",
    shift_length: "shiftLength",
    back_at_store: "backAtStore",
    weight_kg: "weight",
    van: "van",
    managers: "managers",
    totes: "totes",
  };

  function openEdit(record) {
    currentRecord = record;
    document.getElementById("edit-title").textContent = "Edit entry #" + record.id;
    editForm.querySelectorAll("[data-field]").forEach(function (input) {
      var key = FIELD_MAP[input.dataset.field] || input.dataset.field;
      var value = record[key];
      input.value = (value === null || value === undefined) ? "" : String(value);
    });
    editResult.textContent = "";
    editResult.className = "form-result";
    backdrop.classList.remove("hidden");
  }

  function closeEdit() {
    currentRecord = null;
    backdrop.classList.add("hidden");
  }

  editForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!currentRecord) return;

    var payload = {};
    editForm.querySelectorAll("[data-field]").forEach(function (input) {
      payload[input.dataset.field] = input.value;
    });

    editSubmit.disabled = true;
    editResult.innerHTML = "Saving&hellip;";
    editResult.className = "form-result form-result-ok";

    fetch("/api/shifts/" + currentRecord.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      })
      .then(function (result) {
        if (result.ok) {
          closeEdit();
          refresh();
        } else {
          editResult.innerHTML = (result.body.errors || ["Something went wrong."]).join("<br>");
          editResult.className = "form-result form-result-error";
        }
      })
      .catch(function (error) {
        editResult.innerHTML = String(error);
        editResult.className = "form-result form-result-error";
      })
      .finally(function () {
        editSubmit.disabled = false;
      });
  });

  document.getElementById("edit-cancel").addEventListener("click", closeEdit);
  backdrop.addEventListener("click", function (event) {
    if (event.target === backdrop) closeEdit();
  });

  /* ---------- table actions ---------- */

  document.getElementById("entry-body").addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var row = visible()[Number(button.dataset.index)];
    if (!row) return;

    if (button.dataset.action === "edit") {
      openEdit(row);
      return;
    }

    if (button.dataset.action === "delete" && window.confirm(
      "Delete entry #" + row.id + " (" + row.date + ", " +
      (row.managers || "unassigned") + ")?\nThis cannot be undone."
    )) {
      button.disabled = true;
      fetch("/api/shifts/" + row.id, { method: "DELETE" })
        .then(function (response) {
          return response.json().then(function (body) { return { ok: response.ok, body: body }; });
        })
        .then(function (result) {
          if (result.ok) {
            refresh();
          } else {
            window.alert("Could not delete: " + (result.body.errors || ["unknown error"]).join(", "));
            button.disabled = false;
          }
        })
        .catch(function (error) {
          window.alert(String(error));
          button.disabled = false;
        });
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeEdit();
  });

  /* ---------- filters ---------- */

  document.getElementById("entry-search").addEventListener("input", function () {
    state.q = this.value;
    render();
  });
  document.getElementById("entry-manager").addEventListener("change", function () {
    state.manager = this.value;
    render();
  });
  document.getElementById("entry-van").addEventListener("change", function () {
    state.van = this.value;
    render();
  });
  document.getElementById("entry-limit").addEventListener("change", function () {
    state.limit = this.value;
    render();
  });
  document.getElementById("entry-reset").addEventListener("click", function () {
    document.getElementById("entry-search").value = "";
    document.getElementById("entry-limit").value = "all";
    state = { q: "", manager: "all", van: "all", limit: "all" };
    populateFilters();
    render();
  });

  /* ---------- theme (shared with the dashboard) ---------- */

  var THEME = { name: "light", isLight: true };

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }

  function preferredTheme() {
    var saved = localStorage.getItem("shift-dash-theme");
    return saved === "dark" || saved === "light" ? saved : systemTheme();
  }

  function applyTheme(theme) {
    THEME.name = theme;
    THEME.isLight = theme === "light";
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("theme-toggle").setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  }

  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = THEME.isLight ? "dark" : "light";
    localStorage.setItem("shift-dash-theme", next);
    applyTheme(next);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
    if (!localStorage.getItem("shift-dash-theme")) applyTheme(e.matches ? "dark" : "light");
  });

  /* ---------- kick off ---------- */
  applyTheme(preferredTheme());
  refresh();
})();