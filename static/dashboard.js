/* Shift Details dashboard: loads the embedded dataset and renders all charts. */
(function () {
  "use strict";

  var RECORDS = [];
  var FILTERS = { managers: [], vans: [] };
  var META = {};

  var THEMES = {
    light: {
      font: "#1f2430",
      mutedFont: "#667085",
      grid: "#e8ebf2",
      hoverBg: "#1f2430",
      colorbarOutline: "rgba(0,0,0,0.15)",
      colorscale: "Blues",
      legendBg: "rgba(255,255,255,0.6)",
      palette: [
        "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b",
        "#f43f5e", "#8b5cf6", "#14b8a6", "#f97316",
        "#6366f1", "#22c55e", "#ef4444", "#a855f7",
      ],
    },
    dark: {
      font: "#e6e9f2",
      mutedFont: "#a5aec4",
      grid: "#2a3350",
      hoverBg: "#101326",
      colorbarOutline: "rgba(255,255,255,0.25)",
      colorscale: [[0, "#38bdf8"], [0.5, "#fbbf24"], [1, "#fb7185"]],
      legendBg: "rgba(16,19,38,0.75)",
      palette: [
        "#818cf8", "#38bdf8", "#34d399", "#fbbf24",
        "#fb7185", "#a78bfa", "#2dd4bf", "#fb923c",
        "#93c5fd", "#a3e635", "#f87171", "#c084fc",
      ],
    },
  };

  var THEME = THEMES.light;
  var PALETTE = THEME.palette;

  var WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  var state = { from: null, to: null, manager: "all", van: "all", shift: "all" };

  function baseLayout(extra) {
    extra = Object.assign({}, extra || {});
    ["xaxis", "yaxis", "xaxis2", "yaxis2"].forEach(function (axis) {
      if (extra[axis]) {
        extra[axis] = Object.assign({
          gridcolor: THEME.grid,
          zerolinecolor: THEME.grid,
          tickfont: { color: THEME.mutedFont },
          titlefont: { color: THEME.font },
        }, extra[axis]);
      }
    });
    var layout = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: '"Segoe UI", system-ui, sans-serif', size: 12, color: THEME.mutedFont },
      margin: { l: 55, r: 18, t: 12, b: 46 },
      hoverlabel: { bgcolor: THEME.hoverBg, bordercolor: THEME.hoverBg, font: { color: "#ffffff", size: 12 } },
      showlegend: true,
      legend: { orientation: "h", y: 1.15, x: 0, font: { size: 11, color: THEME.mutedFont }, bgcolor: THEME.legendBg, bordercolor: "transparent" },
      colorway: PALETTE,
    };
    return Object.assign(layout, extra);
  }

  /* ---------- helpers ---------- */

  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return "&ndash;";
    return Number(n).toLocaleString("en-GB", {
      minimumFractionDigits: d || 0,
      maximumFractionDigits: d === undefined ? 0 : d,
    });
  }

  function mean(arr) {
    var vals = arr.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function sum(arr) {
    return arr.reduce(function (a, b) { return a + (b || 0); }, 0);
  }

  function countIf(arr) {
    return arr.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); }).length;
  }

  function groupBy(arr, getKey) {
    var map = new Map();
    arr.forEach(function (item) {
      var k = getKey(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return map;
  }

  function toMinutes(timeStr) {
    if (!timeStr) return null;
    var parts = timeStr.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }

  function react(id, data, layout, height) {
    var el = document.getElementById(id);
    if (height) el.style.height = height + "px";
    Plotly.react(el, data, layout, { responsive: true, displayModeBar: false });
  }

  function emptyScatter() {
    return {
      x: [], y: [],
      mode: "markers", type: "scatter",
      marker: { size: 0, color: "rgba(0,0,0,0)" },
      name: "no data", hoverinfo: "skip",
    };
  }

  function monthSeries() {
    var groups = groupBy(filtered(), function (r) { return r.month; });
    var months = Array.from(groups.keys()).sort();
    return {
      labels: months,
      totals: months.map(function (m) { return sum(groups.get(m).map(function (r) { return r.drops; })); }),
      counts: months.map(function (m) { return groups.get(m).length; }),
      avgWeight: months.map(function (m) {
        return mean(groups.get(m).map(function (r) { return r.weight; }));
      }),
      avgEfficiency: months.map(function (m) {
        return mean(groups.get(m).map(function (r) { return r.dropsPerHour; }));
      }),
    };
  }

  function rollingMean(values, window) {
    var out = values.map(function () { return NaN; });
    var n = values.length;
    for (var i = 0; i < n; i++) {
      var start = Math.max(0, i - window + 1);
      var slice = values.slice(start, i + 1).filter(function (v) { return v !== null; });
      if (slice.length) out[i] = mean(slice);
    }
    return out;
  }

  function linearRegression(xs, ys) {
    var n = xs.length;
    if (n < 2) return null;
    var mx = mean(xs), my = mean(ys);
    var ssXX = 0, ssXY = 0;
    for (var i = 0; i < n; i++) {
      ssXX += (xs[i] - mx) * (xs[i] - mx);
      ssXY += (xs[i] - mx) * (ys[i] - my);
    }
    if (ssXX === 0) return null;
    var slope = ssXY / ssXX;
    return { slope: slope, intercept: my - slope * mx };
  }

  /* ---------- filtering ---------- */

  function filtered() {
    return RECORDS.filter(function (r) {
      if (state.from && r.date < state.from) return false;
      if (state.to && r.date > state.to) return false;
      if (state.manager !== "all" && r.managerList.indexOf(state.manager) === -1) return false;
      if (state.van !== "all" && r.van !== state.van) return false;
      if (state.shift === "short" && (r.shiftLength === null || r.shiftLength > 6)) return false;
      if (state.shift === "standard" && (r.shiftLength === null || r.shiftLength < 7 || r.shiftLength > 8)) return false;
      if (state.shift === "long" && (r.shiftLength === null || r.shiftLength < 9)) return false;
      return true;
    });
  }

  /* ---------- KPI cards ---------- */

  function renderKpis(rows) {
    var withDrops = rows.filter(function (r) { return r.drops !== null; });
    var withWait = rows.filter(function (r) { return r.waitTime !== null; });
    var withTotes = rows.filter(function (r) { return r.totes !== null; });
    var withWeight = rows.filter(function (r) { return r.weight !== null && r.weight > 0; });
    var dropCounts = withDrops.map(function (r) { return r.drops; });
    var waitValues = withWait.map(function (r) { return r.waitTime; });
    var totesSum = sum(withTotes.map(function (r) { return r.totes; }));

    var managerCounts = new Map();
    rows.forEach(function (r) {
      r.managerList.forEach(function (m) {
        managerCounts.set(m, (managerCounts.get(m) || 0) + 1);
      });
    });
    var topManager = null, topCount = 0;
    managerCounts.forEach(function (count, name) {
      if (count > topCount) { topCount = count; topManager = name; }
    });

    var cards = [
      { label: "Shifts", value: fmt(rows.length), sub: "in date range", color: "" },
      { label: "Deliveries", value: fmt(sum(dropCounts)), sub: fmt(withDrops.length) + " shifts with data", color: "sky" },
      { label: "Drops / shift", value: fmt(countIf(dropCounts) ? sum(dropCounts) / countIf(dropCounts) : null, 1), sub: "average per shift", color: "green" },
      { label: "Avg wait", value: fmt(waitValues.length ? mean(waitValues) : null, 1) + " min", sub: "before first drop", color: "amber" },
      { label: "Totes", value: fmt(totesSum), sub: fmt(withTotes.length) + " shifts with data", color: "rose" },
      { label: "Avg van weight", value: fmt(withWeight.length ? mean(withWeight.map(function (r) { return r.weight; })) : null) + " kg", sub: "loaded weight", color: "" },
      { label: "Avg shift length", value: fmt(mean(rows.filter(function (r) { return r.shiftLength !== null; }).map(function (r) { return r.shiftLength; })), 1) + " h", sub: "rostered", color: "sky" },
      { label: "Top manager", value: topManager || "&ndash;", sub: topManager ? fmt(topCount) + " shifts" : "", color: "green" },
    ];

    var grid = document.getElementById("kpi-grid");
    grid.innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + (c.color || "") + '">' +
        '<div class="kpi-label">' + c.label + '</div>' +
        '<div class="kpi-value">' + c.value + '</div>' +
        (c.sub ? '<div class="kpi-sub">' + c.sub + '</div>' : '') +
        '</div>';
    }).join("");
  }

  /* ---------- individual charts ---------- */

  function chartTrend(rows) {
    var pts = rows.filter(function (r) { return r.drops !== null; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var x = pts.map(function (r) { return r.date; });
    var y = pts.map(function (r) { return r.drops; });
    var hover = pts.map(function (r) {
      return (r.weekday || "") + " " + r.date +
        "<br>Drops: " + (r.drops === null ? "&ndash;" : r.drops) +
        "<br>Van: " + (r.van || "&ndash;") +
        "<br>Manager: " + (r.managerLabel || "&ndash;") +
        "<br>Weight: " + (r.weight === null ? "&ndash;" : r.weight + " kg");
    });
    react("chart-trend", [
      {
        x: x, y: y, mode: "markers", type: "scatter",
        name: "Drops", customdata: hover,
        text: hover, hovertemplate: "%{text}<extra></extra>",
        marker: { size: 7, color: PALETTE[0], opacity: 0.55, line: { color: "#fff", width: 0.5 } },
      },
      {
        x: x, y: rollingMean(y, 30), mode: "lines", type: "scatter", name: "30-shift average",
        line: { color: PALETTE[3], width: 2.5 }, hoverinfo: "skip",
      },
    ], baseLayout({
      xaxis: { tickangle: -35, title: { text: "Date", standoff: 8 } },
      yaxis: { title: { text: "Drops" } },
      hovermode: "closest",
    }));
  }

  function chartMonthly(rows) {
    var s = monthSeries();
    react("chart-monthly", [
      {
        x: s.labels, y: s.totals, type: "bar", name: "Total drops",
        marker: { color: PALETTE[0] }, hovertemplate: "%{y} drops<extra></extra>",
      },
      {
        x: s.labels, y: s.counts, type: "scatter", mode: "lines+markers",
        name: "Shifts", yaxis: "y2",
        line: { color: PALETTE[3], width: 2 }, marker: { size: 6 },
        hovertemplate: "%{y} shifts<extra></extra>",
      },
    ], baseLayout({
      xaxis: { tickangle: -35 },
      yaxis: { title: { text: "Drops" } },
      yaxis2: { overlaying: "y", side: "right", showgrid: false, title: { text: "Shifts" } },
      hovermode: "x unified",
    }));
  }

  function chartWeekday(rows) {
    var groups = groupBy(rows, function (r) { return r.weekdayNum; });
    var labels = WEEKDAYS;
    var counts = labels.map(function (_, i) { return (groups.get(i) || []).length; });
    react("chart-weekday", [
      {
        x: labels, y: counts, type: "bar", name: "Shifts",
        marker: { color: counts.map(function (_, i) { return PALETTE[i % PALETTE.length]; }) },
        hovertemplate: "%{y} shifts<extra></extra>",
      },
    ], baseLayout({
      xaxis: { title: { text: "Day of week", standoff: 8 } },
      yaxis: { title: { text: "Shifts" } },
    }));
  }

  function chartWait(rows) {
    var vals = rows.filter(function (r) { return r.waitTime !== null; }).map(function (r) { return r.waitTime; });
    react("chart-wait", [
      {
        x: vals, type: "histogram", name: "Wait time",
        nbinsx: Math.max(12, Math.min(24, Math.ceil(vals.length / 6))),
        marker: { color: PALETTE[1] },
        hovertemplate: "%{x} min: %{y} shifts<extra></extra>",
      },
    ], baseLayout({
      xaxis: { title: { text: "Minutes waited" } },
      yaxis: { title: { text: "Shifts" } },
      bargap: 0.05,
    }));
  }

  function chartDropsDist(rows) {
    var vals = rows.filter(function (r) { return r.drops !== null; }).map(function (r) { return r.drops; });
    react("chart-drops-dist", [
      {
        x: vals, type: "histogram", name: "Drops",
        nbinsx: Math.max(10, Math.min(30, Math.ceil(vals.length / 5))),
        marker: { color: PALETTE[2] },
        hovertemplate: "%{x} drops: %{y} shifts<extra></extra>",
      },
    ], baseLayout({
      xaxis: { title: { text: "Drops per shift" } },
      yaxis: { title: { text: "Shifts" } },
      bargap: 0.05,
    }));
  }

  function chartWeight(rows) {
    var s = monthSeries();
    react("chart-weight", [
      {
        x: s.labels, y: s.avgWeight, type: "scatter", mode: "lines+markers",
        name: "Avg weight (kg)",
        line: { color: PALETTE[5], width: 2.5 }, marker: { size: 7 },
        hovertemplate: "%{y:.0f} kg<extra></extra>",
      },
    ], baseLayout({
      xaxis: { tickangle: -35 },
      yaxis: { title: { text: "kg" } },
      hovermode: "x unified",
    }));
  }

  function chartTotesWeight(rows) {
    var pts = rows.filter(function (r) {
      return r.totes !== null && r.weight !== null && r.weight > 0 &&
        r.drops !== null && r.waitTime !== null;
    });
    var xs = pts.map(function (r) { return r.totes; });
    var ys = pts.map(function (r) { return r.weight; });
    var colors = pts.map(function (r) { return r.drops; });
    var reg = linearRegression(xs, ys);

    var traces = [
      {
        x: xs, y: ys, mode: "markers", type: "scatter",
        name: "Shifts",
        marker: {
          size: 11, color: colors, showscale: true,
          colorscale: THEME.colorscale, cmin: 0, cmax: Math.max.apply(null, colors),
          line: { color: THEME.colorbarOutline, width: 0.5 },
          colorbar: {
            len: 0.9,
            title: { text: "Drops", font: { color: THEME.font } },
            tickfont: { color: THEME.mutedFont },
            outlinecolor: THEME.colorbarOutline,
          },
        },
        hovertemplate: "Totes: %{x}<br>Weight: %{y} kg<extra></extra>",
      },
    ];
    if (reg) {
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      traces.push({
        x: [minX, maxX],
        y: [reg.slope * minX + reg.intercept, reg.slope * maxX + reg.intercept],
        mode: "lines", name: "Trend",
        line: { color: PALETTE[4], width: 2, dash: "dash" }, hoverinfo: "skip",
      });
    }
    react("chart-totes-weight", traces, baseLayout({
      xaxis: { title: { text: "Totes" } },
      yaxis: { title: { text: "Van weight (kg)" } },
      hovermode: "closest",
    }));
  }

  function chartManagers(rows) {
    var totals = new Map();
    var counts = new Map();
    rows.forEach(function (r) {
      r.managerList.forEach(function (m) {
        totals.set(m, (totals.get(m) || 0) + (r.drops || 0));
        counts.set(m, (counts.get(m) || 0) + 1);
      });
    });
    var items = Array.from(totals.keys()).map(function (m) {
      return { name: m, drops: totals.get(m), shifts: counts.get(m) };
    }).sort(function (a, b) { return b.drops - a.drops; });

    var names = items.map(function (i) { return i.name; });
    var dropValues = items.map(function (i) { return i.drops; });
    var shifts = items.map(function (i) { return i.shifts; });

    react("chart-managers", [
      {
        x: dropValues, y: names, type: "bar", name: "Drops", orientation: "h",
        customdata: shifts,
        marker: { color: PALETTE[3] },
        hovertemplate: "%{customdata} shifts<extra></extra>",
      },
    ], baseLayout({
      xaxis: { title: { text: "Total drops" } },
      yaxis: { automargin: true, title: { text: "" } },
      hovermode: "y unified",
    }));
  }

  function chartVans(rows) {
    var groups = groupBy(rows, function (r) { return r.van; });
    var items = Array.from(groups.keys()).map(function (v) {
      var shifts = groups.get(v);
      return {
        van: v, shifts: shifts.length,
        drops: sum(shifts.map(function (r) { return r.drops; })),
      };
    }).sort(function (a, b) { return b.shifts - a.shifts; }).slice(0, 12);

    react("chart-vans", [
      {
        x: items.map(function (i) { return i.shifts; }),
        y: items.map(function (i) { return i.van; }),
        type: "bar", orientation: "h", name: "Shifts",
        customdata: items.map(function (i) { return i.drops; }),
        marker: { color: PALETTE[3] },
        hovertemplate: "%{customdata} drops<extra></extra>",
      },
    ], baseLayout({
      xaxis: { title: { text: "Shifts" } },
      yaxis: { automargin: true, title: { text: "" } },
      hovermode: "y unified",
    }));
  }

  function chartShiftLength(rows) {
    var vals = rows.filter(function (r) { return r.shiftLength !== null; }).map(function (r) { return r.shiftLength; });
    var edges = [3, 4, 5, 6, 7, 8, 9, 10];
    var counts = edges.map(function () { return 0; });
    vals.forEach(function (v) {
      if (v <= 4) counts[0] += 1;
      else if (v <= 5) counts[1] += 1;
      else if (v <= 6) counts[2] += 1;
      else if (v <= 7) counts[3] += 1;
      else if (v <= 8) counts[4] += 1;
      else if (v <= 9) counts[5] += 1;
      else if (v <= 10) counts[6] += 1;
      else counts[7] += 1;
    });
    var labels = ["\u2264 4 h", "5 h", "6 h", "7 h", "8 h", "9 h", "10 h", "> 10 h"];
    react("chart-shift-length", [
      {
        x: labels, y: counts, type: "bar", name: "Shifts",
        marker: { color: PALETTE[6] },
        hovertemplate: "%{y} shifts<extra></extra>",
      },
    ], baseLayout({
      xaxis: { title: { text: "Shift length" } },
      yaxis: { title: { text: "Shifts" } },
    }));
  }

  function chartEfficiency(rows) {
    var s = monthSeries();
    react("chart-efficiency", [
      {
        x: s.labels, y: s.avgEfficiency, type: "scatter", mode: "lines+markers",
        name: "Drops / hour",
        line: { color: PALETTE[4], width: 2.5 }, marker: { size: 7 },
        hovertemplate: "%{y:.2f} drops per hour<extra></extra>",
      },
    ], baseLayout({
      xaxis: { tickangle: -35 },
      yaxis: { title: { text: "Drops per hour" } },
      hovermode: "x unified",
    }));
  }

  function chartReturn(rows) {
    var pts = rows.filter(function (r) {
      var end = toMinutes(r.shiftEnd);
      var back = toMinutes(r.backAtStore);
      return end !== null && back !== null && end > 0;
    }).map(function (r) {
      return {
        end: toMinutes(r.shiftEnd) / 60,
        back: toMinutes(r.backAtStore) / 60,
        wait: r.waitTime,
      };
    }).filter(function (p) { return p.end >= 6 && p.back >= 0 && p.back <= 26; });

    var colors = pts.map(function (p) {
      return p.back <= p.end ? "rgb(16,185,129)" : "rgb(244,63,94)";
    });
    var sizes = pts.map(function (p) {
      return 6 + Math.min(12, (p.wait === null ? 0 : p.wait) / 10);
    });
    function clock(h) {
      var hh = Math.floor(h);
      var mm = Math.round((h - hh) * 60);
      if (mm === 60) { hh += 1; mm = 0; }
      hh = hh % 24;
      return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
    }

    var traces = [
      {
        x: pts.map(function (p) { return p.end; }),
        y: pts.map(function (p) { return p.back; }),
        mode: "markers", type: "scatter", name: "Shifts",
        customdata: pts.map(function (p) {
          return [clock(p.end), clock(p.back), p.back <= p.end ? "On time" : "Late"];
        }),
        marker: { size: sizes, color: colors, opacity: 0.65, line: { color: "#fff", width: 0.5 } },
        hovertemplate: "Finish: %{customdata[0]}" +
          "<br>Back: %{customdata[1]}" +
          "<br>%{customdata[2]}<extra></extra>",
      },
      {
        x: [6, 24], y: [6, 24], mode: "lines", name: "On time",
        line: { color: "#94a3b8", width: 1.5, dash: "dot" }, hoverinfo: "skip",
      },
    ];

    var ticks = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24].map(function (h) {
      return { v: h, l: (h >= 24 ? (h - 24) : h) + ":00" };
    });

    react("chart-return", traces, baseLayout({
      xaxis: {
        title: { text: "Rostered shift end" }, showgrid: true,
        tickvals: ticks.map(function (t) { return t.v; }),
        ticktext: ticks.map(function (t) { return t.l; }),
      },
      yaxis: {
        title: { text: "Back at store" },
        tickvals: ticks.map(function (t) { return t.v; }),
        ticktext: ticks.map(function (t) { return t.l; }),
      },
      hovermode: "closest",
    }));
  }

  /* ---------- render loop ---------- */

  function render() {
    var rows = filtered();

    document.getElementById("visible-count").textContent = rows.length;
    document.getElementById("total-count").textContent = RECORDS.length;

    renderKpis(rows);

    chartTrend(rows);
    chartMonthly(rows);
    chartWeekday(rows);
    chartWait(rows);
    chartDropsDist(rows);
    chartWeight(rows);
    chartTotesWeight(rows);
    chartManagers(rows);
    chartVans(rows);
    chartShiftLength(rows);
    chartEfficiency(rows);
    chartReturn(rows);
  }

  /* ---------- payload refresh ---------- */

  function populateFilters() {
    var man = document.getElementById("filter-manager");
    var prevMan = state.manager;
    man.innerHTML = '<option value="all">All managers</option>' +
      FILTERS.managers.map(function (m) { return '<option value="' + m + '">' + m + "</option>"; }).join("");
    state.manager = FILTERS.managers.indexOf(prevMan) !== -1 ? prevMan : "all";
    man.value = state.manager;

    var van = document.getElementById("filter-van");
    var prevVan = state.van;
    van.innerHTML = '<option value="all">All vans</option>' +
      FILTERS.vans.map(function (v) { return '<option value="' + v + '">' + v + "</option>"; }).join("");
    state.van = FILTERS.vans.indexOf(prevVan) !== -1 ? prevVan : "all";
    van.value = state.van;

    var from = document.getElementById("filter-from");
    from.min = META.minDate;
    from.max = META.maxDate;
    var to = document.getElementById("filter-to");
    to.min = META.minDate;
    to.max = META.maxDate;
  }

  function updateMetaText() {
    var rangeEl = document.getElementById("meta-range");
    rangeEl.textContent = META.minDate + " to " + META.maxDate;
    document.getElementById("meta-rows").textContent = META.totalRows;
    document.getElementById("meta-generated").textContent = "Dashboard generated " + META.generated +
      " · Source: SQLite database (data/shift_details.db)";
  }

  function applyPayload(payload) {
    RECORDS = payload.records;
    FILTERS = payload.filters;
    META = payload.meta;
    populateFilters();
    updateMetaText();
    render();
  }

  window.refreshDashboard = function () {
    return fetch("/api/data")
      .then(function (response) { return response.json(); })
      .then(function (payload) { applyPayload(payload); });
  };

  /* ---------- filter wiring ---------- */

  var el;

  el = document.getElementById("filter-from");
  el.addEventListener("change", function () { state.from = el.value || null; render(); });

  el = document.getElementById("filter-to");
  el.addEventListener("change", function () { state.to = el.value || null; render(); });

  el = document.getElementById("filter-manager");
  el.addEventListener("change", function () { state.manager = el.value; render(); });

  el = document.getElementById("filter-van");
  el.addEventListener("change", function () { state.van = el.value; render(); });

  el = document.getElementById("filter-shift");
  el.addEventListener("change", function () { state.shift = el.value; render(); });

  document.getElementById("filter-reset").addEventListener("click", function () {
    document.getElementById("filter-from").value = "";
    document.getElementById("filter-to").value = "";
    document.getElementById("filter-manager").value = "all";
    document.getElementById("filter-van").value = "all";
    document.getElementById("filter-shift").value = "all";
    state = { from: null, to: null, manager: "all", van: "all", shift: "all" };
    render();
  });

  /* ---------- add-shift form ---------- */

  var addForm = document.getElementById("add-shift-form");
  var addBody = document.getElementById("add-shift-body");
  var addToggle = document.getElementById("add-shift-toggle");
  var addCancel = document.getElementById("add-shift-cancel");
  var addResult = document.getElementById("add-shift-result");
  var addSubmit = document.getElementById("add-shift-submit");

  function showAddResult(message, ok) {
    addResult.innerHTML = message;
    addResult.className = "form-result " + (ok ? "form-result-ok" : "form-result-error");
  }

  addToggle.addEventListener("click", function () {
    var open = addBody.classList.toggle("hidden");
    addToggle.textContent = open ? "Open form" : "Close form";
    addToggle.setAttribute("aria-expanded", open ? "false" : "true");
  });

  if (window.location.hash === "#add-shift" && addBody.classList.contains("hidden")) {
    addBody.classList.remove("hidden");
    addToggle.textContent = "Close form";
    addToggle.setAttribute("aria-expanded", "true");
  }

  addCancel.addEventListener("click", function () {
    addBody.classList.add("hidden");
    addToggle.textContent = "Open form";
    addToggle.setAttribute("aria-expanded", "false");
    showAddResult("", true);
  });

  addForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var payload = {};
    addForm.querySelectorAll("[data-field]").forEach(function (input) {
      payload[input.dataset.field] = input.value;
    });

    addSubmit.disabled = true;
    showAddResult("Saving&hellip;", true);
    fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, body: body }; });
      })
      .then(function (result) {
        if (result.ok) {
          showAddResult("Shift saved (row #" + result.body.id + "). Charts updated.", true);
          addForm.reset();
          addForm.querySelector('[data-field="date"]').value = new Date().toISOString().slice(0, 10);
          window.refreshDashboard();
        } else {
          var message = (result.body.errors || ["Something went wrong."]).join("<br>");
          showAddResult(message, false);
        }
      })
      .catch(function (error) {
        showAddResult(String(error), false);
      })
      .finally(function () {
        addSubmit.disabled = false;
      });
  });

  /* ---------- theme handling ---------- */

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }

  function preferredTheme() {
    var saved = localStorage.getItem("shift-dash-theme");
    return saved === "dark" || saved === "light" ? saved : systemTheme();
  }

  function applyTheme(theme) {
    THEME = THEMES[theme];
    PALETTE = THEME.palette;
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("theme-toggle").setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
    render();
  }

  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = THEME === THEMES.dark ? "light" : "dark";
    localStorage.setItem("shift-dash-theme", next);
    applyTheme(next);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
    if (!localStorage.getItem("shift-dash-theme")) applyTheme(e.matches ? "dark" : "light");
  });

  /* ---------- kick off ---------- */
  addForm.querySelector('[data-field="date"]').value = new Date().toISOString().slice(0, 10);
  applyPayload(JSON.parse(document.getElementById("shift-data").textContent));
  applyTheme(preferredTheme());
})();