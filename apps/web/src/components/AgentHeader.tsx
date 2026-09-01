import type { Agent } from "../types";
import { isOrchestratorAgent } from "../lib/orchestrator";
import { StatusPill } from "./StatusPill";

export function AgentHeader({
  agent,
  busy,
  onToggleSettings,
  onToggleAgent,
  onDelete,
}: {
  agent: Agent;
  busy: boolean;
  onToggleSettings: () => void;
  onToggleAgent: () => void;
  onDelete: () => void;
}) {
  const isSystem = isOrchestratorAgent(agent);

  return (
    <header className="agent-header">
      <div>
        <div className="header-title-row">
          <h1>{agent.name}</h1>
          <StatusPill status={agent.status} />
        </div>
        <p>
          {isSystem
            ? "System Agent that drafts Plans for Jobs. Created automatically."
            : agent.description || "A Codex coding Agent in an isolated workspace."}
        </p>
      </div>
      <div className="header-actions">
        <button
          className="button button-ghost"
          onClick={onToggleSettings}
          disabled={busy || agent.status === "busy"}
        >
          Settings
        </button>
        <button className="button button-ghost" onClick={onToggleAgent} disabled={busy}>
          {agent.status === "stopped" ? "Start" : "Stop"}
        </button>
        {!isSystem && (
          <button
            className="button button-danger"
            onClick={onDelete}
            disabled={busy || agent.status === "busy"}
          >
            Delete
          </button>
        )}
      </div>
    </header>
  );
}
