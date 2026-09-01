import type { AgentFormValues } from "../types";
import { Spinner } from "./Spinner";

export function SettingsPanel({
  form,
  busy,
  workspacePath,
  readOnly = false,
  onChange,
  onSubmit,
  onClose,
}: {
  form: AgentFormValues;
  busy: boolean;
  workspacePath: string | null;
  /** Subagents are evidence of what a Job did — inspectable, never editable. */
  readOnly?: boolean;
  onChange: (form: AgentFormValues) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <form className="settings-panel" onSubmit={onSubmit}>
      <div className="settings-title">
        <div>
          <span className="eyebrow">Agent configuration</span>
          <h2>Instructions and identity</h2>
        </div>
        <button type="button" onClick={onClose}>×</button>
      </div>
      <div className="form-grid">
        <label>
          Name
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            required
            maxLength={80}
            readOnly={readOnly}
          />
        </label>
        <label>
          Description
          <input
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            maxLength={500}
            readOnly={readOnly}
          />
        </label>
      </div>
      <label>
        System instructions
        <textarea
          value={form.instructions}
          onChange={(event) => onChange({ ...form, instructions: event.target.value })}
          rows={5}
          maxLength={10_000}
          readOnly={readOnly}
        />
      </label>
      <div className="panel-footer">
        <code>{workspacePath ?? "No workspace — this Agent holds instructions only"}</code>
        {!readOnly && (
          <button className="button button-primary" disabled={busy}>
            {busy ? <Spinner /> : "Save changes"}
          </button>
        )}
      </div>
    </form>
  );
}
