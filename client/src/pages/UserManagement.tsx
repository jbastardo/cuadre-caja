import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { UserPublic } from "@shared/schema";
import { ArrowLeft, Plus, Edit2 } from "lucide-react";

export default function UserManagement() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserPublic | null>(null);
  const [form, setForm] = useState({ nombre: "", email: "", password: "", rol: "cajero" });

  const { data: users, isLoading } = useQuery<UserPublic[]>({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("Error al cargar usuarios");
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingUser) {
        const body: any = { nombre: form.nombre, email: form.email, rol: form.rol };
        if (form.password) body.password = form.password;
        await apiRequest(`/api/users/${editingUser.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await apiRequest("/api/users", { method: "POST", body: JSON.stringify(form) });
      }
    },
    onSuccess: () => {
      toast({ title: editingUser ? "Usuario actualizado" : "Usuario creado" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingUser(null);
    setForm({ nombre: "", email: "", password: "", rol: "cajero" });
    setDialogOpen(true);
  };

  const openEdit = (u: UserPublic) => {
    setEditingUser(u);
    setForm({ nombre: u.nombre, email: u.email, password: "", rol: u.rol });
    setDialogOpen(true);
  };

  const toggleActive = useMutation({
    mutationFn: async (u: UserPublic) => {
      await apiRequest(`/api/users/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ activo: !u.activo }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  if (user?.rol !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>No tienes permisos para acceder a esta página.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0A4083] text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-lg font-bold">Gestión de Usuarios</h1>
          </div>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando...</div>
        ) : (
          <div className="space-y-2">
            {users?.map((u) => (
              <Card key={u.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{u.nombre}</p>
                    <p className="text-sm text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={u.activo ? "default" : "secondary"}>
                      {u.activo ? "Activo" : "Inactivo"}
                    </Badge>
                    <Badge variant="outline">{u.rol}</Badge>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive.mutate(u)}
                    >
                      {u.activo ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Modifica los datos del usuario." : "Completa los datos para crear un nuevo usuario."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nombre</Label>
              <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>{editingUser ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña"}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <Label>Rol</Label>
              <Select value={form.rol} onValueChange={(v) => setForm({ ...form, rol: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cajero">Cajero</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
