import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { prisma } from "@/lib/db";
import { getGroupMember } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await currentUserId();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const mine = await getGroupMember(params.id, me);
  if (!mine || mine.status === "LEFT") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [group, members, rows] = await Promise.all([
    prisma.group.findUniqueOrThrow({ where: { id: params.id } }),
    prisma.groupMember.findMany({
      where: { groupId: params.id, status: { in: ["ACTIVE", "BLOCKED"] } },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.groupMessage.findMany({
      where: { groupId: params.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { sender: { select: { id: true, name: true, image: true } } },
    }),
  ]);
  return NextResponse.json({
    id: group.id,
    name: group.name,
    myRole: mine.role,
    myStatus: mine.status,
    members: members.map((m) => ({ userId: m.userId, role: m.role, status: m.status, user: m.user })),
    messages: rows.reverse(),
  });
}
