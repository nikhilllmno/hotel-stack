import { useEffect, useState } from "react";
import { useActiveTab, useBridgeStatus, useColorScheme, useSettings } from "../lib/chrome-state";
import { isConfigured } from "../lib/settings";
import { ChatList } from "./ChatList";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { SettingsView } from "./SettingsView";
import { StatusBar } from "./StatusBar";
import { Thread } from "./Thread";
import { useChat } from "./use-chat";
import type { Settings } from "../shared/protocol";

type View = "chat" | "chats" | "settings";

function Panel({ settings }: { settings: Settings }) {
  const bridge = useBridgeStatus();
  const tab = useActiveTab();
  const chat = useChat(settings);
  const [view, setView] = useState<View>(isConfigured(settings) ? "chat" : "settings");
  const firstRun = !isConfigured(settings);

  const go = (v: View) => { setView(v); if (v === "chats") void chat.loadSessions(); };

  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <StatusBar hermes={chat.hermes} bridge={bridge.bridge}
        onNew={() => { chat.newChat(); setView("chat"); }} onChats={() => go(view === "chats" ? "chat" : "chats")} onSettings={() => go(view === "settings" ? "chat" : "settings")} />
      {view === "settings" ? (
        <SettingsView key={JSON.stringify(settings)} initial={settings} firstRun={firstRun} onSaved={(ok) => ok && setView("chat")} />
      ) : view === "chats" ? (
        <ChatList sessions={chat.sessions} loading={chat.sessionsLoading} error={chat.sessionsError} currentId={chat.sessionId}
          onOpen={(id) => { void chat.openSession(id); setView("chat"); }} onRetry={() => void chat.loadSessions()} />
      ) : (
        <>
          {chat.historyLoading ? (
            <div className="flex-1 space-y-3 p-3" aria-busy="true" aria-label="Loading chat">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : chat.historyError ? (
            <div className="flex-1 p-3"><ErrorBanner message={chat.historyError.message} kind={chat.historyError.kind} onRetry={() => void chat.openSession(chat.sessionId)} /></div>
          ) : chat.turns.length === 0 ? (
            <EmptyState onPick={(p) => void chat.send(p, tab)} />
          ) : (
            <Thread turns={chat.turns} answers={chat.answers} onApprove={(a, c) => void chat.approve(a, c)}
              onAnswerQuestion={(q, a) => void chat.answerQuestion(q, a)} onRetry={() => void chat.retry()} />
          )}
          <Composer tab={tab} bridge={bridge.bridge} running={chat.running} onSend={(t, tb) => void chat.send(t, tb)} onStop={() => void chat.stop()} onOpenSettings={() => setView("settings")} />
        </>
      )}
    </div>
  );
}

/** Side panel root: waits for the stored settings, then shows the chat (or Settings first when nothing is configured). */
export function App() {
  useColorScheme();
  const settings = useSettings();
  useEffect(() => { document.title = "Hermes"; }, []);
  if (!settings) return <div className="h-dvh bg-background" />;
  return <Panel settings={settings} />;
}
