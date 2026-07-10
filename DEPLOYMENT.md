# Deployment Guide (Dokploy)

## Branch strategy

Single repository, `main` branch = production. Dokploy deploys whichever
branch you point an Application at, so additional environments or future
parallel deployments (e.g. a staging environment, or later a second portal
for a different class/subject) should be new branches in this same repo —
not new repos. Create a Dokploy Application per branch you want deployed.

Convention:
- `main` — production (Class 10 Science portal)
- future branches as needed, e.g. `staging`, or `class-9-science`

## Port

The app listens on the port from the `PORT` environment variable
(Next.js reads this natively — no code needed). This deployment uses
**4055** as the fixed port for this app, to avoid colliding with other
apps/services on the same VM. Set `PORT=4055` in the Dokploy environment
variables for this Application, and set the Dokploy "Port" field
(the internal container port Traefik routes to) to match: `4055`.

## 1. Database (Postgres + pgvector)

In Dokploy, create a **Database → PostgreSQL** service using the
`pgvector/pgvector:pg16` image instead of the default `postgres` image —
this ships with the `vector` extension pre-built, so no manual compilation
is needed on the VM (unlike the local Windows setup, which needed a
precompiled binary because plain PostgreSQL doesn't include pgvector).

Once the database is running, note its internal connection details
(host, port, user, password, db name) — Dokploy shows these in the
service's "General"/"Environment" tab. Then, from a `psql` session (Dokploy
provides a terminal/console for database services), run:

```sql
CREATE DATABASE ncert_portal;
```
```sql
\c ncert_portal
CREATE EXTENSION IF NOT EXISTS vector;
```

The app's own migration (`drizzle-kit migrate`, wired into `npm start` —
see [package.json](package.json)) creates the `chunks` table automatically
on first deploy; you don't need to run it manually.

## 2. Application

Create a Dokploy **Application**:
- Source: this GitHub repo, branch `main`
- Build type: **Nixpacks** (auto-detected — no Dockerfile needed)
- Port: `4055`

Environment variables:
```
DATABASE_URL=postgresql://<user>:<password>@<db-host>:<db-port>/ncert_portal
OPENAI_API_KEY=<your key>
PORT=4055
```

Deploy. Nixpacks will run `npm install`, `npm run build`, then
`npm start` (which runs the DB migration, then starts the server).

## 3. Ingest content (one-time, per deployment)

The ingestion scripts aren't part of the app's runtime — run them once
from your local machine, pointed at the **production** database, after
the app's first deploy has created the `chunks` table:

```bash
# Use the production DATABASE_URL and OPENAI_API_KEY for this one command
DATABASE_URL=<production connection string> OPENAI_API_KEY=<key> npm run ingest:download
DATABASE_URL=<production connection string> OPENAI_API_KEY=<key> npm run ingest:extract
DATABASE_URL=<production connection string> OPENAI_API_KEY=<key> npm run ingest:embed
```

(`download`/`extract` don't touch the database, but `embed` does — make
sure `DATABASE_URL` points at the production DB, not your local one, for
that last command. You'll likely want your VM's Postgres port reachable
from your machine, or run these from a shell on the VM instead.)

## 4. Redeploying after code changes

Push to `main` — if Dokploy's GitHub integration has auto-deploy enabled
for this branch, it redeploys automatically; otherwise trigger a manual
deploy from the Dokploy UI. Schema changes: run `npm run db:generate`
locally to create a new migration file, commit it — `npm start` applies
any pending migrations on the next deploy automatically.
