# Real-time Chat (Next.js + Socket.io + Prisma + PostgreSQL)

Google-only login, private chats, group chats, blocking, whitelist, presence, typing indicators.
A custom Node server (`server/index.ts`) runs Next.js and Socket.io in one process.

## Run locally
1. Google Cloud Console → OAuth client (Web). Redirect URI: `http://localhost:3000/api/auth/callback/google`
2. `cp .env.example .env` and fill `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
3. `docker compose up -d db`
4. `npm install`
5. `npx prisma migrate dev --name init`   (creates + commits `prisma/migrations`)
6. `npm run dev` → http://localhost:3000

Everything in Docker instead: `docker compose up --build` (uses `prisma db push` if no migrations folder exists, otherwise `migrate deploy`).

## Deploy on Railway
1. New project → add **PostgreSQL**; add a service from this repo (Dockerfile is auto-detected).
2. App variables: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_TRUST_HOST=true`, `AUTH_URL=https://<your-domain>`
3. Generate a public domain, then add `https://<your-domain>/api/auth/callback/google` to the Google OAuth client.
4. Keep a single instance (presence is in-memory). To scale out, add the Socket.io Redis adapter.

## Permission rules (enforced server-side in `server/socket.ts`)
| Situation | Read | Send |
|---|---|---|
| Private: A blocks B → B | yes | **no** (and B can't start a new chat with A) |
| Private: A blocks B → A | yes | yes |
| Group: ACTIVE member / admin | yes | yes |
| Group: BLOCKED member | yes | **no** (can still leave) |
| Group: LEFT / kicked | no | no |
Only the group admin can add, kick, block, unblock, rename. If the admin leaves, the longest-standing ACTIVE member becomes admin.
Whitelist: if A whitelists B, B bypasses A's block.
"# chat-app" 
