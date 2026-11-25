// Token Launch Radar — renders window.TOKEN_RADAR_DATA into the board,
// the per-protocol detail view, the model card and the trading table.
// No network: all data comes from data.js written beside this page.
(function () {
  var D = window.TOKEN_RADAR_DATA;
  if (!D) { document.getElementById("rows").innerHTML = "<tr><td colspan=9>No data loaded.</td></tr>"; return; }
  var rows = D.rows, meta = D.meta, model = D.model;

  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function pct(x) {
    if (x === null || x === undefined) return "n/a";
    return (x > 0 ? "+" : "") + x.toFixed(2) + "%";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Integrity strip, from the runtime checks in meta.
  document.getElementById("asOf").textContent = meta.as_of;
  document.getElementById("stWatch").textContent = meta.watchlist_covered + "/" + meta.watchlist_total;
  document.getElementById("stRows").textContent = meta.board_rows;
  document.getElementById("stMono").textContent = meta.monotonic ? "yes" : "NO";
  document.getElementById("stFarm").textContent = meta.farm_steps_ok ? "yes" : "NO";
  document.getElementById("stPre").textContent = meta.pre_token_total;
  document.getElementById("formula").textContent = model.formula;
  document.getElementById("terms").innerHTML = model.terms.map(function (t) {
    return '<div class="term"><b>' + esc(t.name) + '</b><code>' + esc(t.weight) + '</code><p>' + esc(t.derivation) + '</p></div>';
  }).join("");

  // Category filter options, from the board itself.
  var cats = {};
  rows.forEach(function (r) { if (r.category) cats[r.category] = 1; });
  var catSel = document.getElementById("cat");
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement("option"); o.value = c; o.textContent = c; catSel.appendChild(o);
  });

  var state = { q: "", cat: "", sort: "implied", onlyWatch: false, sel: null };

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.onlyWatch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if ((r.name + " " + r.slug).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === "tvl") return b.tvl_usd - a.tvl_usd;
      if (key === "growth") return (b.change_7d || -1e9) - (a.change_7d || -1e9);
      if (key === "age") return (b.age_days || 0) - (a.age_days || 0);
      return a.rank - b.rank;
    });
    return list;
  }

  function render() {
    var list = filtered();
    var tb = document.getElementById("rows");
    tb.innerHTML = list.map(function (r) {
      var g = r.change_7d === null ? "n/a" : pct(r.change_7d);
      var gc = r.change_7d === null ? "" : (r.change_7d >= 0 ? "pos" : "neg");
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : "") + ">" +
        '<td class="rank">' + r.rank + "</td>" +
        "<td><b>" + esc(r.name) + "</b>" + (r.on_watchlist ? ' <span class="badge wl">WATCHLIST</span>' : "") +
        '<span class="sub">' + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc((r.chains || []).slice(0, 2).join(", ")) + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num ' + gc + '">' + g + "</td>" +
        '<td class="num">' + (r.age_days === null ? "n/a" : r.age_days + "d") + "</td>" +
        '<td class="num val">' + money(r.implied_value_usd) + "</td>" +
        '<td><span class="badge">NO TOKEN RECORDED</span></td></tr>';
    }).join("");
    document.getElementById("rowCount").textContent = "(" + list.length + " of " + rows.length + " shown)";
    document.getElementById("boardNote").textContent =
      "Board: " + rows.length + " rows — all " + meta.watchlist_total + " watchlist protocols, " +
      meta.above_floor_added + " more pre-token protocols at or above the $" +
      (meta.floor_usd / 1e6) + "M floor that pass the watchlist rule on the snapshot's own fields, and the " +
      (rows.length - meta.watchlist_total - meta.above_floor_added) + " largest pre-token protocols below the floor. " +
      "Values fall as rank rises; every row carries a 6-step farm plan.";
    tb.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function () { showDetail(tr.getAttribute("data-slug")); });
    });
  }

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    state.sel = slug;
    var d = document.getElementById("detail");
    d.hidden = false;
    document.getElementById("dName").textContent = "#" + r.rank + " — " + r.name;
    document.getElementById("dMeta").textContent =
      (r.category || "Uncategorised") + " · " + (r.chains || []).join(", ") + " · TVL " + money(r.tvl_usd) +
      " · 7d " + pct(r.change_7d) + " · tracked " + (r.age_days === null ? "date not reported" : r.age_days + " days") +
      (r.on_watchlist ? " · on the watchlist" :
        r.above_floor ? " · above the watchlist floor, passes the watchlist rule" : " · below the watchlist floor");
    document.getElementById("dEq").textContent =
      "implied = " + money(r.size_base_usd) + " × " + r.growth_term.toFixed(3) +
      " × " + r.age_term.toFixed(3) + " × " + r.odds_term.toFixed(2) + " = " + money(r.implied_value_usd);
    document.getElementById("dTerms").innerHTML =
      "<div><b>Size base</b><span>" + money(r.size_base_usd) + "</span></div>" +
      "<div><b>Growth term</b><span>" + r.growth_term.toFixed(3) + "</span></div>" +
      "<div><b>Age term</b><span>" + r.age_term.toFixed(3) + "</span></div>" +
      "<div><b>Token-odds term</b><span>" + r.odds_term.toFixed(2) + " (" + r.cohort_tok + "/" + r.cohort_n + " peers)</span></div>" +
      "<div><b>Implied value</b><span>" + money(r.implied_value_usd) + "</span></div>";
    document.getElementById("dNarrative").textContent = r.narrative;
    document.getElementById("dFarm").innerHTML = r.farm_steps.map(function (s) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    render();
    d.scrollIntoView();
    if (location.hash !== "#detail=" + slug) history.replaceState(null, "", "#detail=" + slug);
  }

  // Trading table: protocols whose token already trades, kept off the board.
  document.getElementById("trading").innerHTML = D.trading.map(function (t) {
    return "<tr><td><b>" + esc(t.name) + "</b>" + '<span class="sub">' + esc(t.symbol || "") + "</span></td>" +
      "<td>" + esc(t.category || "—") + "</td>" +
      '<td class="num">' + money(t.tvl_usd) + "</td>" +
      '<td class="num">' + money(t.mcap_usd) + "</td>" +
      '<td class="num">' + t.mcap_per_tvl.toFixed(3) + "</td></tr>";
  }).join("");

  // Controls.
  document.getElementById("q").addEventListener("input", function (e) { state.q = e.target.value; render(); });
  catSel.addEventListener("change", function (e) { state.cat = e.target.value; render(); });
  document.getElementById("sort").addEventListener("change", function (e) { state.sort = e.target.value; render(); });
  document.getElementById("onlyWatch").addEventListener("change", function (e) { state.onlyWatch = e.target.checked; render(); });
  document.querySelectorAll("th[data-k]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-k");
      state.sort = k === "rank" || k === "implied" ? "implied" : k === "name" || k === "category" ? "implied" : k;
      document.getElementById("sort").value = state.sort;
      render();
    });
  });

  // Hash routing, so each view has a stable address:
  // #detail=<slug> opens a protocol, #category=<name> filters the board.
  function applyHash() {
    var h = location.hash || "";
    var m = h.match(/#detail=([^&]+)/);
    if (m) { showDetail(decodeURIComponent(m[1])); return; }
    var c = h.match(/#category=([^&]+)/);
    if (c) {
      state.cat = decodeURIComponent(c[1]);
      catSel.value = state.cat;
      document.getElementById("q").value = "";
      state.q = "";
    }
  }
  window.addEventListener("hashchange", applyHash);
  render();
  applyHash();
})();
