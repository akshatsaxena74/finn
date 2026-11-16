// PDF -> per-page text. Pages are kept so every quote FINN shows can cite a page.
import { extractText, getDocumentProxy } from 'unpdf';
import { getBytes } from './http.js';

export async function pdfPages(url, { maxPages = 80 } = {}) {
  const bytes = await getBytes(url, { timeoutMs: 30000 });
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  if (head !== '%PDF-') throw new Error('Not a PDF: ' + url);
  const doc = await getDocumentProxy(bytes, { verbosity: 0 });
  const { text } = await extractText(doc, { mergePages: false });
  return text.slice(0, maxPages).map((t) => t.replace(/[ \t]+/g, ' ').replace(/\u0000/g, ''));
}

export async function pdfText(url, opts) {
  return (await pdfPages(url, opts)).join('\n');
}
