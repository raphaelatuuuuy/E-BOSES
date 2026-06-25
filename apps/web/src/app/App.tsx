import { AuthProvider } from "@/features/auth/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { AppRouter } from "@/app/AppRouter";

export function App() {
  return (
    <AuthProvider>
      <AppRouter />
      <Toaster richColors closeButton position="top-right" />
    </AuthProvider>
  );
}
