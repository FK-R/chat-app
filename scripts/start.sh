#!/bin/sh
set -e
if [ -d prisma/migrations ]; then
  npx prisma migrate deploy
else
  npx prisma db push --skip-generate
fi
NODE_ENV=production exec npx tsx server/index.ts
