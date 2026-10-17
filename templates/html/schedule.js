// Renders one schedule image from window.__VIEW__ (prepared by scripts/render.mjs).
// View shape:
// { title, updated, corner, tableClass, rows: [{ head, sub, hours: { "1": "yes", ... "24": "no" } }],
//   message, legend: [{ state, label }], credit }
(function () {
  'use strict';
  var view = window.__VIEW__;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ICON = {
    no: '<svg class="ico off" aria-hidden="true"><use href="#i-off"/></svg>',
    first: '<svg class="ico half" aria-hidden="true"><use href="#i-half"/></svg>',
    second: '<svg class="ico half" aria-hidden="true"><use href="#i-half"/></svg>',
    yes: ''
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function state(v) { return ICON.hasOwnProperty(v) ? v : 'yes'; }

  function render() {
    if (!view) throw new Error('window.__VIEW__ is missing');
    document.getElementById('title').textContent = view.title;
    document.getElementById('updated').textContent = view.updated || '';

    var table = document.getElementById('grid');
    if (view.tableClass) table.className = view.tableClass;

    var cols = '<colgroup><col class="c-head">';
    for (var c = 0; c < 24; c++) cols += '<col class="c-hour">';
    cols += '</colgroup>';
    table.insertAdjacentHTML('afterbegin', cols);

    var hr = '<tr><th class="corner" scope="col">' + esc(view.corner) + '</th>';
    for (var h = 0; h < 24; h++) hr += '<th class="hourh" scope="col"><span>' + pad(h) + '-' + pad(h + 1) + '</span></th>';
    hr += '</tr>';
    document.getElementById('thead').innerHTML = hr;

    var body = '';
    if (view.message) {
      body = '<tr><th class="message" colspan="25">' + esc(view.message) + '</th></tr>';
    } else {
      view.rows.forEach(function (row) {
        body += '<tr><th class="rowhead" scope="row">' + esc(row.head) +
          (row.sub ? '<span class="sub">' + esc(row.sub) + '</span>' : '') + '</th>';
        for (var i = 1; i <= 24; i++) {
          var s = state(row.hours && row.hours[String(i)]);
          body += '<td class="cell s-' + s + '">' + ICON[s] + '</td>';
        }
        body += '</tr>';
      });
    }
    document.getElementById('tbody').innerHTML = body;

    var legend = document.getElementById('legend');
    if (view.message || !view.legend) {
      legend.hidden = true;
    } else {
      legend.innerHTML = view.legend.map(function (it) {
        var s = state(it.state);
        return '<div class="item"><span class="swatch s-' + s + '">' + ICON[s] + '</span><span class="lbl">' + esc(it.label) + '</span></div>';
      }).join('');
    }

    var credit = document.getElementById('credit');
    if (view.credit) credit.textContent = view.credit; else credit.hidden = true;
  }

  render();
  var done = function () { document.body.setAttribute('data-ready', '1'); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(done, done); else done();
})();
