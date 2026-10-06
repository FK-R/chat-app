import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await currentUserId();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [convs, blocks, trusts, memberships] = await Promise.all([
    prisma.conversation.findMany({
      where: { members: { some: { userId: me } } },
      include: { members: { include: { user: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.userBlock.findMany({ where: { OR: [{ blockerId: me }, { blockedId: me }] } }),
    prisma.userWhitelist.findMany({ where: { trustedId: me } }),
    prisma.groupMember.findMany({
      where: { userId: me, status: { in: ["ACTIVE", "BLOCKED"] } },
      include: { group: { include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    }),
  ]);

  const conversations = convs.flatMap((c) => {
    const other = c.members.find((m) => m.userId !== me)?.user;
    if (!other) return [];
    const trustedByThem = trusts.some((t) => t.ownerId === other.id);
    return [{
      id: c.id,
      other: { id: other.id, name: other.name, email: other.email, image: other.image },
      blockedByMe: blocks.some((b) => b.blockerId === me && b.blockedId === other.id),
      blockedMe: blocks.some((b) => b.blockerId === other.id && b.blockedId === me) && !trustedByThem,
      lastMessage: c.messages[0] ? { content: c.messages[0].content, createdAt: c.messages[0].createdAt.toISOString() } : null,
    }];
  });

  const groups = memberships
    .map((m) => ({
      id: m.group.id,
      name: m.group.name,
      myRole: m.role,
      myStatus: m.status as "ACTIVE" | "BLOCKED",
      lastMessage: m.group.messages[0]
        ? { content: m.group.messages[0].content, createdAt: m.group.messages[0].createdAt.toISOString() }
        : null,
    }))
    .sort((a, b) => (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? ""));

  return NextResponse.json({ conversations, groups });
}
