import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, setAuthToken } from "./api";
import type { Agent, AgentFormValues, AgentRun, DraftedPlan, Message, SystemInfo } from "./types";
import { AuthGate, ConnectingScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { ConfigBanner } from "./components/ConfigBanner";
import { AgentHeader } from "./components/AgentHeader";
import { SettingsPanel } from "./components/SettingsPanel";
import { Playground } from "./components/Playground";
import { CreateAgentModal } from "./components/CreateAgentModal";
import { EmptyAgentState } from "./components/EmptyAgentState";
import { JobScreen } from "./components/job/JobScreen";
import { isDraftTriggerMessage, isOrchestratorAgent } from "./lib/orchestrator";

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
  const [showSettings, setShowSettings] = useState(false);
  const [form, setForm] = useState<AgentFormValues>(emptyForm);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [authInput, setAuthInput] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [approvingPlanFor, setApprovingPlanFor] = useState<string | null>(null);
  const [focusJobId, setFocusJobId] = useState<string | null>(null);
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

  const createNewChat = async () => {
    setBusy(true);
    setError(null);
    try {
      // Chats can't be deleted, so a simple count is a stable, monotonically
      // increasing "next number" regardless of how existing chats were renamed.
      const nextNumber = agents.filter(isOrchestratorAgent).length + 1;
      const { agent } = await api.createAgent({ name: "Chat " + nextNumber, kind: "orchestrator" });
      await refreshAgents();
      setSelectedId(agent.id);
      setView("playground");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const renameAgent = async (id: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateAgent(id, { name });
      await refreshAgents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const draftPlan = async () => {
    if (!selected) return;
    setDrafting(true);
    setError(null);
    try {
      const result = await api.draftPlan(selected.id);
      if (selectedIdRef.current === selected.id) {
        setMessages((current) => [...current, result.message]);
        setActiveRun(result.run);
      }
      setAgents((current) =>
        current.map((agent) => (agent.id === selected.id ? { ...agent, status: "busy" } : agent)),
      );
      await pollRun(result.run.id, selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await refreshAgents();
    } finally {
      setDrafting(false);
    }
  };

  const approvePlan = async (draft: DraftedPlan, messageId: string) => {
    if (!selected) return;
    setApprovingPlanFor(messageId);
    setError(null);
    try {
      const task =
        messages
          .filter((message) => message.role === "user" && !isDraftTriggerMessage(message.content))
          .map((message) => message.content)
          .join("\n\n") || selected.name;
      const { job } = await api.approvePlan({ name: selected.name, task, draft });
      setFocusJobId(job.id);
      setView("jobs");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setApprovingPlanFor(null);
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
        onNewChat={() => void createNewChat()}
        onCreateClick={() => {
          setForm(emptyForm);
          setShowCreate(true);
        }}
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
          <JobScreen agents={agents} focusJobId={focusJobId} onFocusHandled={() => setFocusJobId(null)} />
        ) : selected ? (
          <>
            <AgentHeader
              agent={selected}
              busy={busy}
              onToggleSettings={() => setShowSettings((value) => !value)}
              onToggleAgent={toggleAgent}
              onDelete={deleteAgent}
              onRename={(name) => void renameAgent(selected.id, name)}
            />

            {showSettings && !isOrchestratorAgent(selected) && (
              <SettingsPanel
                form={form}
                busy={busy}
                workspacePath={selected.workspacePath}
                onChange={setForm}
                onSubmit={saveAgent}
                onClose={() => setShowSettings(false)}
              />
            )}

            <Playground
              agent={selected}
              agents={agents}
              system={system}
              messages={messages}
              activeRun={activeRun}
              onSend={sendMessage}
              onDraftPlan={() => void draftPlan()}
              drafting={drafting}
              onApprovePlan={(draft, messageId) => void approvePlan(draft, messageId)}
              approvingPlanFor={approvingPlanFor}
            />
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
