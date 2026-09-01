import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CoordinationEvent, Job, JobDraft, JobMessage } from "../types";

const POLL_MS = 2000;

/**
 * What one chat is in the middle of.
 *
 * This lives at the top of the app, not inside the Job screen, because that
 * screen unmounts whenever you select a different Agent or switch tabs — and an
 * unmount was destroying half-typed requests and drafts already in flight.
 * Holding it above that boundary means switching away is just a change of view.
 */
export interface ChatState {
  name: string;
  task: string;
  /** null means every one of Your Agents is available for casting. */
  selectedAgentIds: string[] | null;
  drafting: boolean;
  revising: boolean;
  draft: JobDraft | null;
  approving: boolean;
  job: Job | null;
  messages: JobMessage[];
  events: CoordinationEvent[];
  error: string | null;
}

export const emptyChatState = (): ChatState => ({
  name: "",
  task: "",
  selectedAgentIds: null,
  drafting: false,
  revising: false,
  draft: null,
  approving: false,
  job: null,
  messages: [],
  events: [],
  error: null,
});

/** The Jobs tab has no chat of its own, so it shares one bucket. */
export const DEFAULT_CHAT_KEY = "__all__";

const STORAGE_KEY = "launchpad.chat-work.v1";

/**
 * Transcripts and event logs are re-fetched by polling, so they are left out of
 * storage — they are the bulky part, and persisting them would risk blowing the
 * quota to save something we reload anyway.
 */
type StoredChatState = Omit<ChatState, "messages" | "events">;

function load(): Record<string, ChatState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredChatState>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        { ...emptyChatState(), ...value, messages: [], events: [] },
      ]),
    );
  } catch {
    // A corrupt or unavailable store must never stop the app from rendering.
    return {};
  }
}

function save(state: Record<string, ChatState>): void {
  try {
    const stripped = Object.fromEntries(
      Object.entries(state).map(([key, value]) => {
        const { messages: _messages, events: _events, ...rest } = value;
        return [key, rest];
      }),
    );
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
  } catch {
    // Storage being full or blocked is not worth failing a render over.
  }
}

export interface ChatWork {
  get: (key: string) => ChatState;
  patch: (key: string, changes: Partial<ChatState>) => void;
  /** Chats with a Job still in flight, so polling can follow them from the top. */
  activeJobs: { key: string; jobId: string }[];
}

export function useChatWork(): ChatWork {
  const [byChat, setByChat] = useState<Record<string, ChatState>>(load);

  useEffect(() => {
    save(byChat);
  }, [byChat]);

  const patch = useCallback((key: string, changes: Partial<ChatState>) => {
    setByChat((prior) => ({
      ...prior,
      [key]: { ...(prior[key] ?? emptyChatState()), ...changes },
    }));
  }, []);

  const get = useCallback((key: string) => byChat[key] ?? emptyChatState(), [byChat]);

  const activeJobs = Object.entries(byChat)
    .filter(([, value]) => value.job && (value.job.status === "pending" || value.job.status === "running"))
    .map(([key, value]) => ({ key, jobId: value.job!.id }));

  return { get, patch, activeJobs };
}

/**
 * Follows every running Job, not just the one on screen. Mounted once at the top
 * of the app, so a Job keeps advancing while the user is on another Agent — and
 * coming back shows current state rather than a frozen snapshot.
 */
export function useJobPolling(chatWork: ChatWork): void {
  const signature = chatWork.activeJobs.map((entry) => entry.key + ":" + entry.jobId).join(",");
  const { patch } = chatWork;

  useEffect(() => {
    if (!signature) return;
    const entries = signature.split(",").map((part) => {
      const separator = part.lastIndexOf(":");
      return { key: part.slice(0, separator), jobId: part.slice(separator + 1) };
    });
    let cancelled = false;

    const poll = async () => {
      await Promise.all(
        entries.map(async ({ key, jobId }) => {
          try {
            const [jobResult, messagesResult, eventsResult] = await Promise.all([
              api.getJob(jobId),
              api.getJobMessages(jobId),
              api.getJobEvents(jobId),
            ]);
            if (cancelled) return;
            patch(key, {
              job: jobResult.job,
              messages: messagesResult.messages,
              events: eventsResult.events,
            });
          } catch (reason) {
            if (!cancelled) {
              patch(key, { error: reason instanceof Error ? reason.message : String(reason) });
            }
          }
        }),
      );
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [signature, patch]);
}
