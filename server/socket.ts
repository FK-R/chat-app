import type { Server, Socket } from "socket.io";
import { decode } from "next-auth/jwt";
import { prisma } from "../lib/db";
import {
  Fail,
  cleanText,
  getGroupMember,
  getPrivateState,
  requireAdmin,
} from "../lib/permissions";

const COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];
const privRoom = (id: string) => `private:${id}`;
const grpRoom = (id: string) => `group:${id}`;
const userRoom = (id: string) => `user:${id}`;

/** Read the Auth.js session JWT from the handshake cookie (handles chunked cookies). */
async function userIdFromCookie(header = ""): Promise<string | null> {
  const jar = new Map<string, string>();
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0)
      jar.set(
        part.slice(0, i).trim(),
        decodeURIComponent(part.slice(i + 1).trim()),
      );
  }
  for (const name of COOKIES) {
    let token = jar.get(name);
    if (!token) {
      const chunks: string[] = [];
      for (let i = 0; jar.has(`${name}.${i}`); i++)
        chunks.push(jar.get(`${name}.${i}`)!);
      token = chunks.join("");
    }
    if (!token) continue;
    try {
      const payload = await decode({
        token,
        secret: process.env.AUTH_SECRET!,
        salt: name,
      });
      return ((payload as any)?.uid as string) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export function registerSocket(io: Server) {
  const online = new Map<string, number>();

  const refresh = (...userIds: string[]) =>
    userIds.forEach((id) => io.to(userRoom(id)).emit("chats:refresh"));
  const joinRoom = (userId: string, room: string) =>
    io.in(userRoom(userId)).socketsJoin(room);
  const leaveRoom = (userId: string, room: string) =>
    io.in(userRoom(userId)).socketsLeave(room);

  io.use(async (socket, next) => {
    const uid = await userIdFromCookie(socket.handshake.headers.cookie);
    if (!uid) return next(new Error("unauthorized"));
    socket.data.userId = uid;
    next();
  });

  io.on("connection", async (socket: Socket) => {
    const uid: string = socket.data.userId;

    // --- rooms: personal room + every conversation / group the user belongs to
    socket.join(userRoom(uid));
    const [convs, groups] = await Promise.all([
      prisma.conversationMember.findMany({
        where: { userId: uid },
        select: { conversationId: true },
      }),
      prisma.groupMember.findMany({
        where: { userId: uid, status: { in: ["ACTIVE", "BLOCKED"] } },
        select: { groupId: true },
      }),
    ]);
    convs.forEach((c) => socket.join(privRoom(c.conversationId)));
    groups.forEach((g) => socket.join(grpRoom(g.groupId)));

    // --- presence
    online.set(uid, (online.get(uid) ?? 0) + 1);
    if (online.get(uid) === 1) io.emit("user:online", uid);
    socket.emit("presence:list", [...online.keys()]);
    socket.on("disconnect", () => {
      const n = (online.get(uid) ?? 1) - 1;
      if (n <= 0) {
        online.delete(uid);
        io.emit("user:offline", uid);
      } else online.set(uid, n);
    });

    // Every handler: validate on the server -> write to Postgres -> emit. Acks carry errors back.
    const on = (event: string, fn: (p: any) => Promise<unknown>) =>
      socket.on(event, async (payload: any, ack?: (r: any) => void) => {
        try {
          const data = await fn(payload ?? {});
          ack?.({ ok: true, data });
        } catch (e) {
          if (!(e instanceof Fail)) console.error(event, e);
          ack?.({
            ok: false,
            error: e instanceof Fail ? e.message : "Something went wrong.",
          });
        }
      });

    const typing = (kind: "private" | "group", on_: boolean) => (p: any) => {
      const room = kind === "private" ? privRoom(p.id) : grpRoom(p.id);
      if (socket.rooms.has(room))
        socket
          .to(room)
          .emit(on_ ? "typing:start" : "typing:stop", { room, userId: uid });
      return Promise.resolve();
    };
    on("typing:start", (p) =>
      typing(p.kind === "group" ? "group" : "private", true)(p),
    );
    on("typing:stop", (p) =>
      typing(p.kind === "group" ? "group" : "private", false)(p),
    );

    // ================= private chat =================
    on("conversation:start", async ({ email }) => {
      const target = await prisma.user.findUnique({
        where: {
          email: String(email ?? "")
            .trim()
            .toLowerCase(),
        },
      });
      if (!target) throw new Fail("No registered user with that email.");
      if (target.id === uid) throw new Fail("You can't chat with yourself.");

      const [theirBlock, theyTrustMe] = await Promise.all([
        prisma.userBlock.findUnique({
          where: {
            blockerId_blockedId: { blockerId: target.id, blockedId: uid },
          },
        }),
        prisma.userWhitelist.findUnique({
          where: { ownerId_trustedId: { ownerId: target.id, trustedId: uid } },
        }),
      ]);
      const pairKey = [uid, target.id].sort().join(":");
      const existing = await prisma.conversation.findUnique({
        where: { pairKey },
      });
      // A blocked user cannot START communication (an existing chat stays readable).
      if (!existing && theirBlock && !theyTrustMe)
        throw new Fail("You can't start a conversation with this user.");

      const conv =
        existing ??
        (await prisma.conversation.create({
          data: {
            pairKey,
            members: { create: [{ userId: uid }, { userId: target.id }] },
          },
        }));
      [uid, target.id].forEach((u) => joinRoom(u, privRoom(conv.id)));
      refresh(uid, target.id);
      return { conversationId: conv.id };
    });

    on("message:send", async ({ conversationId, content }) => {
      const text = cleanText(content);
      const state = await getPrivateState(uid, String(conversationId));
      if (!state) throw new Fail("Conversation not found.");
      if (state.blockedMe)
        throw new Fail(
          "You have been blocked by this user and can't send messages.",
        );
      const message = await prisma.message.create({
        data: { conversationId, senderId: uid, content: text },
        include: { sender: { select: { id: true, name: true, image: true } } },
      });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      io.to(privRoom(conversationId)).emit("message:new", {
        conversationId,
        message,
      });
      return null;
    });

    // ================= blocking / whitelist =================
    const pairAction = (
      event: string,
      fn: (otherId: string) => Promise<unknown>,
      notify: string,
    ) =>
      on(event, async ({ userId }) => {
        const otherId = String(userId ?? "");
        if (!otherId || otherId === uid) throw new Fail("Invalid user.");
        if (!(await prisma.user.findUnique({ where: { id: otherId } })))
          throw new Fail("User not found.");
        await fn(otherId);
        io.to(userRoom(otherId)).emit(notify, { by: uid });
        io.to(userRoom(uid)).emit(notify, { by: uid });
        refresh(uid, otherId);
        return null;
      });
    pairAction(
      "user:block",
      (o) =>
        prisma.userBlock.upsert({
          where: { blockerId_blockedId: { blockerId: uid, blockedId: o } },
          update: {},
          create: { blockerId: uid, blockedId: o },
        }),
      "user:blocked",
    );
    pairAction(
      "user:unblock",
      (o) =>
        prisma.userBlock.deleteMany({
          where: { blockerId: uid, blockedId: o },
        }),
      "user:unblocked",
    );
    pairAction(
      "user:whitelist",
      (o) =>
        prisma.userWhitelist.upsert({
          where: { ownerId_trustedId: { ownerId: uid, trustedId: o } },
          update: {},
          create: { ownerId: uid, trustedId: o },
        }),
      "user:whitelisted",
    );
    pairAction(
      "user:unwhitelist",
      (o) =>
        prisma.userWhitelist.deleteMany({
          where: { ownerId: uid, trustedId: o },
        }),
      "user:unwhitelisted",
    );

    // ================= groups =================
    const groupChanged = (groupId: string, ...extraUsers: string[]) => {
      io.to(grpRoom(groupId)).emit("group:updated", { groupId });
      extraUsers.forEach((u) =>
        io.to(userRoom(u)).emit("group:updated", { groupId }),
      );
      refresh(...extraUsers);
      io.to(grpRoom(groupId)).emit("chats:refresh");
    };

    on("group:create", async ({ name, emails }) => {
      const title = String(name ?? "").trim();
      if (!title || title.length > 80)
        throw new Fail("Group name must be 1-80 characters.");
      const list = [
        ...new Set(
          (Array.isArray(emails) ? emails : []).map((e: unknown) =>
            String(e).trim().toLowerCase(),
          ),
        ),
      ];
      const users = await prisma.user.findMany({
        where: { email: { in: list as string[] }, id: { not: uid } },
      });
      const group = await prisma.group.create({
        data: {
          name: title,
          createdById: uid, // creator becomes ADMIN
          members: {
            create: [
              { userId: uid, role: "ADMIN" },
              ...users.map((u) => ({ userId: u.id })),
            ],
          },
        },
      });
      [uid, ...users.map((u) => u.id)].forEach((u) =>
        joinRoom(u, grpRoom(group.id)),
      );
      refresh(uid, ...users.map((u) => u.id));
      const found = new Set(users.map((u) => u.email));
      return {
        groupId: group.id,
        notFound: list.filter((e) => !found.has(e as string)),
      };
    });

    on("group:message", async ({ groupId, content }) => {
      const text = cleanText(content);
      const me = await getGroupMember(String(groupId), uid);
      if (!me || me.status === "LEFT")
        throw new Fail("You are not a member of this group.");
      if (me.status === "BLOCKED")
        throw new Fail(
          "An admin has blocked you from sending messages in this group.",
        );
      const message = await prisma.groupMessage.create({
        data: { groupId, senderId: uid, content: text },
        include: { sender: { select: { id: true, name: true, image: true } } },
      });
      io.to(grpRoom(groupId)).emit("group:message", { groupId, message });
      return null;
    });

on("group:leave", async ({ groupId }) => {
  const me = await getGroupMember(String(groupId), uid);

  if (!me || me.status === "LEFT") {
    throw new Fail("You are not a member of this group.");
  }
  if (me.role === "ADMIN") {
    const otherAdmin = await prisma.groupMember.findFirst({
      where: {
        groupId,
        userId: { not: uid },
        status: "ACTIVE",
        role: "ADMIN",
      },
    });

    if (!otherAdmin) {
      const heir = await prisma.groupMember.findFirst({
        where: {
          groupId,
          userId: { not: uid },
          status: "ACTIVE",
        },
        orderBy: {
          joinedAt: "asc",
        },
      });

      if (heir) {
        await prisma.groupMember.update({
          where: { id: heir.id },
          data: { role: "ADMIN" },
        });
      }
    }
  } // <-- THIS was missing

  await prisma.groupMember.update({
    where: { id: me.id },
    data: {
      status: "LEFT",
      role: "MEMBER",
      leftAt: new Date(),
    },
  });

  groupChanged(groupId, uid);
  leaveRoom(uid, grpRoom(groupId));

  return null;
});

    on("group:member:add", async ({ groupId, email }) => {
      await requireAdmin(groupId, uid);
      const user = await prisma.user.findUnique({
        where: {
          email: String(email ?? "")
            .trim()
            .toLowerCase(),
        },
      });
      if (!user) throw new Fail("No registered user with that email.");
      const existing = await getGroupMember(groupId, user.id);
      if (existing?.status === "ACTIVE") throw new Fail("Already a member.");
      if (existing?.status === "BLOCKED")
        throw new Fail("This member is blocked. Unblock them instead.");
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: user.id } },
        update: {
          status: "ACTIVE",
          role: "MEMBER",
          leftAt: null,
          joinedAt: new Date(),
        },
        create: { groupId, userId: user.id },
      });
      joinRoom(user.id, grpRoom(groupId));
      groupChanged(groupId, user.id);
      return null;
    });

    // const memberAction = (event: string, fn: (target: { id: string; userId: string; role: string; status: string }, groupId: string) => Promise<unknown>) =>
    //   on(event, async ({ groupId, userId }) => {
    //     await requireAdmin(groupId, uid);
    //     if (userId === uid) throw new Fail("You can't do that to yourself.");
    //     const target = await getGroupMember(groupId, String(userId));
    //     if (!target || target.status === "LEFT") throw new Fail("Member not found.");
    //     await fn(target, groupId);
    //     groupChanged(groupId, target.userId);
    //     return null;
    //   });

    const memberAction = (
      event: string,
      fn: (
        target: { id: string; userId: string; role: string; status: string },
        groupId: string,
      ) => Promise<unknown>,
      allowAdminTarget = false,
    ) =>
      on(event, async ({ groupId, userId }) => {
        await requireAdmin(groupId, uid);
        if (userId === uid) throw new Fail("You can't do that to yourself.");
        const target = await getGroupMember(groupId, String(userId));
        if (!target || target.status === "LEFT")
          throw new Fail("Member not found.");
        if (target.role === "ADMIN" && !allowAdminTarget)
          throw new Fail("Remove this person's admin role first.");
        await fn(target, groupId);
        groupChanged(groupId, target.userId);
        return null;
      });

    memberAction("group:member:kick", async (t, groupId) => {
      await prisma.groupMember.update({
        where: { id: t.id },
        data: { status: "LEFT", role: "MEMBER", leftAt: new Date() },
      });
      leaveRoom(t.userId, grpRoom(groupId));
    });
    memberAction("group:member:block", async (t) => {
      await prisma.groupMember.update({
        where: { id: t.id },
        data: { status: "BLOCKED" },
      });
    });
    memberAction("group:member:unblock", async (t) => {
      await prisma.groupMember.update({
        where: { id: t.id },
        data: { status: "ACTIVE" },
      });
    });
// Make a user Admin
    memberAction("group:member:promote", async (t) => {
  if (t.status === "BLOCKED") throw new Fail("Unblock this member before making them admin.");
  await prisma.groupMember.update({ where: { id: t.id }, data: { role: "ADMIN" } });
});
memberAction(
  "group:member:demote",
  async (t) => {
    await prisma.groupMember.update({ where: { id: t.id }, data: { role: "MEMBER" } });
  },
  true, // allowed to target an admin
);

    on("group:update", async ({ groupId, name }) => {
      await requireAdmin(groupId, uid);
      const title = String(name ?? "").trim();
      if (!title || title.length > 80)
        throw new Fail("Group name must be 1-80 characters.");
      await prisma.group.update({
        where: { id: groupId },
        data: { name: title },
      });
      groupChanged(groupId);
      return null;
    });
  });
}
