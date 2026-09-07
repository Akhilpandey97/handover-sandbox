import { useAuth } from "@/contexts/AuthContext";
import { LoginScreen } from "@/components/LoginScreen";
import { TeamDashboard } from "@/components/TeamDashboard";
import { ManagerDashboard } from "@/components/ManagerDashboard";
import { SalesDashboard } from "@/components/SalesDashboard";
import { AiChatBot } from "@/components/AiChatBot";

type ProjectView = "kanban" | "list" | "golive";

const Index = ({ initialProjectView }: { initialProjectView?: ProjectView }) => {
  const { isAuthenticated, currentUser, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Show manager dashboard for gokwik_general (Sales & Strategy) role — view-only access
  if (currentUser?.team === "gokwik_general") {
    return (
      <>
        <ManagerDashboard initialProjectView={initialProjectView} />
        <AiChatBot />
      </>
    );
  }

  // Show manager dashboard for manager, super_admin
  if (currentUser?.team === "manager" || currentUser?.team === "admin" || currentUser?.team === "super_admin") {
    return (
      <>
        <ManagerDashboard initialProjectView={initialProjectView} />
        <AiChatBot />
      </>
    );
  }

  return (
    <>
      <TeamDashboard />
      <AiChatBot />
    </>
  );
};

export default Index;
