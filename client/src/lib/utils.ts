import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: "USD" | "VES" = "USD"): string {
  if (currency === "VES") {
    return `Bs ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
  }
  return `$ ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

export function formatBs(amount: number): string {
  const n = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  return `Bs ${new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function formatUSD(amount: number): string {
  const n = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  return `$ ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-VE", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatDateTime(dateStr: string): string {
  if (!dateStr) return "";
  // Handle both Odoo datetime ("2026-03-18 22:20:49") and ISO ("2026-03-18T22:20:49.774Z")
  let normalized = dateStr.replace(" ", "T");
  if (!normalized.endsWith("Z") && !normalized.includes("+")) normalized += "Z"; // treat as UTC
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return dateStr; // fallback if unparseable
  return d.toLocaleString("es-VE", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Caracas",
  });
}

export function getStatusColor(estado: string): string {
  switch (estado) {
    case "cuadrado": return "text-green-700 bg-green-50 border-green-200";
    case "descuadrado": return "text-red-700 bg-red-50 border-red-200";
    case "pendiente": return "text-amber-700 bg-amber-50 border-amber-200";
    default: return "text-gray-700 bg-gray-50 border-gray-200";
  }
}

export function getStatusLabel(estado: string): string {
  switch (estado) {
    case "cuadrado": return "Cuadrado";
    case "descuadrado": return "Descuadrado";
    case "pendiente": return "Pendiente";
    default: return estado;
  }
}

export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Calculate cuadre estado with the SAME logic used by the form.
 * This ensures Dashboard, Historial, Reporte and Formulario all show
 * the same status for a given cuadre.
 */
export function calculateEstado(cuadre: { ventaNetaZ: number; diferencia: number; cerradoPor?: string; estado?: string }): string {
  if (cuadre.ventaNetaZ === 0) return "cuadrado";
  if (Math.abs(cuadre.diferencia) < 5) return "cuadrado";
  if (cuadre.cerradoPor) return "descuadrado";
  return "pendiente";
}

export function formatLocalDate(dateStr: string): string {
  if (!dateStr) return "";
  let normalized = dateStr.replace(" ", "T");
  if (!normalized.endsWith("Z") && !normalized.includes("+")) normalized += "Z";
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return dateStr.split(" ")[0] || dateStr;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: "America/Caracas",
  }).format(d);
}
