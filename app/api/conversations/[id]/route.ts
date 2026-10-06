import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { prisma } from "@/lib/db";
import { getPrivateState } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await currentUserId();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = await getPrivateState(me, params.id);
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [other, rows] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: state.otherId }, select: { id: true, name: true, email: true, image: true } }),
    prisma.message.findMany({
      where: { conversationId: params.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { sender: { select: { id: true, name: true, image: true } } },
    }),
  ]);
  // Blocked users keep full read access to history.
  return NextResponse.json({
    id: params.id,
    other,
    blockedByMe: state.blockedByMe,
    blockedMe: state.blockedMe,
    trustedByMe: state.trustedByMe,
    messages: rows.reverse(),
  });
}
