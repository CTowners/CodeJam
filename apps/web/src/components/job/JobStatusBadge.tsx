import type { JobStatus } from "../../types";

const labels: Record<JobStatus, string> = {
  pending: "Queued",
  running: "Running",
  completed: "Completed",
  halted: "Halted",
};

const pillVariant: Record<JobStatus, string> = {
  pending: "status-busy",
  running: "status-busy",
  completed: "status-ready",
  halted: "status-error",
};

export function JobStatusBadge({
  status,
  haltedReason,
}: {
  status: JobStatus;
  haltedReason: string | null;
}) {
  return (
    <div className="job-status">
      <span className={"status " + pillVariant[status]}>
        <span className="status-dot" />
        {labels[status]}
      </span>
      {haltedReason && <span className="job-halted-reason">{haltedReason}</span>}
    </div>
  );
}
