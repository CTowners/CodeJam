import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, setAuthToken } from "./api";
import type { Agent, AgentFormValues, AgentRun, Message, SystemInfo } from "./types";
import { AuthGate, ConnectingScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { ConfigBanner } from "./components/ConfigBanner";
import { AgentHeader } from "./components/AgentHeader";
import { SettingsPanel } from "./components/SettingsPanel";
import { Playground } from "./components/Playground";
import { CreateAgentModal } from "./components/CreateAgentModal";
import { EmptyAgentState } from "./components/EmptyAgentState";
import { JobScreen } from "./components/job/JobScreen";
import { useChatWork, useJobPolling } from "./lib/chat-work";

type View = "playground" | "jobs";

const emptyForm: AgentFormValues = {
  name: "",
  description: "",
  instructions:
    "Help me build and test software in this workspace. Keep changes small and explain the result.",
};

export default function App() {
  const [view, setView] = useState<View>("playground");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Lives here, above every view switch, so tabbing away never discards a chat's
  // half-written request or an in-flight draft.
  const chatWork = useChatWork();
  useJobPolling(chatWork);

  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState<AgentFormValues>(emptyForm);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [authInput, setAuthInput] = useState("");
  const selectedIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const pollingRunIds = useRef(new Set<string>());
  selectedIdRef.current = selectedId;

  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId],
  );

  const refreshAgents = useCallback(async () => {
    const { agents: next } = await api.listAgents();
    setAgents(next);
    setSelectedId((current) =>
      current && next.some((agent) => agent.id === current)
        ? current
        : (next[0]?.id ?? null),
    );
  }, []);

  const refreshMessages = useCallback(async (agentId: string) => {
    const result = await api.messages(agentId);
    if (mountedRef.current && selectedIdRef.current === agentId) {
      setMessages(result.messages);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    await Promise.all([refreshAgents(), api.system().then(setSystem)]);
  }, [refreshAgents]);

  // Approving a Plan spawns a subagent per role, server-side, mid-run. Without
  // this the sidebar only picked them up on the next action the user happened to
  // take, so a Chat looked empty while its subagents were already working.
  const jobsRunning = chatWork.activeJobs.length > 0;
  useEffect(() => {
    if (!jobsRunning) return;
    const timer = window.setInterval(() => void refreshAgents(), 2000);
    return () => window.clearInterval(timer);
  }, [jobsRunning, refreshAgents]);


  useEffect(() => {
    mountedRef.current = true;
    void api
      .auth()
      .then(async ({ required }) => {
        if (!mountedRef.current) return;
        setAuthRequired(required);
        if (!required) await bootstrap();
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      mountedRef.current = false;
    };
  }, [bootstrap]);

  useEffect(() => {
    setActiveRun(null);
    setShowSettings(false);
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void Promise.all([refreshMessages(selectedId), api.runs(selectedId)])
      .then(([, result]) => {
        if (selectedIdRef.current !== selectedId) return;
        const latest = result.runs[0] ?? null;
        setActiveRun(latest);
        if (latest && ["queued", "running"].includes(latest.status)) {
          void pollRun(latest.id, selectedId).catch((reason) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          );
        }
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [refreshMessages, selectedId]);

  useEffect(() => {
    if (selected) {
      setForm({
        name: selected.name,
        description: selected.description,
        instructions: selected.instructions,
      });
    }
  }, [selected]);

  /**
   * A Chat needs no configuring — it is a conversation, not a specialist — so it
   * is created directly rather than through the Agent form. Its instructions are
   * set server-side; the user only names it.
   */
  const createChat = async () => {
    setBusy(true);
    setError(null);
    try {
      const existing = agents.filter((agent) => agent.kind === "chat").length;
      const { agent } = await api.createAgent({
        name: existing === 0 ? "Chat" : `Chat ${existing + 1}`,
        description: "Where you ask for work. Plans it, and fans it out to Agents.",
        // Deliberately blank: the server owns a chat's instructions.
        instructions: "",
        kind: "chat",
      });
      await refreshAgents();
      setSelectedId(agent.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const createAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { agent } = await api.createAgent(form);
      await refreshAgents();
      setSelectedId(agent.id);
      setShowCreate(false);
      setForm(emptyForm);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateAgent(selected.id, form);
      await refreshAgents();
      setShowSettings(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggleAgent = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (selected.status === "stopped") {
        await api.startAgent(selected.id);
      } else {
        await api.stopAgent(selected.id);
      }
      await refreshAgents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const deleteAgent = async () => {
    if (!selected) return;
    if (!window.confirm("Delete " + selected.name + "? Its workspace will be archived.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteAgent(selected.id);
      await refreshAgents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const pollRun = async (runId: string, agentId: string) => {
    if (pollingRunIds.current.has(runId)) return;
    pollingRunIds.current.add(runId);
    try {
      while (mountedRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        if (!mountedRef.current) return;
        const result = await api.run(runId);
        if (selectedIdRef.current === agentId) setActiveRun(result.run);
        if (!["queued", "running"].includes(result.run.status)) {
          await Promise.all([refreshMessages(agentId), refreshAgents()]);
          return;
        }
      }
    } finally {
      pollingRunIds.current.delete(runId);
    }
  };

  const sendMessage = async (content: string) => {
    if (!selected) return;
    setError(null);
    try {
      const result = await api.sendMessage(selected.id, content);
      if (selectedIdRef.current === selected.id) {
        setMessages((current) => [...current, result.message]);
        setActiveRun(result.run);
      }
      setAgents((current) =>
        current.map((agent) =>
          agent.id === selected.id ? { ...agent, status: "busy" } : agent,
        ),
      );
      await pollRun(result.run.id, selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setActiveRun(null);
      await refreshAgents();
    }
  };

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAuthToken(authInput);
    try {
      await bootstrap();
      setAuthRequired(false);
      setAuthInput("");
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setError("The access token is not valid.");
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  if (authRequired === null) {
    return <ConnectingScreen error={error} />;
  }

  if (authRequired) {
    return (
      <AuthGate
        error={error}
        busy={busy}
        authInput={authInput}
        onAuthInputChange={setAuthInput}
        onSubmit={unlock}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        agents={agents}
        selectedId={selectedId}
        system={system}
        onSelect={(id) => {
          setView("playground");
          setSelectedId(id);
        }}
        onCreateClick={() => {
          setForm(emptyForm);
          setShowCreate(true);
        }}
        onNewChatClick={createChat}
      />

      <main className="main">
        <ConfigBanner system={system} />

        <div className="view-tabs">
          <button
            className={"view-tab " + (view === "playground" ? "active" : "")}
            onClick={() => setView("playground")}
          >
            Playground
          </button>
          <button className={"view-tab " + (view === "jobs" ? "active" : "")} onClick={() => setView("jobs")}>
            Jobs
          </button>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {view === "jobs" ? (
          <JobScreen agents={agents} chatWork={chatWork} />
        ) : selected ? (
          <>
            <AgentHeader
              agent={selected}
              agents={agents}
              busy={busy}
              onToggleSettings={() => setShowSettings((value) => !value)}
              onToggleAgent={toggleAgent}
              onDelete={deleteAgent}
            />

            {showSettings && (
              <SettingsPanel
                form={form}
                busy={busy}
                workspacePath={selected.workspacePath}
                readOnly={selected.kind === "worker"}
                onChange={setForm}
                onSubmit={saveAgent}
                onClose={() => setShowSettings(false)}
              />
            )}

            {/* Each kind gets the surface that matches what it can do. A Chat
                plans and fans work out, so it gets the Job surface — asking here
                is what starts a Job. A template answers for itself, so it gets a
                plain conversation. A worker is directed through its Chat. */}
            {selected.kind === "chat" ? (
              <JobScreen agents={agents} chatId={selected.id} chatWork={chatWork} />
            ) : selected.kind === "template" ? (
              <Playground
                agent={selected}
                system={system}
                messages={messages}
                activeRun={activeRun}
                onSend={sendMessage}
              />
            ) : (
              <div className="kind-notice">
                <h2>Subagent</h2>
                <p>
                  Spawned for one Job. Its work is on the Jobs screen. To direct it,
                  ask its Chat — messaging it here would race the Coordinator.
                </p>
                <div className="kind-notice-instructions">
                  <span className="eyebrow">Instructions</span>
                  <pre>{selected.instructions || "(none)"}</pre>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyAgentState
            onCreateClick={() => {
              setForm(emptyForm);
              setShowCreate(true);
            }}
          />
        )}
      </main>

      {showCreate && (
        <CreateAgentModal
          form={form}
          busy={busy}
          onChange={setForm}
          onSubmit={createAgent}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
