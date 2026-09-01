import type { Agent, DraftedPlan } from "../types";

/** An assistant reply that parsed as a valid drafted Plan — rendered inline instead of raw JSON. */
export function PlanCard({
  draft,
  agents,
  approving,
  onApprove,
}: {
  draft: DraftedPlan;
  agents: Agent[];
  approving: boolean;
  onApprove: () => void;
}) {
  const agentName = (id: string): string => agents.find((agent) => agent.id === id)?.name ?? id;

  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <span className="eyebrow">Drafted Plan</span>
        <button className="button button-primary" onClick={onApprove} disabled={approving}>
          {approving ? "Approving…" : "Approve & Run"}
        </button>
      </div>

      <ol className="plan-steps">
        {draft.plan.steps.map((step) => {
          const proposal = draft.castByRole[step.role];
          return (
            <li key={step.id} className="plan-step">
              <div className="plan-step-role">
                <span className="role-chip">{step.role}</span>
                {proposal?.kind === "existing" && (
                  <span className="cast-chip cast-existing">{agentName(proposal.agentId)}</span>
                )}
                {proposal?.kind === "new" && (
                  <span className="cast-chip cast-new">New Agent: {proposal.name}</span>
                )}
                {!proposal && <span className="cast-chip cast-missing">Unassigned</span>}
              </div>
              <p className="plan-step-instruction">{step.instruction}</p>
              {(step.needs.length > 0 || step.produces.length > 0) && (
                <div className="plan-step-files">
                  {step.needs.length > 0 && <span>needs: {step.needs.join(", ")}</span>}
                  {step.produces.length > 0 && <span>produces: {step.produces.join(", ")}</span>}
                </div>
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
