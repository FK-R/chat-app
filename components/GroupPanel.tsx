"use client";
import { useState } from "react";
import type { GroupDetail } from "@/lib/types";
import Avatar from "./Avatar";

type Call = (event: string, payload: unknown) => Promise<any>;

export default function GroupPanel({
  group,
  meId,
  call,
  onClose,
  onError,
}: {
  group: GroupDetail;
  meId: string;
  call: Call;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState(group.name);
  const isAdmin = group.myRole === "ADMIN";
  const run = (event: string, payload: Record<string, unknown>) =>
    call(event, { groupId: group.id, ...payload }).catch((e: Error) =>
      onError(e.message),
    );

  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-200 bg-white sm:w-80">
      <div className="flex items-center justify-between border-b border-slate-200 p-4">
        <h2 className="font-semibold">Group info</h2>
        <button
          onClick={onClose}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          Close
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {isAdmin && (
          <section className="space-y-2">
            <label className="text-xs font-medium uppercase text-slate-500">
              Group name
            </label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => run("group:update", { name })}
                className="rounded-md bg-slate-900 px-3 text-sm text-white"
              >
                Save
              </button>
            </div>
            <label className="text-xs font-medium uppercase text-slate-500">
              Add member by email
            </label>
            <div className="flex gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                onClick={async () => {
                  await run("group:member:add", { email });
                  setEmail("");
                }}
                className="rounded-md bg-slate-900 px-3 text-sm text-white"
              >
                Add
              </button>
            </div>
          </section>
        )}
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase text-slate-500">
            Members ({group.members.length})
          </h3>
          <ul className="space-y-2">
            {group.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2">
                <Avatar
                  name={m.user.name ?? m.user.email}
                  src={m.user.image}
                  size={30}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {m.user.name ?? m.user.email}
                    {m.userId === meId && " (you)"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {m.role === "ADMIN" ? "Admin" : "Member"}
                    {m.status === "BLOCKED" && " · read-only"}
                  </p>
                </div>
                {/* {isAdmin && m.userId !== meId && (
                  <div className="flex gap-1 text-xs">
                    {m.status === "ACTIVE" ? (
                      <button onClick={() => run("group:member:block", { userId: m.userId })} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">Block</button>
                    ) : (
                      <button onClick={() => run("group:member:unblock", { userId: m.userId })} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">Unblock</button>
                    )}
                    <button onClick={() => confirm(`Remove ${m.user.name ?? m.user.email}?`) && run("group:member:kick", { userId: m.userId })} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">Kick</button>
                  </div>
                )} */}

                {isAdmin && m.userId !== meId && (
                  <div className="flex flex-wrap justify-end gap-1 text-xs">
                    {m.role === "ADMIN" ? (
                      <button
                        onClick={() =>
                          confirm(
                            `Remove admin role from ${m.user.name ?? m.user.email}?`,
                          ) && run("group:member:demote", { userId: m.userId })
                        }
                        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                      >
                        Remove admin
                      </button>
                    ) : (
                      <>
                        {m.status === "ACTIVE" && (
                          <button
                            onClick={() =>
                              confirm(
                                `Make ${m.user.name ?? m.user.email} an admin?`,
                              ) &&
                              run("group:member:promote", { userId: m.userId })
                            }
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                          >
                            Make admin
                          </button>
                        )}
                        {m.status === "ACTIVE" ? (
                          <button
                            onClick={() =>
                              run("group:member:block", { userId: m.userId })
                            }
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                          >
                            Block
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              run("group:member:unblock", { userId: m.userId })
                            }
                            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                          >
                            Unblock
                          </button>
                        )}
                        <button
                          onClick={() =>
                            confirm(`Remove ${m.user.name ?? m.user.email}?`) &&
                            run("group:member:kick", { userId: m.userId })
                          }
                          className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50"
                        >
                          Kick
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="border-t border-slate-200 p-4">
        <button
          // onClick={() =>
          //   confirm(
          //     isAdmin
          //       ? "Leave this group? Admin rights pass to another member."
          //       : "Leave this group?",
          //   ) && run("group:leave", {})
          // }

          onClick={() =>
            confirm(
              isAdmin &&
                group.members.filter((x) => x.role === "ADMIN").length === 1
                ? "You're the only admin. Leaving will pass admin rights to another member. Continue?"
                : "Leave this group?",
            ) && run("group:leave", {})
          }
          className="w-full rounded-md border border-red-300 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          Leave group
        </button>
      </div>
    </aside>
  );
}
