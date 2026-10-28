import { extname } from 'node:path';
import { extractProfile } from '@shared/core/profileExtractor';
import type { ResumeImportResult } from '@shared/types';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_TEXT = 200_000;
export const SUPPORTED_RESUME_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;

export class ResumeParseError extends Error {
  override name = 'ResumeParseError';
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function cleanText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_RESUME_TEXT);
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  // The legacy build runs in Node without a DOM. Imported lazily to keep startup fast.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    const pageCount = Math.min(document.numPages, 30);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        } else if (item.str && !item.str.endsWith(' ')) {
          line += ' ';
        }
      }
      if (line.trim()) lines.push(line);
      pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n'));
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

async function docxToText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth');
  const extract = mammoth.extractRawText ?? (mammoth as unknown as { default: typeof mammoth }).default.extractRawText;
  const result = await extract({ buffer: Buffer.from(bytes) });
  return result.value;
}

/**
 * Extract text from an imported resume entirely on this machine. Files are size-limited,
 * type-checked by their magic bytes (not just the extension) and never executed.
 */
export async function parseResume(fileName: string, bytes: Uint8Array): Promise<ResumeImportResult> {
  if (bytes.byteLength === 0) throw new ResumeParseError('The file is empty.');
  if (bytes.byteLength > MAX_RESUME_BYTES) {
    throw new ResumeParseError('The file is larger than 10 MB. Please export a smaller PDF or paste the text.');
  }
  const extension = extname(fileName).toLowerCase();
  if (!(SUPPORTED_RESUME_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ResumeParseError('Unsupported file type. Use PDF, DOCX, TXT or paste the text.');
  }

  let text: string;
  try {
    if (extension === '.pdf') {
      if (!isPdf(bytes)) throw new ResumeParseError('This file does not look like a valid PDF.');
      text = await pdfToText(bytes);
    } else if (extension === '.docx') {
      if (!isZip(bytes)) throw new ResumeParseError('This file does not look like a valid DOCX document.');
      text = await docxToText(bytes);
    } else {
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2_000))) {
        throw new ResumeParseError('This text file appears to contain binary data.');
      }
    }
  } catch (error) {
    if (error instanceof ResumeParseError) throw error;
    throw new ResumeParseError('The file could not be read. It may be damaged or password-protected. Try pasting the text instead.');
  }

  const cleaned = cleanText(text);
  if (cleaned.length < 30) {
    throw new ResumeParseError(
      'Little or no text could be extracted. If this is a scanned PDF, paste the resume text instead.',
    );
  }
  const { profile, warnings } = extractProfile(cleaned, fileName);
  return { fileName, text: cleaned, profile, warnings };
}
