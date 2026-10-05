"use client";

// The agent shell in « Aurore » (prototypes/agent-shell-v2.html): `.agt` carries the prototype's
// tokens (agent.css, scoped by a script), `.stage` the page gradient, then the band `.ah`, the
// page `.agt-main > .page`, and on a phone `.mtop` / `.mtitle` / the bottom `.mtabs` instead of the
// band. Every agent page renders the children of `.page`.

import { QueueSearchProvider } from "@/context/queue-search";
import { FeedbackCaptureProvider } from "@/components/feedback/FeedbackCaptureProvider";
import { AgentToastProvider } from "@/components/agent/shared";
import { AgentHeader, AgentPhoneTop } from "@/components/agent/shell/AgentHeader";
import { AgentNav } from "@/components/agent/shell/AgentNav";
import { AgentTabsContainer } from "./AgentTabsContainer";
import type { AuthUser } from "@/types";
import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";

export function AgentDashboardShell({ user, children }: { user: AuthUser; children?: React.ReactNode }) {
  return (
    <QueueSearchProvider>
      <FeedbackCaptureProvider role={user.role}>
        <div className="agt" dir={user.direction === "rtl" ? "rtl" : "ltr"} lang={user.locale}>
          <AgentToastProvider>
            <div className="stage">
              <AgentHeader user={user} />
              <AgentPhoneTop user={user} />
              <AgentTabsContainer user={user}>{children}</AgentTabsContainer>
              <AgentNav user={user} variant="phone" />
            </div>
          </AgentToastProvider>
        </div>
      </FeedbackCaptureProvider>
    </QueueSearchProvider>
  );
}
