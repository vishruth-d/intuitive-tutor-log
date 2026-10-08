// Invoice request builders ported from multitutor/Code.gs. No network or credentials.
var TEAL = '#002B38', MINT = '#99DBCF', WHITE = '#ffffff', FONT = 'Barlow';
var MONTH_FMT = 'mmm"\'"yy';                  // -> Sep'26
var GBP = '[$\u00a3-809]#,##0';              // -> \u00a3250
var HRS = '0.##';                            // whole when integer (3), decimal only when needed (1.5)
var LOGO_URL = 'https://raw.githubusercontent.com/vishruth-d/tutor-log-assets/main/logo.jpg';   // GitHub raw = cacheable image/jpeg (Sheets =IMAGE-friendly, unlike the no-cache Pages copy). Wrapped in IFERROR so it never shows #REF!.

var COLOURS = [
  '#c9e7ff', '#ffd9d6', '#c9efd4', '#ffe9b0', '#e6d4fb',
  '#bdf0ea', '#ffd6ec', '#dcedc1', '#ffcfb0', '#cfe0ff'
];
// Distinct sheet-tab colours, indexed by calendar month (Jan..Dec).
var TAB_PAL = [
  '#4285F4', '#34A853', '#A142F4', '#F4B400', '#00ACC1', '#EA4335',
  '#FF7043', '#9E9D24', '#26A69A', '#7E57C2', '#EC407A', '#5C6BC0'
];

function _tabColour(d) {
  var m = (d && typeof d.getMonth === 'function') ? d.getMonth() : new Date().getMonth();
  return TAB_PAL[m % TAB_PAL.length];
}

var HEADER_ROW = 5;          // 1-based sheet row of the column headers
var FIRST_DATA_ROW = 6;
var TZ = 'Europe/London';
var SUMMARY = 'Summary Statement';


// ---------- format helpers ----------
function _rgb(hex) {
  hex = String(hex).replace('#', '');
  return { red: parseInt(hex.substr(0, 2), 16) / 255, green: parseInt(hex.substr(2, 2), 16) / 255, blue: parseInt(hex.substr(4, 2), 16) / 255 };
}
function _fmt(o) {
  o = o || {};
  var t = { fontFamily: FONT, bold: o.bold !== false };
  if (o.fg) t.foregroundColor = _rgb(o.fg);
  if (o.size) t.fontSize = o.size;
  var f = { textFormat: t, verticalAlignment: 'MIDDLE' };
  if (o.bg) f.backgroundColor = _rgb(o.bg);
  if (o.align) f.horizontalAlignment = o.align;
  if (o.numFmt) f.numberFormat = { type: o.numType || 'NUMBER', pattern: o.numFmt };
  return f;
}
function _cell(value, fmt) {
  var c = {};
  if (value !== null && value !== undefined && value !== '') {
    if (typeof value === 'number') c.userEnteredValue = { numberValue: value };
    else if (typeof value === 'string' && value.charAt(0) === '=') c.userEnteredValue = { formulaValue: value };
    else c.userEnteredValue = { stringValue: String(value) };
  }
  if (fmt) c.userEnteredFormat = fmt;
  return c;
}
function _setCells(sid, row0, col0, grid) {
  return { updateCells: { start: { sheetId: sid, rowIndex: row0, columnIndex: col0 },
    rows: grid.map(function (r) { return { values: r }; }), fields: 'userEnteredValue,userEnteredFormat' } };
}
function _colW(sid, col0, px) { return { updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: col0, endIndex: col0 + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }; }
function _rowH(sid, r0, r1, px) { return { updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: r0, endIndex: r1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }; }
function _merge(sid, r0, r1, c0, c1) { return { mergeCells: { range: { sheetId: sid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, mergeType: 'MERGE_ALL' } }; }
function _baseFont(sid, rows, cols) {
  return { repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: cols },
    cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, bold: true } } },
    fields: 'userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.bold' } };
}
function _validation(sid, row0, col0, opts) {
  return { setDataValidation: { range: { sheetId: sid, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
    rule: { condition: { type: 'ONE_OF_LIST', values: opts.map(function (o) { return { userEnteredValue: o }; }) }, strict: false, showCustomUi: true } } };
}

// ---------- logo / banner ----------
function _logoReqs(sid) {
  var reqs = [_merge(sid, 0, 4, 1, 5), _rowH(sid, 0, 4, 20)];   // merge B1:E4, 4 rows @ 20px
  var val, fmt;
  if (LOGO_URL) { val = '=IFERROR(IMAGE("' + LOGO_URL + '",1),"INTUITIVE ACADEMY")'; fmt = _fmt({ align: 'LEFT', fg: TEAL, bold: true, size: 16 }); }
  else { val = 'INTUITIVE ACADEMY'; fmt = _fmt({ align: 'LEFT', fg: TEAL, size: 18 }); }
  reqs.push(_setCells(sid, 0, 1, [[_cell(val, fmt)]]));
  return reqs;
}

// ---------- sheet content builders (return arrays of batchUpdate requests) ----------
function _sheetSpec(title, tabHex, frozen) {
  return { properties: { title: title, tabColor: _rgb(tabHex), gridProperties: { hideGridlines: true, frozenRowCount: frozen } } };
}
function _summaryContent(sid) {
  var reqs = [_baseFont(sid, 50, 8)];
  reqs = reqs.concat(_logoReqs(sid));
  reqs.push(_setCells(sid, 5, 1, [[
    _cell('Year', _fmt({ bg: TEAL, fg: WHITE, align: 'CENTER' })),
    _cell('Total Earnings', _fmt({ bg: TEAL, fg: WHITE, align: 'CENTER' })),
    _cell('Cumulative', _fmt({ bg: TEAL, fg: WHITE, align: 'CENTER' }))
  ]]));
  reqs.push(_colW(sid, 1, 110), _colW(sid, 2, 150), _colW(sid, 3, 150));
  return reqs;
}
function _monthContent(sid, name, rate, dateObj) {
  var reqs = [_baseFont(sid, 60, 12)];
  reqs = reqs.concat(_logoReqs(sid));
  // Name / Month box F2:G3
  var monthVal = dateObj ? ('=DATE(' + dateObj.getFullYear() + ',' + (dateObj.getMonth() + 1) + ',1)') : '';
  reqs.push(_setCells(sid, 1, 5, [
    [_cell('Name', _fmt({ bg: TEAL, fg: WHITE, align: 'LEFT' })), _cell(name, _fmt({ bg: TEAL, fg: MINT, align: 'CENTER' }))],
    [_cell('Month', _fmt({ bg: TEAL, fg: WHITE, align: 'LEFT' })), _cell(monthVal, _fmt({ bg: TEAL, fg: MINT, align: 'CENTER', numFmt: MONTH_FMT, numType: 'DATE' }))]
  ]));
  // Header row 5 (B..G)
  var hdr = ['Date', 'Students', 'Year Group', 'Start Time', 'End Time', 'Total Hours'];
  reqs.push(_setCells(sid, HEADER_ROW - 1, 1, [hdr.map(function (h) { return _cell(h, _fmt({ bg: TEAL, fg: WHITE, align: 'CENTER' })); })]));
  // Totals: Total hours row highlighted, Total payment row plain (OG style)
  reqs.push(_setCells(sid, 4, 8, [[_cell('Total hours', _fmt({ bg: TEAL, fg: MINT, align: 'LEFT' })), _cell('=MAX(G5:G)', _fmt({ bg: TEAL, fg: MINT, align: 'CENTER' }))]]));  // whole-column MAX: immune to row-insert reference drift (G6:G anchor shifted past the data -> 0). Hours: Automatic format (clean whole/decimal).
  reqs.push(_setCells(sid, 5, 8, [[_cell('Total payment', _fmt({ fg: TEAL, align: 'LEFT' })), _cell('=' + rate + '*J5', _fmt({ fg: TEAL, align: 'CENTER', numFmt: GBP }))]]));
  reqs.push(_colW(sid, 1, 92), _colW(sid, 2, 210), _colW(sid, 3, 95), _colW(sid, 4, 85), _colW(sid, 5, 85), _colW(sid, 6, 95), _colW(sid, 8, 100), _colW(sid, 9, 100));
  return reqs;
}


function _mkGroups(list) {
  return (list || []).map(function (g, i) {
    return {
      id: g.id || ('g' + i),
      label: String(g.label || '').trim() || ('Group ' + (i + 1)),
      year: String(g.year || '').trim(),
      start: String(g.start || '').trim(),
      end: String(g.end || '').trim(),
      students: (g.students || []).map(function (s) { return String(s).trim(); }).filter(function (s) { return s; }),
      colour: g.colour || COLOURS[i % COLOURS.length]
    };
  });
}

function _rowReqs(sid, rowNum, s, ifs, adhoc) {
  var row0 = rowNum - 1, R = String(rowNum), d = s.date;
  var cB = _cell('=DATE(' + d.getFullYear() + ',' + (d.getMonth() + 1) + ',' + d.getDate() + ')', _fmt({ align: 'CENTER', numFmt: 'dd/mm/yyyy', numType: 'DATE' }));
  var cC = _cell(s.students, _fmt({ align: 'CENTER', bg: s.colour }));
  var yearV, startV, endV;
  if (adhoc) { yearV = adhoc.year; startV = adhoc.start; endV = adhoc.end; }
  else {
    yearV = ifs.year ? ifs.year.replace(/\{R\}/g, R) : '';
    startV = ifs.start ? ifs.start.replace(/\{R\}/g, R) : '';
    endV = ifs.end ? ifs.end.replace(/\{R\}/g, R) : '';
  }
  var cD = _cell(yearV, _fmt({ align: 'CENTER' }));
  var cE = _cell(startV, _fmt({ align: 'CENTER' }));
  var cF = _cell(endV, _fmt({ align: 'CENTER' }));
  var gF = (rowNum === FIRST_DATA_ROW)
    ? '=ROUND((TIMEVALUE(F' + R + ')-TIMEVALUE(E' + R + '))*24,2)'
    : '=ROUND(G' + (rowNum - 1) + '+(TIMEVALUE(F' + R + ')-TIMEVALUE(E' + R + '))*24,2)';
  var cG = _cell(gF, _fmt({ align: 'CENTER' }));   // Automatic format: 1 -> "1", 1.5 -> "1.5", no trailing dot
  var reqs = [_setCells(sid, row0, 1, [[cB, cC, cD, cE, cF, cG]])];
  var opts = _uniq(s.options || []);
  if (opts.length) reqs.push(_validation(sid, row0, 2, opts));
  return reqs;
}


// ---------- IFS builders (roster -> live formulae) ----------
function _q(s) { return String(s).replace(/[\\.^$|?*+()\[\]{}]/g, '\\$&').replace(/"/g, '""'); }  // regex pattern
function _qstr(s) { return String(s).replace(/"/g, '""'); }   // formula string-literal (quote-only, NOT regex)
function _buildIfs(cfg) {
  var yr = [], st = [], en = [];
  cfg.groups.forEach(function (g) {
    g.students.forEach(function (s) {
      var n = '\\b' + _q(s) + '\\b';   // word-boundary so "Sam" != "Samuel"
      yr.push('REGEXMATCH(C{R},"' + n + '"), "' + _qstr(g.year) + '"');   // year value is literal, e.g. "11+"
      st.push('REGEXMATCH(C{R},"' + n + '"), "' + _qstr(g.start) + '"');
      en.push('REGEXMATCH(C{R},"' + n + '"), "' + _qstr(g.end) + '"');
    });
  });
  return {
    year: yr.length ? '=IFS(' + yr.join(', ') + ')' : '',
    start: st.length ? '=IFS(' + st.join(', ') + ')' : '',
    end: en.length ? '=IFS(' + en.join(', ') + ')' : ''
  };
}

// ---------- misc helpers ----------
function _uniq(arr) {
  var seen = {}, out = [];
  (arr || []).forEach(function (v) { v = String(v || '').trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
  return out;
}
var _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _isMonthTab(nm) { return /^[A-Z][a-z]{2}\d{2}$/.test(nm); }
function _monthTabName(dateObj) { return _MONTHS[dateObj.getMonth()] + String(dateObj.getFullYear()).slice(-2); }
function _firstOfMonth(ym) {
  var y, m;
  if (ym && /^\d{4}-\d{2}$/.test(ym)) { y = Number(ym.slice(0, 4)); m = Number(ym.slice(5, 7)) - 1; }
  else { var now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
  return new Date(y, m, 1);
}
function _toDate(ds) {
  if (ds instanceof Date) return ds;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds || ''));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date();
}

export { TEAL, MINT, GBP, HRS, SUMMARY, HEADER_ROW, FIRST_DATA_ROW, _tabColour, _sheetSpec, _summaryContent, _monthContent, _mkGroups, _rowReqs, _buildIfs, _monthTabName, _firstOfMonth, _toDate, _isMonthTab, _setCells, _cell, _fmt, _MONTHS };
