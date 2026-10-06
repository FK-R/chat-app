export type UserLite = { id: string; name: string | null; email: string; image: string | null };
export type Msg = {
  id: string;
  content: string;
  createdAt: string;
  senderId: string;
  sender: { id: string; name: string | null; image: string | null };
};
export type ConversationItem = {
  id: string;
  other: UserLite;
  blockedByMe: boolean;
  blockedMe: boolean;
  lastMessage: { content: string; createdAt: string } | null;
};
export type GroupItem = {
  id: string;
  name: string;
  myRole: "ADMIN" | "MEMBER";
  myStatus: "ACTIVE" | "BLOCKED";
  lastMessage: { content: string; createdAt: string } | null;
};
export type ChatsResponse = { conversations: ConversationItem[]; groups: GroupItem[] };
export type GroupMemberItem = { userId: string; role: "ADMIN" | "MEMBER"; status: "ACTIVE" | "BLOCKED"; user: UserLite };
export type ConversationDetail = {
  id: string;
  other: UserLite;
  blockedByMe: boolean;
  blockedMe: boolean;
  trustedByMe: boolean;
  messages: Msg[];
};
export type GroupDetail = {
  id: string;
  name: string;
  myRole: "ADMIN" | "MEMBER";
  myStatus: "ACTIVE" | "BLOCKED";
  members: GroupMemberItem[];
  messages: Msg[];
};
