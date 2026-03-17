/**
 * LinkedIn public guest API client — no authentication required.
 *
 * Uses LinkedIn's publicly accessible endpoints:
 *   /jobs-guest/jobs/api/seeMoreJobPostings/search  → job listings (HTML)
 *   /jobs-guest/jobs/api/jobPosting/{id}            → job detail (HTML)
 *
 * No li_at cookie. No session. No logout risk.
 */

import * as cheerio from "cheerio";
import type { Job, JobDetail, SearchFilters } from "./types";
import { delay } from "./utils";

const GUEST_SEARCH_URL =
  "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const GUEST_JOB_URL =
  "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";

/** Headers that make requests look like a real browser — critical for LinkedIn */
function buildHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
  };
}

function datePostedToFilter(datePosted?: SearchFilters["datePosted"]): string {
  switch (datePosted) {
    case "past-24h":
      return "r86400";
    case "past-week":
      return "r604800";
    case "past-month":
      return "r2592000";
    default:
      return "";
  }
}

function jobTypeToFilter(jobType?: SearchFilters["jobType"]): string {
  switch (jobType) {
    case "full-time":
      return "F";
    case "part-time":
      return "P";
    case "contract":
      return "C";
    case "internship":
      return "I";
    default:
      return "";
  }
}

function experienceLevelToFilter(level?: SearchFilters["experienceLevel"]): string {
  switch (level) {
    case "entry":
      return "1,2";
    case "associate":
      return "3";
    case "mid-senior":
      return "4";
    case "director":
      return "5";
    case "executive":
      return "6";
    default:
      return "";
  }
}

/** Parse the HTML fragment returned by the guest search endpoint */
function parseJobCards(html: string, searchedCompany: string): Job[] {
  const $ = cheerio.load(html);
  const jobs: Job[] = [];

  // Each job is an <li> with a .base-card inside
  $("li").each((_, el) => {
    try {
      const card = $(el).find(".base-card, .job-search-card").first();
      if (!card.length) return;

      // Job ID from data attribute
      const urn =
        card.attr("data-entity-urn") ||
        $(el).attr("data-entity-urn") ||
        card.find("a[href*='/jobs/view/']").first().attr("href") ||
        "";

      let id =
        urn.includes("jobPosting:") ? urn.split("jobPosting:").pop()?.replace(/\D/g, "") :
        urn.match(/\/jobs\/view\/(\d+)/)?.[1] || "";

      if (!id) {
        const href =
          card.find("a[href*='/jobs/view/']").first().attr("href") ||
          $(el).find("a[href*='/jobs/view/']").first().attr("href") || "";
        id = href.match(/\/jobs\/view\/(\d+)/)?.[1] || "";
      }
      if (!id) return;

      const title =
        card.find(".base-search-card__title").text().trim() ||
        card.find("h3").first().text().trim() ||
        "";

      const company =
        card.find(".base-search-card__subtitle a, .base-search-card__subtitle").first().text().trim() ||
        card.find(".job-search-card__company-name").text().trim() ||
        "";

      const location =
        card.find(".job-search-card__location, .base-search-card__metadata .location").text().trim() ||
        card.find("[class*='location']").first().text().trim() ||
        "";

      const postedTime =
        card.find("time").attr("datetime") ||
        card.find(".job-search-card__listdate--new, .job-search-card__listdate").attr("datetime") ||
        "";

      const url =
        card.find("a.base-card__full-link, a[href*='/jobs/view/']").first().attr("href") || "";
      const cleanUrl = url
        ? `https://www.linkedin.com/jobs/view/${id}/`
        : `https://www.linkedin.com/jobs/view/${id}/`;

      const logoUrl =
        card.find("img.artdeco-entity-image, img[src*='company-logo']").first().attr("data-delayed-url") ||
        card.find("img").first().attr("src") ||
        "";

      jobs.push({
        id,
        title: title || "(No title)",
        company: company || searchedCompany,
        companyLogo: logoUrl || undefined,
        location,
        postedAt: postedTime || "",
        postedAtTimestamp: postedTime ? new Date(postedTime).getTime() : 0,
        employmentType: "",
        experienceLevel: "",
        applicantCount: "",
        url: cleanUrl,
        descriptionSnippet: "",
        searchedCompany,
      });
    } catch {
      // skip malformed cards
    }
  });

  return jobs;
}

const PAGE_SIZE = 10; // LinkedIn guest API returns 10 per page
const MAX_SAFE_PAGES = 20; // hard cap: 200 jobs per company max

/** Fetch a single page of results */
async function fetchPage(
  company: string,
  filters: SearchFilters,
  start: number
): Promise<{ jobs: Job[]; error?: string }> {
  const params = new URLSearchParams({
    keywords: company,
    start: String(start),
    count: String(PAGE_SIZE),
  });

  if (filters.location) params.set("location", filters.location);

  const dateFilter = datePostedToFilter(filters.datePosted);
  if (dateFilter) params.set("f_TPR", dateFilter);

  const jobTypeFilter = jobTypeToFilter(filters.jobType);
  if (jobTypeFilter) params.set("f_JT", jobTypeFilter);

  const expFilter = experienceLevelToFilter(filters.experienceLevel);
  if (expFilter) params.set("f_E", expFilter);

  const url = `${GUEST_SEARCH_URL}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: buildHeaders(),
      cache: "no-store",
    });

    if (res.status === 429) {
      await delay(3000);
      return { jobs: [], error: "rate_limited" };
    }
    if (!res.ok) return { jobs: [], error: `HTTP ${res.status}` };

    const html = await res.text();
    if (!html || html.trim().length < 50) return { jobs: [] };

    return { jobs: parseJobCards(html, company) };
  } catch (err) {
    return { jobs: [], error: err instanceof Error ? err.message : "network_error" };
  }
}

/**
 * Fetch all available jobs for a company by paginating through pages.
 * @param maxJobs  Upper limit. 0 = fetch all (up to MAX_SAFE_PAGES * PAGE_SIZE).
 */
export async function searchJobsByCompany(
  company: string,
  filters: SearchFilters = {},
  maxJobs = 0
): Promise<{ jobs: Job[]; error?: string }> {
  const allJobs: Job[] = [];
  const seenIds = new Set<string>();
  const effectiveMax = maxJobs > 0 ? maxJobs : MAX_SAFE_PAGES * PAGE_SIZE;

  for (let page = 0; page < MAX_SAFE_PAGES; page++) {
    if (allJobs.length >= effectiveMax) break;

    const start = page * PAGE_SIZE;
    const { jobs, error } = await fetchPage(company, filters, start);

    if (error) {
      // If first page fails, surface the error; otherwise return what we have
      if (page === 0) return { jobs: [], error };
      break;
    }

    if (jobs.length === 0) break; // no more results

    // Deduplicate by job ID
    for (const job of jobs) {
      if (!seenIds.has(job.id) && allJobs.length < effectiveMax) {
        seenIds.add(job.id);
        allJobs.push(job);
      }
    }

    // If LinkedIn returned fewer than PAGE_SIZE, we've hit the last page
    if (jobs.length < PAGE_SIZE) break;

    // Small delay between pages to avoid rate limiting
    if (page < MAX_SAFE_PAGES - 1) await delay(600);
  }

  return { jobs: allJobs };
}

/** Parse job detail HTML from the guest job posting endpoint */
function parseJobDetail(html: string, jobId: string): JobDetail {
  const $ = cheerio.load(html);

  const title =
    $(".top-card-layout__title, h2.top-card-layout__title").first().text().trim() ||
    $("h1, h2").first().text().trim() ||
    "";

  const company =
    $(".topcard__org-name-link, .top-card-layout__card .topcard__org-name-link").text().trim() ||
    $("a[data-tracking-control-name='public_jobs_topcard-org-name']").text().trim() ||
    $(".company-name").text().trim() ||
    "";

  const location =
    $(".topcard__flavor--bullet, .top-card-layout__card .topcard__flavor.topcard__flavor--bullet")
      .first().text().trim() ||
    $("[class*='location']").first().text().trim() ||
    "";

  const postedTime =
    $("time").attr("datetime") ||
    $(".posted-time-ago__text, .topcard__flavor--metadata-item").first().text().trim() ||
    "";

  // Employment type and experience level from the criteria list
  const criteriaItems: string[] = [];
  $(".description__job-criteria-item").each((_, el) => {
    criteriaItems.push($(el).find(".description__job-criteria-text").text().trim());
  });

  const employmentType = criteriaItems[0] || "";
  const experienceLevel = criteriaItems[1] || "";

  // Full description — prefer the rich HTML version, fall back to text
  const descriptionHtml =
    $(".show-more-less-html__markup").html() ||
    $(".description__text--rich").html() ||
    $(".description__text").html() ||
    "";

  const descriptionText =
    $(".show-more-less-html__markup").text().trim() ||
    $(".description__text--rich").text().trim() ||
    $(".description__text").text().trim() ||
    "";

  // Skills
  const skills: string[] = [];
  $(".skill-pill .skill-pill__label, .job-details-skill-match-status-list li").each((_, el) => {
    const skill = $(el).text().trim();
    if (skill) skills.push(skill);
  });

  const applicantCountText =
    $(".num-applicants__caption, .topcard__flavor--metadata-item:last-child").text().trim() || "";

  const logoUrl =
    $(".artdeco-entity-image, img[alt*='company logo']").first().attr("data-delayed-url") ||
    $("img.artdeco-entity-image").first().attr("src") ||
    "";

  return {
    id: jobId,
    title: title || "(No title)",
    company,
    companyLogo: logoUrl || undefined,
    location,
    postedAt: postedTime,
    postedAtTimestamp: postedTime ? new Date(postedTime).getTime() : 0,
    employmentType,
    experienceLevel,
    applicantCount: applicantCountText,
    url: `https://www.linkedin.com/jobs/view/${jobId}/`,
    descriptionSnippet: descriptionText.slice(0, 300),
    descriptionHtml: descriptionHtml || descriptionText,
    descriptionText,
    skills,
    industries: [],
    searchedCompany: company,
  };
}

export async function getJobDetails(
  jobId: string
): Promise<{ job: JobDetail | null; error?: string }> {
  const url = `${GUEST_JOB_URL}/${jobId}`;

  try {
    const res = await fetch(url, {
      headers: buildHeaders(),
      cache: "no-store",
    });

    if (res.status === 429) return { job: null, error: "rate_limited" };
    if (!res.ok) return { job: null, error: `HTTP ${res.status}` };

    const html = await res.text();
    const job = parseJobDetail(html, jobId);
    return { job };
  } catch (err) {
    return {
      job: null,
      error: err instanceof Error ? err.message : "network_error",
    };
  }
}
