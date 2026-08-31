export function EmptyAgentState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="no-agent">
      <div className="no-agent-art">A</div>
      <span className="eyebrow">Agent Launchpad</span>
      <h1>Your runtime is ready for an Agent.</h1>
      <p>Create a workspace, give Codex a job, and continue the conversation here.</p>
      <button className="button button-primary" onClick={onCreateClick}>
        Create your first Agent
      </button>
    </div>
  );
}
