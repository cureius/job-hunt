# LinkedIn Job Aggregator — Implementation Plan

## Overview

A lightweight web application where users input company names, search LinkedIn for job openings at those companies, view detailed job descriptions, and export everything to Excel.

**Cost: Zero.** No paid APIs, no database, no external services.

---

## Architecture

### Tech Stack

| Layer            | Technology              | Purpose                                      |
| ---------------- | ----------------------- | -------------------------------------------- |
| Framework        | Next.js 14 (App Router) | Single project: frontend + API routes        |
| UI Components    | Tailwind CSS + shadcn/ui| Modern, responsive design                    |
| LinkedIn Data    | Voyager API + `li_at`   | User's own session cookie, zero API cost     |
| Excel Export     | SheetJS (`xlsx`)        | Runs in browser, no server needed            |
| State Management | React useState/context  | Lightweight, no external state library       |
| Persistence      | Browser localStorage    | Stores user config (cookie, preferences)     |
| Deployment       | Vercel (free tier)      | One-click deploy, auto SSL, custom subdomain |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Frontend)                       │
│                                                                 │
│  1. User enters company names (tag input)                       │
│  2. User clicks "Search Jobs"                                   │
│  3. Frontend reads li_at cookie from localStorage               │
│  4. Sends POST to /api/jobs with { companies, li_at, filters }  │
│  5. Receives structured job data                                │
│  6. Renders job cards / table                                   │
│  7. User clicks "Export Excel" → SheetJS generates .xlsx        │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   NEXT.JS API ROUTE (Server)                    │
│                                                                 │
│  /api/jobs (POST)                                               │
│  - Receives companies[] + li_at cookie                          │
│  - For each company: calls LinkedIn Voyager API                 │
│  - Normalizes deeply nested LinkedIn JSON → clean Job objects   │
│  - Returns { jobs: Job[], totalCount: number }                  │
│                                                                 │
│  /api/job-details (POST)                                        │
│  - Receives jobId + li_at cookie                                │
│  - Fetches full job posting from Voyager API                    │
│  - Returns full JD, skills, company info                        │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LINKEDIN VOYAGER API                        │
│                                                                 │
│  Endpoints used:                                                │
│                                                                 │
│  GET /voyager/api/voyagerJobsDashJobCards                       │
│    ?q=jobSearch                                                 │
│    &keywords={companyName}                                      │
│    &count=25&start=0                                            │
│                                                                 │
│  GET /voyager/api/jobs/jobPostings/{jobId}                      │
│                                                                 │
│  Auth: Cookie header with li_at + Csrf-Token header             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
linkedin-job-aggregator/
│
├── app/
│   ├── layout.tsx                      # Root layout, fonts, global styles
│   ├── page.tsx                        # Main page — search + results
│   ├── globals.css                     # Tailwind base styles
│   │
│   ├── api/
│   │   ├── jobs/
│   │   │   └── route.ts               # POST: search jobs by company names
│   │   └── job-details/
│   │       └── route.ts               # POST: fetch full JD for one job
│   │
│   └── components/
│       ├── Header.tsx                  # App header with logo + config button
│       ├── ConfigModal.tsx             # li_at cookie setup wizard
│       ├── CompanyInput.tsx            # Tag-based multi-company input
│       ├── SearchFilters.tsx           # Location, date, job type filters
│       ├── JobCard.tsx                 # Individual job card (grid view)
│       ├── JobTable.tsx                # Tabular results view
│       ├── JobDetailDrawer.tsx         # Slide-out panel for full JD
│       ├── ExportButton.tsx            # Excel download trigger
│       ├── LoadingState.tsx            # Skeleton loaders
│       ├── EmptyState.tsx              # No results illustration
│       └── ErrorBoundary.tsx           # Graceful error handling
│
├── lib/
│   ├── linkedin-client.ts             # Voyager API wrapper functions
│   ├── types.ts                       # TypeScript interfaces (Job, Config, etc.)
│   ├── config-store.ts                # localStorage helpers for user config
│   ├── excel-export.ts                # SheetJS export utility
│   └── utils.ts                       # Shared helpers (delay, debounce, etc.)
│
├── public/
│   └── favicon.ico
│
├── .env.local                          # Empty — no server secrets needed
├── .gitignore
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.js
└── README.md
```

---

## LinkedIn Authentication Strategy

### How It Works

1. LinkedIn uses a cookie called `li_at` to authenticate all API requests
2. This cookie is set when the user logs into linkedin.com in their browser
3. The user copies this cookie value and pastes it into our app (one-time setup)
4. Our API route uses it to call LinkedIn's internal Voyager API on the user's behalf

### How User Gets Their Cookie

1. Open linkedin.com in Chrome (must be logged in)
2. Press F12 → Application tab → Cookies → `linkedin.com`
3. Find `li_at` → copy the value
4. Paste into our app's config modal

### Storage

- Stored in browser `localStorage` as: `{ li_at: "AQE...", savedAt: "2026-03-10T..." }`
- Never sent to any third party
- Never persisted on any server or database
- User can clear it anytime from the config page

### Cookie Lifecycle

- `li_at` cookies typically last ~1 year
- If expired, LinkedIn returns 401 → app shows "Session expired, please update your cookie"
- User simply re-copies the new cookie value

---

## API Design

### POST /api/jobs

**Request:**
```json
{
  "companies": ["Google", "Microsoft", "Atlassian"],
  "li_at": "AQEDAQx...",
  "filters": {
    "location": "India",
    "datePosted": "past-week",
    "jobType": "full-time"
  }
}
```

**Response:**
```json
{
  "jobs": [
    {
      "id": "3812345678",
      "title": "Senior Software Engineer",
      "company": "Google",
      "companyLogo": "https://media.licdn.com/...",
      "location": "Bangalore, India",
      "postedAt": "2026-03-08",
      "employmentType": "Full-time",
      "experienceLevel": "Mid-Senior level",
      "applicantCount": "142 applicants",
      "url": "https://www.linkedin.com/jobs/view/3812345678",
      "descriptionSnippet": "We are looking for a Senior SWE to join..."
    }
  ],
  "totalCount": 47,
  "searchedCompanies": ["Google", "Microsoft", "Atlassian"]
}
```

### POST /api/job-details

**Request:**
```json
{
  "jobId": "3812345678",
  "li_at": "AQEDAQx..."
}
```

**Response:**
```json
{
  "id": "3812345678",
  "title": "Senior Software Engineer",
  "company": "Google",
  "location": "Bangalore, India",
  "descriptionHtml": "<p>About the role...</p>",
  "descriptionText": "About the role...",
  "skills": ["Python", "Distributed Systems", "Kubernetes"],
  "employmentType": "Full-time",
  "experienceLevel": "Mid-Senior level",
  "industries": ["Technology", "Internet"],
  "postedAt": "2026-03-08",
  "applicantCount": "142 applicants",
  "url": "https://www.linkedin.com/jobs/view/3812345678"
}
```

---

## UI Design

### Pages & Views

**Main Page (Single Page App)**

```
┌──────────────────────────────────────────────────┐
│  🔍 LinkedIn Job Aggregator          [⚙ Config]  │
├──────────────────────────────────────────────────┤
│                                                  │
│  Enter company names:                            │
│  ┌──────────────────────────────────────────┐    │
│  │ [Google ×] [Microsoft ×] [Atlassian ×]   │    │
│  │ Type company name...                     │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  Filters:                                        │
│  [Location ▼] [Date Posted ▼] [Job Type ▼]      │
│                                                  │
│  [🔍 Search Jobs]            [📥 Export Excel]   │
│                                                  │
├──────────────────────────────────────────────────┤
│                                                  │
│  Found 47 jobs across 3 companies                │
│  [Card View] [Table View]                        │
│                                                  │
│  ┌─────────────┐  ┌─────────────┐               │
│  │ Google      │  │ Microsoft   │               │
│  │ Sr. SWE     │  │ PM II       │               │
│  │ Bangalore   │  │ Hyderabad   │               │
│  │ Full-time   │  │ Full-time   │               │
│  │ 142 applied │  │ 89 applied  │               │
│  │ [Details]   │  │ [Details]   │               │
│  └─────────────┘  └─────────────┘               │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Config Modal**

```
┌──────────────────────────────────────┐
│  ⚙ Setup LinkedIn Connection        │
│                                      │
│  Step 1: Open linkedin.com           │
│  Step 2: Press F12 → Application     │
│          → Cookies → li_at           │
│  Step 3: Paste the value below       │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ Paste li_at cookie here...   │    │
│  └──────────────────────────────┘    │
│                                      │
│  [Test Connection]  [Save & Close]   │
│                                      │
│  Status: ✅ Connected as Raj P.      │
└──────────────────────────────────────┘
```

---

## Excel Export Format

Generated entirely in-browser using SheetJS. Columns:

| Column           | Source                     |
| ---------------- | -------------------------- |
| Company          | `job.company`              |
| Job Title        | `job.title`                |
| Location         | `job.location`             |
| Employment Type  | `job.employmentType`       |
| Experience Level | `job.experienceLevel`      |
| Posted Date      | `job.postedAt`             |
| Applicants       | `job.applicantCount`       |
| LinkedIn URL     | `job.url`                  |
| Description      | `job.descriptionText`      |

File name: `linkedin-jobs-YYYY-MM-DD.xlsx`

---

## Rate Limiting & Safety

| Concern                  | Mitigation                                              |
| ------------------------ | ------------------------------------------------------- |
| LinkedIn throttling      | 1.5s delay between company searches                     |
| Too many requests        | Max 10 companies per search batch                       |
| Repeated searches        | Cache results in `sessionStorage` for 15 min            |
| Cookie expiry            | Detect 401 → show "Update your cookie" prompt           |
| Account safety           | Read-only API calls (job search only, no writes)         |
| Large result sets        | Paginate at 25 per company, lazy-load on scroll          |

---

## Deployment

### Local Development

```bash
git clone <repo>
cd linkedin-job-aggregator
npm install
npm run dev
# Open http://localhost:3000
```

### Production (Vercel)

1. Push code to GitHub
2. Go to vercel.com → Import Project → Select repo
3. Click Deploy
4. App is live at `https://your-app.vercel.app`

No environment variables needed. No database to provision. No external services to configure.

---

## Future Enhancements (Optional, Post-MVP)

- **Saved searches**: Remember company lists in localStorage
- **Job alerts**: Periodic re-check with browser notifications
- **Resume matcher**: Compare JD keywords against uploaded resume
- **Multi-platform**: Add Naukri, Indeed support alongside LinkedIn
- **Bookmarking**: Save interesting jobs locally
- **Comparison view**: Side-by-side JD comparison for similar roles
