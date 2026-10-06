import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await currentUserId();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("email") ?? "").trim().toLowerCase();
  if (q.length < 3) return NextResponse.json({ users: [] });
  const users = await prisma.user.findMany({
    where: { email: { contains: q }, id: { not: me } },
    select: { id: true, name: true, email: true, image: true },
    take: 8,
  });
  return NextResponse.json({ users });
}
