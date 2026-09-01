import { useState } from "react";
import type { Agent, SystemInfo } from "../types";

/**
 * Two sections, mirroring the three Agent kinds:
 *
 *   Chats        — one node per chat, expandable to the workers it spawned.
 *                  Chats are where the user types; workers are inspect-only, so
 *                  they are nested under the chat that owns them rather than
 *                  listed as peers you could mistake for something to talk to.
 *   Your Agents  — templates: reusable role definitions a chat may cast.
 *
 * The nesting is the explanation. Seeing workers indented under a chat is what
 * makes "you direct these through the chat" obvious without a paragraph saying so.
 */
export function Sidebar({
  agents,
  selectedId,
  system,
  onSelect,
  onCreateClick,
  onNewChatClick,
}: {
  agents: Agent[];
  selectedId: string | null;
  system: SystemInfo | null;
  onSelect: (id: string) => void;
  onCreateClick: () => void;
  onNewChatClick: () => void;
}) {
  const chats = agents.filter((agent) => agent.kind === "chat");
  const templates = agents.filter((agent) => agent.kind === "template");
  const workersByChat = new Map<string, Agent[]>();
  for (const agent of agents) {
    if (agent.kind !== "worker") continue;
    const key = agent.parentChatId ?? "";
    workersByChat.set(key, [...(workersByChat.get(key) ?? []), agent]);
  }

  // Chats start expanded: a chat with no workers yet is the common case, and
  // collapsing by default would hide the one thing this tree exists to show.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setCollapsed((prior) => ({ ...prior, [id]: !prior[id] }));

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

      <button className="button button-primary create-button" onClick={onNewChatClick}>
        <span>＋</span> New Chat
      </button>

      <div className="sidebar-label">
        <span>Chats</span>
        <span>{chats.length}</span>
      </div>
      <nav className="agent-list">
        {chats.map((chat) => {
          const workers = workersByChat.get(chat.id) ?? [];
          const isCollapsed = collapsed[chat.id] ?? false;
          return (
            <div key={chat.id} className="tree-branch">
              <div className="tree-row">
                <button
                  className="tree-twisty"
                  onClick={() => toggle(chat.id)}
                  disabled={workers.length === 0}
                  aria-label={isCollapsed ? "Expand" : "Collapse"}
                >
                  {workers.length === 0 ? "·" : isCollapsed ? "▸" : "▾"}
                </button>
                <button
                  className={"agent-card agent-card-chat " + (chat.id === selectedId ? "selected" : "")}
                  onClick={() => onSelect(chat.id)}
                >
                  <div className="agent-avatar agent-avatar-system">
                    {chat.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="agent-card-copy">
                    <strong>{chat.name}</strong>
                    <span>{workers.length > 0 ? `${workers.length} subagent${workers.length === 1 ? "" : "s"}` : "Ask for anything"}</span>
                  </div>
                  <span className={"mini-dot mini-" + chat.status} />
                </button>
              </div>

              {!isCollapsed &&
                workers.map((worker) => (
                  <button
                    key={worker.id}
                    className={"agent-card agent-card-worker " + (worker.id === selectedId ? "selected" : "")}
                    onClick={() => onSelect(worker.id)}
                  >
                    <div className="agent-avatar agent-avatar-worker">
                      {worker.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="agent-card-copy">
                      <strong>{worker.name}</strong>
                      <span>Subagent · inspect only</span>
                    </div>
                    <span className={"mini-dot mini-" + worker.status} />
                  </button>
                ))}
            </div>
          );
        })}
        {chats.length === 0 && (
          <div className="empty-sidebar">
            <span>◇</span>
            Ask for something to start a Chat.
          </div>
        )}
      </nav>

      <div className="sidebar-label">
        <span>Your Agents</span>
        <button className="sidebar-add" onClick={onCreateClick} title="Define a new Agent">
          ＋
        </button>
      </div>
      <nav className="agent-list">
        {templates.map((agent) => (
          <button
            className={"agent-card " + (agent.id === selectedId ? "selected" : "")}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
          >
            <div className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</div>
            <div className="agent-card-copy">
              <strong>{agent.name}</strong>
              <span>{agent.description || "Role definition"}</span>
            </div>
          </button>
        ))}
        {templates.length === 0 && (
          <div className="empty-sidebar">
            <span>◇</span>
            Define a specialist your Chats can call on.
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
