import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getStatusColor, getStatusLabel } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import type { Cuadre } from "@shared/schema";

export default function CuadreList() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [fecha, setFecha] = useState("");
  const [estado, setEstado] = useState("all");

  const params = new URLSearchParams();
  if (fecha) params.set("fecha", fecha);
  if (estado && estado !== "all") params.set("estado", estado);

  const { data: cuadres, isLoading } = useQuery<Cuadre[]>({
    queryKey: ["cuadres", fecha, estado],
    queryFn: async () => {
      const res = await fetch(`/api/cuadres?${params.toString()}`);
      if (!res.ok) throw new Error("Error al cargar cuadres");
      return res.json();
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0A4083] text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-bold">Historial de Cuadres</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-40" placeholder="Fecha" />
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="cuadrado">Cuadrado</SelectItem>
              <SelectItem value="descuadrado">Descuadrado</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
            </SelectContent>
          </Select>
          {fecha && (
            <Button variant="ghost" size="sm" onClick={() => setFecha("")}>
              Limpiar fecha
            </Button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando...</div>
        ) : !cuadres?.length ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No hay cuadres con estos filtros
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {cuadres.map((c) => (
              <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/cuadre/${c.id}`)}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{c.sessionName}</span>
                        <Badge variant="outline" className="text-xs">{c.caja}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {c.fecha} &middot; {c.cajero} &middot; Z: {c.zNumero}
                      </p>
                    </div>
                  <Badge className={getStatusColor(c.estado)}>
                    {getStatusLabel(c.estado)}
                  </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
