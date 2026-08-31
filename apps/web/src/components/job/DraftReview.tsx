import type { Agent, JobDraft } from "../../types";

export function DraftReview({
  draft,
  agents,
  busy,
  onApprove,
  onDiscard,
}: {
  draft: JobDraft;
  agents: Agent[];
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const agentName = (id: string): string => agents.find((agent) => agent.id === id)?.name ?? id;

  return (
    <div className="draft-review">
      <div className="draft-review-header">
        <div>
          <span className="eyebrow">Drafted Plan</span>
          <h2>{draft.name}</h2>
        </div>
        <div className="draft-review-actions">
          <button className="button button-ghost" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
          <button className="button button-primary" onClick={onApprove} disabled={busy}>
            {busy ? "Approving…" : "Approve & Run"}
          </button>
        </div>
      </div>

      <p className="draft-review-hint">
        Approving runs the whole Plan below — nothing executes until you do. Reassigning a Step or
        revising the Plan by chat isn't wired up yet in this build; discard and redraft with a
        clarified task instead.
      </p>

      <ol className="plan-steps">
        {draft.draft.plan.steps.map((step) => {
          const proposal = draft.draft.castByRole[step.role];
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
                <p className="plan-step-new-instructions">
                  New Agent instructions: {proposal.instructions}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
