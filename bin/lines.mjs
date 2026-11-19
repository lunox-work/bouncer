// A file's lines, one at a time, without holding the file in memory: a
// long agent session's transcript runs to hundreds of megabytes, past what
// one string holds. Synchronous, 1 MiB at a time.
import { closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** Yields each line of `file` (no terminator; a last line without one is yielded too). */
export function* linesOf(file) {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    const decoder = new StringDecoder("utf8");
    let rest = "";
    for (let read = readSync(fd, buffer, 0, buffer.length, null); read > 0; read = readSync(fd, buffer, 0, buffer.length, null)) {
      const lines = (rest + decoder.write(buffer.subarray(0, read))).split("\n");
      rest = lines.pop();
      yield* lines;
    }
    rest += decoder.end();
    if (rest !== "") yield rest;
  } finally {
    closeSync(fd);
  }
}
