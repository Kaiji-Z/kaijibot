import { render } from "lit";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DEFAULT_CRON_FORM } from "../app-defaults.ts";
import type { CronJob } from "../types.ts";
import { renderCron, resetCronViewStateForTests, type CronProps } from "./cron.ts";

function createJob(id: string, overrides: Partial<CronJob> = {}): CronJob {
  return {
    id,
    name: "Daily ping",
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: "cron", expr: "0 9 * * *" },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "ping" },
    ...overrides,
  };
}

function createProps(overrides: Partial<CronProps> = {}): CronProps {
  return {
    basePath: "",
    loading: false,
    jobsLoadingMore: false,
    status: null,
    jobs: [],
    jobsTotal: 0,
    jobsHasMore: false,
    jobsQuery: "",
    jobsEnabledFilter: "all",
    jobsScheduleKindFilter: "all",
    jobsLastStatusFilter: "all",
    jobsSortBy: "nextRunAtMs",
    jobsSortDir: "asc",
    error: null,
    busy: false,
    form: { ...DEFAULT_CRON_FORM },
    fieldErrors: {},
    canSubmit: true,
    editingJobId: null,
    channels: [],
    channelLabels: {},
    runsJobId: null,
    runs: [],
    runsTotal: 0,
    runsHasMore: false,
    runsLoadingMore: false,
    runsScope: "all",
    runsStatuses: [],
    runsDeliveryStatuses: [],
    runsStatusFilter: "all",
    runsQuery: "",
    runsSortDir: "desc",
    agentSuggestions: [],
    modelSuggestions: [],
    thinkingSuggestions: [],
    timezoneSuggestions: [],
    deliveryToSuggestions: [],
    accountSuggestions: [],
    onFormChange: () => undefined,
    onRefresh: () => undefined,
    onAdd: () => undefined,
    onEdit: () => undefined,
    onClone: () => undefined,
    onCancelEdit: () => undefined,
    onToggle: () => undefined,
    onRun: () => undefined,
    onRemove: () => undefined,
    onLoadRuns: () => undefined,
    onLoadMoreJobs: () => undefined,
    onJobsFiltersChange: () => undefined,
    onJobsFiltersReset: () => undefined,
    onLoadMoreRuns: () => undefined,
    onRunsFiltersChange: () => undefined,
    ...overrides,
  };
}

describe("cron view", () => {
  beforeEach(() => {
    resetCronViewStateForTests();
  });

  it("renders summary strip and empty state", () => {
    const container = document.createElement("div");
    render(renderCron(createProps({ status: { enabled: true, jobs: 0 } })), container);

    expect(container.querySelector(".cron-summary-strip")).not.toBeNull();
    expect(container.querySelector(".cron-fab")).not.toBeNull();
    expect(container.querySelector(".cron-card")).toBeNull();
  });

  it("renders job cards for each job", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          status: { enabled: true, jobs: 2 },
          jobs: [createJob("job-1"), createJob("job-2")],
        }),
      ),
      container,
    );

    const cards = container.querySelectorAll(".cron-card");
    expect(cards.length).toBe(2);
    expect(container.textContent).toContain("Daily ping");
  });

  it("renders toggle switches on job cards", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [createJob("job-1")],
        }),
      ),
      container,
    );

    const toggle = container.querySelector(".toggle-switch input[type='checkbox']");
    expect(toggle).not.toBeNull();
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it("calls onToggle when toggle switch is changed", () => {
    const onToggle = vi.fn();
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [createJob("job-1")],
          onToggle,
        }),
      ),
      container,
    );

    const toggle = container.querySelector(".toggle-switch input[type='checkbox']") as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("expands job detail when card header is clicked", () => {
    const onLoadRuns = vi.fn();
    const job = createJob("job-1");
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [job],
          runsJobId: "job-1",
          runs: [
            {
              jobId: "job-1",
              ts: Date.now() - 3600000,
              status: "ok",
              summary: "Test run",
            },
          ],
          onLoadRuns,
        }),
      ),
      container,
    );

    expect(container.querySelector(".cron-card--expanded")).not.toBeNull();
    expect(container.querySelector(".cron-card__detail")).not.toBeNull();
    expect(container.textContent).toContain("Recent runs");
  });

  it("renders run action buttons in expanded card", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [createJob("job-1")],
          runsJobId: "job-1",
        }),
      ),
      container,
    );

    const actions = container.querySelector(".cron-card__actions");
    expect(actions).not.toBeNull();
    expect(actions!.textContent).toContain("Run");
    expect(actions!.textContent).toContain("Edit");
    expect(actions!.textContent).toContain("Clone");
    expect(actions!.textContent).toContain("Remove");
  });

  it("renders FAB when form overlay is not open", () => {
    const container = document.createElement("div");
    render(renderCron(createProps()), container);

    expect(container.querySelector(".cron-fab")).not.toBeNull();
    expect(container.querySelector(".cron-form-overlay")).toBeNull();
  });

  it("renders form overlay when editingJobId is set", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          editingJobId: "job-1",
          jobs: [createJob("job-1")],
        }),
      ),
      container,
    );

    expect(container.querySelector(".cron-form-overlay")).not.toBeNull();
    expect(container.querySelector(".cron-fab")).toBeNull();
    expect(container.textContent).toContain("Edit Job");
  });

  it("renders form sections in the overlay", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          editingJobId: "new",
          form: { ...DEFAULT_CRON_FORM, payloadKind: "agentTurn" },
        }),
      ),
      container,
    );

    const overlay = container.querySelector(".cron-form-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("Basics");
    expect(overlay!.textContent).toContain("Schedule");
    expect(overlay!.textContent).toContain("Execution");
    expect(overlay!.textContent).toContain("Delivery");
  });

  it("renders schedule fields for 'every' kind", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          editingJobId: "new",
          form: { ...DEFAULT_CRON_FORM, scheduleKind: "every" },
        }),
      ),
      container,
    );

    expect(container.querySelector("#cron-every-amount")).not.toBeNull();
  });

  it("renders schedule fields for 'at' kind", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          editingJobId: "new",
          form: { ...DEFAULT_CRON_FORM, scheduleKind: "at" },
        }),
      ),
      container,
    );

    expect(container.querySelector("#cron-schedule-at")).not.toBeNull();
  });

  it("renders schedule fields for 'cron' kind", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          editingJobId: "new",
          form: { ...DEFAULT_CRON_FORM, scheduleKind: "cron" },
        }),
      ),
      container,
    );

    expect(container.querySelector("#cron-cron-expr")).not.toBeNull();
  });

  it("renders validation errors and disables submit", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          editingJobId: "new",
          fieldErrors: { name: "cron.form.fieldRequired" },
          canSubmit: false,
        }),
      ),
      container,
    );

    expect(container.querySelector(".cron-error")).not.toBeNull();
    const submitBtn = container.querySelector(".cron-form-actions .btn.primary") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("renders suggestion datalists when form is open", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          editingJobId: "new",
          form: { ...DEFAULT_CRON_FORM, scheduleKind: "cron", payloadKind: "agentTurn" },
          agentSuggestions: ["main"],
          modelSuggestions: ["openai/gpt-5.2"],
          thinkingSuggestions: ["low"],
          timezoneSuggestions: ["UTC"],
          deliveryToSuggestions: ["+15551234567"],
          accountSuggestions: ["default"],
        }),
      ),
      container,
    );

    expect(container.querySelector("datalist#cron-agent-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-model-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-thinking-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-tz-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-delivery-to-suggestions")).not.toBeNull();
    expect(container.querySelector("datalist#cron-delivery-account-suggestions")).not.toBeNull();
    expect(container.querySelector('input[list="cron-agent-suggestions"]')).not.toBeNull();
    expect(container.querySelector('input[list="cron-model-suggestions"]')).not.toBeNull();
    expect(container.querySelector('input[list="cron-thinking-suggestions"]')).not.toBeNull();
    expect(container.querySelector('input[list="cron-tz-suggestions"]')).not.toBeNull();
  });

  it("shows error message when props.error is set", () => {
    const container = document.createElement("div");
    render(renderCron(createProps({ error: "Something went wrong" })), container);

    expect(container.textContent).toContain("Something went wrong");
  });

  it("shows load more button when jobsHasMore is true", () => {
    const container = document.createElement("div");
    render(
      renderCron(
        createProps({
          jobs: [createJob("job-1")],
          jobsHasMore: true,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Load more");
  });
});
