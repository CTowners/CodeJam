import type { Agent, DraftedPlan } from "../types";

/**
 * An assistant reply that parsed as a valid drafted Plan — rendered inline
 * instead of raw JSON. No Approve button: running it is just saying so in
 * the chat (App.tsx's sendMessage detects an affirmative reply to a plan
 * card and calls the same approvePlan path a click used to).
 */
export function PlanCard({ draft, agents }: { draft: DraftedPlan; agents: Agent[] }) {
  const agentName = (id: string): string => agents.find((agent) => agent.id === id)?.name ?? "an unknown Agent";

  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <span className="eyebrow">Drafted Plan</span>
        <span className="plan-card-hint">Say the word — “yes”, “go ahead” — to run it</span>
      </div>

      <ol className="plan-steps">
        {draft.plan.steps.map((step, index) => {
          const proposal = draft.castByRole[step.role];
          return (
            <li key={step.id} className="plan-step">
              <div className="plan-step-heading">
                <span className="plan-step-number">Step {index + 1}</span>
                <span className="role-chip">{step.role}</span>
              </div>

              <div className="plan-step-assignee">
                {proposal?.kind === "existing" && (
                  <>
                    <span className="assignee-label">Assigned to</span>
                    <span className="cast-chip cast-existing">{agentName(proposal.agentId)}</span>
                  </>
                )}
                {proposal?.kind === "new" && (
                  <>
                    <span className="assignee-label">Will create a new Agent</span>
                    <span className="cast-chip cast-new">{proposal.name}</span>
                  </>
                )}
                {!proposal && (
                  <>
                    <span className="assignee-label">No Agent assigned</span>
                    <span className="cast-chip cast-missing">Unassigned</span>
                  </>
                )}
              </div>

              <p className="plan-step-instruction">{step.instruction}</p>

              {(step.needs.length > 0 || step.produces.length > 0) && (
                <dl className="plan-step-files">
                  {step.needs.length > 0 && (
                    <div>
                      <dt>Needs</dt>
                      <dd>{step.needs.join(", ")}</dd>
                    </div>
                  )}
                  {step.produces.length > 0 && (
                    <div>
                      <dt>Produces</dt>
                      <dd>{step.produces.join(", ")}</dd>
                    </div>
                  )}
                </dl>
              )}

              {proposal?.kind === "new" && (
                <p className="plan-step-new-instructions">New Agent instructions: {proposal.instructions}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
