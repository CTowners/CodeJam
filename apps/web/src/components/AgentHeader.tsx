import type { Agent } from "../types";
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
  return (
    <header className="agent-header">
      <div>
        <div className="header-title-row">
          <h1>{agent.name}</h1>
          <StatusPill status={agent.status} />
        </div>
        <p>{agent.description || "A Codex coding Agent in an isolated workspace."}</p>
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
        <button
          className="button button-danger"
          onClick={onDelete}
          disabled={busy || agent.status === "busy"}
        >
          Delete
        </button>
      </div>
    </header>
  );
}
