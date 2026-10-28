import JSZip from 'jszip';
import { MAX_RESUME_BYTES, parseResume } from '../../src/main/services/resume/ResumeParser';
import { makePdf } from '../fixtures/makePdf';

const RESUME_LINES = [
  'Jane Doe',
  'Senior Backend Engineer',
  'Experience',
  'Senior Engineer at Acme 2019 - 2023',
  '- Built payment APIs in TypeScript and PostgreSQL',
  'Skills',
  'TypeScript, PostgreSQL, Kubernetes',
];

async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('parseResume', () => {
  it('extracts text and a draft profile from a PDF locally', async () => {
    const result = await parseResume('resume.pdf', makePdf(RESUME_LINES));
    expect(result.text).toContain('Built payment APIs');
    expect(result.profile.name).toBe('Jane Doe');
    expect(result.profile.experience[0]).toMatchObject({ title: 'Senior Engineer', company: 'Acme' });
    expect(result.profile.skills).toEqual(expect.arrayContaining(['TypeScript', 'Kubernetes']));
    expect(result.profile.verified).toBe(false);
  });

  it('extracts text from a DOCX', async () => {
    const result = await parseResume('resume.docx', await makeDocx(RESUME_LINES));
    expect(result.text).toContain('Senior Backend Engineer');
    expect(result.profile.skills).toContain('PostgreSQL');
  });

  it('reads plain text and markdown', async () => {
    const result = await parseResume('resume.txt', new TextEncoder().encode(RESUME_LINES.join('\n')));
    expect(result.profile.headline).toBe('Senior Backend Engineer');
  });

  it('rejects unsupported, empty and oversized files', async () => {
    await expect(parseResume('resume.exe', new Uint8Array([1, 2, 3]))).rejects.toThrow('Unsupported file type');
    await expect(parseResume('resume.pdf', new Uint8Array())).rejects.toThrow('empty');
    await expect(parseResume('resume.pdf', new Uint8Array(MAX_RESUME_BYTES + 1))).rejects.toThrow('10 MB');
  });

  it('checks magic bytes instead of trusting the extension', async () => {
    await expect(parseResume('resume.pdf', new TextEncoder().encode('not really a pdf at all, just text'))).rejects.toThrow(
      'does not look like a valid PDF',
    );
    await expect(parseResume('resume.docx', new TextEncoder().encode('plain text pretending'))).rejects.toThrow(
      'does not look like a valid DOCX',
    );
  });

  it('handles malformed PDFs and DOCX gracefully', async () => {
    const brokenPdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> garbage garbage %%EOF');
    await expect(parseResume('broken.pdf', brokenPdf)).rejects.toThrow(/could not be read|Little or no text/);
    const brokenDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);
    await expect(parseResume('broken.docx', brokenDocx)).rejects.toThrow('could not be read');
  });

  it('rejects binary data disguised as text and near-empty documents', async () => {
    await expect(parseResume('resume.txt', new Uint8Array([0, 1, 2, 3, 4, 5, 65, 66]))).rejects.toThrow('binary');
    await expect(parseResume('resume.pdf', makePdf(['Hi']))).rejects.toThrow('Little or no text');
  });
});
