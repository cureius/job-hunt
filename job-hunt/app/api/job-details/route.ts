import { NextRequest, NextResponse } from "next/server";
import { getJobDetails } from "@/lib/linkedin-client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId } = body as { jobId?: string };

    if (!jobId || typeof jobId !== "string" || !jobId.trim()) {
      return NextResponse.json(
        { error: "missing_job_id", message: "jobId is required." },
        { status: 400 }
      );
    }

    const { job, error } = await getJobDetails(jobId.trim());

    if (error || !job) {
      return NextResponse.json(
        { error: error || "not_found", message: "Could not fetch job details." },
        { status: 502 }
      );
    }

    return NextResponse.json({ job });
  } catch (err) {
    console.error("[/api/job-details]", err);
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
