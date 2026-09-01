import { useState } from "react";
import type { Agent, JobDraft } from "../../types";

export function DraftReview({
  draft,
  agents,
  busy,
  revising,
  onApprove,
  onDiscard,
  onRevise,
}: {
  draft: JobDraft;
  agents: Agent[];
  busy: boolean;
  revising: boolean;
  onApprove: () => void;
  onDiscard: () => void;
  onRevise: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const unsentFeedback = feedback.trim().length > 0;
  const agentName = (id: string): string => agents.find((agent) => agent.id === id)?.name ?? id;

  return (
    <div className="draft-review">
      <div className="draft-review-header">
        <div>
          <span className="eyebrow">
            Drafted Plan
            {draft.revision > 0 && (
              <span className="revision-chip">revised ×{draft.revision}</span>
            )}
          </span>
          <h2>{draft.name}</h2>
        </div>
        <div className="draft-review-actions">
          <button className="button button-ghost" onClick={onDiscard} disabled={busy || revising}>
            Discard
          </button>
          <button
            className="button button-primary"
            onClick={onApprove}
            disabled={busy || revising || unsentFeedback}
            title={unsentFeedback ? "Send or clear your changes first" : undefined}
          >
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

      {/* Revising re-drafts in place: still nothing created, so it costs only a
          planning turn and can be repeated until the plan is right. */}
      <form
        className="draft-revise"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = feedback.trim();
          if (!trimmed) return;
          onRevise(trimmed);
          setFeedback("");
        }}
      >
        <label>
          <span className="draft-revise-title">Not quite right?</span>
          <span className="draft-revise-help">
            Describe what to change and the Chat re-drafts the whole plan with your
            changes applied, keeping the parts you did not mention. Nothing has been
            created yet, so you can revise as many times as you like.
          </span>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="e.g. split the research into four angles instead of two, and drop the review step"
            rows={2}
            disabled={busy || revising}
          />
        </label>
        <div className="draft-revise-actions">
          <button className="button button-primary" disabled={!unsentFeedback || busy || revising}>
            {revising ? "Revising…" : "Revise Plan"}
          </button>
          {unsentFeedback && !revising && (
            <span className="draft-revise-pending">
              Not applied yet — press Revise Plan, or clear the box to approve as-is.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
