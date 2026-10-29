/**
 * Decode bytes obtained by the caller from a selected File's arrayBuffer().
 * UTF-16 requires a BOM; otherwise UTF-8 is tried before Windows-1252.
 * ArrayBuffer views are decoded only within their byte offset and length.
 * CRLF and CR line breaks are normalized to LF.
 */
export function decodeConfiguration(buffer) {
  let bytes;
  if (buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(buffer);
  } else if (ArrayBuffer.isView(buffer)) {
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    throw new TypeError("Expected an ArrayBuffer or ArrayBuffer view");
  }

  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = new TextDecoder("utf-16le").decode(bytes);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = new TextDecoder("utf-16be").decode(bytes);
  } else {
    // Keep an invalid UTF-8 file's BOM out of the Windows-1252 fallback too.
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      bytes = bytes.subarray(3);
    }
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
    }
  }
  return text.replace(/\r\n?/g, "\n");
}

/**
 * List standalone bracketed command lines as { name, line } in source order.
 * Names retain case and internal whitespace; line numbers are one-based.
 * This is a lexical scan, not an OMSI hierarchy or argument parser.
 */
export function listCommands(text) {
  if (typeof text !== "string") {
    throw new TypeError("Expected configuration text as a string");
  }
  const commands = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^\[([^\[\]]+)\]$/.exec(lines[i].trim());
    if (!match) continue;
    const name = match[1].trim();
    if (name) commands.push({ name, line: i + 1 });
  }
  return commands;
}
