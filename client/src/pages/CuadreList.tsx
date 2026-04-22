import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ChevronLeft, ChevronRight, List, Calendar } from "lucide-react";
import { getStatusColor, getStatusLabel } from "@/lib/utils";
import type { Cuadre } from "@shared/schema";

// ─── helpers ──────────────────────────────────────────────────────────────────
const DAYS   = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

// Statuses and colors
const STATUS_DOT: Record<string, { bg: string; text: string; label: string }> = {
  cuadrado:    { bg: "bg-green-500",  text: "text-green-700",  label: "Cuadrado" },
  descuadrado: { bg: "bg-red-500",    text: "text-red-700",    label: "Descuadrado" },
  pendiente:   { bg: "bg-amber-400",  text: "text-amber-700",  label: "Pendiente" },
  no_realizado:{ bg: "bg-gray-300",   text: "text-gray-500",   label: "Sin cuadre" },
  nf:          { bg: "bg-purple-400",  text: "text-purple-700",  label: "No Fiscal" },
};

// ─── component ────────────────────────────────────────────────────────────────
export default function CuadreList() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [view,  setView]  = useState<"calendar" | "list">("calendar");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Fetch all cuadres for the displayed month (no filter → fetch all and filter client-side)
  const { data: cuadres = [], isLoading } = useQuery<Cuadre[]>({
    queryKey: ["cuadres-all"],
    queryFn: () => fetch("/api/cuadres").then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // Group cuadres by fecha
  const byDate = useMemo(() => {
    const map: Record<string, Cuadre[]> = {};
    for (const c of cuadres) {
      if (!map[c.fecha]) map[c.fecha] = [];
      map[c.fecha].push(c);
    }
    return map;
  }, [cuadres]);

  // ── navigation ──
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDate(ymd(today)); };

  // ── calendar grid ──
  const firstDay  = new Date(year, month, 1).getDay();  // 0=Sun
  const totalDays = daysInMonth(year, month);
  const todayStr  = ymd(today);

  // Days with at least one cuadre this month
  const calendarDays: Array<{ date: string; day: number; isToday: boolean; isWeekend: boolean; cuadres: Cuadre[]; hasData: boolean }> = [];
  for (let d = 1; d <= totalDays; d++) {
    const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow  = new Date(year, month, d).getDay();
    calendarDays.push({
      date,
      day: d,
      isToday: date === todayStr,
      isWeekend: dow === 0 || dow === 6,
      cuadres: byDate[date] || [],
      hasData: !!byDate[date],
    });
  }

  // Summary for selected date or whole month
  const listCuadres = selectedDate
    ? (byDate[selectedDate] || [])
    : cuadres.filter(c => c.fecha.startsWith(`${year}-${String(month+1).padStart(2,"0")}`));

  // Stats for the month
  const monthStr = `${year}-${String(month+1).padStart(2,"0")}`;
  const monthCuadres = cuadres.filter(c => c.fecha.startsWith(monthStr));
  const stats = {
    cuadrado:    monthCuadres.filter(c => c.estado === "cuadrado").length,
    descuadrado: monthCuadres.filter(c => c.estado === "descuadrado").length,
    pendiente:   monthCuadres.filter(c => c.estado === "pendiente").length,
    total:       monthCuadres.length,
  };

  // Get dominant status for a day (worst first)
  function dayStatus(cuadresList: Cuadre[]): keyof typeof STATUS_DOT {
    if (!cuadresList.length) return "no_realizado";
    if (cuadresList.some(c => c.estado === "descuadrado")) return "descuadrado";
    if (cuadresList.some(c => c.estado === "pendiente"))   return "pendiente";
    return "cuadrado";
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0A4083] text-white shadow-md no-print">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-lg font-bold">Historial de Cuadres</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm"
              className={`text-white hover:bg-white/20 ${view === "calendar" ? "bg-white/20" : ""}`}
              onClick={() => setView("calendar")}
            >
              <Calendar className="h-4 w-4 mr-1" /> Calendario
            </Button>
            <Button
              variant="ghost" size="sm"
              className={`text-white hover:bg-white/20 ${view === "list" ? "bg-white/20" : ""}`}
              onClick={() => setView("list")}
            >
              <List className="h-4 w-4 mr-1" /> Lista
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">

        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <h2 className="text-lg font-bold w-44 text-center">{MONTHS[month]} {year}</h2>
            <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={goToday}>Hoy</Button>
          </div>
          {/* Monthly stats */}
          <div className="flex gap-2 text-xs">
            {[
              { k: "cuadrado",    label: `${stats.cuadrado} cuadrado${stats.cuadrado !== 1 ? "s" : ""}` },
              { k: "descuadrado", label: `${stats.descuadrado} descuadrado${stats.descuadrado !== 1 ? "s" : ""}` },
              { k: "pendiente",   label: `${stats.pendiente} pendiente${stats.pendiente !== 1 ? "s" : ""}` },
            ].map(({ k, label }) => (
              <span key={k} className={`flex items-center gap-1 px-2 py-1 rounded-full border ${STATUS_DOT[k].text} bg-white`}>
                <span className={`w-2 h-2 rounded-full ${STATUS_DOT[k].bg}`} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* CALENDAR VIEW */}
        {view === "calendar" && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b">
              {DAYS.map(d => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
              ))}
            </div>

            {/* Calendar cells */}
            <div className="grid grid-cols-7">
              {/* Empty cells before first day */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[90px] border-b border-r bg-gray-50/50" />
              ))}

              {calendarDays.map(({ date, day, isToday, isWeekend, cuadres: dayCuadres }) => {
                const status    = dayStatus(dayCuadres);
                const dotCfg    = STATUS_DOT[status];
                const isSelected = date === selectedDate;
                const isFuture  = date > todayStr;

                return (
                  <div
                    key={date}
                    onClick={() => setSelectedDate(isSelected ? null : date)}
className={`min-h-[110px] border-b border-r p-1.5 cursor-pointer transition-colors
                      ${isSelected  ? "bg-blue-50 ring-2 ring-inset ring-blue-400" : ""}
                      ${isToday     ? "bg-amber-50" : ""}
                      ${isWeekend && !isSelected && !isToday ? "bg-gray-50" : ""}
                      ${!isSelected && !isToday ? "hover:bg-blue-50/40" : ""}
                    `}
                  >
                    {/* Day number */}
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-semibold w-6 h-6 flex items-center justify-center rounded-full
                        ${isToday ? "bg-[#0A4083] text-white" : isWeekend ? "text-gray-400" : "text-gray-700"}`}>
                        {day}
                      </span>
                      {!isFuture && (
                        <span className={`w-2 h-2 rounded-full ${dotCfg.bg}`} />
                      )}
                    </div>

                    {/* Cuadre chips */}
                    {dayCuadres.length > 0 && (
                      <div className="space-y-0.5">
                        {dayCuadres.slice(0, 4).map(c => {
                          const isNF = c.ventaNetaZ === 0;
                          return (
                            <div
                              key={c.id}
                              onClick={e => { e.stopPropagation(); navigate(isNF ? `/cuadre-nf?sessionId=${c.sessionId}` : `/cuadre/${c.id}`); }}
                              className={`text-xs px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80 flex items-center gap-0.5
                                ${isNF ? "bg-purple-100 text-purple-800" :
                                  c.estado === "cuadrado"    ? "bg-green-100 text-green-800" :
                                  c.estado === "descuadrado" ? "bg-red-100 text-red-800" :
                                                               "bg-amber-100 text-amber-800"}`}
                            >
                              {isNF && <span className="font-bold text-[10px] bg-purple-300 text-purple-900 px-0.5 rounded">NF</span>}
                              <span className="truncate">{c.caja}</span>
                            </div>
                          );
                        })}
                        {dayCuadres.length > 4 && (
                          <div className="text-xs text-muted-foreground pl-1">+{dayCuadres.length - 4} más</div>
                        )}
                      </div>
                    )}

                    {/* No cuadre marker for past days */}
                    {!isFuture && dayCuadres.length === 0 && (
                      <div className="text-xs text-gray-300 mt-1">—</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* LIST VIEW — or detail panel for selected date */}
        {(view === "list" || selectedDate) && (
          <div className="space-y-2">
            {selectedDate && (
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  {selectedDate} — {listCuadres.length} cuadre{listCuadres.length !== 1 ? "s" : ""}
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setSelectedDate(null)}>Ver mes completo</Button>
              </div>
            )}

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Cargando...</div>
            ) : !listCuadres.length ? (
              <div className="py-8 text-center text-muted-foreground bg-white rounded-lg border">
                {selectedDate ? "No hay cuadres para este día" : "No hay cuadres este mes"}
              </div>
            ) : (
              listCuadres
                .slice()
                .sort((a, b) => b.fecha.localeCompare(a.fecha))
                .map(c => (
                  <div
                    key={c.id}
                    className="bg-white rounded-lg border px-4 py-3 flex items-center justify-between cursor-pointer hover:shadow-sm transition-shadow"
                    onClick={() => navigate(c.ventaNetaZ === 0 ? `/cuadre-nf?sessionId=${c.sessionId}` : `/cuadre/${c.id}`)}
                  >
<div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{c.sessionName}</span>
                          <span className="text-xs text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded">{c.caja}</span>
                          {c.ventaNetaZ === 0 && <span className="text-[10px] font-bold bg-purple-200 text-purple-900 px-1.5 py-0.5 rounded">NF</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {c.fecha} · {c.cajero}{c.ventaNetaZ === 0 ? " · No Fiscal" : ` · Z: ${c.zNumero}`}
                          {c.cerradoPor && <span className="ml-2 text-gray-400">Cerrado por {c.cerradoPor}</span>}
                        </p>
                      </div>
                    <Badge className={getStatusColor(c.estado)}>{getStatusLabel(c.estado)}</Badge>
                  </div>
                ))
            )}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-2">
          {Object.entries(STATUS_DOT).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-full ${v.bg}`} />
              {v.label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
            No Fiscal (NF)
          </span>
        </div>

      </main>
    </div>
  );
}
