import type { KnowledgeSourceListItem } from '../../../interfaces/knowledge-sources';
import { formatDateTime } from '../../../lib/format';
import { API } from '../../api';

export function KnowledgeSourceRow({
  source,
  busy,
  run,
}: {
  source: KnowledgeSourceListItem;
  busy: string | null;
  run: (key: string, fn: () => Promise<string>) => void;
}) {
  return (
    <div className="source-row">
      <div>
        <div style={{ fontWeight: 500 }}>{source.title}</div>
        <div className="muted">
          {source.kind} · {source.chunk_count} chunks · used {source.used_in_answers_count} times
          {source.last_crawled_at ? ` · crawled ${formatDateTime(source.last_crawled_at)}` : ''}
          {source.last_indexed_at
            ? ` · indexed ${formatDateTime(source.last_indexed_at)}`
            : ' · not vectorized yet'}
        </div>
        {source.source_url && (
          <a href={source.source_url} target="_blank" rel="noreferrer">
            {source.source_url}
          </a>
        )}
        {source.error && <div className="error">{source.error}</div>}
      </div>
      <div className="source-actions">
        <div className="source-pills">
          <span
            className={`pill ${source.status === 'failed' ? 'urgent' : source.status === 'ready' ? 'resolved' : ''}`}
          >
            {source.status}
          </span>
          {source.stale && <span className="pill high">stale</span>}
          {source.duplicate_count > 0 && <span className="pill high">duplicate</span>}
          {source.public === 1 && <span className="pill resolved">public</span>}
        </div>
        <button
          disabled={!!busy || source.status !== 'ready'}
          title="Publish to the public help center at /help/<workspace-slug>"
          onClick={() =>
            run(`public-${source.id}`, async () => {
              await API.setKnowledgePublic(source.id, source.public !== 1);
              return source.public === 1 ? 'Removed from help center' : 'Published to help center';
            })
          }
        >
          {source.public === 1 ? 'Unpublish' : 'Publish'}
        </button>
        <button
          disabled={!!busy || source.status === 'indexing'}
          onClick={() =>
            run(`reindex-${source.id}`, async () => {
              const result = await API.reindexKnowledge(source.id);
              return `Reindexed ${result.chunks} chunks`;
            })
          }
        >
          {busy === `reindex-${source.id}` ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
