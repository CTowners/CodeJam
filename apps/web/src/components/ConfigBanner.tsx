import type { SystemInfo } from "../types";

export function ConfigBanner({ system }: { system: SystemInfo | null }) {
  if (system?.arkConfigured && system?.codexAvailable) return null;
  return (
    <div className="config-banner">
      <span>!</span>
      <div>
        <strong>Runtime configuration needed</strong>
        <p>
          {!system?.arkConfigured
            ? "Set ARK_API_KEY and ARK_MODEL in .env before using the Playground."
            : system.runtimeProvider === "container"
              ? "The local container engine or Agent Runtime image is unavailable. Rerun npm run poc."
              : "Codex CLI was not found. Use the Docker image or install @openai/codex."}
        </p>
      </div>
    </div>
  );
}
