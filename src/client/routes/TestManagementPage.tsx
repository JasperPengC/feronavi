import { useState } from "react";
import { TestPlans } from "../components/testing/TestPlans.tsx";
import { PageTabs, TabPanel } from "../components/ui/PageTabs.tsx";
import { useParams } from "@tanstack/react-router";
import { t, useLocale } from "../i18n/index.ts";
import { WorkItemViewHeader } from "../components/project/WorkItemViewHeader.tsx";
import { TestCaseLibrary } from "../components/testing/TestCaseLibrary.tsx";
export function TestManagementPage() {
  useLocale();
  const [view, setView] = useState("cases");
  const { projectId } = useParams({
    from: "/_app/projects/$projectId/testing",
  });
  return (
    <div className="page project-refinement testing-page">
      <WorkItemViewHeader projectId={projectId} active="testing" />
      <PageTabs
        id="testing"
        label={t("nav.testing")}
        value={view}
        onChange={setView}
        tabs={[
          { value: "cases", label: t("testing.cases") },
          { value: "plans", label: t("testing.plans") },
          { value: "reports", label: t("testing.runs") },
        ]}
      />
      <TabPanel tabsId="testing" value="cases" activeValue={view}>
        <TestCaseLibrary key={projectId} projectId={projectId} />
      </TabPanel>
      <TabPanel tabsId="testing" value="plans" activeValue={view}>
        <TestPlans key={projectId} projectId={projectId} />
      </TabPanel>
      <TabPanel tabsId="testing" value="reports" activeValue={view}>
        <TestPlans key={projectId} projectId={projectId} reports />
      </TabPanel>
    </div>
  );
}
