import { useEffect, useRef, useState } from "react";
import type { Agent, AgentRun, Message, SystemInfo } from "../types";
import { formatTime } from "../lib/format";
import { Spinner } from "./Spinner";

const starterPrompts = [
  "Create a small TypeScript CLI that prints a weather summary from sample JSON.",
  "Inspect this workspace and explain what you would improve first.",
  "Build a responsive single-page todo app with tests.",
];

export function Playground({
  agent,
  system,
  messages,
  activeRun,
  onSend,
}: {
  agent: Agent;
  system: SystemInfo | null;
  messages: Message[];
  activeRun: AgentRun | null;
  onSend: (content: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const messageEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeRun]);

  const running = activeRun != null && ["queued", "running"].includes(activeRun.status);
  const disabled = agent.status === "stopped" || agent.status === "busy" || running;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    const content = prompt.trim();
    setPrompt("");
    onSend(content);
  };

  return (
    <section className="playground">
      <div className="playground-topbar">
        <div>
          <span className="eyebrow">Playground</span>
          <h2>Build something with your Agent</h2>
        </div>
        <div className="session-info">
          <span className="pulse" />
          {agent.codexThreadId ? "Session connected" : "New session"}
        </div>
      </div>

      <div className="messages">
        {messages.length === 0 && !activeRun ? (
          <div className="welcome">
            <div className="welcome-orbit">
              <div>⌁</div>
            </div>
            <h3>What should {agent.name} build?</h3>
            <p>
              The Agent can inspect files, write code, run commands, and continue the same
              Codex session across messages.
            </p>
            <div className="prompt-grid">
              {starterPrompts.map((item) => (
                <button key={item} onClick={() => setPrompt(item)}>
                  <span>↗</span>
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article className={"message message-" + message.role} key={message.id}>
              <div className="message-meta">
                <strong>{message.role === "user" ? "You" : agent.name}</strong>
                <span>{formatTime(message.createdAt)}</span>
              </div>
              <div className="message-body">{message.content}</div>
            </article>
          ))
        )}
        {running && (
          <article className="message message-assistant thinking">
            <div className="message-meta">
              <strong>{agent.name}</strong>
              <span>working in the Agent workspace</span>
            </div>
            <div className="thinking-row">
              <Spinner />
              Codex is reading, editing, or running commands…
            </div>
          </article>
        )}
        {activeRun?.status === "failed" && (
          <article className="run-error">
            <strong>Run failed</strong>
            <span>{activeRun.error}</span>
          </article>
        )}
        <div ref={messageEnd} />
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            agent.status === "stopped"
              ? "Start this Agent to continue…"
              : "Describe what you want the Agent to do…"
          }
          disabled={disabled}
          rows={3}
        />
        <div className="composer-footer">
          <span>
            Enter to send · Shift + Enter for newline ·{" "}
            {system?.codexSandboxMode ?? "checking sandbox"}
          </span>
          <button className="send-button" disabled={!prompt.trim() || disabled} aria-label="Send message">
            ↑
          </button>
        </div>
      </form>
    </section>
  );
}
