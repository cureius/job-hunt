"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MapPin, Clock, Users, ExternalLink, ChevronRight } from "lucide-react";
import { formatRelativeDate, truncateText } from "@/lib/utils";
import type { Job } from "@/lib/types";

interface JobCardProps {
  job: Job;
  onViewDetails: (job: Job) => void;
}

const COMPANY_COLORS: Record<string, string> = {};
const COLOR_PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-green-100 text-green-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-teal-100 text-teal-700",
];

function getCompanyColor(company: string): string {
  if (!COMPANY_COLORS[company]) {
    const idx = Object.keys(COMPANY_COLORS).length % COLOR_PALETTE.length;
    COMPANY_COLORS[company] = COLOR_PALETTE[idx];
  }
  return COMPANY_COLORS[company];
}

export default function JobCard({ job, onViewDetails }: JobCardProps) {
  const initials = job.company
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <Card className="group h-full flex flex-col hover:shadow-md transition-shadow duration-200 border-border/60">
      <CardHeader className="pb-3 space-y-0">
        <div className="flex items-start gap-3">
          {/* Company logo / initials */}
          <div
            className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold ${getCompanyColor(job.searchedCompany)}`}
          >
            {job.companyLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={job.companyLogo} alt={job.company} className="h-8 w-8 object-contain rounded" />
            ) : (
              initials
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors">
              {job.title}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.company}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3">
        {/* Meta info */}
        <div className="space-y-1.5">
          {job.location && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin size={11} className="shrink-0" />
              <span className="truncate">{job.location}</span>
            </div>
          )}
          {job.postedAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock size={11} className="shrink-0" />
              <span>{formatRelativeDate(job.postedAt)}</span>
            </div>
          )}
          {job.applicantCount && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users size={11} className="shrink-0" />
              <span>{job.applicantCount}</span>
            </div>
          )}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          {job.employmentType && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              {job.employmentType}
            </Badge>
          )}
          {job.experienceLevel && (
            <Badge variant="outline" className="text-xs h-5 px-1.5">
              {job.experienceLevel}
            </Badge>
          )}
        </div>

        {/* Snippet */}
        {job.descriptionSnippet && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {truncateText(job.descriptionSnippet, 120)}
          </p>
        )}

        {/* Actions — pushed to bottom */}
        <div className="mt-auto flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1 h-8 text-xs gap-1"
            onClick={() => onViewDetails(job)}
          >
            View Details
            <ChevronRight size={12} />
          </Button>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open on LinkedIn"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
