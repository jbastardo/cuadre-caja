import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/contexts/AuthContext";
import App from "./App";
import "./index.css";

const hashListeners = {
  v: [] as Array<() => void>,
};

const onCleanHashChange = () => hashListeners.v.forEach((cb) => cb());

const subscribeToHashUpdates = (callback: () => void) => {
  if (hashListeners.v.push(callback) === 1) {
    window.addEventListener("hashchange", onCleanHashChange);
  }
  return () => {
    hashListeners.v = hashListeners.v.filter((i) => i !== callback);
    if (!hashListeners.v.length) {
      window.removeEventListener("hashchange", onCleanHashChange);
    }
  };
};

// Strip query parameters from hash location so wouter routes like "/cuadre/new"
// match even when the hash contains "?sessionId=...".
const currentCleanHashLocation = (): string => {
  const raw = "/" + window.location.hash.replace(/^#?\/?/, "");
  return raw.split("?")[0] || "/";
};

function cleanHashNavigate<S = any>(
  to: string,
  { state, replace = false }: { state?: S; replace?: boolean; transition?: boolean } = {}
): void {
  const oldURL = window.location.href;
  const cleanTo = to.replace(/^#?\/?/, "");
  const url = new URL(window.location.href);
  url.hash = `/${cleanTo}`;
  url.search = "";
  const newURL = url.href;

  if (replace) {
    window.history.replaceState(state ?? null, "", newURL);
  } else {
    window.history.pushState(state ?? null, "", newURL);
  }

  const event =
    typeof HashChangeEvent !== "undefined"
      ? new HashChangeEvent("hashchange", { oldURL, newURL })
      : new Event("hashchange");

  window.dispatchEvent(event);
}

function useCleanHashLocation({ ssrPath = "/" }: { ssrPath?: string } = {}): [string, typeof cleanHashNavigate] {
  return [
    useSyncExternalStore(subscribeToHashUpdates, currentCleanHashLocation, () => ssrPath),
    cleanHashNavigate,
  ];
}
(useCleanHashLocation as any).hrefs = (href: string) => "#" + href;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router hook={useCleanHashLocation}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>
);
