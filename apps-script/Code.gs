/**
 * Aquascape Log — Apps Script backend
 *
 * Setup:
 *   1. Open the "Aquascape Log" sheet → Extensions → Apps Script
 *   2. Paste this file over Code.gs
 *   3. Change TOKEN below to something only you know
 *   4. Deploy → New deployment → Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   5. Copy the /exec URL into the frontend as SHEET_URL
 *
 * Redeploy (not just save) after any edit, or the URL keeps serving old code.
 */

var TOKEN = 'change-me';
var TAB = 'Events';
var HEADERS = ['Timestamp', 'Tank', 'Event Type', 'Metric', 'Value', 'Unit', 'Note'];

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
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, 4, sh.getMaxRows(), 4).setNumberFormat('@');
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
  }
  return null;
}

/** Read everything back. The app rebuilds its whole state from this. */
function doGet(e) {
  if (!e || !e.parameter || e.parameter.token !== TOKEN) {
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
      note: asText_(r[6])
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
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  if (body.token !== TOKEN) return json_({ ok: false, error: 'bad token' });

  var problem = validate_(body.rows);
  if (problem) return json_({ ok: false, error: problem });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    var sh = sheet_();
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
        String(r.note || '')
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
