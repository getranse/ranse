import { useEffect, useState } from 'react';
import type { KnowledgeSectionProps } from '../../../interfaces/client';
import {
  type AnswerInspectionTrace,
  API,
  type KnowledgeSearchHit,
  type KnowledgeSource,
} from '../../api';
import { AnswerInspection } from './AnswerInspection';
import { KnowledgeSourceRow } from './KnowledgeSourceRow';

export function KnowledgeSection({ onSaved }: KnowledgeSectionProps) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [manualTitle, setManualTitle] = useState('');
  const [manualBody, setManualBody] = useState('');
  const [url, setUrl] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeSearchHit[]>([]);
  const [trace, setTrace] = useState<AnswerInspectionTrace | undefined>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const data = await API.listKnowledge();
    setSources(data.sources ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function run(action: string, fn: () => Promise<string | undefined>) {
    setBusy(action);
    setError('');
    try {
      const message = await fn();
      await load();
      onSaved(message || 'Saved');
    } catch (err: any) {
      setError(err.message || 'Knowledge update failed');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <h2>Content Library</h2>
      <div className="card">
        <div className="knowledge-grid">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run('manual', async () => {
                const result = await API.createKnowledge({
                  kind: 'manual',
                  title: manualTitle || 'Manual source',
                  body: manualBody,
                });
                setManualTitle('');
                setManualBody('');
                return `Indexed ${result.chunks} chunks`;
              });
            }}
          >
            <div className="field">
              <label>Manual source</label>
              <input
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="Refund policy"
              />
            </div>
            <textarea
              rows={5}
              value={manualBody}
              onChange={(e) => setManualBody(e.target.value)}
              placeholder="Paste policy or help-center text…"
            />
            <button
              className="primary"
              disabled={!manualBody.trim() || !!busy}
              style={{ marginTop: 8 }}
            >
              {busy === 'manual' ? 'Indexing…' : 'Add source'}
            </button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!pdfFile) return;
              run('pdf', async () => {
                const result = await API.createKnowledge({
                  kind: 'pdf',
                  file: pdfFile,
                  title: pdfTitle || undefined,
                });
                setPdfTitle('');
                setPdfFile(null);
                return `Indexed ${result.chunks} chunks`;
              });
            }}
          >
            <div className="field">
              <label>PDF</label>
              <input
                value={pdfTitle}
                onChange={(e) => setPdfTitle(e.target.value)}
                placeholder="Optional title"
              />
            </div>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            />
            <button className="primary" disabled={!pdfFile || !!busy} style={{ marginTop: 8 }}>
              {busy === 'pdf' ? 'Indexing…' : 'Upload PDF'}
            </button>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              run('url', async () => {
                const result = await API.createKnowledge({
                  kind: 'url',
                  title: urlTitle || undefined,
                  url,
                });
                setUrl('');
                setUrlTitle('');
                return `Indexed ${result.chunks} chunks`;
              });
            }}
          >
            <div className="field">
              <label>Help-center URL</label>
              <input
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
                placeholder="Optional title"
              />
            </div>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/help/refunds"
            />
            <button className="primary" disabled={!url.trim() || !!busy} style={{ marginTop: 8 }}>
              {busy === 'url' ? 'Crawling…' : 'Crawl URL'}
            </button>
          </form>
        </div>

        <div className="row" style={{ alignItems: 'flex-end', marginTop: 14 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Search</label>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) {
                  setHits([]);
                  setTrace(undefined);
                }
              }}
              placeholder="Test retrieval…"
            />
          </div>
          <button
            disabled={!query.trim() || !!busy}
            onClick={async () => {
              setBusy('search');
              setError('');
              try {
                const result = await API.searchKnowledge(query, 5);
                setHits(result.hits ?? []);
                setTrace(result.trace);
              } catch (err: any) {
                setTrace(undefined);
                setError(err.message || 'Search failed');
              } finally {
                setBusy('');
              }
            }}
          >
            {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              run('resolved', async () => {
                const result = await API.importResolvedTicketsKnowledge(50);
                return `Imported ${result.imported}; skipped ${result.skipped}; failed ${result.failed}`;
              })
            }
          >
            {busy === 'resolved' ? 'Importing…' : 'Import resolved tickets'}
          </button>
        </div>

        {error && (
          <div className="error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
        <AnswerInspection hits={hits} trace={trace} />

        {hits.length > 0 && (
          <div className="knowledge-results">
            {hits.map((hit) => (
              <div key={hit.id} className="knowledge-hit">
                <div>
                  <strong>{hit.title}</strong>
                  <span className="muted"> score {hit.score.toFixed(3)}</span>
                </div>
                <div className="muted">{hit.snippet}</div>
                {hit.url && (
                  <a href={hit.url} target="_blank" rel="noreferrer">
                    {hit.url}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="source-list">
          {sources.map((source) => (
            <KnowledgeSourceRow key={source.id} source={source} busy={busy} run={run} />
          ))}
          {sources.length === 0 && <div className="muted">No sources indexed yet.</div>}
        </div>
      </div>
    </>
  );
}
