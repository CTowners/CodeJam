import type { Agent, SystemInfo } from "../types";
import { isOrchestratorAgent } from "../lib/orchestrator";

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
  const orchestrator = agents.find(isOrchestratorAgent);
  const yourAgents = agents.filter((agent) => !isOrchestratorAgent(agent));

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

      {orchestrator && (
        <>
          <div className="sidebar-label">
            <span>System</span>
          </div>
          <nav className="agent-list agent-list-system">
            <button
              className={"agent-card agent-card-system " + (orchestrator.id === selectedId ? "selected" : "")}
              onClick={() => onSelect(orchestrator.id)}
            >
              <div className="agent-avatar agent-avatar-system">{orchestrator.name.slice(0, 1).toUpperCase()}</div>
              <div className="agent-card-copy">
                <strong>{orchestrator.name}</strong>
                <span>Drafts Plans for Jobs</span>
              </div>
              <span className={"mini-dot mini-" + orchestrator.status} />
            </button>
          </nav>
        </>
      )}

      <div className="sidebar-label">
        <span>Your Agents</span>
        <span>{yourAgents.length}</span>
      </div>
      <nav className="agent-list">
        {yourAgents.map((agent) => (
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
        {yourAgents.length === 0 && (
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
