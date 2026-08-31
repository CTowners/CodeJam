import type { Agent, CoordinationEvent, Plan } from "../../types";

/**
 * A Step is "working now" when the latest event recorded for it is turn_started
 * with nothing terminal after it yet — Contracts.ts's event log is the only
 * source of truth for Step state, there's no separate status field to read.
 */
export function JobStepIndicator({
  events,
  plan,
  agents,
}: {
  events: CoordinationEvent[];
  plan: Plan;
  agents: Agent[];
}) {
  const lastEventByStep = new Map<string, CoordinationEvent>();
  for (const event of events) {
    if (event.stepId) lastEventByStep.set(event.stepId, event);
  }
  const inFlight = [...lastEventByStep.values()].filter((event) => event.type === "turn_started");

  if (inFlight.length === 0) return null;

  const roleFor = (stepId: string): string => plan.steps.find((step) => step.id === stepId)?.role ?? stepId;
  const agentName = (id: string | null): string =>
    id ? (agents.find((agent) => agent.id === id)?.name ?? id) : "—";

  return (
    <div className="job-step-indicator">
      <span className="eyebrow">Working now</span>
      <ul>
        {inFlight.map((event) => (
          <li key={event.stepId}>
            <span className="pulse" />
            {roleFor(event.stepId!)} · {agentName(event.agentId)}
          </li>
        ))}
      </ul>
    </div>
  );
}
