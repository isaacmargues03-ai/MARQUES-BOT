"use client";

import { cn } from "@/lib/utils";
import type { Status } from "./chat-layout";

interface StatusIndicatorProps {
  status: Status;
  className?: string;
}

const statusConfig = {
  unauthenticated: { color: "bg-orange-500", text: "Authenticate" },
  connecting: { color: "bg-blue-500", text: "Connecting" },
  authentication_successful: { color: "bg-green-500", text: "Connected" },
  connected: { color: "bg-green-500", text: "Connected" },
  disconnected: { color: "bg-red-500", text: "Disconnected" },
};

export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className={cn("flex items-center gap-2 text-sm font-medium", className)}>
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full",
          config.color,
          status === "connecting" && "animate-pulse"
        )}
      />
      <span className="text-muted-foreground">{config.text}</span>
    </div>
  );
}
