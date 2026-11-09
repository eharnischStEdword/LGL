// Turning what an LGL permanent link sends into rows.
//
// LGL has sent the All Funds export as a zip around a CSV since June 2026, and
// on 2026-11-09 the Offertory report arrived as a zip around an .xlsx, which
// the hybrid endpoint handed to SheetJS whole: "Unsupported ZIP file". A real
// .xlsx is itself a zip, so what is inside decides, not the first four bytes.
// Both proxyLGL and the hybrid endpoint read through here.

import zlib from "zlib";
import * as XLSX from "xlsx";

// Entries listed from the central directory, so a streaming zip that defers its
// sizes to a data descriptor still reads. null when the bytes are not a zip.
function zipEntries(b) {
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return null;
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 65536; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return null;

  const entries = [];
  let cd = b.readUInt32LE(eocd + 16);
  const count = b.readUInt16LE(eocd + 10);
  for (let e = 0; e < count; e++) {
    if (b.readUInt32LE(cd) !== 0x02014b50) return null;
    const nameLen = b.readUInt16LE(cd + 28);
    entries.push({
      method: b.readUInt16LE(cd + 10),
      compSize: b.readUInt32LE(cd + 20),
      localOffset: b.readUInt32LE(cd + 42),
      name: b.slice(cd + 46, cd + 46 + nameLen).toString("utf-8"),
    });
    cd += 46 + nameLen + b.readUInt16LE(cd + 30) + b.readUInt16LE(cd + 32);
  }
  return entries;
}

function inflateEntry(b, entry) {
  if (b.readUInt32LE(entry.localOffset) !== 0x04034b50) return null;
  const dataStart = entry.localOffset + 30
    + b.readUInt16LE(entry.localOffset + 26) + b.readUInt16LE(entry.localOffset + 28);
  const comp = b.slice(dataStart, dataStart + entry.compSize);
  return entry.method === 8 ? zlib.inflateRawSync(comp) : comp; // 8 deflate, 0 stored
}

// { csv } for a zipped CSV, { buffer } for anything SheetJS reads as it stands
// (a workbook, plain text, or a workbook taken out of a zip, which also sets
// `unwrapped`). Any other zip is refused by the names inside it.
export function readReportFile(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const entries = zipEntries(b);
  if (!entries) return { csv: null, buffer: b };

  const csvEntry = entries.find(e => e.name.toLowerCase().endsWith(".csv"));
  if (csvEntry) {
    const out = inflateEntry(b, csvEntry);
    if (out) return { csv: out.toString("utf-8"), buffer: null };
  }
  if (entries.some(e => e.name === "[Content_Types].xml")) return { csv: null, buffer: b };

  const xlsxEntry = entries.find(e => e.name.toLowerCase().endsWith(".xlsx"));
  if (xlsxEntry) {
    const out = inflateEntry(b, xlsxEntry);
    if (out) return { csv: null, buffer: out, unwrapped: true };
  }

  const names = entries.map(e => e.name).join(", ") || "nothing";
  throw new Error(`LGL sent a zip with no CSV or workbook in it (it holds: ${names})`);
}

// Rows the way the page parses them (src/v2/lib.js parseSpreadsheet): a CSV
// goes through SheetJS as a string, which is how the All Funds report loads.
export function parseReport(buf, contentType) {
  const { csv, buffer } = readReportFile(buf);
  let wb;
  if (csv !== null) {
    wb = XLSX.read(csv, { type: "string" });
  } else if (contentType && (contentType.includes("text/") || contentType.includes("csv"))) {
    wb = XLSX.read(buffer.toString("utf-8"), { type: "string" });
  } else {
    wb = XLSX.read(buffer, { type: "buffer" });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}
