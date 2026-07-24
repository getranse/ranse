import { useEffect, useState } from 'react';
import type { Macro } from '../../../interfaces/macros';
import { API } from '../../api';
import { toast } from '../common/toast';

/**
 * Canned-response selector for the reply composer. Placeholders like
 * {{customer_name}} are filled client-side from the open ticket so the
 * operator reviews the final text before sending.
 */
export function MacroPicker({
  vars,
  onInsert,
}: {
  vars: Record<string, string | null | undefined>;
  onInsert: (body: string) => void;
}) {
  const [macros, setMacros] = useState<Macro[]>([]);

  useEffect(() => {
    API.macros()
      .then((d) => setMacros(d.macros ?? []))
      .catch(() => toast.error("Couldn't load canned responses."));
  }, []);

  if (macros.length === 0) return null;

  function render(body: string): string {
    return body.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => vars[key] ?? whole);
  }

  return (
    <select
      value=""
      onChange={(e) => {
        const macro = macros.find((m) => m.id === e.target.value);
        if (macro) onInsert(render(macro.body));
      }}
      title="Insert a canned response"
    >
      <option value="">Canned response…</option>
      {macros.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
