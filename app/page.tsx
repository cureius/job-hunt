"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  LayoutGrid,
  Table2,
  SlidersHorizontal,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import CompanyInput from "./components/CompanyInput";
import SearchFiltersPanel from "./components/SearchFilters";
import JobCard from "./components/JobCard";
import JobTable from "./components/JobTable";
import JobDetailDrawer from "./components/JobDetailDrawer";
import LoadingState from "./components/LoadingState";
import EmptyState from "./components/EmptyState";
import ExportButton from "./components/ExportButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { getSessionCache, setSessionCache, hashString } from "@/lib/utils";
import type { Job, MaxJobsOption, SearchFilters, ViewMode, SortConfig, SortField } from "@/lib/types";

const DEFAULT_FILTERS: SearchFilters = {};
const DEFAULT_SORT: SortConfig = { field: "postedAt", direction: "desc" };

export default function HomePage() {
  const [companies, setCompanies] = useState<string[]>([]);
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [maxJobs, setMaxJobs] = useState<MaxJobsOption>(25);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [errorType, setErrorType] = useState<"error" | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Client-side filter state
  const [textSearch, setTextSearch] = useState("");
  const [activeCompanyFilters, setActiveCompanyFilters] = useState<string[]>([]);

  async function handleSearch(bypassCache = false) {
    if (companies.length === 0) {
      toast.error("Please enter at least one company name");
      return;
    }

    // Check session cache
    if (!bypassCache) {
      const cacheKey = hashString(JSON.stringify({ companies, filters, maxJobs }));
      const cached = getSessionCache<Job[]>(cacheKey);
      if (cached) {
        setJobs(cached);
        setHasSearched(true);
        setActiveCompanyFilters([]);
        setTextSearch("");
        toast.success(`Loaded ${cached.length} jobs from cache`);
        return;
      }
    }

    setLoading(true);
    setErrorType(null);
    setHasSearched(true);
    setJobs([]);
    setActiveCompanyFilters([]);
    setTextSearch("");
    setLoadingMessage(`Searching ${companies[0]}…`);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies, filters, maxJobs }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorType("error");
        toast.error(data.message || "Failed to fetch jobs");
        setLoading(false);
        return;
      }

      const results: Job[] = data.jobs || [];
      setJobs(results);

      // Cache the results
      const cacheKey = hashString(JSON.stringify({ companies, filters, maxJobs }));
      setSessionCache(cacheKey, results);

      if (data.errors?.length) {
        data.errors.forEach((e: { company: string; message: string }) => {
          toast.warning(`${e.company}: ${e.message}`);
        });
      }

      if (results.length === 0) {
        toast.info("No jobs found for those companies");
      } else {
        toast.success(`Found ${results.length} jobs across ${companies.length} ${companies.length === 1 ? "company" : "companies"}`);
      }
    } catch {
      setErrorType("error");
      toast.error("Network error. Please check your connection.");
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  }

  function handleSortChange(field: SortField) {
    setSort((prev) =>
      prev.field === field
        ? { field, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "asc" }
    );
  }

  function handleViewDetails(job: Job) {
    setSelectedJob(job);
    setDrawerOpen(true);
  }

  // Unique companies in results (for filter chips)
  const resultCompanies = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.searchedCompany))),
    [jobs]
  );

  // Filtered + sorted jobs
  const displayedJobs = useMemo(() => {
    let filtered = [...jobs];

    if (activeCompanyFilters.length > 0) {
      filtered = filtered.filter((j) => activeCompanyFilters.includes(j.searchedCompany));
    }

    if (textSearch.trim()) {
      const q = textSearch.toLowerCase();
      filtered = filtered.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          j.location.toLowerCase().includes(q) ||
          j.descriptionSnippet.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sort.field === "company") cmp = a.company.localeCompare(b.company);
      else if (sort.field === "title") cmp = a.title.localeCompare(b.title);
      else if (sort.field === "postedAt")
        cmp = (a.postedAtTimestamp || 0) - (b.postedAtTimestamp || 0);
      else if (sort.field === "applicantCount") {
        cmp = parseInt(a.applicantCount || "0") - parseInt(b.applicantCount || "0");
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [jobs, activeCompanyFilters, textSearch, sort]);

  const isFiltered = activeCompanyFilters.length > 0 || textSearch.trim() !== "";

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Search panel */}
      <div className="rounded-xl border bg-card shadow-sm p-5 sm:p-6 space-y-5">
        <CompanyInput companies={companies} onChange={setCompanies} disabled={loading} />

        {/* Filters toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <SlidersHorizontal size={13} />
            {showFilters ? "Hide filters" : "Show filters"}
          </button>
          {showFilters && (
            <div className="mt-3">
              <SearchFiltersPanel
                filters={filters}
                onChange={setFilters}
                maxJobs={maxJobs}
                onMaxJobsChange={setMaxJobs}
                disabled={loading}
              />
            </div>
          )}
        </div>

        {/* Search button + jobs-per-company quick selector */}
        <div className="flex gap-2 flex-wrap items-center">
          {/* Quick jobs-per-company selector (always visible, no need to expand filters) */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Jobs per company:</span>
            <Select
              value={String(maxJobs)}
              onValueChange={(v) => setMaxJobs(Number(v) as MaxJobsOption)}
              disabled={loading}
            >
              <SelectTrigger className="h-9 w-28 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="0">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => handleSearch(false)}
            disabled={loading || companies.length === 0}
            className="gap-2 flex-1 sm:flex-none"
          >
            {loading ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                {loadingMessage || "Searching…"}
              </>
            ) : (
              <>
                <Search size={14} />
                Search Jobs
              </>
            )}
          </Button>

          {hasSearched && jobs.length > 0 && (
            <Button
              variant="outline"
              onClick={() => handleSearch(true)}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw size={13} />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {/* Results area */}
      {loading ? (
        <LoadingState message={loadingMessage} />
      ) : errorType === "error" ? (
        <EmptyState type="error" onRetry={() => handleSearch(true)} />
      ) : !hasSearched ? (
        <EmptyState type="initial" />
      ) : jobs.length === 0 ? (
        <EmptyState type="no-results" />
      ) : (
        <div className="space-y-4">
          {/* Results toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">
                {isFiltered
                  ? `Showing ${displayedJobs.length} of ${jobs.length} jobs`
                  : `${jobs.length} jobs found`}
              </p>
              {isFiltered && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1 text-muted-foreground"
                  onClick={() => {
                    setActiveCompanyFilters([]);
                    setTextSearch("");
                  }}
                >
                  <X size={11} />
                  Clear filters
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <ExportButton jobs={displayedJobs} />

              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <TabsList className="h-8">
                  <TabsTrigger value="card" className="h-6 px-2 gap-1 text-xs">
                    <LayoutGrid size={12} />
                    Cards
                  </TabsTrigger>
                  <TabsTrigger value="table" className="h-6 px-2 gap-1 text-xs">
                    <Table2 size={12} />
                    Table
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Company filter chips */}
          {resultCompanies.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {resultCompanies.map((company) => {
                const active = activeCompanyFilters.includes(company);
                const count = jobs.filter((j) => j.searchedCompany === company).length;
                return (
                  <button
                    key={company}
                    type="button"
                    onClick={() =>
                      setActiveCompanyFilters((prev) =>
                        active ? prev.filter((c) => c !== company) : [...prev, company]
                      )
                    }
                    className="focus:outline-none"
                  >
                    <Badge
                      variant={active ? "default" : "secondary"}
                      className="cursor-pointer text-xs gap-1 transition-colors"
                    >
                      {company}
                      <span className="opacity-70">{count}</span>
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}

          {/* Text search */}
          <div className="relative max-w-sm">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search within results…"
              value={textSearch}
              onChange={(e) => setTextSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
            {textSearch && (
              <button
                type="button"
                onClick={() => setTextSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Jobs display */}
          {displayedJobs.length === 0 ? (
            <EmptyState type="no-results" message="No jobs match your current filters." />
          ) : viewMode === "card" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayedJobs.map((job) => (
                <JobCard key={job.id} job={job} onViewDetails={handleViewDetails} />
              ))}
            </div>
          ) : (
            <JobTable
              jobs={displayedJobs}
              sort={sort}
              onSortChange={handleSortChange}
              onViewDetails={handleViewDetails}
            />
          )}
        </div>
      )}

      {/* Job detail drawer */}
      <JobDetailDrawer
        job={selectedJob}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
