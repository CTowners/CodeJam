import type { Agent, JobMessage } from "../../types";
import { formatTime } from "../../lib/format";

export function JobTranscript({ messages, agents }: { messages: JobMessage[]; agents: Agent[] }) {
  const agentName = (id: string): string => agents.find((agent) => agent.id === id)?.name ?? id;

  if (messages.length === 0) {
    return <p className="job-transcript-empty">No turns yet.</p>;
  }

  return (
    <div className="job-transcript">
      {messages.map((message) => (
        <article className="message job-message" key={message.id}>
          <div className="message-meta">
            <strong>{message.role}</strong>
            <span>
              {agentName(message.agentId)} · turn {message.turn}
            </span>
            <span>{formatTime(message.createdAt)}</span>
          </div>
          <div className="message-body">{message.content}</div>
        </article>
      ))}
    </div>
  );
}
