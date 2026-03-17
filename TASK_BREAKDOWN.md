# LinkedIn Job Aggregator — Task Breakdown

> Each task is a self-contained unit of work. Complete them in order.
> Estimated total effort: ~8-10 hours for MVP.

---

## Phase 1: Project Setup & Foundation

### Task 1.1 — Initialize Next.js Project ✅
- [x] Run `npx create-next-app@latest linkedin-job-aggregator` with TypeScript + Tailwind + App Router
- [x] Clean up default boilerplate (remove demo content from `page.tsx`)
- [x] Verify `npm run dev` works at `http://localhost:3000`

### Task 1.2 — Install Dependencies ✅
- [x] Install `xlsx` (SheetJS) for Excel export
- [x] Install shadcn/ui CLI and initialize: `npx shadcn@latest init`
- [x] Add shadcn components: `button`, `input`, `badge`, `card`, `dialog`, `sheet`, `table`, `select`, `tabs`, `sonner`, `skeleton`
- [x] Verify all imports resolve without errors

### Task 1.3 — Define TypeScript Types ✅
- [x] Create `lib/types.ts`
- [x] Define `LinkedInConfig` interface: `{ li_at: string; savedAt: string }`
- [x] Define `Job` interface with all fields (id, title, company, location, etc.)
- [x] Define `JobDetail` interface (extends Job with full description, skills)
- [x] Define `SearchFilters` interface (location, datePosted, jobType)
- [x] Define `SearchResponse` interface (jobs array, totalCount, errors)
- [x] Export all types

### Task 1.4 — Create Utility Modules ✅
- [x] Create `lib/config-store.ts`:
  - [x] `getConfig(): LinkedInConfig | null` — read from localStorage
  - [x] `saveConfig(config: LinkedInConfig): void` — write to localStorage
  - [x] `clearConfig(): void` — remove from localStorage
  - [x] `isConfigured(): boolean` — check if li_at exists
- [x] Create `lib/utils.ts`:
  - [x] `delay(ms: number): Promise<void>` — for rate limiting
  - [x] `cn(...classes)` — Tailwind class merge utility (shadcn provides this)
  - [x] `formatDate(dateString: string): string` — human-readable dates
  - [x] `truncateText(text: string, maxLen: number): string`
  - [x] `getSessionCache / setSessionCache` — 15-min TTL result caching
  - [x] `hashString` — for cache key generation

---

## Phase 2: LinkedIn API Integration

### Task 2.1 — Build LinkedIn Voyager Client ✅
- [x] Create `lib/linkedin-client.ts`
- [x] Implement `buildHeaders(liAt: string)` function:
  - [x] Set `Cookie: li_at={value}`
  - [x] Set `Csrf-Token: ajax:0000000000000`
  - [x] Set `x-li-lang: en_US`
  - [x] Set `x-restli-protocol-version: 2.0.0`
  - [x] Set appropriate `User-Agent`
- [x] Implement `searchJobsByCompany(company: string, liAt: string, start?: number)`:
  - [x] Build Voyager search URL with query params
  - [x] Make GET request with auth headers
  - [x] Parse LinkedIn's nested JSON response
  - [x] Extract job cards: id, title, company, location, posted date, etc.
  - [x] Return normalized `Job[]` array
- [x] Implement `getJobDetails(jobId: string, liAt: string)`:
  - [x] Build Voyager job posting URL
  - [x] Make GET request with auth headers
  - [x] Parse full job posting response
  - [x] Extract: description HTML/text, skills, experience level, etc.
  - [x] Return normalized `JobDetail` object
- [x] Implement `testConnection(liAt: string)`:
  - [x] Make a lightweight Voyager call
  - [x] Return `{ valid: boolean, name?: string }` (user's name if valid)
- [x] Add error handling:
  - [x] 401 → return `{ error: "session_expired" }`
  - [x] 429 → return `{ error: "rate_limited" }`
  - [x] Network errors → return `{ error: "network_error" }`

### Task 2.2 — Create Job Search API Route ✅
- [x] Create `app/api/jobs/route.ts`
- [x] Accept POST with body: `{ companies: string[], li_at: string, filters?: SearchFilters }`
- [x] Validate input:
  - [x] `companies` must be non-empty array, max 10 items
  - [x] `li_at` must be non-empty string
- [x] For each company:
  - [x] Call `searchJobsByCompany()`
  - [x] Add 1.5 second delay between companies (rate limiting)
  - [x] Collect results, tag each job with the searched company
- [x] Aggregate all results
- [x] Return `{ jobs: Job[], totalCount: number, searchedCompanies: string[] }`
- [x] Handle errors gracefully (partial failures: return jobs found + error list)

### Task 2.3 — Create Job Details API Route ✅
- [x] Create `app/api/job-details/route.ts`
- [x] Accept POST with body: `{ jobId: string, li_at: string }`
- [x] Call `getJobDetails()`
- [x] Return full `JobDetail` object
- [x] Handle 401/429/network errors

### Task 2.4 — Test API Routes Manually
- [ ] Use browser console or curl to test `/api/jobs` with a real `li_at` cookie
- [ ] Verify response structure matches `Job` interface
- [ ] Test `/api/job-details` with a real job ID
- [ ] Test with expired/invalid cookie → verify error response

---

## Phase 3: Frontend — Config & Input

### Task 3.1 — Build App Layout ✅
- [x] Create `app/layout.tsx`:
  - [x] Set up HTML metadata (title, description)
  - [x] Import global styles and fonts (Geist from Google Fonts)
  - [x] Add Toaster (sonner) component for notifications
- [x] `app/globals.css` with Tailwind directives + shadcn theme

### Task 3.2 — Build Header Component ✅
- [x] Create `app/components/Header.tsx`
- [x] App title/logo: "LinkedIn Job Aggregator"
- [x] Config button (gear icon) → opens ConfigModal
- [x] Connection status indicator: green/grey wifi icon

### Task 3.3 — Build Config Modal ✅
- [x] Create `app/components/ConfigModal.tsx`
- [x] Modal/dialog using shadcn `Dialog`
- [x] Step-by-step instructions for getting the li_at cookie
- [x] Password-style input with show/hide toggle
- [x] "Test Connection" button with loading spinner and success/error state
- [x] "Save & Connect" button → stores to localStorage
- [x] "Clear" (trash) button → removes from localStorage
- [x] Auto-open on first visit if no config found

### Task 3.4 — Build Company Input Component ✅
- [x] Create `app/components/CompanyInput.tsx`
- [x] Text input field with placeholder
- [x] On Enter/comma: trim, deduplicate, add as badge chip
- [x] Each chip shows company name + X button to remove
- [x] "Clear All" link
- [x] Max 10 companies limit with counter
- [x] Backspace removes last chip when input is empty
- [x] Inline "Add X" suggestion button

### Task 3.5 — Build Search Filters Component ✅
- [x] Create `app/components/SearchFilters.tsx`
- [x] Location text input (optional, free text)
- [x] Date Posted dropdown: Any time, Past 24h, Past week, Past month
- [x] Job Type dropdown: Any, Full-time, Part-time, Contract, Internship
- [x] Experience Level dropdown: Any, Entry, Associate, Mid-Senior, Director, Executive
- [x] Hidden by default, shown via "Show filters" toggle

---

## Phase 4: Frontend — Results Display

### Task 4.1 — Build Main Page Logic ✅
- [x] Create `app/page.tsx`
- [x] State management:
  - [x] `companies: string[]` — list of company names
  - [x] `jobs: Job[]` — search results
  - [x] `filters: SearchFilters` — current filters
  - [x] `loading: boolean` — search in progress
  - [x] `errorType` — session-expired / error / null
  - [x] `viewMode: "card" | "table"` — toggle between views
- [x] "Search Jobs" button handler:
  - [x] Validate: at least 1 company, config exists
  - [x] Read li_at from localStorage
  - [x] POST to `/api/jobs`
  - [x] Set results in state
  - [x] Cache in sessionStorage (15 min TTL)
- [x] Compose all components: Header, CompanyInput, SearchFilters, Results area, ExportButton
- [x] Responsive layout using Tailwind grid

### Task 4.2 — Build Job Card Component ✅
- [x] Create `app/components/JobCard.tsx`
- [x] Company initials avatar with color-coded background per company
- [x] Job title, company name, location, posted date, applicant count
- [x] Employment type + experience level badges
- [x] Description snippet (truncated to 120 chars)
- [x] "View Details" button + "Open on LinkedIn" link
- [x] Hover shadow effect

### Task 4.3 — Build Job Table Component ✅
- [x] Create `app/components/JobTable.tsx`
- [x] Sortable columns: Company, Title, Posted, Applicants
- [x] Sort direction indicator arrows
- [x] Row click → open detail drawer
- [x] External link per row

### Task 4.4 — Build Job Detail Drawer ✅
- [x] Create `app/components/JobDetailDrawer.tsx`
- [x] Slide-out panel from right using shadcn `Sheet`
- [x] Lazy-fetches full JD from `/api/job-details` on open
- [x] Per-job cache (no re-fetching on re-open)
- [x] Skeleton loader while fetching
- [x] Skills tags, full description, all metadata
- [x] "Open on LinkedIn" link + "Copy JD" button with clipboard feedback
- [x] Session expired → fires `onSessionExpired` callback

### Task 4.5 — Build Loading & Empty States ✅
- [x] `LoadingState.tsx`: 6 skeleton cards in grid
- [x] `EmptyState.tsx`: 4 states — initial, no-results, session-expired, error
- [x] Retry and Configure action buttons per state

### Task 4.6 — Build Client-Side Filtering ✅
- [x] Company filter chips (click to toggle per-company filter)
- [x] Text search across title + company + location + snippet
- [x] "Showing X of Y jobs" counter
- [x] "Clear filters" button
- [x] All filtering is instant, no API call

---

## Phase 5: Excel Export

### Task 5.1 — Build Excel Export Utility ✅
- [x] Create `lib/excel-export.ts`
- [x] `exportJobsToExcel(jobs: Job[]): void`
  - [x] Column headers: Company, Job Title, Location, Employment Type, Experience Level, Posted Date, Applicants, LinkedIn URL, Description
  - [x] Column widths set for readability
  - [x] Generates `linkedin-jobs-YYYY-MM-DD.xlsx`

### Task 5.2 — Build Export Button Component ✅
- [x] Create `app/components/ExportButton.tsx`
- [x] Download icon + job count badge
- [x] Disabled when no jobs loaded
- [x] Success toast with filename and count
- [x] Exports currently filtered (visible) jobs only

---

## Phase 6: Polish & Error Handling

### Task 6.1 — Error Handling & Edge Cases ✅
- [x] API: Invalid/missing li_at → 400 with clear message
- [x] API: 401/403 from LinkedIn → `session_expired` error propagated
- [x] API: 429 → `rate_limited` with 3s delay
- [x] API: Partial company failures → return successes + errors array
- [x] Frontend: Toast notifications for all error states (sonner)
- [x] Frontend: Auto-open config modal on session_expired
- [x] Frontend: Retry button on network errors
- [x] Input: Whitespace trimmed, duplicates rejected, max 10 enforced

### Task 6.2 — Response Caching ✅
- [x] Search results cached in `sessionStorage` with 15-min TTL
- [x] Cache key = hash of `{ companies, filters }`
- [x] Job details cached in component state (Map jobId → JobDetail)
- [x] "Refresh" button bypasses cache

### Task 6.3 — Responsive Design ✅
- [x] Mobile: single column card grid, collapsible filters
- [x] Tablet: two column grid
- [x] Desktop: three column grid, slide-out drawer (max-w-2xl)
- [x] Header collapses subtitle and status text on small screens

### Task 6.4 — Final UI Polish ✅
- [x] Page title "LinkedIn Job Aggregator" in browser tab
- [x] Hover shadow on job cards
- [x] Enter/comma to add company, Backspace to remove last chip
- [x] Loading message updates as search progresses
- [x] Toast notifications: search complete, export, cache hit, errors
- [x] Company color-coded chips in both input and result filters

---

## Phase 7: Deployment

### Task 7.1 — Prepare for Production ✅
- [x] `.gitignore` auto-generated by create-next-app
- [x] `README.md` written with full usage, setup, and deploy instructions
- [x] `npm run build` passes with zero errors or warnings
- [ ] Test production build locally: `npm run start`

### Task 7.2 — Deploy to Vercel
- [ ] Create GitHub repository
- [ ] Push code to GitHub
- [ ] Go to vercel.com → "New Project" → Import GitHub repo
- [ ] No environment variables needed
- [ ] Click "Deploy"
- [ ] Verify app works at `https://your-app.vercel.app`

### Task 7.3 — Post-Deploy Verification
- [ ] Test with real LinkedIn `li_at` cookie
- [ ] Test full flow: config → search → view details → export
- [ ] Test on Chrome, Firefox, Safari
- [ ] Test on mobile (responsive)
- [ ] Test with expired cookie → proper error message

---

## Summary

| Phase   | Tasks | Estimated Time |
| ------- | ----- | -------------- |
| Phase 1 | 4     | 1 hour         |
| Phase 2 | 4     | 2.5 hours      |
| Phase 3 | 5     | 2 hours        |
| Phase 4 | 6     | 2.5 hours      |
| Phase 5 | 2     | 0.5 hours      |
| Phase 6 | 4     | 1.5 hours      |
| Phase 7 | 3     | 0.5 hours      |
| **Total** | **28** | **~10 hours** |

### Priority Order (If Short on Time)

**Must-have (MVP):** Tasks 1.1–1.4, 2.1–2.2, 3.1–3.4, 4.1–4.2, 5.1–5.2, 7.1–7.2
**Nice-to-have:** Tasks 2.3, 3.5, 4.3–4.6, 6.1–6.4, 7.3

MVP can be delivered in ~5-6 hours.
