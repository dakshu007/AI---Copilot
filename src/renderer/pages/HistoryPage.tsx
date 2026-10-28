import { useCallback, useEffect, useState } from 'react';
import type { SessionRecord, SessionSummary } from '@shared/types';
import { useCopilot } from '../app/CopilotProvider';
import { SessionHistory } from '../components/SessionHistory';
import { api, errorMessage, unwrap } from '../lib/api';

export function HistoryPage() {
  const { settings, updateSettings, notify } = useCopilot();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SessionRecord | null>(null);

  const load = useCallback(
    async (search: string) => {
      try {
        setSessions(await unwrap(api().history.list(search)));
      } catch (error) {
        notify('error', errorMessage(error));
      }
    },
    [notify],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(query), 200);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SessionHistory
        enabled={Boolean(settings?.settings.privacy.historyEnabled)}
        sessions={sessions}
        query={query}
        selected={selected}
        onQueryChange={setQuery}
        onSelect={async (id) => setSelected(await unwrap(api().history.get(id)))}
        onDelete={async (id) => {
          if (!window.confirm('Delete this session permanently?')) return;
          await unwrap(api().history.delete(id));
          setSelected(null);
          await load(query);
        }}
        onDeleteAll={async () => {
          if (!window.confirm('Delete all saved sessions permanently?')) return;
          await unwrap(api().history.deleteAll());
          setSelected(null);
          await load(query);
        }}
        onExport={async (id, format) => {
          try {
            const path = await unwrap(api().history.export(id, format));
            if (path) notify('info', `Exported to ${path}`);
          } catch (error) {
            notify('error', errorMessage(error));
          }
        }}
        onEnable={() => void updateSettings({ privacy: { historyEnabled: true } })}
      />
    </div>
  );
}
