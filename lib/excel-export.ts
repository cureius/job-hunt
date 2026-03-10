import * as XLSX from "xlsx";
import type { Job } from "./types";
import { stripHtml, formatDate } from "./utils";

export function exportJobsToExcel(jobs: Job[]): void {
  if (!jobs || jobs.length === 0) return;

  const rows = jobs.map((job) => ({
    Company: job.company,
    "Job Title": job.title,
    Location: job.location,
    "Employment Type": job.employmentType || "—",
    "Experience Level": job.experienceLevel || "—",
    "Posted Date": formatDate(job.postedAt),
    Applicants: job.applicantCount || "—",
    "LinkedIn URL": job.url,
    Description: stripHtml(job.descriptionSnippet || ""),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = [
    { wch: 22 },  // Company
    { wch: 42 },  // Job Title
    { wch: 26 },  // Location
    { wch: 18 },  // Employment Type
    { wch: 20 },  // Experience Level
    { wch: 14 },  // Posted Date
    { wch: 16 },  // Applicants
    { wch: 52 },  // LinkedIn URL
    { wch: 80 },  // Description
  ];
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Jobs");

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `linkedin-jobs-${today}.xlsx`);
}
