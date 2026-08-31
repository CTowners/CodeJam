import type { Agent, SystemInfo } from "../types";

export function Sidebar({
  agents,
  selectedId,
  system,
  onSelect,
  onCreateClick,
}: {
  agents: Agent[];
  selectedId: string | null;
  system: SystemInfo | null;
  onSelect: (id: string) => void;
  onCreateClick: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <strong>Agent Launchpad</strong>
          <span>
            {system?.runtimeProvider === "container"
              ? "Local container · Codex CLI"
              : "ECS / Docker · Codex CLI"}
          </span>
        </div>
      </div>

      <button className="button button-primary create-button" onClick={onCreateClick}>
        <span>＋</span> Create Agent
      </button>

      <div className="sidebar-label">
        <span>Your Agents</span>
        <span>{agents.length}</span>
      </div>
      <nav className="agent-list">
        {agents.map((agent) => (
          <button
            className={"agent-card " + (agent.id === selectedId ? "selected" : "")}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
          >
            <div className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</div>
            <div className="agent-card-copy">
              <strong>{agent.name}</strong>
              <span>{agent.description || "Coding Agent"}</span>
            </div>
            <span className={"mini-dot mini-" + agent.status} />
          </button>
        ))}
        {agents.length === 0 && (
          <div className="empty-sidebar">
            <span>◇</span>
            Create your first coding Agent.
          </div>
        )}
      </nav>

      <div className="runtime-card">
        <span className="eyebrow">Runtime</span>
        <strong>{system?.runtime ?? "Checking…"}</strong>
        <span>
          {system?.arkModel ?? "Ark model not configured"}
          {system?.containerEngine ? " · " + system.containerEngine : ""}
        </span>
      </div>
    </aside>
  );
}
