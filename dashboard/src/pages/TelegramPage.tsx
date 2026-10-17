import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import type { User } from "../types";
import "../telegram.css";

type Settings = {
  configured: boolean;
  enabled: boolean;
  token_set: boolean;
  token_hint: string;
  bot_username: string;
  chat_id: string;
  notify_network: boolean;
  notify_pi: boolean;
  notify_server: boolean;
  notify_app: boolean;
  notify_recovery: boolean;
  last_ok_at: string | null;
  last_error: string;
};

type AlertRow = {
  id: string;
  category: "network" | "pi" | "server" | "app";
  severity: "critical" | "warning";
  title: string;
  detail: string;
  status: "open" | "resolved";
  opened_at: string | null;
  resolved_at: string | null;
  notified: boolean;
};

type Chat = { id: string; name: string; type: string };
type Flag = "notify_network" | "notify_pi" | "notify_server" | "notify_app" | "notify_recovery";

const KINDS: { key: Exclude<Flag, "notify_recovery">; title: string; text: string }[] = [
  { key: "notify_network", title: "Network outages", text: "The internet is down on the wired or Wi-Fi link, or many web services cannot be reached." },
  { key: "notify_pi", title: "Pi problems", text: "A Pi goes offline, runs hot, is nearly out of disk space or reports an error." },
  { key: "notify_server", title: "Server problems", text: "The server is nearly out of disk space or database connections, or keeps returning errors." },
  { key: "notify_app", title: "Application health", text: "A voice, video or other application check keeps failing." },
];

/** A server error comes back as JSON text with a `detail`. Show only that. */
function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : "That did not work.";
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // not JSON: use the text as it is
  }
  return text;
}

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

export default function TelegramPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const settings = useQuery({ queryKey: ["telegram"], queryFn: () => api.telegram() as Promise<Settings>, enabled: admin });
  const events = useQuery({
    queryKey: ["telegram-events"],
    queryFn: () => api.telegramEvents() as Promise<AlertRow[]>,
    enabled: admin,
    refetchInterval: 30000,
  });
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [flags, setFlags] = useState<Record<Flag, boolean>>({ notify_network: true, notify_pi: true, notify_server: true, notify_app: true, notify_recovery: true });
  const [enabled, setEnabled] = useState(true);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const data = settings.data;
  useEffect(() => {
    if (!data || loaded) return;
    setChatId(data.chat_id);
    setEnabled(data.token_set ? data.enabled : true);
    setFlags({
      notify_network: data.notify_network,
      notify_pi: data.notify_pi,
      notify_server: data.notify_server,
      notify_app: data.notify_app,
      notify_recovery: data.notify_recovery,
    });
    setLoaded(true);
  }, [data, loaded]);

  if (me.isLoading) return <div className="state-box">Loading…</div>;
  if (!admin) return <Navigate to="/settings/onboarding" replace />;
  if (settings.isLoading) return <div className="state-box">Loading…</div>;
  if (settings.isError || !data) return <div className="state-box">Could not load the Telegram settings.</div>;

  const csrf = me.data?.csrf_token ?? "";

  async function run(name: string, work: () => Promise<void>) {
    setBusy(name);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setNotice({ kind: "error", text: messageOf(err) });
    } finally {
      setBusy("");
    }
  }

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["telegram"] }), qc.invalidateQueries({ queryKey: ["telegram-events"] })]);

  const save = () =>
    run("save", async () => {
      await api.telegramSave({ token: token.trim() || undefined, chat_id: chatId.trim(), enabled, ...flags }, csrf);
      setToken("");
      setChats(null);
      await refresh();
      setNotice({ kind: "ok", text: "Saved." });
    });

  const test = () =>
    run("test", async () => {
      await api.telegramTest(csrf);
      await refresh();
      setNotice({ kind: "ok", text: "Test message sent. Check Telegram." });
    });

  const detect = () =>
    run("detect", async () => {
      const body = (await api.telegramDetect(token.trim() || undefined, csrf)) as { chats: Chat[] };
      setChats(body.chats);
      if (body.chats.length === 0) setNotice({ kind: "error", text: "No chats yet. Open your bot in Telegram, press Start, send it any message, then try again." });
    });

  const disconnect = () =>
    run("disconnect", async () => {
      await api.telegramDisconnect(csrf);
      setChatId("");
      setToken("");
      setChats(null);
      await refresh();
      setNotice({ kind: "ok", text: "Disconnected. The bot token was removed." });
    });

  const status = !data.token_set ? "Not set up" : data.last_error ? "Problem" : data.configured ? "On" : "Paused";
  const statusClass = status === "On" ? "ok" : status === "Problem" ? "bad" : "off";
  const canTest = data.token_set && Boolean(data.chat_id);

  return (
    <div className="tg">
      <div className="tg-head">
        <div>
          <h2 className="page-title">Configure Telegram</h2>
          <p className="page-sub">Get a Telegram message when the network, a Pi or the server has a serious problem, and another when it clears.</p>
        </div>
        <span className={`tg-status ${statusClass}`} role="status">
          <i aria-hidden="true" />
          {status}
        </span>
      </div>

      {notice ? (
        <div className={notice.kind === "ok" ? "tg-note ok" : "tg-note bad"} role={notice.kind === "ok" ? "status" : "alert"}>
          {notice.text}
        </div>
      ) : null}
      {!notice && data.last_error ? (
        <div className="tg-note bad" role="alert">
          Last send failed: {data.last_error}
        </div>
      ) : null}

      <section className="panel tg-panel">
        <h3>Connect your bot</h3>
        <ol className="tg-steps">
          <li>
            In Telegram, message <b>@BotFather</b>, send <code>/newbot</code>, and copy the bot token it gives you.
          </li>
          <li>Paste the token below.</li>
          <li>Open your new bot in Telegram, press <b>Start</b>, and send it any message.</li>
          <li>
            Press <b>Find my chat</b> and pick it, or type the chat ID.
          </li>
        </ol>

        <div className="tg-fields">
          <label className="tg-field">
            <span>Bot token</span>
            <input
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={token}
              placeholder={data.token_set ? `Saved, ends in ${data.token_hint}. Leave empty to keep it.` : "123456789:AA..."}
              onChange={(event) => setToken(event.target.value)}
            />
            {data.bot_username ? <small>Bot: @{data.bot_username}</small> : null}
          </label>
          <label className="tg-field">
            <span>Chat ID</span>
            <div className="tg-inline">
              <input type="text" inputMode="numeric" autoComplete="off" value={chatId} placeholder="123456789" onChange={(event) => setChatId(event.target.value)} />
              <button type="button" className="btn" disabled={busy !== "" || (!token.trim() && !data.token_set)} onClick={detect}>
                {busy === "detect" ? "Looking…" : "Find my chat"}
              </button>
            </div>
          </label>
        </div>

        {chats && chats.length > 0 ? (
          <div className="tg-chats" role="group" aria-label="Chats found">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={chat.id === chatId ? "tg-chat active" : "tg-chat"}
                onClick={() => setChatId(chat.id)}
              >
                <b>{chat.name || "Unnamed chat"}</b>
                <span>
                  {chat.type} · {chat.id}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel tg-panel">
        <h3>What to send</h3>
        <ul className="tg-kinds">
          {KINDS.map((kind) => (
            <li key={kind.key}>
              <label className="tg-toggle">
                <input type="checkbox" checked={flags[kind.key]} onChange={(event) => setFlags({ ...flags, [kind.key]: event.target.checked })} />
                <span>
                  <b>{kind.title}</b>
                  <small>{kind.text}</small>
                </span>
              </label>
            </li>
          ))}
          <li>
            <label className="tg-toggle">
              <input type="checkbox" checked={flags.notify_recovery} onChange={(event) => setFlags({ ...flags, notify_recovery: event.target.checked })} />
              <span>
                <b>Tell me when a problem is resolved</b>
                <small>One short message when something that was reported clears.</small>
              </span>
            </label>
          </li>
        </ul>
        <label className="tg-toggle tg-master">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>
            <b>Send alerts</b>
            <small>Turn this off to pause all messages without losing the setup.</small>
          </span>
        </label>

        <div className="tg-actions">
          <button type="button" className="btn btn-primary" disabled={busy !== ""} onClick={save}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn" disabled={busy !== "" || !canTest} onClick={test}>
            {busy === "test" ? "Sending…" : "Send test message"}
          </button>
          {data.token_set ? (
            <button type="button" className="btn tg-danger" disabled={busy !== ""} onClick={() => setConfirming(true)}>
              Disconnect
            </button>
          ) : null}
        </div>
        {data.last_ok_at ? <p className="muted tg-last">Last message sent {when(data.last_ok_at)}.</p> : null}
      </section>

      <section className="panel tg-panel">
        <h3>Recent alerts</h3>
        {events.data && events.data.length > 0 ? (
          <ul className="tg-events">
            {events.data.map((item) => (
              <li key={item.id}>
                <i className={`tg-dot ${item.severity}`} aria-hidden="true" />
                <div>
                  <b>{item.title}</b>
                  {item.detail ? <span>{item.detail}</span> : null}
                  <small>
                    {when(item.opened_at)}
                    {item.status === "resolved" ? ` · resolved ${when(item.resolved_at)}` : " · still open"}
                    {item.notified ? "" : " · not sent"}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing has been reported yet.</p>
        )}
        <p className="muted tg-limit">If the whole server is down it cannot send an alert, because the alerts are sent from the server.</p>
      </section>

      {confirming ? (
        <ConfirmDialog
          title="Disconnect Telegram?"
          confirmLabel="Disconnect"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void disconnect();
          }}
        >
          The bot token is removed from the server and alerts stop. You can set it up again later.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
