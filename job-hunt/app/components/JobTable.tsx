"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";
import type { Job, SortConfig, SortField } from "@/lib/types";

interface JobTableProps {
  jobs: Job[];
  sort: SortConfig;
  onSortChange: (field: SortField) => void;
  onViewDetails: (job: Job) => void;
}

function SortIcon({ field, sort }: { field: SortField; sort: SortConfig }) {
  if (sort.field !== field) return <ArrowUpDown size={13} className="text-muted-foreground/50" />;
  return sort.direction === "asc" ? (
    <ArrowUp size={13} className="text-primary" />
  ) : (
    <ArrowDown size={13} className="text-primary" />
  );
}

function SortableHead({
  field,
  label,
  sort,
  onSortChange,
}: {
  field: SortField;
  label: string;
  sort: SortConfig;
  onSortChange: (f: SortField) => void;
}) {
  return (
    <TableHead
      className="cursor-pointer select-none whitespace-nowrap"
      onClick={() => onSortChange(field)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <SortIcon field={field} sort={sort} />
      </div>
    </TableHead>
  );
}

export default function JobTable({ jobs, sort, onSortChange, onViewDetails }: JobTableProps) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <SortableHead field="company" label="Company" sort={sort} onSortChange={onSortChange} />
              <SortableHead field="title" label="Job Title" sort={sort} onSortChange={onSortChange} />
              <TableHead>Location</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Level</TableHead>
              <SortableHead field="applicantCount" label="Applicants" sort={sort} onSortChange={onSortChange} />
              <SortableHead field="postedAt" label="Posted" sort={sort} onSortChange={onSortChange} />
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow
                key={job.id}
                className="cursor-pointer hover:bg-muted/30"
                onClick={() => onViewDetails(job)}
              >
                <TableCell className="font-medium text-sm whitespace-nowrap">{job.company}</TableCell>
                <TableCell className="max-w-[220px]">
                  <span className="text-sm font-medium line-clamp-2">{job.title}</span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {job.location || "—"}
                </TableCell>
                <TableCell>
                  {job.employmentType ? (
                    <Badge variant="secondary" className="text-xs whitespace-nowrap">
                      {job.employmentType}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {job.experienceLevel || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {job.applicantCount || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {job.postedAt ? formatRelativeDate(job.postedAt) : "—"}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-2"
                      onClick={() => onViewDetails(job)}
                    >
                      Details
                    </Button>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
