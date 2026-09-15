import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, CheckCircle2 } from "lucide-react";

const FIELDS = [
  { key: "name", label: "Name", type: "text", placeholder: "Your full name", required: true },
  { key: "email", label: "Email", type: "email", placeholder: "name@company.com", required: true },
  { key: "jobTitle", label: "Job Title", type: "text", placeholder: "Head of Onboarding", required: true },
  { key: "companyName", label: "Company Name", type: "text", placeholder: "Your company", required: true },
  { key: "phone", label: "Phone Number", type: "tel", placeholder: "Optional", required: false },
  { key: "country", label: "Country", type: "text", placeholder: "Country", required: true },
  { key: "city", label: "City", type: "text", placeholder: "City", required: true },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

const EMPTY: Record<FieldKey, string> = {
  name: "", email: "", jobTitle: "", companyName: "", phone: "", country: "", city: "",
};

/**
 * Sign-up enquiry. This collects interest — it creates no account and grants
 * no access, so it says so rather than implying a login is on the way.
 */
export const SignupLeadForm = ({ onBack }: { onBack: () => void }) => {
  const [values, setValues] = useState<Record<FieldKey, string>>(EMPTY);
  // Honeypot: hidden from people, tempting to bots.
  const [website, setWebsite] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key: FieldKey, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch("/api/public/signup-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit your details");
      setDone(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success-strong" />
        <div>
          <p className="text-sm font-semibold text-foreground">Thanks — we have your details</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Someone will be in touch at {values.email}.
          </p>
        </div>
        <Button variant="outline" className="w-full h-10" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Off-screen rather than display:none, which some bots skip. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div
            key={f.key}
            className={f.key === "email" || f.key === "companyName" ? "col-span-2 space-y-1.5" : "space-y-1.5"}
          >
            <Label htmlFor={`lead-${f.key}`} className="text-xs font-medium text-muted-foreground">
              {f.label}{f.required ? " *" : ""}
            </Label>
            <Input
              id={`lead-${f.key}`}
              type={f.type}
              placeholder={f.placeholder}
              value={values[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              required={f.required}
              className="h-10"
            />
          </div>
        ))}
      </div>

      <Button type="submit" className="w-full h-10 font-semibold" disabled={isLoading}>
        {isLoading ? "Submitting..." : (<><Send className="h-4 w-4 mr-2" />Submit</>)}
      </Button>
      <Button type="button" variant="ghost" className="w-full h-9 text-sm" onClick={onBack}>
        Back to sign in
      </Button>
    </form>
  );
};
