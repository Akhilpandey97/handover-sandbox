import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn, Shield, UserPlus } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "./ThemeToggle";
import type { Database } from "@/integrations/supabase/types";
import { useLabels } from "@/contexts/LabelsContext";

type TeamRole = Database["public"]["Enums"]["team_role"];

export const LoginScreen = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [team, setTeam] = useState<TeamRole>("mint");
  const [isSignup, setIsSignup] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login, signup } = useAuth();
  const { teamLabels } = useLabels();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const result = await login(email, password);
    if (result.success) {
      toast.success("Login successful!");
      window.location.reload();
    } else {
      toast.error(result.error || "Invalid credentials");
    }
    setIsLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    if (!name.trim()) {
      toast.error("Please enter your name");
      setIsLoading(false);
      return;
    }
    const result = await signup(email, password, name, team);
    if (result.success) {
      toast.success("Account created! You can now log in.");
      setIsSignup(false);
      setPassword("");
    } else {
      toast.error(result.error || "Failed to create account");
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary/5 via-primary/10 to-accent/5 dark:from-primary/10 dark:via-primary/5 dark:to-background items-center justify-center p-12 relative">
        <div className="absolute top-6 left-6">
          <ThemeToggle />
        </div>
        <div className="max-w-md space-y-8">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">ProjectHub</h1>
          </div>
          <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight leading-snug">
              Enterprise Project <br />Handoff Platform
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Streamline cross-team project transitions, track accountability, and accelerate time-to-live for high-value integrations.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4">
            <div className="space-y-1">
              <p className="text-lg font-bold">99.9%</p>
              <p className="text-xs text-muted-foreground">Uptime SLA</p>
            </div>
            <div className="space-y-1">
              <p className="text-lg font-bold">SOC 2</p>
              <p className="text-xs text-muted-foreground">Compliant</p>
            </div>
            <div className="space-y-1">
              <p className="text-lg font-bold">256-bit</p>
              <p className="text-xs text-muted-foreground">Encryption</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[420px] space-y-8">
          <div className="lg:hidden flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary-foreground" />
              </div>
              <h1 className="text-base font-bold">ProjectHub</h1>
            </div>
            <ThemeToggle />
          </div>

          <div>
            <h2 className="text-xl font-bold tracking-tight">
              {isSignup ? "Create your account" : "Welcome back"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isSignup
                ? "Set up your credentials to get started"
                : "Enter your credentials to access the dashboard"
              }
            </p>
          </div>

          <Card className="border-border/50 shadow-sm">
            <CardContent className="pt-6">
              <form onSubmit={isSignup ? handleSignup : handleLogin} className="space-y-4">
                {isSignup && (
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Full Name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Enter your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-10"
                  />
                </div>

                {isSignup && (
                  <div className="space-y-2">
                    <Label htmlFor="team" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Team</Label>
                    <Select value={team} onValueChange={(value) => setTeam(value as TeamRole)}>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select your team" />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(teamLabels) as TeamRole[]).filter(r => r !== "super_admin").map((role) => (
                          <SelectItem key={role} value={role}>
                            {teamLabels[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button type="submit" className="w-full h-10 font-semibold" disabled={isLoading}>
                  {isLoading ? (
                    "Please wait..."
                  ) : isSignup ? (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Create Account
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4 mr-2" />
                      Sign In
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-6 pt-4 border-t text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsSignup(!isSignup);
                    setPassword("");
                  }}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {isSignup
                    ? "Already have an account? Sign in"
                    : "Don't have an account? Create one"
                  }
                </button>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            By signing in, you agree to our Terms of Service and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
};
