import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, X } from "lucide-react";
import { projectStateLabels, ProjectState } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
import { cn } from "@/lib/utils";
import type { useReportFilters } from "@/hooks/useReportFilters";

type FilterState = ReturnType<typeof useReportFilters>;

interface ReportFilterBarProps extends FilterState {
  projectCount: number;
}

export const ReportFilterBar = (props: ReportFilterBarProps) => {
  const {
    projectCount,
    teamFilter, setTeamFilter,
    ownerFilter, setOwnerFilter,
    stateFilter, setStateFilter,
    platformFilter, setPlatformFilter,
    categoryFilter, setCategoryFilter,
    responsibilityFilter, setResponsibilityFilter,
    arrMin, setArrMin,
    arrMax, setArrMax,
    kickOffFrom, setKickOffFrom,
    kickOffTo, setKickOffTo,
    goLiveFrom, setGoLiveFrom,
    goLiveTo, setGoLiveTo,
    expectedGoLiveFrom, setExpectedGoLiveFrom,
    expectedGoLiveTo, setExpectedGoLiveTo,
    expectedGoLiveNone, setExpectedGoLiveNone,
    activeFilterCount,
    clearFilters,
    uniquePlatforms,
    uniqueCategories,
    uniqueOwners,
    toggleFilter,
  } = props;

  const { teamLabels, responsibilityLabels, stateLabels } = useLabels();

  const stateOptions = (Object.keys(projectStateLabels) as ProjectState[]).map(s => ({
    value: s,
    label: stateLabels?.[s] || projectStateLabels[s],
  }));

  const filterGroups = [
    {
      label: "Team",
      values: teamFilter,
      setter: setTeamFilter,
      options: [
        { value: "mint", label: teamLabels?.mint || "Mint" },
        { value: "integration", label: teamLabels?.integration || "Integration" },
        { value: "ms", label: teamLabels?.ms || "MS" },
      ],
    },
    {
      label: "Owner",
      values: ownerFilter,
      setter: setOwnerFilter,
      options: [
        { value: "unassigned", label: "None (Unassigned)" },
        ...uniqueOwners.map(o => ({ value: o.id, label: o.name })),
      ],
    },
    {
      label: "State",
      values: stateFilter,
      setter: setStateFilter,
      options: stateOptions,
    },
    {
      label: "Platform",
      values: platformFilter,
      setter: setPlatformFilter,
      options: uniquePlatforms.map(p => ({ value: p, label: p })),
    },
    {
      label: "Category",
      values: categoryFilter,
      setter: setCategoryFilter,
      options: uniqueCategories.map(c => ({ value: c, label: c })),
    },
    {
      label: "Responsibility",
      values: responsibilityFilter,
      setter: setResponsibilityFilter,
      options: [
        { value: "gokwik", label: responsibilityLabels?.gokwik || "GoKwik" },
        { value: "merchant", label: responsibilityLabels?.merchant || "Merchant" },
        { value: "neutral", label: "Neutral" },
      ],
    },
  ];

  const allChips = [
    ...teamFilter.map(v => ({ label: teamLabels?.[v as keyof typeof teamLabels] || v, clear: () => setTeamFilter(p => p.filter(x => x !== v)) })),
    ...ownerFilter.map(v => ({ label: v === "unassigned" ? "Unassigned" : uniqueOwners.find(o => o.id === v)?.name || v, clear: () => setOwnerFilter(p => p.filter(x => x !== v)) })),
    ...stateFilter.map(v => ({ label: stateLabels?.[v as ProjectState] || projectStateLabels[v as ProjectState] || v, clear: () => setStateFilter(p => p.filter(x => x !== v)) })),
    ...platformFilter.map(v => ({ label: v, clear: () => setPlatformFilter(p => p.filter(x => x !== v)) })),
    ...categoryFilter.map(v => ({ label: v, clear: () => setCategoryFilter(p => p.filter(x => x !== v)) })),
    ...responsibilityFilter.map(v => ({ label: responsibilityLabels?.[v as keyof typeof responsibilityLabels] || v, clear: () => setResponsibilityFilter(p => p.filter(x => x !== v)) })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b bg-muted/30">
      <span className="text-2xs text-muted-foreground whitespace-nowrap">{projectCount} projects</span>

      {filterGroups.filter(g => g.options.length > 0).map(({ label, values, setter, options }) => (
        <Popover key={label}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium transition-colors border",
              values.length > 0 ? "bg-primary/10 text-primary border-primary/30" : "bg-background text-muted-foreground border-border hover:bg-muted"
            )}>
              {values.length > 0 ? `${label}: ${values.length}` : label}
              <ChevronDown className="h-2.5 w-2.5 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 p-2">
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {options.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-xs">
                  <Checkbox checked={values.includes(opt.value)} onCheckedChange={() => toggleFilter(setter, opt.value)} />
                  <span className="truncate">{opt.label}</span>
                </label>
              ))}
            </div>
            {values.length > 0 && (
              <Button variant="ghost" size="sm" className="w-full mt-1 h-7 text-xs" onClick={() => setter([])}>Clear</Button>
            )}
          </PopoverContent>
        </Popover>
      ))}

      {/* ARR range */}
      <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-background text-2xs text-muted-foreground">
        <span className="whitespace-nowrap">ARR:</span>
        <input type="number" placeholder="min" value={arrMin} onChange={e => setArrMin(e.target.value)} className="w-10 bg-transparent outline-none text-2xs text-foreground placeholder:text-muted-foreground/50" />
        <span>–</span>
        <input type="number" placeholder="max" value={arrMax} onChange={e => setArrMax(e.target.value)} className="w-10 bg-transparent outline-none text-2xs text-foreground placeholder:text-muted-foreground/50" />
        <span>Cr</span>
      </div>

      {/* Date ranges */}
      <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-background text-2xs text-muted-foreground">
        <span className="whitespace-nowrap">Start:</span>
        <input type="date" value={kickOffFrom} onChange={e => setKickOffFrom(e.target.value)} className="bg-transparent outline-none text-2xs text-foreground w-[6.5rem]" />
        <span>–</span>
        <input type="date" value={kickOffTo} onChange={e => setKickOffTo(e.target.value)} className="bg-transparent outline-none text-2xs text-foreground w-[6.5rem]" />
      </div>

      <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-background text-2xs text-muted-foreground">
        <span className="whitespace-nowrap">Go-Live:</span>
        <input type="date" value={goLiveFrom} onChange={e => setGoLiveFrom(e.target.value)} className="bg-transparent outline-none text-2xs text-foreground w-[6.5rem]" />
        <span>–</span>
        <input type="date" value={goLiveTo} onChange={e => setGoLiveTo(e.target.value)} className="bg-transparent outline-none text-2xs text-foreground w-[6.5rem]" />
      </div>

      <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-background text-2xs text-muted-foreground">
        <span className="whitespace-nowrap">Exp. Go-Live:</span>
        <input type="date" value={expectedGoLiveFrom} onChange={e => setExpectedGoLiveFrom(e.target.value)} className="bg-transparent outline-none text-2xs text-foreground w-[6.5rem]" />
        <span>–</span>
        <input type="date" value={expectedGoLiveTo} onChange={e => setExpectedGoLiveTo(e.target.value)} className="bg-transparent outline-none text-2xs text-foreground w-[6.5rem]" />
      </div>

      {/* None (not set) toggle for expected go-live */}
      <button
        type="button"
        onClick={() => setExpectedGoLiveNone(v => !v)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium transition-colors border",
          expectedGoLiveNone ? "bg-primary/10 text-primary border-primary/30" : "bg-background text-muted-foreground border-border hover:bg-muted"
        )}
      >
        No Exp. Go-Live
        {expectedGoLiveNone && <X className="h-2.5 w-2.5 ml-0.5 opacity-70" onClick={e => { e.stopPropagation(); setExpectedGoLiveNone(false); }} />}
      </button>

      {/* Active chips */}
      {allChips.map(({ label, clear }) => (
        <span key={label} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium bg-primary/10 text-primary border border-primary/30">
          {label}
          <button type="button" onClick={clear} className="opacity-60 hover:opacity-100"><X className="h-2.5 w-2.5" /></button>
        </span>
      ))}

      {activeFilterCount > 0 && (
        <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-2.5 w-2.5" />Clear all
        </button>
      )}
    </div>
  );
};
