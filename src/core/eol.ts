// The document's own line ending, for text the core inserts (quick fixes): CRLF when most of its lines end so.

/** '\r\n' when the text's lines mostly end with CRLF, else '\n'. */
export function eolOf(text: string): '\r\n' | '\n' {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) text[i - 1] === '\r' ? crlf++ : lf++;
  return crlf > lf ? '\r\n' : '\n';
}

/** `text` (an edit's new text, written with \n) with the document's line ending. */
export const withEol = (text: string, eol: string) => (eol === '\n' ? text : text.replace(/\r?\n/g, eol));
