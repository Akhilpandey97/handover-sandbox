import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowUpDown, SlidersHorizontal, ChevronDown } from "lucide-react";
import { projectStateLabels, ProjectState } from "@/data/projectsData";
import { useLabels } from "@/contexts/LabelsContext";
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
    sortField, setSortField,
    sortDir, setSortDir,
    activeFilterCount,
    clearFilters,
    uniquePlatforms,
    uniqueCategories,
    uniqueOwners,
    toggleFilter,
  } = props;

  const { teamLabels, responsibilityLabels, stateLabels } = useLabels();
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

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

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">{projectCount} projects</span>

      {/* Sort */}
      <Collapsible open={sortOpen} onOpenChange={setSortOpen}>
        <div className="relative">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <ArrowUpDown className="h-3 w-3" />
              Sort
              {sortField !== "none" && (
                <Badge variant="default" className="ml-0.5 h-4 px-1 text-2xs">1</Badge>
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="absolute z-30 mt-1 left-0 top-full w-72 bg-card border rounded-lg shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Sort By</p>
              {sortField !== "none" && (
                <Button variant="ghost" size="sm" className="text-xs h-6"
                  onClick={() => { setSortField("none"); setSortDir("asc"); }}>
                  Clear
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Field</p>
                <Select value={sortField} onValueChange={setSortField}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="merchantName">Merchant Name</SelectItem>
                    <SelectItem value="arr">ARR</SelectItem>
                    <SelectItem value="platform">Platform</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="state">State</SelectItem>
                    <SelectItem value="kickOffDate">Start Date</SelectItem>
                    <SelectItem value="expectedGoLiveDate">Expected Go-Live</SelectItem>
                    <SelectItem value="goLiveDate">Go-Live Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Direction</p>
                <Select value={sortDir} onValueChange={v => setSortDir(v as "asc" | "desc")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t">
              <CollapsibleTrigger asChild>
                <Button size="sm" className="text-xs h-7">Done</Button>
              </CollapsibleTrigger>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Filters */}
      <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
        <div className="relative">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <SlidersHorizontal className="h-3 w-3" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="default" className="ml-0.5 h-4 px-1 text-2xs">{activeFilterCount}</Badge>
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="absolute z-30 mt-1 left-0 top-full w-[580px] bg-card border rounded-lg shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Filters</p>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-6" onClick={clearFilters}>
                  Clear All
                </Button>
              )}
            </div>

            {/* Multi-select filters */}
            <div className="grid grid-cols-2 gap-3">
              {filterGroups.map(({ label, values, setter, options }) => (
                <div key={label} className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">{label}</p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between h-8 text-xs font-normal">
                        <span className="truncate">
                          {values.length === 0 ? `All ${label}s` : `${values.length} selected`}
                        </span>
                        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-2" align="start">
                      <div className="max-h-44 overflow-y-auto space-y-0.5">
                        {options.map(opt => (
                          <label
                            key={opt.value}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-xs"
                          >
                            <Checkbox
                              checked={values.includes(opt.value)}
                              onCheckedChange={() => toggleFilter(setter, opt.value)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="truncate">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                      {values.length > 0 && (
                        <Button
                          variant="ghost" size="sm"
                          className="w-full mt-1 text-xs h-7"
                          onClick={() => setter([])}
                        >
                          Clear
                        </Button>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              ))}

              {/* ARR Range */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">ARR Range (Cr)</p>
                <div className="flex gap-1">
                  <Input type="number" placeholder="Min" value={arrMin}
                    onChange={e => setArrMin(e.target.value)} className="h-8 text-xs" />
                  <Input type="number" placeholder="Max" value={arrMax}
                    onChange={e => setArrMax(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
            </div>

            {/* Date ranges */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div className="space-y-1 border rounded-md p-2">
                <p className="text-xs text-muted-foreground font-medium">Start Date</p>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  <Input type="date" value={kickOffFrom} onChange={e => setKickOffFrom(e.target.value)}
                    className="h-7 text-xs px-1.5 min-w-0" />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input type="date" value={kickOffTo} onChange={e => setKickOffTo(e.target.value)}
                    className="h-7 text-xs px-1.5 min-w-0" />
                </div>
              </div>
              <div className="space-y-1 border rounded-md p-2">
                <p className="text-xs text-muted-foreground font-medium">Go-Live Date</p>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  <Input type="date" value={goLiveFrom} onChange={e => setGoLiveFrom(e.target.value)}
                    className="h-7 text-xs px-1.5 min-w-0" />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input type="date" value={goLiveTo} onChange={e => setGoLiveTo(e.target.value)}
                    className="h-7 text-xs px-1.5 min-w-0" />
                </div>
              </div>
            </div>
            <div className="space-y-1 border rounded-md p-2">
              <p className="text-xs text-muted-foreground font-medium">Expected Go-Live</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                <Input type="date" value={expectedGoLiveFrom} onChange={e => setExpectedGoLiveFrom(e.target.value)}
                  className="h-7 text-xs px-1.5 min-w-0" />
                <span className="text-xs text-muted-foreground">–</span>
                <Input type="date" value={expectedGoLiveTo} onChange={e => setExpectedGoLiveTo(e.target.value)}
                  className="h-7 text-xs px-1.5 min-w-0" />
              </div>
              <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                <Checkbox checked={expectedGoLiveNone} onCheckedChange={v => setExpectedGoLiveNone(!!v)}
                  className="h-3.5 w-3.5" />
                <span className="text-xs text-muted-foreground">None (not set)</span>
              </label>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <CollapsibleTrigger asChild>
                <Button size="sm" className="text-xs h-7">Done</Button>
              </CollapsibleTrigger>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
};
