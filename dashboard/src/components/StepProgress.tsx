import type { TaskStep } from "../api/client";

const statusColors: Record<string, string> = {
  pending: "bg-zinc-700",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
  skipped: "bg-zinc-600",
};

export default function StepProgress({ steps }: { steps: TaskStep[] }) {
  if (!steps.length) return null;

  return (
    <div className="flex items-center gap-1">
      {steps
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map((step, i) => (
          <div key={step.id} className="flex items-center gap-1">
            <div className="flex flex-col items-center">
              <div
                className={`w-3 h-3 rounded-full ${statusColors[step.status] || "bg-zinc-700"}`}
                title={`${step.stepName}: ${step.status}`}
              />
              <span className="text-[10px] text-zinc-500 mt-0.5">
                {step.stepName}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-4 h-px bg-zinc-700 mb-3" />
            )}
          </div>
        ))}
    </div>
  );
}
