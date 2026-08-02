/**
 * Aquascape Log — Apps Script backend
 *
 * Setup:
 *   1. Open the "Aquascape Log" sheet → Extensions → Apps Script
 *   2. Paste this file over Code.gs
 *   3. Project Settings → Script Properties → add TOKEN (once, ever)
 *   4. Deploy → New deployment → Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   5. Copy the /exec URL into the frontend as SHEET_URL
 *
 * Redeploy (not just save) after any edit, or the URL keeps serving old code.
 */

/**
 * The token lives in Script Properties, not in this file, so pasting a new
 * version of this code can never clobber it.
 *
 * Set it once: Project Settings (gear, left sidebar) -> Script Properties ->
 * Add script property -> name TOKEN, value whatever you like. That same value
 * goes in Vercel as SHEET_TOKEN.
 */
function token_() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN') || '';
}

var TAB = 'Events';
// Entry ID is last so existing sheets gain a column instead of shifting one.
var HEADERS = ['Timestamp', 'Tank', 'Event Type', 'Metric', 'Value', 'Unit', 'Note', 'Entry ID'];

var MAX_ROWS_PER_WRITE = 40;
var TYPES = ['water_change', 'dose', 'test', 'checker', 'observation',
             'maintenance', 'livestock', 'plant', 'setting', 'note'];

var BACKUP_FOLDER = 'Aquascape Log backups';
var BACKUPS_TO_KEEP = 10;

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB) || ss.getSheets()[0];
  if (sh.getName() !== TAB) sh.setName(TAB);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  sh.setFrozenRows(1);

  // Timestamp, Metric, Value, Unit and Note are all plain text. Without this
  // Sheets reads "3/4" as a date and "07:30" as a time, and hands the app back
  // a Date object where it wrote a string.
  sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@');

  // Backfill the header if this sheet predates the Entry ID column.
  var head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (String(head[7]) !== 'Entry ID') {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sh;
}

/** Anything Sheets turned into a Date on the way in comes back out as text. */
function asText_(v) {
  if (v instanceof Date) {
    var mins = v.getHours() * 60 + v.getMinutes();
    // A bare time lands on Sheets' 1899-12-30 epoch date.
    if (v.getFullYear() === 1899) {
      return ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2);
    }
    return mins ? v.toISOString() : Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : String(v);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Reject anything that isn't a row this app would have written. Not because
 * someone is trying — because a bug in the frontend appending garbage is the
 * likelier way this sheet gets ruined, and a bad row is silent forever.
 */
function validate_(rows) {
  if (!Array.isArray(rows) || !rows.length) return 'no rows';
  if (rows.length > MAX_ROWS_PER_WRITE) return 'too many rows in one write';

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], at = ' (row ' + (i + 1) + ')';
    if (!r || typeof r !== 'object') return 'not an object' + at;

    if (!r.ts || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(r.ts))) {
      return 'timestamp must be ISO' + at;
    }
    var when = new Date(r.ts);
    if (isNaN(when.getTime())) return 'unparseable timestamp' + at;
    if (when.getTime() > Date.now() + 86400000) return 'timestamp is in the future' + at;
    if (when.getFullYear() < 2020) return 'timestamp is implausibly old' + at;

    if (!/^t[a-z0-9]{1,10}$/i.test(String(r.tank))) return 'bad tank id' + at;
    if (TYPES.indexOf(String(r.type)) === -1) return 'unknown event type "' + r.type + '"' + at;
    if (!r.metric || String(r.metric).length > 60) return 'bad metric' + at;
    if (String(r.value === undefined || r.value === null ? '' : r.value).length > 200) {
      return 'value too long' + at;
    }
    if (String(r.unit || '').length > 24) return 'unit too long' + at;
    if (String(r.note || '').length > 500) return 'note too long' + at;
    // Every row carries an id. Without one it can never be edited or deleted,
    // which is how a "change" ends up reverting on the next reload.
    if (!r.id) return 'missing entry id' + at;
    if (String(r.id).length > 60) return 'entry id too long' + at;
  }
  return null;
}

/** Read everything back. The app rebuilds its whole state from this. */
function doGet(e) {
  var want = token_();
  if (!want) return json_({ ok: false, error: 'TOKEN script property not set' });
  if (!e || !e.parameter || e.parameter.token !== want) {
    return json_({ ok: false, error: 'bad token' });
  }
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return json_({ ok: true, rows: [] });

  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var rows = values.map(function (r) {
    return {
      ts: asText_(r[0]),
      tank: String(r[1]),
      type: String(r[2]),
      metric: asText_(r[3]),
      value: asText_(r[4]),
      unit: asText_(r[5]),
      note: asText_(r[6]),
      id: asText_(r[7])
    };
  }).filter(function (r) { return r.ts && r.tank; });

  return json_({ ok: true, rows: rows });
}

/**
 * Append rows. Body is JSON, sent as text/plain so the browser skips
 * the CORS preflight that Apps Script can't answer.
 *
 *   { "token": "...", "rows": [
 *       { "ts": "...", "tank": "t1", "type": "water_change",
 *         "metric": "percent", "value": 50, "unit": "%", "note": "" }
 *   ]}
 */
/**
 * Remove every row belonging to one entry. Bottom-up so indexes stay valid.
 *
 * Falls back to matching on content when the id is a composite key. Rows
 * written before the Entry ID column exists have none, and the app addresses
 * those as "timestamp|tank|type" or "timestamp|tank|type|metric". Without this
 * fallback an edit to an old row silently does nothing and reverts on reload.
 */
function deleteEntry_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var composite = String(id).indexOf('|') !== -1;
  var parts = composite ? String(id).split('|') : null;
  var removed = 0;

  for (var i = rows.length - 1; i >= 0; i--) {
    var match;
    if (composite) {
      match = asText_(rows[i][0]) === parts[0] &&
              String(rows[i][1]) === parts[1] &&
              String(rows[i][2]) === parts[2] &&
              (parts.length < 4 || String(rows[i][3]) === parts[3]);
    } else {
      match = String(rows[i][7]) === String(id);
    }
    if (match) { sh.deleteRow(i + 2); removed++; }
  }
  return removed;
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  var want = token_();
  if (!want) return json_({ ok: false, error: 'TOKEN script property not set' });
  if (body.token !== want) return json_({ ok: false, error: 'bad token' });

  var action = body.action || 'append';
  if (['append', 'replace', 'delete', 'merge'].indexOf(action) === -1) {
    return json_({ ok: false, error: 'unknown action' });
  }
  if (action !== 'delete' && action !== 'merge') {
    var problem = validate_(body.rows);
    if (problem) return json_({ ok: false, error: problem });
  }
  if (action === 'replace' || action === 'delete') {
    if (!body.id) return json_({ ok: false, error: 'no entry id' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    var sh = sheet_();

    if (action === 'merge') {
      var moved = mergeSpecies_(sh, String(body.kind), String(body.from), String(body.to));
      return json_({ ok: true, merged: moved });
    }

    if (action === 'delete') {
      var gone = deleteEntry_(sh, body.id);
      return json_({ ok: true, deleted: gone });
    }
    if (action === 'replace') {
      // If nothing matched, the entry predates the Entry ID column. Appending
      // anyway would silently duplicate it, so fail loudly instead.
      if (deleteEntry_(sh, body.id) === 0) {
        return json_({ ok: false, error: 'no rows carry that entry id — run backfillIds() once' });
      }
    }

    // Everything goes in as a string. The app parses on read; the sheet is
    // storage, not a calculator, so there is nothing here worth a number type.
    var out = body.rows.map(function (r) {
      return [
        String(r.ts || new Date().toISOString()),
        String(r.tank || ''),
        String(r.type || ''),
        String(r.metric || ''),
        r.value === undefined || r.value === null ? '' : String(r.value),
        String(r.unit || ''),
        String(r.note || ''),
        String(r.id || '')
      ];
    });
    sh.getRange(sh.getLastRow() + 1, 1, out.length, HEADERS.length).setValues(out);
    return json_({ ok: true, appended: out.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}


/* ============================ backups ============================ */

/**
 * Sheets version history already covers a bad edit you notice. This covers the
 * ones you don't: the file deleted, or a script quietly overwriting rows months
 * before you look. Separate file, separate folder, dated.
 *
 * Run installBackupTrigger() once from the editor to schedule it.
 */

function folder_() {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
}

function weeklyBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = folder_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  DriveApp.getFileById(ss.getId()).makeCopy('Aquascape Log ' + stamp, folder);
  prune_(folder);
}

function prune_(folder) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = BACKUPS_TO_KEEP; i < files.length; i++) files[i].setTrashed(true);
}

function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyBackup')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(21)
    .create();
}


/**
 * Rewrite one species name into another, in place.
 *
 * Deliberately does NOT go through Entry IDs. Rows logged before that column
 * existed have none, and an id-based merge silently appended duplicates
 * instead of moving anything. Metric is "<event>_<species>", so this edits
 * that cell directly and works on every row regardless of age.
 */
function mergeSpecies_(sh, kind, from, to) {
  var last = sh.getLastRow();
  if (last < 2 || !kind || !from || !to || from === to) return 0;

  var rng = sh.getRange(2, 3, last - 1, 2);   // Event Type, Metric
  var vals = rng.getValues();
  var moved = 0;

  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) !== kind) continue;
    var metric = String(vals[i][1]);
    var us = metric.indexOf('_');
    if (us === -1) continue;
    if (metric.slice(us + 1) !== from) continue;
    vals[i][1] = metric.slice(0, us + 1) + to;
    moved++;
  }

  if (moved) rng.setValues(vals);
  return moved;
}

/* ======================= one-time repair ======================= */

/**
 * Fill in Entry IDs for rows written before that column existed.
 *
 * Rows belonging to one event must share an id, so this groups the way the app
 * does: multi-metric events by timestamp + tank + type, everything else by
 * those plus the metric. Run once from the editor; safe to run again.
 */
function backfillIds() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return 'nothing to do';

  var rng = sh.getRange(2, 1, last - 1, HEADERS.length);
  var vals = rng.getValues();
  var multi = ['water_change', 'test', 'checker', 'observation'];
  var byKey = {};
  var filled = 0;

  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][7])) continue;                 // already has one
    var ts = asText_(vals[i][0]);
    var tank = String(vals[i][1]);
    var type = String(vals[i][2]);
    if (!ts || !tank) continue;

    var key = ts + '|' + tank + '|' + type;
    if (multi.indexOf(type) === -1) key += '|' + String(vals[i][3]);

    if (!byKey[key]) {
      byKey[key] = 'b' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    }
    vals[i][7] = byKey[key];
    filled++;
  }

  rng.setValues(vals);
  return 'filled ' + filled + ' rows across ' + Object.keys(byKey).length + ' entries';
}
