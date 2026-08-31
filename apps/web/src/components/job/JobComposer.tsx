import { useState } from "react";

export function JobComposer({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: { name: string; task: string }) => void;
}) {
  const [name, setName] = useState("");
  const [task, setTask] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = task.trim();
    if (!trimmed) return;
    onSubmit({ name: name.trim(), task: trimmed });
  };

  return (
    <form className="job-composer" onSubmit={submit}>
      <div className="welcome">
        <div className="welcome-orbit">
          <div>⌁</div>
        </div>
        <h3>What should the team of Agents build?</h3>
        <p>
          The Orchestrator drafts an ordered Plan and proposes which Agent plays each Step —
          nothing runs until you approve it.
        </p>
      </div>

      <label>
        Job name (optional)
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Add a search endpoint"
          disabled={busy}
        />
      </label>
      <label>
        Task for the Orchestrator
        <textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder="Describe what you want the team of Agents to build…"
          rows={4}
          disabled={busy}
        />
      </label>
      <button className="button button-primary" disabled={!task.trim() || busy}>
        {busy ? "Drafting…" : "Draft Plan"}
      </button>
    </form>
  );
}
