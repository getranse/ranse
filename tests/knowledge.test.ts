import { describe, expect, it } from 'vitest';
import { chunkText, extractReadableTextFromHtml, extractTextFromPdfBytes, ingestKnowledgeSource } from '../src/server/automation/knowledge';

describe('extractReadableTextFromHtml', () => {
  it('extracts title and visible text while dropping scripts/styles', () => {
    const result = extractReadableTextFromHtml(`
      <html>
        <head>
          <title>Refunds &amp; Returns</title>
          <style>.hidden { display: none }</style>
        </head>
        <body>
          <h1>Refund policy</h1>
          <p>Refunds are available within 30 days.</p>
          <script>alert('ignore me')</script>
        </body>
      </html>
    `);

    expect(result.title).toBe('Refunds & Returns');
    expect(result.body).toContain('Refund policy');
    expect(result.body).toContain('Refunds are available within 30 days.');
    expect(result.body).not.toContain('ignore me');
  });
});

describe('chunkText', () => {
  it('keeps short documents in one chunk', () => {
    expect(chunkText('A short policy.\n\nSecond paragraph.')).toEqual([
      'A short policy.\n\nSecond paragraph.',
    ]);
  });

  it('splits long paragraphs with overlap', () => {
    const chunks = chunkText('abcdefghi', { maxChars: 5, overlapChars: 2 });

    expect(chunks).toEqual(['abcde', 'defgh', 'ghi']);
  });
});

describe('extractTextFromPdfBytes', () => {
  it('extracts literal strings from PDF content streams', async () => {
    const pdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj
<< /Length 72 >>
stream
BT /F1 12 Tf 72 720 Td (Refund policy) Tj (Refunds \\(when eligible\\)) Tj ET
endstream
endobj
%%EOF`);

    const text = await extractTextFromPdfBytes(pdf);

    expect(text).toContain('Refund policy');
    expect(text).toContain('Refunds (when eligible)');
  });

  it('rejects non-PDF bytes', async () => {
    await expect(extractTextFromPdfBytes(new TextEncoder().encode('not a pdf'))).rejects.toThrow('invalid_pdf');
  });

  it('fails closed on unsupported PDF stream filters', async () => {
    const pdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj
<< /Length 4 /Filter /DCTDecode >>
stream
abcd
endstream
endobj
%%EOF`);

    await expect(extractTextFromPdfBytes(pdf)).rejects.toThrow('unsupported_pdf_filter:DCTDecode');
  });
});

describe('ingestKnowledgeSource', () => {
  it('blocks private URL crawl targets before fetching', async () => {
    await expect(ingestKnowledgeSource({} as any, 'ws_1', {
      kind: 'url',
      url: 'http://127.0.0.1/help',
    })).rejects.toThrow('private_url_not_allowed');
  });

  it('cleans up newly upserted vectors when D1 commit fails', async () => {
    const deletedVectorIds: string[] = [];
    const env = {
      AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
      KNOWLEDGE_INDEX: {
        upsert: async () => undefined,
        deleteByIds: async (ids: string[]) => {
          deletedVectorIds.push(...ids);
        },
      },
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
        batch: async () => {
          throw new Error('d1_commit_failed');
        },
      },
    } as any;

    await expect(ingestKnowledgeSource(env, 'ws_1', {
      kind: 'manual',
      title: 'Refund policy',
      body: 'Refunds are available within 30 days.',
    })).rejects.toThrow('d1_commit_failed');

    expect(deletedVectorIds.length).toBeGreaterThan(0);
  });
});
