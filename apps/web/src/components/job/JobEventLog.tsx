import type { Agent, CoordinationEvent, CoordinationEventType, Plan } from "../../types";
import { formatTime } from "../../lib/format";

const eventLabels: Record<CoordinationEventType, string> = {
  job_started: "Job started",
  turn_started: "Turn started",
  turn_completed: "Turn completed",
  turn_rejected: "Turn rejected",
  turn_timeout: "Turn timed out",
  turn_retried: "Retrying",
  files_copied_in: "Files staged in",
  files_copied_out: "Files staged out",
  job_completed: "Job completed",
  job_halted: "Job halted",
};

/** Compact audit strip — this is what makes the failure/retry/halt path visible, not just a toggle. */
export function JobEventLog({
  events,
  plan,
  agents,
}: {
  events: CoordinationEvent[];
  plan: Plan;
  agents: Agent[];
}) {
  const roleFor = (stepId: string | null): string | null =>
    stepId ? (plan.steps.find((step) => step.id === stepId)?.role ?? stepId) : null;
  const agentName = (id: string | null): string | null =>
    id ? (agents.find((agent) => agent.id === id)?.name ?? id) : null;

  return (
    <div className="job-event-log">
      <span className="eyebrow">Event log</span>
      {events.length === 0 ? (
        <p className="job-event-log-empty">No events yet.</p>
      ) : (
        <ul>
          {[...events].reverse().map((event) => (
            <li key={event.id} className={"event-row event-" + event.type}>
              <span className="event-time">{formatTime(event.createdAt)}</span>
              <span className="event-label">{eventLabels[event.type] ?? event.type}</span>
              {roleFor(event.stepId) && <span className="event-role">{roleFor(event.stepId)}</span>}
              {agentName(event.agentId) && <span className="event-agent">{agentName(event.agentId)}</span>}
              {event.detail && <span className="event-detail">{event.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
