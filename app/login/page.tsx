import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage() {
  const session = await auth();

  if ((session?.user as any)?.id) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold">Chat</h1>

        <p className="mt-2 text-sm text-slate-500">
          Private messages and group chats in real time.
        </p>

        {/* Email / Password */}
        <form
          className="mt-8 space-y-3"
          action={async (formData) => {
            "use server";

            await signIn("credentials", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: "/",
            });
          }}
        >
          <input
            name="email"
            type="email"
            placeholder="Email"
            required
            className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm"
          />

          <input
            name="password"
            type="password"
            placeholder="Password"
            required
            className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm"
          />

          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Continue with Email
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">OR</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Google */}
        <form
          action={async () => {
            "use server";

            await signIn("google", {
              redirectTo: "/",
            });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}