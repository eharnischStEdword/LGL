// What LGL's permanent links send, read the way the hybrid fallback and the
// report proxy read it. All Funds comes as a zip around a CSV; on 2026-11-09
// the Offertory report came as a zip around an .xlsx, named as below, and the
// fallback answered "Unsupported ZIP file".
// Every fixture is built here; no real report is used.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import zlib from "zlib";
import * as XLSX from "xlsx";

import { readReportFile, parseReport } from "../report-file.js";
import { mergeApiGifts } from "../top-up.js";

// A real zip: local headers, central directory and end record, deflated.
function zipOf(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf-8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

const COLS = { dateCol: "Gift date", amountCol: "Gift amount", fundCol: "Fund",
               paymentCol: "Payment type" };

const CSV = [
  "Gift date,Gift amount,Fund,Payment type,Parent gift pmt. type",
  "2026-11-01,20.00,Offertory,Cash,",
  "2026-11-01,20.00,Offertory,Check,",
  "2026-11-02,150.00,Offertory,ACH,",
].join("\n");

// What the zip header says LGL sends: not text, so the type cannot be trusted.
const ZIP_TYPE = "application/zip";

// The name LGL put inside the Offertory zip, slash and all.
const OFFERTORY_ENTRY = "Offertory/Fund Export Update 2026-11-09.xlsx";
const workbookOf = (csv) =>
  XLSX.write(XLSX.read(csv, { type: "string" }), { type: "buffer", bookType: "xlsx" });

test("the Offertory report zipped around a workbook parses instead of failing", () => {
  const zipped = zipOf([[OFFERTORY_ENTRY, workbookOf(CSV)]]);
  assert.throws(() => XLSX.read(zipped, { type: "buffer" }), /Unsupported ZIP file/);

  const read = readReportFile(zipped);
  assert.equal(read.unwrapped, true);
  const rows = parseReport(zipped, ZIP_TYPE);
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]).slice(0, 4), ["Gift date", "Gift amount", "Fund", "Payment type"]);
  assert.equal(rows.reduce((sum, r) => sum + Number(r["Gift amount"]), 0), 190);
});

test("a report zipped around a CSV parses instead of failing", () => {
  const zipped = zipOf([["Offertory Fund Export Update 2026-11-09.csv", CSV]]);
  // The defect: SheetJS reading the zip as a workbook.
  assert.throws(() => XLSX.read(zipped, { type: "buffer" }), /Unsupported ZIP file/);

  const rows = parseReport(zipped, ZIP_TYPE);
  assert.equal(rows.length, 3);
  assert.deepEqual(Object.keys(rows[0]).slice(0, 4), ["Gift date", "Gift amount", "Fund", "Payment type"]);
  assert.equal(rows.reduce((sum, r) => sum + Number(r["Gift amount"]), 0), 190);
});

test("a gift in both the unzipped report and the API counts once", () => {
  const US = CSV.replaceAll("2026-11-01", "11/1/2026").replaceAll("2026-11-02", "11/2/2026");
  for (const [label, zipped] of [
    ["CSV, ISO dates", zipOf([["report.csv", CSV]])],
    ["CSV, US dates", zipOf([["report.csv", US]])],
    ["workbook, date cells", zipOf([[OFFERTORY_ENTRY, workbookOf(US)]])],
  ]) {
    const rows = parseReport(zipped, ZIP_TYPE);
    const api = (date, amount, payment) =>
      ({ received_date: date, received_amount: amount, fund_name: "Offertory", payment_type_name: payment });
    const added = mergeApiGifts(rows, [
      // the report's own three gifts, sent back by the API
      api("2026-11-02", 150, "ACH"), api("2026-11-01", 20, "Cash"), api("2026-11-01", 20, "Check"),
      // a third $20.00 that Sunday, which the report does not hold
      api("2026-11-01", 20, "Cash"),
    ], COLS);
    assert.equal(added, 1, `${label}: the report's own gift came back as a new one`);
    assert.equal(rows.length, 4, label);
  }
});

test("a real workbook still passes through untouched", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Gift date", "Gift amount", "Fund"], ["2026-11-01", 20, "Offertory"],
  ]), "Sheet1");
  const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const read = readReportFile(xlsx);
  assert.equal(read.csv, null);
  assert.equal(read.buffer.length, xlsx.length);
  const rows = parseReport(xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Fund, "Offertory");
});

test("plain CSV text is read as text, as the proxy forwards it", () => {
  const read = readReportFile(Buffer.from(CSV));
  assert.equal(read.csv, null);
  assert.equal(parseReport(Buffer.from(CSV), "text/csv").length, 3);
});

test("a zip holding neither a CSV nor a workbook is refused by name", () => {
  const odd = zipOf([["Offertory Fund Export.pdf", "not a report"]]);
  assert.throws(() => readReportFile(odd), /no CSV or workbook in it \(it holds: Offertory Fund Export\.pdf\)/);
});
