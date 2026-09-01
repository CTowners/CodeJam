import type { Agent } from "../types";
import { describeKind, isProtectedAgent } from "../lib/orchestrator";
import { StatusPill } from "./StatusPill";

export function AgentHeader({
  agent,
  agents,
  busy,
  onToggleSettings,
  onToggleAgent,
  onDelete,
}: {
  agent: Agent;
  /** Needed to tell whether this is the last Chat, which can't be deleted. */
  agents: Agent[];
  busy: boolean;
  onToggleSettings: () => void;
  onToggleAgent: () => void;
  onDelete: () => void;
}) {
  const isProtected = isProtectedAgent(agent, agents);
  const isWorker = agent.kind === "worker";

  return (
    <header className="agent-header">
      <div>
        <div className="header-title-row">
          <h1>{agent.name}</h1>
          <StatusPill status={agent.status} />
        </div>
        <p>{agent.description || describeKind(agent)}</p>
      </div>
      <div className="header-actions">
        <button
          className="button button-ghost"
          onClick={onToggleSettings}
          disabled={busy || agent.status === "busy"}
        >
          {isWorker ? "Details" : "Settings"}
        </button>
        {/* A worker is a record of what one Job did; starting or stopping it out
            from under the Coordinator is not something the user should reach for. */}
        {!isWorker && (
          <button className="button button-ghost" onClick={onToggleAgent} disabled={busy}>
            {agent.status === "stopped" ? "Start" : "Stop"}
          </button>
        )}
        {/* Deleting a worker would strip its name out of the Job transcript that
            references it, leaving a bare id behind. */}
        {!isProtected && !isWorker && (
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
