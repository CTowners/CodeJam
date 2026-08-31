import type {
  Agent,
  AgentRun,
  CoordinationEvent,
  Job,
  JobDraft,
  JobMessage,
  Message,
  SystemInfo,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let authToken = "";

export function setAuthToken(token: string): void {
  authToken = token.trim();
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
    ...options?.headers,
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data;
}

export const api = {
  auth: () => request<{ required: boolean }>("/api/auth"),
  system: () => request<SystemInfo>("/api/system"),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  createAgent: (body: {
    name: string;
    description: string;
    instructions: string;
  }) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (
    id: string,
    body: { name: string; description: string; instructions: string },
  ) =>
    request<{ agent: Agent }>("/api/agents/" + id, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<{ archivedWorkspace: string }>("/api/agents/" + id, {
      method: "DELETE",
    }),
  startAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/start", {
      method: "POST",
    }),
  stopAgent: (id: string) =>
    request<{ agent: Agent }>("/api/agents/" + id + "/stop", {
      method: "POST",
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>("/api/agents/" + id + "/messages"),
  runs: (id: string) =>
    request<{ runs: AgentRun[] }>("/api/agents/" + id + "/runs"),
  sendMessage: (id: string, content: string) =>
    request<{ run: AgentRun; message: Message }>(
      "/api/agents/" + id + "/messages",
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    ),
  run: (id: string) => request<{ run: AgentRun }>("/api/runs/" + id),
  draftJob: (body: { name?: string; task: string }) =>
    request<JobDraft>("/api/jobs/draft", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getDraft: (draftId: string) => request<JobDraft>("/api/jobs/drafts/" + draftId),
  approveDraft: (draftId: string) =>
    request<{ job: Job }>("/api/jobs/drafts/" + draftId + "/approve", {
      method: "POST",
    }),
  listJobs: () => request<{ jobs: Job[] }>("/api/jobs"),
  getJob: (id: string) => request<{ job: Job }>("/api/jobs/" + id),
  getJobMessages: (id: string) => request<{ messages: JobMessage[] }>("/api/jobs/" + id + "/messages"),
  getJobEvents: (id: string) => request<{ events: CoordinationEvent[] }>("/api/jobs/" + id + "/events"),
  cancelJob: (id: string) =>
    request<{ job: Job }>("/api/jobs/" + id + "/cancel", { method: "POST" }),
};
