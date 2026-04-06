# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## Project Documentation

The `docs/` folder contains the authoritative technical documentation for this project. Start here before making changes to backend logic, the database, or background jobs.

| Document | What it covers |
|----------|---------------|
| [`docs/PROJECT_BIBLE.md`](docs/PROJECT_BIBLE.md) | Non-negotiable rules, architecture overview, golden rules. **Highest authority — read first.** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Brain + Muscle hybrid system, networking model, API boundaries |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | All database tables, columns, constraints, indexes, RLS rules |
| [`docs/INFRASTRUCTURE.md`](docs/INFRASTRUCTURE.md) | All Edge Functions, pg_cron, Vault, DB triggers, key DB functions, DigitalOcean Spaces |
| [`docs/BULK_JOBS.md`](docs/BULK_JOBS.md) | Background job system — all jobs, the lane/conflict system, how to add a new job |
| [`docs/STYLE_GROUPS.md`](docs/STYLE_GROUPS.md) | Style group lifecycle, rebuild stages, tag propagation, primary asset selection |
| [`docs/ADMIN_OPERATIONS.md`](docs/ADMIN_OPERATIONS.md) | Every admin-api route with parameters and return values (60+ routes) |
| [`docs/UI_OVERVIEW.md`](docs/UI_OVERVIEW.md) | All pages, detail panels, settings tabs, workflow status values |
| [`docs/WORKER_LOGIC.md`](docs/WORKER_LOGIC.md) | Synology Bridge Agent (NAS scanner) contract and rules |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deployment procedures |
| [`docs/PATH_UTILS.md`](docs/PATH_UTILS.md) | Path canonicalization and NAS path mapping |
| [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) | agent-api request/response contracts |

> **For AI assistants:** Read `docs/PROJECT_BIBLE.md` first — it lists which doc to consult for each type of question.

---

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
