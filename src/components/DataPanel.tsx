import { useRef, useState } from 'react';
import { useStore } from '../lib/useStore';

type Message = { kind: 'ok' | 'error'; text: string; details?: string[] };

export function DataPanel() {
  const store = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('merge');
  const [msg, setMsg] = useState<Message | null>(null);

  const exportJson = () => {
    const data = store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `treasure-map-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg({ kind: 'ok', text: `Exported ${data.marks.length} of your marks and ${data.landmarks.length} landmarks.` });
  };

  const importFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      if (mode === 'replace' && !confirm('Replace ALL current marks and landmarks with this file? (You can undo.)')) return;
      const r = store.importData(json, mode);
      setMsg({
        kind: r.warnings.length ? 'error' : 'ok',
        text: `Imported ${r.marks} marks and ${r.landmarks} landmarks${r.warnings.length ? `, with ${r.warnings.length} problem(s)` : ''}.`,
        details: r.warnings,
      });
    } catch (e) {
      setMsg({ kind: 'error', text: `Import failed: ${(e as Error).message}` });
    }
  };


  const info = store.sharedInfo;
  const hidden = store.hiddenOwnMarks().length;

  return (
    <div className="data-panel">
      <div className="shared-info">
        <div>
          <b>Shared map:</b> {info.count} mark{info.count === 1 ? '' : 's'}
          {info.updatedAt && <> · updated {info.updatedAt}</>}
        </div>
        <div className="muted small">
          Published with the site, the same for everyone and read-only. Your own marks go on the other tiles and
          stay in this browser; Export saves only your own marks.
        </div>
        {hidden > 0 && (
          <button
            onClick={() => setMsg({ kind: 'ok', text: `Removed ${store.removeHiddenOwnMarks()} of your marks hidden under shared marks.` })}
          >
            Remove {hidden} own mark{hidden === 1 ? '' : 's'} hidden under shared marks
          </button>
        )}
      </div>
      <div className="row">
        <button className="primary" onClick={exportJson}>
          Export JSON
        </button>
        <button onClick={() => fileRef.current?.click()}>Import JSON…</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) importFile(f);
          }}
        />
      </div>
      <div className="row radio-row">
        <label className="check">
          <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
          Merge into current
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
          Replace all
        </label>
      </div>
      {msg && (
        <div className={msg.kind === 'ok' ? 'success' : 'error'}>
          {msg.text}
          {msg.details && msg.details.length > 0 && (
            <ul>
              {msg.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {store.saveError ? (
        <div className="error">{store.saveError}</div>
      ) : (
        <div className="muted small">Saved automatically in this browser.</div>
      )}

    </div>
  );
}
