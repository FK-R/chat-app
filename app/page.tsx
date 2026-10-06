import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import ChatApp from "@/components/ChatApp";

export default async function Home() {
  const session = await auth();
  const user = session?.user as { id?: string; name?: string | null; email?: string | null; image?: string | null } | undefined;
  if (!user?.id) redirect("/login");

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <ChatApp
      me={{ id: user.id, name: user.name ?? null, email: user.email ?? "", image: user.image ?? null }}
      logoutAction={logout}
    />
  );
}
