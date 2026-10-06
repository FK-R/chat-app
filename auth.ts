import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Google Login
    Google,

    // Simple Email + Password Login
    Credentials({
      name: "Credentials",

      credentials: {
        email: {
          label: "Email",
          type: "email",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },

      async authorize(credentials) {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();

        const password = String(credentials?.password ?? "");

        if (!email || !password) {
          return null;
        }

        // Find existing user
        let user = await prisma.user.findUnique({
          where: { email },
        });

        // User doesn't exist → automatically register
        if (!user) {
          user = await prisma.user.create({
            data: {
              email,
              name: email.split("@")[0],
              password,
            },
          });
        } else {
          // Existing Google-only account
          if (!user.password) {
            return null;
          }

          // Simple password check
          if (user.password !== password) {
            return null;
          }
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
  },

  trustHost: true,

  pages: {
    signIn: "/login",
  },

  callbacks: {
    async signIn({ profile, account }) {
      // Google login
      if (account?.provider === "google") {
        return !!profile?.email && (profile as any).email_verified !== false;
      }

      // Credentials login
      return true;
    },

    async jwt({ token, profile, account, user }) {
      // Google login
      if (account?.provider === "google" && profile?.email) {
        const email = profile.email.toLowerCase();

        const dbUser = await prisma.user.upsert({
          where: { email },

          update: {
            name: profile.name ?? null,
            image: (profile as any).picture ?? null,
          },

          create: {
            email,
            name: profile.name ?? null,
            image: (profile as any).picture ?? null,
          },
        });

        token.uid = dbUser.id;
      }

      // Credentials login
      if (account?.provider === "credentials" && user?.id) {
        token.uid = user.id;
      }

      return token;
    },

    async session({ session, token }) {
      (session.user as any).id = token.uid as string;

      return session;
    },
  },
});

export async function currentUserId(): Promise<string | null> {
  const s = await auth();

  return ((s?.user as any)?.id as string | undefined) ?? null;
}