import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Agent, CoordinationEvent, Job, JobDraft, JobMessage } from "../../types";
import { DraftReview } from "./DraftReview";
import { JobComposer } from "./JobComposer";
import { JobEventLog } from "./JobEventLog";
import { JobStatusBadge } from "./JobStatusBadge";
import { JobStepIndicator } from "./JobStepIndicator";
import { JobTranscript } from "./JobTranscript";

const POLL_MS = 2000;

export function JobScreen({ agents }: { agents: Agent[] }) {
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [approving, setApproving] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [events, setEvents] = useState<CoordinationEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submitTask = async (input: { name: string; task: string }) => {
    setDrafting(true);
    setError(null);
    try {
      const nextDraft = await api.draftJob(input);
      if (mountedRef.current) setDraft(nextDraft);
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mountedRef.current) setDrafting(false);
    }
  };

  const discardDraft = () => {
    setDraft(null);
    setError(null);
  };

  const approve = async () => {
    if (!draft) return;
    setApproving(true);
    setError(null);
    try {
      const { job: created } = await api.approveDraft(draft.draftId);
      if (!mountedRef.current) return;
      setDraft(null);
      jobIdRef.current = created.id;
      setJob(created);
      setMessages([]);
      setEvents([]);
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mountedRef.current) setApproving(false);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    try {
      const { job: updated } = await api.cancelJob(job.id);
      if (mountedRef.current && jobIdRef.current === job.id) setJob(updated);
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const startOver = () => {
    jobIdRef.current = null;
    setJob(null);
    setMessages([]);
    setEvents([]);
    setError(null);
  };

  useEffect(() => {
    if (!job || (job.status !== "pending" && job.status !== "running")) {
      return;
    }
    let cancelled = false;
    const id = job.id;

    const poll = async () => {
      try {
        const [jobResult, messagesResult, eventsResult] = await Promise.all([
          api.getJob(id),
          api.getJobMessages(id),
          api.getJobEvents(id),
        ]);
        if (cancelled || jobIdRef.current !== id) return;
        setJob(jobResult.job);
        setMessages(messagesResult.messages);
        setEvents(eventsResult.events);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status]);

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
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {!job && !draft && <JobComposer busy={drafting} onSubmit={submitTask} />}

      {!job && draft && (
        <DraftReview draft={draft} agents={agents} busy={approving} onApprove={approve} onDiscard={discardDraft} />
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
