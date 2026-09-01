import { useEffect, useState } from "react";
import type { Agent } from "../types";
import { isOrchestratorAgent } from "../lib/orchestrator";
import { StatusPill } from "./StatusPill";

export function AgentHeader({
  agent,
  busy,
  onToggleSettings,
  onToggleAgent,
  onDelete,
  onRename,
}: {
  agent: Agent;
  busy: boolean;
  onToggleSettings: () => void;
  onToggleAgent: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const isChat = isOrchestratorAgent(agent);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name);

  // A chat has no Settings panel to rename through — its name is only
  // editable here — so switching to a different chat must cancel any
  // in-progress edit rather than carry stale draft text onto it.
  useEffect(() => {
    setNameDraft(agent.name);
    setRenaming(false);
  }, [agent.id, agent.name]);

  const commitRename = () => {
    setRenaming(false);
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== agent.name) {
      onRename(trimmed);
    } else {
      setNameDraft(agent.name);
    }
  };

  return (
    <header className="agent-header">
      <div>
        <div className="header-title-row">
          {isChat && renaming ? (
            <input
              className="agent-title-input"
              value={nameDraft}
              autoFocus
              maxLength={80}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === "Escape") {
                  setNameDraft(agent.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <h1
              className={isChat ? "agent-title-renamable" : undefined}
              onClick={isChat ? () => setRenaming(true) : undefined}
              title={isChat ? "Click to rename" : undefined}
            >
              {agent.name}
            </h1>
          )}
          <StatusPill status={agent.status} />
        </div>
        <p>{agent.description || "A Codex coding Agent in an isolated workspace."}</p>
      </div>
      <div className="header-actions">
        {/* A chat's description/instructions are server-owned — Settings has nothing to edit. */}
        {!isChat && (
          <button
            className="button button-ghost"
            onClick={onToggleSettings}
            disabled={busy || agent.status === "busy"}
          >
            Settings
          </button>
        )}
        <button className="button button-ghost" onClick={onToggleAgent} disabled={busy}>
          {agent.status === "stopped" ? "Start" : "Stop"}
        </button>
        {!isChat && (
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
