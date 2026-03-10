"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Copy, MapPin, Clock, Users, Briefcase, CheckCheck } from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";
import type { Job, JobDetail } from "@/lib/types";

interface JobDetailDrawerProps {
  job: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function JobDetailDrawer({ job, open, onOpenChange }: JobDetailDrawerProps) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<Record<string, JobDetail>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!job || !open) return;
    if (cache[job.id]) {
      setDetail(cache[job.id]);
      return;
    }
    setDetail(null);
    setLoading(true);

    fetch("/api/job-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.job) {
          setDetail(data.job);
          setCache((prev) => ({ ...prev, [job.id]: data.job }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [job, open]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCopy() {
    const text = detail?.descriptionText || job?.descriptionSnippet || "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const displayed = detail || job;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto flex flex-col gap-0 p-0">
        {displayed ? (
          <>
            {/* Header */}
            <SheetHeader className="p-6 pb-4 border-b bg-muted/20 space-y-0">
              <div className="pr-8">
                <SheetTitle className="text-base font-bold leading-snug">{displayed.title}</SheetTitle>
                <p className="text-sm text-muted-foreground mt-1">{displayed.company}</p>
              </div>

              <div className="flex flex-wrap gap-2 pt-3">
                {displayed.location && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin size={11} />
                    {displayed.location}
                  </div>
                )}
                {displayed.postedAt && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={11} />
                    {formatRelativeDate(displayed.postedAt)}
                  </div>
                )}
                {displayed.applicantCount && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users size={11} />
                    {displayed.applicantCount}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 pt-2">
                {displayed.employmentType && (
                  <Badge variant="secondary" className="text-xs">
                    <Briefcase size={10} className="mr-1" />
                    {displayed.employmentType}
                  </Badge>
                )}
                {displayed.experienceLevel && (
                  <Badge variant="outline" className="text-xs">{displayed.experienceLevel}</Badge>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-3">
                <a
                  href={displayed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
                >
                  <ExternalLink size={12} />
                  Open on LinkedIn
                </a>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopy}>
                  {copied ? <CheckCheck size={12} className="text-green-500" /> : <Copy size={12} />}
                  {copied ? "Copied!" : "Copy JD"}
                </Button>
              </div>
            </SheetHeader>

            {/* Skills */}
            {detail?.skills && detail.skills.length > 0 && (
              <div className="px-6 py-4 border-b">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Skills
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.skills.map((skill) => (
                    <Badge key={skill} variant="secondary" className="text-xs font-normal">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div className="px-6 py-4 flex-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Job Description
              </p>

              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className={`h-3 ${i % 3 === 2 ? "w-3/5" : "w-full"}`} />
                  ))}
                </div>
              ) : detail?.descriptionText ? (
                <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {detail.descriptionText}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {job?.descriptionSnippet || "No description available. Open on LinkedIn to view."}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="p-6 space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="space-y-2 pt-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
