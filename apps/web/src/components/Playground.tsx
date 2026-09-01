import { useEffect, useRef, useState } from "react";
import type { Agent, AgentRun, DraftedPlan, Message, SystemInfo } from "../types";
import { formatTime } from "../lib/format";
import { classifyReply, isDraftTriggerMessage, isOrchestratorAgent } from "../lib/orchestrator";
import { PlanCard } from "./PlanCard";
import { Spinner } from "./Spinner";

const starterPrompts = [
  "Create a small TypeScript CLI that prints a weather summary from sample JSON.",
  "Inspect this workspace and explain what you would improve first.",
  "Build a responsive single-page todo app with tests.",
];

export function Playground({
  agent,
  agents,
  system,
  messages,
  activeRun,
  onSend,
  onDraftPlan,
  drafting,
  onApprovePlan,
  approvingPlanFor,
}: {
  agent: Agent;
  agents: Agent[];
  system: SystemInfo | null;
  messages: Message[];
  activeRun: AgentRun | null;
  onSend: (content: string) => void;
  onDraftPlan: () => void;
  drafting: boolean;
  onApprovePlan: (draft: DraftedPlan, messageId: string) => void;
  /** The message id of the plan card currently being approved, if any. */
  approvingPlanFor: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const messageEnd = useRef<HTMLDivElement>(null);
  const isChat = isOrchestratorAgent(agent);

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

  const visibleMessages = messages.filter((message) => !isDraftTriggerMessage(message.content));

  return (
    <section className="playground">
      <div className="playground-topbar">
        <div>
          <span className="eyebrow">{isChat ? "Chat" : "Playground"}</span>
          <h2>{isChat ? "Plan a Job with " + agent.name : "Build something with your Agent"}</h2>
        </div>
        <div className="playground-topbar-actions">
          {isChat && (
            <button
              className="button button-primary"
              onClick={onDraftPlan}
              disabled={disabled || drafting}
            >
              {drafting ? "Drafting…" : "Draft the plan"}
            </button>
          )}
          <div className="session-info">
            <span className="pulse" />
            {agent.codexThreadId ? "Session connected" : "New session"}
          </div>
        </div>
      </div>

      <div className="messages">
        {visibleMessages.length === 0 && !activeRun ? (
          <div className="welcome">
            <div className="welcome-orbit">
              <div>⌁</div>
            </div>
            <h3>{isChat ? "What should this Job accomplish?" : "What should " + agent.name + " build?"}</h3>
            <p>
              {isChat
                ? "Describe the task, ask questions, and refine it together. When you're ready, click " +
                  "“Draft the plan” to see an ordered Plan and proposed cast — nothing runs until you approve it."
                : "The Agent can inspect files, write code, run commands, and continue the same " +
                  "Codex session across messages."}
            </p>
            {!isChat && (
              <div className="prompt-grid">
                {starterPrompts.map((item) => (
                  <button key={item} onClick={() => setPrompt(item)}>
                    <span>↗</span>
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          visibleMessages.map((message) => {
            if (message.role === "user") {
              return (
                <article className="message message-user" key={message.id}>
                  <div className="message-meta">
                    <strong>You</strong>
                    <span>{formatTime(message.createdAt)}</span>
                  </div>
                  <div className="message-body">{message.content}</div>
                </article>
              );
            }

            // The one gate: an assistant reply is only ever shown as raw text
            // when it does not parse as JSON at all. Anything JSON-shaped is
            // either a Plan Card or a clean notice — never the raw text.
            const parsed = classifyReply(message.content);
            return (
              <article className="message message-assistant" key={message.id}>
                <div className="message-meta">
                  <strong>{agent.name}</strong>
                  <span>{formatTime(message.createdAt)}</span>
                </div>
                {parsed.kind === "text" && <div className="message-body">{message.content}</div>}
                {parsed.kind === "plan" && (
                  <PlanCard
                    draft={parsed.draft}
                    agents={agents}
                    approving={approvingPlanFor === message.id}
                    onApprove={() => onApprovePlan(parsed.draft, message.id)}
                  />
                )}
                {parsed.kind === "invalid-plan-attempt" && (
                  <div className="plan-card plan-card-invalid">
                    <strong>The drafted plan wasn't in the expected shape.</strong>
                    <p>Ask {agent.name} to fix it, or describe the task differently and try again.</p>
                  </div>
                )}
              </article>
            );
          })
        )}
        {running && (
          <article className="message message-assistant thinking">
            <div className="message-meta">
              <strong>{agent.name}</strong>
              <span>{isChat ? "thinking" : "working in the Agent workspace"}</span>
            </div>
            <div className="thinking-row">
              <Spinner />
              {isChat ? "Thinking…" : "Codex is reading, editing, or running commands…"}
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
              : isChat
                ? "Describe the task, or give feedback on the plan…"
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
