# LinkedIn Job Aggregator

Search job openings across multiple companies on LinkedIn and export the results to Excel — completely free, no paid APIs.

## Features

- **Multi-company search** — add up to 10 companies as chips and search all at once
- **Smart filters** — location, date posted, job type, experience level
- **Card & Table view** — toggle between views, sort by any column
- **Job detail drawer** — slide-out panel with full job description
- **Client-side filtering** — filter by company, text search within results
- **Excel export** — download all visible jobs as a `.xlsx` file
- **Session caching** — results cached for 15 minutes (no re-fetching)

## Tech Stack

- [Next.js 14](https://nextjs.org/) (App Router)
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [SheetJS](https://sheetjs.com/) for Excel export
- LinkedIn Voyager API (via your own `li_at` session cookie)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Get your LinkedIn session cookie

1. Open [linkedin.com](https://www.linkedin.com) and log in
2. Press `F12` → **Application** tab → **Cookies** → `https://www.linkedin.com`
3. Find `li_at` and copy its **Value**

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click **Configure**, and paste your `li_at` cookie.

### 4. Deploy to Vercel

```bash
# Push to GitHub, then:
npx vercel --prod
```

No environment variables needed. No database. No external services.

## Usage

1. Click **Configure** (top-right) and paste your `li_at` LinkedIn cookie
2. Type company names in the input field and press `Enter` to add them as chips
3. Optionally expand **Filters** for location, date, job type, experience level
4. Click **Search Jobs**
5. Browse results in card or table view
6. Click any job to view the full job description in the detail panel
7. Click **Export Excel** to download all results as `.xlsx`

## Cost

**Zero.** This app uses your own LinkedIn session to fetch data — no paid APIs, no database, no external services.

| Item | Cost |
|------|------|
| Hosting (Vercel) | Free |
| LinkedIn data | Free (your own account) |
| Excel export | Free (open-source SheetJS) |

## Notes

- Your `li_at` cookie is stored only in your browser's `localStorage` — never on any server
- LinkedIn may rate-limit heavy usage; the app adds 1.5s delay between company searches
- Cookie typically lasts ~1 year; if expired, the app will prompt you to update it
- Read-only operation: the app only searches, never applies or modifies anything
