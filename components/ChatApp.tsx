"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ChatsResponse, ConversationDetail, GroupDetail, Msg, UserLite } from "@/lib/types";
import Avatar from "./Avatar";
import GroupPanel from "./GroupPanel";

type Active = { kind: "private" | "group"; id: string };

export default function ChatApp({ me, logoutAction }: { me: UserLite; logoutAction: () => Promise<void> }) {
  const socketRef = useRef<Socket | null>(null);
  const [chats, setChats] = useState<ChatsResponse>({ conversations: [], groups: [] });
  const [active, setActive] = useState<Active | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | GroupDetail | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserLite[]>([]);
  const [text, setText] = useState("");
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingEmit = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>();

  const showError = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Promise wrapper around Socket.io acks; the server validates every action.
  const call = useCallback(
    (event: string, payload: unknown) =>
      new Promise<any>((resolve, reject) => {
        const s = socketRef.current;
        if (!s) return reject(new Error("Not connected."));
        s.emit(event, payload, (r: { ok: boolean; data?: any; error?: string }) =>
          r.ok ? resolve(r.data) : reject(new Error(r.error ?? "Failed.")),
        );
      }),
    [],
  );

  const loadChats = useCallback(async () => {
    const r = await fetch("/api/chats");
    if (r.ok) setChats(await r.json());
  }, []);

  const loadDetail = useCallback(async (a: Active | null) => {
    if (!a) return setDetail(null);
    const r = await fetch(a.kind === "private" ? `/api/conversations/${a.id}` : `/api/groups/${a.id}`);
    if (!r.ok) {
      setActive(null);
      setDetail(null);
      return;
    }
    const d = await r.json();
    if (activeRef.current?.id !== a.id) return;
    setDetail(d);
    setMessages(d.messages);
  }, []);

  const reloadActive = useCallback(() => loadDetail(activeRef.current), [loadDetail]);

  // Socket lifecycle
  useEffect(() => {
    const s = io();
    socketRef.current = s;
    s.on("presence:list", (ids: string[]) => setOnline(new Set(ids)));
    s.on("user:online", (id: string) => setOnline((p) => new Set(p).add(id)));
    s.on("user:offline", (id: string) => setOnline((p) => { const n = new Set(p); n.delete(id); return n; }));

    const incoming = (kind: Active["kind"]) => (p: { conversationId?: string; groupId?: string; message: Msg }) => {
      const a = activeRef.current;
      const id = p.conversationId ?? p.groupId;
      if (a?.kind === kind && a.id === id) setMessages((m) => (m.some((x) => x.id === p.message.id) ? m : [...m, p.message]));
      loadChats();
    };
    s.on("message:new", incoming("private"));
    s.on("group:message", incoming("group"));

    const refresh = () => { loadChats(); reloadActive(); };
    s.on("chats:refresh", refresh);
    s.on("group:updated", refresh);

    s.on("typing:start", ({ room }: { room: string }) => {
      setTyping((t) => ({ ...t, [room]: true }));
      setTimeout(() => setTyping((t) => ({ ...t, [room]: false })), 3000);
    });
    s.on("typing:stop", ({ room }: { room: string }) => setTyping((t) => ({ ...t, [room]: false })));

    loadChats();
    return () => { s.disconnect(); };
  }, [loadChats, reloadActive]);

  useEffect(() => { setShowInfo(false); setMessages([]); setDetail(null); loadDetail(active); }, [active, loadDetail]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ---- user search by email (debounced)
  useEffect(() => {
    if (query.trim().length < 3) return setResults([]);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/users/search?email=${encodeURIComponent(query.trim())}`);
      if (r.ok) setResults((await r.json()).users);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const startChat = async (email: string) => {
    try {
      const { conversationId } = await call("conversation:start", { email });
      setQuery(""); setResults([]);
      await loadChats();
      setActive({ kind: "private", id: conversationId });
    } catch (e) { showError((e as Error).message); }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || !active) return;
    setText("");
    try {
      await call(active.kind === "private" ? "message:send" : "group:message",
        active.kind === "private" ? { conversationId: active.id, content } : { groupId: active.id, content });
      call("typing:stop", { kind: active.kind, id: active.id }).catch(() => {});
    } catch (err) { setText(content); showError((err as Error).message); }
  };

  const onType = (v: string) => {
    setText(v);
    if (!active) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 1500) {
      lastTypingEmit.current = now;
      call("typing:start", { kind: active.kind, id: active.id }).catch(() => {});
    }
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => call("typing:stop", { kind: active.kind, id: active.id }).catch(() => {}), 2000);
  };

  const act = (event: string, payload: unknown) => call(event, payload).catch((e: Error) => showError(e.message));

  // ---- derived view state
  const priv = active?.kind === "private" ? (detail as ConversationDetail | null) : null;
  const grp = active?.kind === "group" ? (detail as GroupDetail | null) : null;
  const room = active ? `${active.kind}:${active.id}` : "";
  const canSend = priv ? !priv.blockedMe : grp ? grp.myStatus === "ACTIVE" : false;
  const title = priv ? priv.other.name ?? priv.other.email : grp?.name ?? "";

  const itemCls = (on: boolean) => `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-100 ${on ? "bg-slate-100" : ""}`;

  return (
    <div className="flex h-screen bg-white">
      {/* ---------- sidebar ---------- */}
      <aside className={`${active ? "hidden md:flex" : "flex"} w-full flex-col border-r border-slate-200 md:w-80`}>
        <div className="flex items-center gap-3 border-b border-slate-200 p-4">
          <Avatar name={me.name ?? me.email} src={me.image} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me.name ?? me.email}</p>
            <p className="truncate text-xs text-slate-500">{me.email}</p>
          </div>
          <form action={logoutAction}><button className="text-xs text-slate-500 hover:text-slate-900">Log out</button></form>
        </div>

        <div className="relative p-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search user by email…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
          {query.trim().length >= 3 && (
            <div className="absolute left-3 right-3 top-12 z-10 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {results.map((u) => (
                <button key={u.id} onClick={() => startChat(u.email)} className={itemCls(false)}>
                  <Avatar name={u.name ?? u.email} src={u.image} size={30} />
                  <span className="min-w-0"><span className="block truncate text-sm">{u.name}</span><span className="block truncate text-xs text-slate-500">{u.email}</span></span>
                </button>
              ))}
              {results.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No registered users found.</p>}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <h3 className="px-3 py-2 text-xs font-medium uppercase text-slate-500">Chats</h3>
          {chats.conversations.length === 0 && <p className="px-3 text-sm text-slate-400">Search an email to start chatting.</p>}
          {chats.conversations.map((c) => (
            <button key={c.id} onClick={() => setActive({ kind: "private", id: c.id })} className={itemCls(active?.id === c.id)}>
              <Avatar name={c.other.name ?? c.other.email} src={c.other.image} online={online.has(c.other.id)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.other.name ?? c.other.email}</span>
                <span className="block truncate text-xs text-slate-500">
                  {c.blockedByMe ? "You blocked this user" : c.blockedMe ? "You can't reply" : c.lastMessage?.content ?? "No messages yet"}
                </span>
              </span>
            </button>
          ))}

          <div className="flex items-center justify-between px-3 pb-1 pt-4">
            <h3 className="text-xs font-medium uppercase text-slate-500">Groups</h3>
            <button onClick={() => setShowNewGroup(true)} className="text-xs font-medium text-slate-700 hover:underline">+ New</button>
          </div>
          {chats.groups.map((g) => (
            <button key={g.id} onClick={() => setActive({ kind: "group", id: g.id })} className={itemCls(active?.id === g.id)}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm text-white">{g.name[0]?.toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {g.myStatus === "BLOCKED" ? "Read-only" : g.lastMessage?.content ?? "No messages yet"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ---------- conversation ---------- */}
      <main className={`${active ? "flex" : "hidden md:flex"} min-w-0 flex-1`}>
        {!active || !detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            {active ? "Loading…" : "Select a chat or search for someone by email."}
          </div>
        ) : (
          <>
            <section className="flex min-w-0 flex-1 flex-col bg-slate-50">
              <header className="flex items-center gap-3 border-b border-slate-200 bg-white p-3">
                <button onClick={() => setActive(null)} className="px-1 text-slate-500 md:hidden">←</button>
                {priv ? <Avatar name={title} src={priv.other.image} online={online.has(priv.other.id)} /> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{title}</p>
                  <p className="text-xs text-slate-500">
                    {typing[room] ? "typing…" : priv ? (online.has(priv.other.id) ? "● Online" : "Offline") : `${grp?.members.length ?? 0} members`}
                  </p>
                </div>
                {priv && (
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => act(priv.trustedByMe ? "user:unwhitelist" : "user:whitelist", { userId: priv.other.id })}
                      className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">{priv.trustedByMe ? "Remove from whitelist" : "Whitelist"}</button>
                    <button onClick={() => act(priv.blockedByMe ? "user:unblock" : "user:block", { userId: priv.other.id })}
                      className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">{priv.blockedByMe ? "Unblock" : "Block"}</button>
                  </div>
                )}
                {grp && <button onClick={() => setShowInfo((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">Info</button>}
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {messages.map((m) => {
                  const mine = m.senderId === me.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}>
                        {grp && !mine && <p className="mb-0.5 text-xs font-medium text-slate-500">{m.sender.name ?? "Unknown"}</p>}
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <p className={`mt-1 text-[10px] ${mine ? "text-slate-300" : "text-slate-400"}`}>
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {priv?.blockedByMe && (
                <div className="flex items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  <span>You have blocked this user. They can read this chat but can&apos;t reply. Unblock them to continue chatting.</span>
                  <button onClick={() => act("user:unblock", { userId: priv.other.id })} className="shrink-0 rounded border border-amber-300 px-2 py-1 text-xs">Unblock</button>
                </div>
              )}
              {canSend ? (
                <form onSubmit={send} className="flex gap-2 border-t border-slate-200 bg-white p-3">
                  <input value={text} onChange={(e) => onType(e.target.value)} placeholder="Type a message…" maxLength={4000}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                  <button className="rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700">Send</button>
                </form>
              ) : (
                <div className="border-t border-slate-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {priv ? "This user has blocked you. You can read the conversation but can't send messages." : "An admin has blocked you in this group. You can read messages but can't send them."}
                </div>
              )}
            </section>
            {grp && showInfo && <GroupPanel group={grp} meId={me.id} call={call} onClose={() => setShowInfo(false)} onError={showError} />}
          </>
        )}
      </main>

      {showNewGroup && <NewGroup onClose={() => setShowNewGroup(false)} onCreate={async (name, emails) => {
        try {
          const r = await call("group:create", { name, emails });
          setShowNewGroup(false);
          await loadChats();
          setActive({ kind: "group", id: r.groupId });
          if (r.notFound?.length) showError(`Not registered, skipped: ${r.notFound.join(", ")}`);
        } catch (e) { showError((e as Error).message); }
      }} />}

      {toast && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>}
    </div>
  );
}

function NewGroup({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, emails: string[]) => void }) {
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">New group</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} placeholder="Member emails, separated by commas (optional)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <p className="text-xs text-slate-500">You&apos;ll be the group admin.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-600">Cancel</button>
          <button onClick={() => onCreate(name, emails.split(/[,\s]+/).filter(Boolean))} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white">Create</button>
        </div>
      </div>
    </div>
  );
}
