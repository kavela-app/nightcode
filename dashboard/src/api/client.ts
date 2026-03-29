const BASE_URL = "/api";

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = localStorage.getItem("nightcode_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  login: (token: string) =>
    request<{ data: { ok: boolean; error?: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  // Setup (no auth required)
  getSetupStatus: () => request<{ data: SetupStatus }>("/setup/status"),
  startClaudeLogin: () =>
    request<{ data: { loginUrl: string | null; error?: string } }>("/setup/claude-login", { method: "POST" }),
  submitAuthCode: (code: string) =>
    request<{ data: { ok: boolean; error?: string } }>("/setup/claude-auth-code", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  setClaudeApiKey: (apiKey: string) =>
    request<{ data: { ok: boolean; error?: string } }>("/setup/claude-api-key", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  testGhAuth: () =>
    request<{ data: { ok: boolean; user?: string; error?: string } }>("/setup/gh-status"),
  loginGh: (token: string) =>
    request<{ data: { ok: boolean; error?: string } }>("/setup/gh-login", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  getTailscaleStatus: () =>
    request<{ data: { installed: boolean; running: boolean; url: string | null; hostname: string | null; error?: string } }>("/setup/tailscale-status"),
  connectTailscale: (authKey: string) =>
    request<{ data: { ok: boolean; url: string | null; error?: string } }>("/setup/tailscale-connect", {
      method: "POST",
      body: JSON.stringify({ authKey }),
    }),
  disconnectTailscale: () =>
    request<{ data: { ok: boolean; error?: string } }>("/setup/tailscale-disconnect", { method: "POST" }),

  // Dashboard
  getStats: () => request<{ data: DashboardStats }>("/dashboard/stats"),

  // Repos
  getRepos: () => request<{ data: Repo[] }>("/repos"),
  createRepo: (data: CreateRepoInput) =>
    request<{ data: Repo }>("/repos", { method: "POST", body: JSON.stringify(data) }),
  deleteRepo: (id: number) =>
    request("/repos/" + id, { method: "DELETE" }),
  testConnection: (id: number) =>
    request<{ data: { ok: boolean; error?: string } }>(`/repos/${id}/test-connection`, { method: "POST" }),

  // Tasks
  getTasks: (params?: { status?: string; repo_id?: string }) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request<{ data: Task[] }>(`/tasks${qs ? "?" + qs : ""}`);
  },
  getTask: (id: number) => request<{ data: Task & { steps: TaskStep[] } }>(`/tasks/${id}`),
  createTask: (data: CreateTaskInput) =>
    request<{ data: Task }>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: number, data: Partial<Task>) =>
    request<{ data: Task }>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTask: (id: number) => request(`/tasks/${id}`, { method: "DELETE" }),
  runTask: (id: number) => request(`/tasks/${id}/run`, { method: "POST" }),
  pauseTask: (id: number) => request(`/tasks/${id}/pause`, { method: "POST" }),
  resumeTask: (id: number) => request(`/tasks/${id}/resume`, { method: "POST" }),
  cancelTask: (id: number) => request(`/tasks/${id}/cancel`, { method: "POST" }),
  exportTask: (id: number) => request<{ data: { markdown: string } }>(`/tasks/${id}/export`),
  refineTask: (id: number, message: string) =>
    request<{ data: Task }>(`/tasks/${id}/refine`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  // Schedules
  getSchedules: () => request<{ data: Schedule[] }>("/schedules"),
  createSchedule: (data: CreateScheduleInput) =>
    request<{ data: Schedule }>("/schedules", { method: "POST", body: JSON.stringify(data) }),
  updateSchedule: (id: number, data: Partial<Schedule>) =>
    request<{ data: Schedule }>(`/schedules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSchedule: (id: number) => request(`/schedules/${id}`, { method: "DELETE" }),
  triggerSchedule: (id: number) => request(`/schedules/${id}/trigger`, { method: "POST" }),

  // Agent
  sendAgentMessage: (message: string) =>
    request<{ data: { reply: string; action: string | null; data?: any } }>("/agent", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  // Settings
  getSettings: () => request<{ data: Record<string, string> }>("/settings"),
  updateSettings: (data: Record<string, string>) =>
    request("/settings", { method: "PATCH", body: JSON.stringify(data) }),
  testClaude: () => request<{ data: { ok: boolean; error?: string } }>("/settings/test-claude", { method: "POST" }),
  testGithub: () => request<{ data: { ok: boolean; error?: string } }>("/settings/test-github", { method: "POST" }),
  testKavela: (apiKey: string) =>
    request<{ data: { ok: boolean; error?: string } }>("/settings/test-kavela", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  rotateToken: () =>
    request<{ data: { token: string } }>("/settings/rotate-token", { method: "POST" }),
};

// Types
export interface DashboardStats {
  tasks: {
    total: number;
    pending: number;
    queued: number;
    running: number;
    paused: number;
    completed: number;
    failed: number;
  };
  executor: { runningTaskIds: number[]; runningCount: number };
  repos: number;
  schedules: number;
  recentPrs: { taskId: number; title: string; prUrl: string; completedAt: string }[];
}

export interface Repo {
  id: number;
  name: string;
  url: string;
  branch: string;
  systemPrompt: string | null;
  mcpConfig: string | null;
  kavelaGroup: string | null;
  allowedTools: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  repoId: number;
  title: string;
  prompt: string;
  workflow: string;
  priority: number;
  status: string;
  currentStep: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  additionalRepoIds: number[] | null;
  additionalPrUrls: string[] | null;
  additionalRepos?: Repo[];  // Resolved by server
  sessionId: string | null;
  scheduleId: number | null;
  parentTaskId: number | null;
  recurring: boolean;
  error: string | null;
  retryCount: number;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  subtasks?: Task[];
}

export interface TaskStep {
  id: number;
  taskId: number;
  stepName: string;
  stepOrder: number;
  status: string;
  sessionId: string | null;
  result: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Schedule {
  id: number;
  name: string;
  cronExpr: string | null;
  intervalMinutes: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  timezone: string;
  enabled: boolean;
  taskTemplate: string | null;
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
}

export type CreateRepoInput = { name: string; url: string; branch?: string; systemPrompt?: string };
export type CreateTaskInput = { repoId: number; title: string; prompt: string; workflow?: string; priority?: number; scheduleId?: number; additionalRepoIds?: number[]; recurring?: boolean };
export interface SetupStatus {
  needsSetup: boolean;
  claude: { ok: boolean; error?: string };
  github: { ok: boolean; error?: string };
  kavela: { configured: boolean };
  repos: number;
  authToken: string | null;
  requiresLogin?: boolean;
}

export type CreateScheduleInput = {
  name: string;
  intervalMinutes?: number;
  windowStart?: string;
  windowEnd?: string;
  cronExpr?: string;
  timezone: string;
  enabled?: boolean;
  taskTemplate?: { repoId: number; title: string; prompt: string; workflow?: string; priority?: number };
};
