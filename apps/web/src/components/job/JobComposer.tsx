import type { Agent } from "../../types";

/**
 * Controlled: the text and the Agent selection belong to the chat, not to this
 * component, so switching chats and coming back leaves both intact.
 */
export function JobComposer({
  busy,
  name,
  task,
  agents,
  selectedAgentIds,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  name: string;
  task: string;
  /** Your Agents — the only kind a Plan may cast. */
  agents: Agent[];
  /** null means "no restriction": every one of Your Agents is available. */
  selectedAgentIds: string[] | null;
  onChange: (changes: { name?: string; task?: string; selectedAgentIds?: string[] | null }) => void;
  onSubmit: (input: { name: string; task: string }) => void;
}) {
  const templates = agents.filter((agent) => agent.kind === "template");
  const isSelected = (id: string): boolean => selectedAgentIds === null || selectedAgentIds.includes(id);

  const toggleAgent = (id: string): void => {
    // First deselection turns "all of them" into an explicit list, so the user
    // never has to tick every Agent just to exclude one.
    const current = selectedAgentIds ?? templates.map((agent) => agent.id);
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    onChange({ selectedAgentIds: next.length === templates.length ? null : next });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = task.trim();
    if (!trimmed) return;
    onSubmit({ name: name.trim(), task: trimmed });
  };

  return (
    <form className="job-composer" onSubmit={submit}>
      <div className="welcome">
        <div className="welcome-orbit">
          <div>⌁</div>
        </div>
        <h3>What do you want done?</h3>
        <p>
          This Chat drafts a Plan and proposes which Agent plays each Step, fanning
          independent work out to several at once — nothing runs until you approve it.
        </p>
      </div>

      <label>
        Job name (optional)
        <input
          value={name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="e.g. Cancer and modern lifestyle"
          disabled={busy}
        />
      </label>
      <label>
        Your request
        <textarea
          value={task}
          onChange={(event) => onChange({ task: event.target.value })}
          placeholder="Research, write, build, review — describe the whole task…"
          rows={4}
          disabled={busy}
        />
      </label>
      {templates.length > 0 && (
        <div className="agent-picker">
          <div className="agent-picker-head">
            <span>Agents this Chat may use</span>
            <span className="agent-picker-count">
              {selectedAgentIds === null ? "all" : `${selectedAgentIds.length} of ${templates.length}`}
              {selectedAgentIds !== null && (
                <button type="button" className="agent-picker-reset" onClick={() => onChange({ selectedAgentIds: null })}>
                  reset
                </button>
              )}
            </span>
          </div>
          <div className="agent-picker-grid">
            {templates.map((agent) => {
              const on = isSelected(agent.id);
              return (
                <button
                  type="button"
                  key={agent.id}
                  className={"agent-pick " + (on ? "on" : "off")}
                  onClick={() => toggleAgent(agent.id)}
                  disabled={busy}
                  aria-pressed={on}
                  title={agent.capabilitySummary || agent.description}
                >
                  <span className="agent-pick-avatar">{agent.name.slice(0, 1).toUpperCase()}</span>
                  <span className="agent-pick-copy">
                    <strong>{agent.name}</strong>
                    <span>{agent.capabilitySummary || agent.description || "No instructions yet"}</span>
                  </span>
                  <span className="agent-pick-mark" aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedAgentIds !== null && selectedAgentIds.length === 0 && (
            <p className="agent-picker-warn">
              None selected — the Chat will propose a brand-new Agent for every step.
            </p>
          )}
        </div>
      )}

      <button className="button button-primary" disabled={!task.trim() || busy}>
        {busy ? "Drafting…" : "Draft Plan"}
      </button>
    </form>
  );
}
