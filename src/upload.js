import { problem } from "./patch.js";
const MAX_BYTES = 10 * 1024 * 1024;
export async function parseUpload(req) {
  const type = req.headers["content-type"] ?? "";
  const match =
    /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))\s*$/iu.exec(
      type,
    );
  if (!match)
    problem("Use multipart/form-data with file and prompt fields.", 415);
  const boundary = match[1] ?? match[2];
  if (boundary.length > 200) problem("Invalid multipart boundary.", 400);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) problem("Upload exceeds 10 MB.", 413);
    chunks.push(chunk);
  }
  return decodeMultipart(Buffer.concat(chunks), boundary);
}
export function decodeMultipart(body, boundary) {
  const first = Buffer.from(`--${boundary}\r\n`);
  const marker = Buffer.from(`\r\n--${boundary}`);
  if (!body.subarray(0, first.length).equals(first))
    problem("Malformed upload.", 400);
  let cursor = first.length;
  const fields = new Map();
  for (let count = 0; count < 3; count++) {
    const endHeaders = body.indexOf("\r\n\r\n", cursor);
    if (endHeaders < 0 || endHeaders - cursor > 8192)
      problem("Malformed upload headers.", 400);
    const headers = body.subarray(cursor, endHeaders).toString("utf8");
    const disposition =
      /^content-disposition:\s*form-data;\s*name="([^"\r\n]+)"(?:;\s*filename="([^"\r\n]*)")?\s*$/imu.exec(
        headers,
      );
    if (!disposition) problem("Invalid form-data field.", 400);
    const name = disposition[1],
      filename = disposition[2];
    if (!["file", "prompt"].includes(name) || fields.has(name))
      problem("Send exactly one file and one prompt.", 400);
    const start = endHeaders + 4;
    let end = body.indexOf(marker, start);
    // Boundary-like bytes within JSON are not delimiters unless followed by CRLF or --.
    while (end >= 0) {
      const suffix = body
        .subarray(end + marker.length, end + marker.length + 2)
        .toString();
      if (suffix === "\r\n" || suffix === "--") break;
      end = body.indexOf(marker, end + marker.length);
    }
    if (end < 0) problem("Incomplete upload.", 400);
    if (
      name === "file" &&
      (!filename || !filename.toLowerCase().endsWith(".json"))
    )
      problem("file must be an attached .json file.", 400);
    if (name === "prompt" && filename !== undefined)
      problem("prompt must be a text field.", 400);
    fields.set(name, body.subarray(start, end));
    cursor = end + marker.length;
    if (body.subarray(cursor, cursor + 2).toString() === "--") {
      const trailing = body.subarray(cursor + 2).toString();
      if (trailing !== "" && trailing !== "\r\n")
        problem("Unexpected trailing upload data.", 400);
      if (fields.size !== 2) problem("Attach file and provide prompt.", 400);
      let test;
      try {
        test = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(fields.get("file")),
        );
      } catch {
        problem("Attached file must contain valid UTF-8 JSON.", 400);
      }
      return { test, prompt: fields.get("prompt").toString("utf8") };
    }
    cursor += 2;
  }
  problem("Too many form fields.", 400);
}
