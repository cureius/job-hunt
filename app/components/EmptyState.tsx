import { Briefcase, SearchX, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type EmptyStateType = "initial" | "no-results" | "session-expired" | "error";

interface EmptyStateProps {
  type: EmptyStateType;
  message?: string;
  onRetry?: () => void;
  onConfigure?: () => void;
}

const CONFIG: Record<EmptyStateType, { icon: React.ElementType; title: string; description: string }> = {
  initial: {
    icon: Briefcase,
    title: "Start searching",
    description: "Enter one or more company names above and click Search to find open job listings.",
  },
  "no-results": {
    icon: SearchX,
    title: "No jobs found",
    description: "We couldn't find any job listings for those companies. Try different names or adjust your filters.",
  },
  "session-expired": {
    icon: WifiOff,
    title: "Session expired",
    description: "Your LinkedIn session has expired. Please update your li_at cookie in the configuration.",
  },
  error: {
    icon: RefreshCw,
    title: "Something went wrong",
    description: "We ran into an issue while fetching jobs. Check your connection and try again.",
  },
};

export default function EmptyState({ type, message, onRetry, onConfigure }: EmptyStateProps) {
  const { icon: Icon, title, description } = CONFIG[type];

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
        <Icon size={28} className="text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-5">{message || description}</p>

      <div className="flex gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
            <RefreshCw size={13} />
            Retry
          </Button>
        )}
        {onConfigure && (
          <Button size="sm" onClick={onConfigure}>
            Update Cookie
          </Button>
        )}
      </div>
    </div>
  );
}
