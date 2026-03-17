import { NextRequest, NextResponse } from "next/server";
import { searchJobsByCompany } from "@/lib/linkedin-client";
import { delay } from "@/lib/utils";
import type { SearchFilters } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { companies, filters, maxJobs } = body as {
      companies?: string[];
      filters?: SearchFilters;
      maxJobs?: number; // 0 = fetch all
    };

    if (!Array.isArray(companies) || companies.length === 0) {
      return NextResponse.json(
        { error: "missing_companies", message: "At least one company name is required." },
        { status: 400 }
      );
    }

    const trimmed = companies
      .map((c) => String(c || "").trim())
      .filter(Boolean)
      .slice(0, 10);

    const allJobs = [];
    const errors: { company: string; message: string }[] = [];

    for (let i = 0; i < trimmed.length; i++) {
      const company = trimmed[i];
      if (i > 0) await delay(1000);

      const { jobs, error } = await searchJobsByCompany(
        company,
        filters || {},
        typeof maxJobs === "number" ? maxJobs : 0
      );

      if (error) {
        errors.push({ company, message: error });
      } else {
        allJobs.push(...jobs);
      }
    }

    return NextResponse.json({
      jobs: allJobs,
      totalCount: allJobs.length,
      searchedCompanies: trimmed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("[/api/jobs]", err);
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
