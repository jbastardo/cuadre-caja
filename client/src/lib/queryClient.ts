import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export async function apiRequest(path: string, options?: RequestInit): Promise<Response> {
  const user = JSON.parse(localStorage.getItem("cuadre_user") || "null");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user?.email) headers["x-user-email"] = user.email;
  if (user?.email) headers["authorization"] = `Bearer ${user.email}`;

  const res = await fetch(path, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res;
}
