import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Agent, CoordinationEvent, Job, JobMessage } from "../../types";
import { JobEventLog } from "./JobEventLog";
import { JobStatusBadge } from "./JobStatusBadge";
import { JobStepIndicator } from "./JobStepIndicator";
import { JobTranscript } from "./JobTranscript";

const POLL_MS = 2000;

/**
 * List + detail only — a Job itself is created by approving a drafted Plan
 * from a chat (App.tsx's approvePlan), not from this screen. `focusJobId` is
 * how App hands off "select the Job that was just approved"; JobScreen calls
 * onFocusHandled() once it has consumed it, so App doesn't keep re-selecting
 * it after the user picks something else.
 */
export function JobScreen({
  agents,
  focusJobId,
  onFocusHandled,
}: {
  agents: Agent[];
  focusJobId: string | null;
  onFocusHandled: () => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [events, setEvents] = useState<CoordinationEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshList = async () => {
    try {
      const { jobs: next } = await api.listJobs();
      if (mountedRef.current) setJobs(next);
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void refreshList();
  }, []);

  useEffect(() => {
    if (focusJobId) {
      setSelectedId(focusJobId);
      void refreshList();
      onFocusHandled();
    }
  }, [focusJobId, onFocusHandled]);

  const job = jobs.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setEvents([]);
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const [jobResult, messagesResult, eventsResult] = await Promise.all([
          api.getJob(selectedId),
          api.getJobMessages(selectedId),
          api.getJobEvents(selectedId),
        ]);
        if (cancelled || selectedIdRef.current !== selectedId) return;
        setMessages(messagesResult.messages);
        setEvents(eventsResult.events);
        setJobs((current) => current.map((item) => (item.id === selectedId ? jobResult.job : item)));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    void poll();
    const active = job && (job.status === "pending" || job.status === "running");
    if (!active) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // job.status is read only to decide whether to keep polling — selectedId already retriggers this effect.
  }, [selectedId, job?.status]);

  const cancelJob = async () => {
    if (!job) return;
    try {
      const { job: updated } = await api.cancelJob(job.id);
      if (mountedRef.current) setJobs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="job-screen">
      <div className="job-screen-topbar">
        <div>
          <span className="eyebrow">Jobs</span>
          <h2>What your Agents have built</h2>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="job-screen-body">
        <nav className="job-list">
          {jobs.map((item) => (
            <button
              key={item.id}
              className={"job-list-item " + (item.id === selectedId ? "selected" : "")}
              onClick={() => setSelectedId(item.id)}
            >
              <strong>{item.name}</strong>
              <JobStatusBadge status={item.status} haltedReason={null} />
            </button>
          ))}
          {jobs.length === 0 && (
            <div className="empty-sidebar">
              <span>◇</span>
              No Jobs yet — start a chat, draft a plan, and approve it to see one here.
            </div>
          )}
        </nav>

        <div className="job-detail">
          {job ? (
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
          ) : (
            <div className="empty-sidebar job-detail-empty">
              <span>◇</span>
              Select a Job to see its progress.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
