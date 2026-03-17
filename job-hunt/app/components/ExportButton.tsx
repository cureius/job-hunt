"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { exportJobsToExcel } from "@/lib/excel-export";
import { toast } from "sonner";
import type { Job } from "@/lib/types";

interface ExportButtonProps {
  jobs: Job[];
  disabled?: boolean;
}

export default function ExportButton({ jobs, disabled }: ExportButtonProps) {
  function handleExport() {
    if (!jobs || jobs.length === 0) {
      toast.error("No jobs to export");
      return;
    }
    exportJobsToExcel(jobs);
    const today = new Date().toISOString().slice(0, 10);
    toast.success(`Downloaded linkedin-jobs-${today}.xlsx`, {
      description: `${jobs.length} jobs exported`,
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={handleExport}
      disabled={disabled || !jobs || jobs.length === 0}
    >
      <Download size={14} />
      Export Excel
      {jobs && jobs.length > 0 && (
        <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
          {jobs.length}
        </span>
      )}
    </Button>
  );
}
