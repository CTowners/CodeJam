import type { Agent, SystemInfo } from "../types";
import { isOrchestratorAgent } from "../lib/orchestrator";

export function Sidebar({
  agents,
  selectedId,
  system,
  onSelect,
  onNewChat,
  onCreateClick,
}: {
  agents: Agent[];
  selectedId: string | null;
  system: SystemInfo | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onCreateClick: () => void;
}) {
  const chats = agents.filter(isOrchestratorAgent).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

      <button className="button button-primary create-button" onClick={onNewChat}>
        <span>＋</span> New Chat
      </button>

      <div className="sidebar-label">
        <span>Chats</span>
        <span>{chats.length}</span>
      </div>
      <nav className="agent-list agent-list-chats">
        {chats.map((chat) => (
          <button
            className={"agent-card agent-card-chat " + (chat.id === selectedId ? "selected" : "")}
            key={chat.id}
            onClick={() => onSelect(chat.id)}
          >
            <div className="agent-avatar agent-avatar-chat">💬</div>
            <div className="agent-card-copy">
              <strong>{chat.name}</strong>
              <span>Plans and casts one Job</span>
            </div>
            <span className={"mini-dot mini-" + chat.status} />
          </button>
        ))}
        {chats.length === 0 && (
          <div className="empty-sidebar">
            <span>◇</span>
            Start a new chat to plan your first Job.
          </div>
        )}
      </nav>

      <div className="sidebar-label sidebar-label-agents">
        <span>Agents</span>
        <span>{yourAgents.length}</span>
        <button className="button button-ghost button-small create-agent-button" onClick={onCreateClick}>
          <span>＋</span> Create Agent
        </button>
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
