import { Briefcase } from "lucide-react";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Briefcase size={16} />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">LinkedIn Job Aggregator</p>
              <p className="text-xs text-muted-foreground leading-tight hidden sm:block">
                Search jobs across multiple companies · No login required
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
              Ready to search
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
