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

/**
 * Calcula el estado visible de un cuadre basado en la diferencia y si está cerrado.
 * Replica la lógica del formulario (CuadreForm.tsx) para consistencia entre
 * Dashboard, Historial, Reporte y Formulario.
 * 
 * @param cuadre - El objeto cuadre con ventaNetaZ, diferencia, cerradoPor, estado
 * @param tolerance - Tolerancia en Bs (default 5)
 * @returns "cuadrado" | "descuadrado" | "pendiente"
 */
export function calculateEstado(
  cuadre: { ventaNetaZ?: number; diferencia?: number; cerradoPor?: string; estado?: string },
  tolerance: number = 5
): "cuadrado" | "descuadrado" | "pendiente" {
  const ventaNetaZ = cuadre.ventaNetaZ || 0;
  const diferencia = cuadre.diferencia !== undefined ? Math.abs(cuadre.diferencia) : 0;
  
  // Mismo cálculo que CuadreForm.tsx líneas 792-798
  // Si ventaNetaZ es 0, considerar cuadrado
  if (ventaNetaZ === 0) return "cuadrado";
  // Si diferencia está dentro de tolerancia, considerar cuadrado
  if (diferencia < tolerance) return "cuadrado";
  // Si está cerrado, es descuadrado
  if (cuadre.cerradoPor) return "descuadrado";
  // Sino, está pendiente
  return "pendiente";
}

export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}
