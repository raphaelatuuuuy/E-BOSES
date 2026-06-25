import { Navigate } from "react-router-dom";
import { useAuth } from "@/features/auth/contexts/AuthContext";

interface PublicRouteProps {
  children: React.ReactNode;
}

/**
 * PublicRoute — redirects already-authenticated users to the dashboard.
 * Used for login/register pages.
 */
export function PublicRoute({ children }: PublicRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-civic-bg flex items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-civic-primary border-t-transparent" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
