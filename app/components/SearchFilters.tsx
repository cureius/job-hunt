"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MaxJobsOption, SearchFilters } from "@/lib/types";

interface SearchFiltersProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  maxJobs: MaxJobsOption;
  onMaxJobsChange: (v: MaxJobsOption) => void;
  disabled?: boolean;
}

export default function SearchFiltersPanel({ filters, onChange, maxJobs, onMaxJobsChange, disabled }: SearchFiltersProps) {
  function update(key: keyof SearchFilters, value: string | null) {
    const v = value === null || value === "any" ? undefined : value;
    onChange({ ...filters, [key]: v });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Location
        </label>
        <Input
          placeholder="e.g. Bangalore, India"
          value={filters.location || ""}
          onChange={(e) => update("location", e.target.value)}
          disabled={disabled}
          className="h-9 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Date Posted
        </label>
        <Select
          value={filters.datePosted || "any"}
          onValueChange={(v) => update("datePosted", v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any time</SelectItem>
            <SelectItem value="past-24h">Past 24 hours</SelectItem>
            <SelectItem value="past-week">Past week</SelectItem>
            <SelectItem value="past-month">Past month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Job Type
        </label>
        <Select
          value={filters.jobType || "any"}
          onValueChange={(v) => update("jobType", v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any type</SelectItem>
            <SelectItem value="full-time">Full-time</SelectItem>
            <SelectItem value="part-time">Part-time</SelectItem>
            <SelectItem value="contract">Contract</SelectItem>
            <SelectItem value="internship">Internship</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Experience Level
        </label>
        <Select
          value={filters.experienceLevel || "any"}
          onValueChange={(v) => update("experienceLevel", v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any level</SelectItem>
            <SelectItem value="entry">Entry level</SelectItem>
            <SelectItem value="associate">Associate</SelectItem>
            <SelectItem value="mid-senior">Mid-Senior level</SelectItem>
            <SelectItem value="director">Director</SelectItem>
            <SelectItem value="executive">Executive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Jobs per company
        </label>
        <Select
          value={String(maxJobs)}
          onValueChange={(v) => onMaxJobsChange(Number(v) as MaxJobsOption)}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10 jobs</SelectItem>
            <SelectItem value="25">25 jobs</SelectItem>
            <SelectItem value="50">50 jobs</SelectItem>
            <SelectItem value="100">100 jobs</SelectItem>
            <SelectItem value="0">All jobs</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
