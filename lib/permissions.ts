import { prisma } from "./db";

export class Fail extends Error {}

/** State of a private conversation from `meId`'s point of view. null = not a member. */
export async function getPrivateState(meId: string, conversationId: string) {
  const members = await prisma.conversationMember.findMany({ where: { conversationId } });
  if (!members.some((m) => m.userId === meId)) return null;
  const otherId = members.find((m) => m.userId !== meId)?.userId;
  if (!otherId) return null;
  const [theirBlock, myBlock, theyTrustMe, iTrustThem] = await Promise.all([
    prisma.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: otherId, blockedId: meId } } }),
    prisma.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: meId, blockedId: otherId } } }),
    prisma.userWhitelist.findUnique({ where: { ownerId_trustedId: { ownerId: otherId, trustedId: meId } } }),
    prisma.userWhitelist.findUnique({ where: { ownerId_trustedId: { ownerId: meId, trustedId: otherId } } }),
  ]);
  return {
    otherId,
    // I can't send if the other user blocked me, unless they whitelisted me.
    blockedMe: !!theirBlock && !theyTrustMe,
    blockedByMe: !!myBlock,
    trustedByMe: !!iTrustThem,
  };
}

export async function getGroupMember(groupId: string, userId: string) {
  return prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
}

export async function requireAdmin(groupId: string, userId: string) {
  const m = await getGroupMember(groupId, userId);
  if (!m || m.role !== "ADMIN" || m.status !== "ACTIVE") throw new Fail("Only the group admin can do that.");
  return m;
}

export const cleanText = (s: unknown, max = 4000) => {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t) throw new Fail("Message cannot be empty.");
  if (t.length > max) throw new Fail(`Message is too long (max ${max} characters).`);
  return t;
};
