import { useToast } from "@/hooks/use-toast";
import { X } from "lucide-react";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border p-4 shadow-lg bg-background ${
            t.variant === "destructive" ? "border-red-300 bg-red-50 text-red-800" : "border-border"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{t.title}</p>
              {t.description && <p className="text-sm mt-1 opacity-80">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="opacity-50 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
