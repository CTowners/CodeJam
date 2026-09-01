import { api } from "../../api";
import type { ChatWork } from "../../lib/chat-work";
import { DEFAULT_CHAT_KEY } from "../../lib/chat-work";
import type { Agent } from "../../types";
import { DraftReview } from "./DraftReview";
import { JobComposer } from "./JobComposer";
import { JobEventLog } from "./JobEventLog";
import { JobStatusBadge } from "./JobStatusBadge";
import { JobStepIndicator } from "./JobStepIndicator";
import { JobTranscript } from "./JobTranscript";

const POLL_MS = 2000;

export function JobScreen({
  agents,
  chatId,
  chatWork,
}: {
  agents: Agent[];
  chatId?: string;
  /** Held above this component so switching Agents or tabs cannot destroy it. */
  chatWork: ChatWork;
}) {
  const key = chatId ?? DEFAULT_CHAT_KEY;
  const state = chatWork.get(key);

  /**
   * Writes against the chat that owns the work, not whichever chat happens to be
   * on screen when the response lands — so a draft that finishes after you switch
   * away still updates its own chat instead of leaking into the visible one.
   */
  const patch = chatWork.patch;

  const submitTask = async (input: { name: string; task: string }) => {
    const chatKey = key;
    const forChat = chatId;
    patch(chatKey, { drafting: true, error: null, name: input.name, task: input.task });
    try {
      // An empty name is omitted rather than sent: the field is optional, and an
      // empty string fails the server's minimum-length check with a 400.
      const selected = state.selectedAgentIds;
      const nextDraft = await api.draftJob({
        ...(input.name ? { name: input.name } : {}),
        task: input.task,
        ...(forChat ? { chatId: forChat } : {}),
        ...(selected ? { agentIds: selected } : {}),
      });
      patch(chatKey, { draft: nextDraft });
    } catch (reason) {
      patch(chatKey, { error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      patch(chatKey, { drafting: false });
    }
  };

  const discardDraft = () => patch(key, { draft: null, error: null });

  /**
   * Re-drafts in place. The draft id is stable, so this can be repeated until the
   * plan is right — and since nothing is created before approval, it costs only a
   * planning turn.
   */
  const reviseDraft = async (feedback: string) => {
    const chatKey = key;
    const pending = state.draft;
    if (!pending) return;
    patch(chatKey, { revising: true, error: null });
    try {
      const revised = await api.reviseDraft(pending.draftId, feedback);
      patch(chatKey, { draft: revised });
    } catch (reason) {
      patch(chatKey, { error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      patch(chatKey, { revising: false });
    }
  };

  const approve = async () => {
    const chatKey = key;
    const pending = state.draft;
    if (!pending) return;
    patch(chatKey, { approving: true, error: null });
    try {
      const { job: created } = await api.approveDraft(pending.draftId);
      patch(chatKey, { draft: null, job: created, messages: [], events: [], name: "", task: "" });
    } catch (reason) {
      patch(chatKey, { error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      patch(chatKey, { approving: false });
    }
  };

  const cancelJob = async () => {
    const chatKey = key;
    const running = state.job;
    if (!running) return;
    try {
      const { job: updated } = await api.cancelJob(running.id);
      patch(chatKey, { job: updated });
    } catch (reason) {
      patch(chatKey, { error: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  const startOver = () =>
    patch(key, { job: null, messages: [], events: [], error: null, name: "", task: "" });

  const { draft, job, messages, events, error, drafting, approving, revising } = state;

  return (
    <section className="job-screen">
      <div className="job-screen-topbar">
        <div>
          <span className="eyebrow">Jobs</span>
          <h2>Coordinate a team of Agents</h2>
        </div>
        {job && (
          <button className="button button-ghost" onClick={startOver}>
            Start a new Job
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => patch(key, { error: null })}>×</button>
        </div>
      )}

      {!job && !draft && drafting && (
        <div className="drafting-panel">
          <div className="drafting-orbit" aria-hidden="true">
            ⌁
          </div>
          <h3>Drafting a plan…</h3>
          <p>
            The Chat is breaking this into steps and choosing which Agent plays each
            one. Nothing runs yet — you review and approve the plan first.
          </p>
          <p className="drafting-task">“{state.task}”</p>
        </div>
      )}

      {!job && !draft && !drafting && (
        <JobComposer
          busy={drafting}
          name={state.name}
          task={state.task}
          agents={agents}
          selectedAgentIds={state.selectedAgentIds}
          onChange={(changes) => patch(key, changes)}
          onSubmit={submitTask}
        />
      )}

      {!job && draft && (
        <DraftReview
          draft={draft}
          agents={agents}
          busy={approving}
          revising={revising}
          onApprove={approve}
          onDiscard={discardDraft}
          onRevise={reviseDraft}
        />
      )}

      {job && (
        <div className="job-run">
          <div className="job-run-header">
            <div>
              <h3>{job.name}</h3>
              <p className="job-task">{job.task}</p>
            </div>
            <div className="job-run-header-actions">
              <JobStatusBadge status={job.status} haltedReason={job.haltedReason} />
              {(job.status === "pending" || job.status === "running") && (
                <button className="button button-danger" onClick={cancelJob}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          <JobStepIndicator events={events} plan={job.plan} agents={agents} />

          <div className="job-run-body">
            <JobTranscript messages={messages} agents={agents} />
            <JobEventLog events={events} plan={job.plan} agents={agents} />
          </div>
        </div>
      )}
    </section>
  );
}
