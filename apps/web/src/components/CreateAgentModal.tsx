import type { AgentFormValues } from "../types";
import { Spinner } from "./Spinner";

export function CreateAgentModal({
  form,
  busy,
  onChange,
  onSubmit,
  onClose,
}: {
  form: AgentFormValues;
  busy: boolean;
  onChange: (form: AgentFormValues) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">New workspace</span>
            <h2>Create an Agent</h2>
            <p>Each Agent gets a persistent folder and a resumable Codex session.</p>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <label>
          Name
          <input
            autoFocus
            placeholder="Frontend Builder"
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            required
            maxLength={80}
          />
        </label>
        <label>
          Description
          <input
            placeholder="Builds polished React prototypes"
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            maxLength={500}
          />
        </label>
        <label>
          Instructions
          <textarea
            value={form.instructions}
            onChange={(event) => onChange({ ...form, instructions: event.target.value })}
            rows={6}
            maxLength={10_000}
          />
        </label>
        <div className="modal-footer">
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? <Spinner /> : "Create Agent"}
          </button>
        </div>
      </form>
    </div>
  );
}
