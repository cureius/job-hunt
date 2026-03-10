export interface LinkedInConfig {
  li_at: string;
  savedAt: string;
}

export interface SearchFilters {
  location?: string;
  datePosted?: "any" | "past-24h" | "past-week" | "past-month";
  jobType?: "any" | "full-time" | "part-time" | "contract" | "internship";
  experienceLevel?: "any" | "entry" | "associate" | "mid-senior" | "director" | "executive";
}

/** 0 = fetch all available pages */
export type MaxJobsOption = 10 | 25 | 50 | 100 | 0;

export interface Job {
  id: string;
  title: string;
  company: string;
  companyLogo?: string;
  location: string;
  postedAt: string;
  postedAtTimestamp?: number;
  employmentType: string;
  experienceLevel: string;
  applicantCount: string;
  url: string;
  descriptionSnippet: string;
  searchedCompany: string;
}

export interface JobDetail extends Job {
  descriptionHtml: string;
  descriptionText: string;
  skills: string[];
  industries: string[];
}

export interface SearchResponse {
  jobs: Job[];
  totalCount: number;
  searchedCompanies: string[];
  errors?: { company: string; message: string }[];
}

export interface JobDetailResponse {
  job: JobDetail | null;
  error?: string;
}

export type ViewMode = "card" | "table";

export type SortField = "company" | "title" | "postedAt" | "applicantCount";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}
