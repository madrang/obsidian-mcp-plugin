/**
 * util.styleText polyfill for Node below 20.12. ESLint 10's default stylish
 * formatter colors findings through util.styleText, which does not exist on
 * Node 18. A run WITH findings then crashes before it can print them. A
 * clean run prints nothing and never trips it, which is why the crash only
 * shows up when there is real work to read.
 *
 * Imported from eslint.config.mts, which loads inside the ESLint process
 * before any formatter runs — so `npm run lint` keeps its default settings.
 */
import util from 'node:util';

if (typeof util.styleText !== 'function') {
  const CODES = {
    reset: 0, bold: 1, dim: 2, italic: 3, underline: 4,
    red: 31, green: 32, yellow: 33, blue: 34,
    magenta: 35, cyan: 36, white: 37, gray: 90, grey: 90,
  };
  util.styleText = (format, text, options) => {
    // Node's real styleText declines to color a non-TTY stream.
    if (options?.stream && options.stream.isTTY === false) return text;
    const formats = Array.isArray(format) ? format : [format];
    const codes = formats.map(f => CODES[f]).filter(c => c !== undefined);
    if (codes.length === 0) return text;
    return `\u001b[${codes.join(';')}m${text}\u001b[0m`;
  };
}
