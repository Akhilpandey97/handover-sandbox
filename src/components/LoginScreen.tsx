import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn, Shield } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { SignupLeadForm } from "./SignupLeadForm";

/** Google's brand mark, inlined — lucide carries no third-party logos. */
const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A8.99 8.99 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a8.99 8.99 0 0 0 0 8.12l3.01-2.34Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A8.99 8.99 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
    />
  </svg>
);

/**
 * Sign-in, plus a sign-up enquiry form. The enquiry creates no account — it
 * records interest for follow-up. Accounts are still made by an admin under
 * Settings → Users, including for Google sign-in: signing in with Google
 * authenticates a person, it does not provision them.
 */
export const LoginScreen = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const { login, loginWithGoogle, accessError } = useAuth();

  const busy = isLoading || isGoogleLoading;

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

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    const result = await loginWithGoogle();
    if (!result.success) {
      toast.error(result.error || "Could not start Google sign-in");
      setIsGoogleLoading(false);
      return;
    }
    if (result.openedInNewTab) {
      // This tab is staying put — sign-in is happening elsewhere.
      toast.info("Continue signing in with Google in the new tab.");
      setIsGoogleLoading(false);
    }
    // Otherwise this tab is already navigating to Google; leave the button
    // spinning rather than flicking it back to its resting state.
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>

      <div className={showSignup ? "w-full max-w-[560px] space-y-8" : "w-full max-w-[420px] space-y-8"}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Handover</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {showSignup
                ? "Tell us about yourself and we'll be in touch"
                : "Enter your credentials to access the dashboard"}
            </p>
          </div>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardContent className="pt-6">
            {showSignup ? (
              <SignupLeadForm onBack={() => setShowSignup(false)} />
            ) : (
              <>
            {accessError && (
              <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {accessError}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleLogin}
              disabled={busy}
              className="h-10 w-full gap-2 font-medium"
            >
              {isGoogleLoading ? (
                "Redirecting to Google..."
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </Button>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-medium tracking-normal text-muted-foreground">Email Address</Label>
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
                <Label htmlFor="password" className="text-xs font-medium tracking-normal text-muted-foreground">Password</Label>
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

              <Button type="submit" className="w-full h-10 font-semibold" disabled={busy}>
                {isLoading ? (
                  "Please wait..."
                ) : (
                  <>
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign In
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 border-t pt-4 text-center">
              <button
                type="button"
                onClick={() => setShowSignup(true)}
                className="text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                Don't have access? Sign up
              </button>
            </div>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
};
