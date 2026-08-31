import { useState, useMemo } from "react";
import { Project } from "@/data/projectsData";

export function useReportFilters(projects: Project[]) {
  // Multi-select filters
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [responsibilityFilter, setResponsibilityFilter] = useState<string[]>([]);

  // Range / date filters
  const [arrMin, setArrMin] = useState("");
  const [arrMax, setArrMax] = useState("");
  const [kickOffFrom, setKickOffFrom] = useState("");
  const [kickOffTo, setKickOffTo] = useState("");
  const [goLiveFrom, setGoLiveFrom] = useState("");
  const [goLiveTo, setGoLiveTo] = useState("");
  const [expectedGoLiveFrom, setExpectedGoLiveFrom] = useState("");
  const [expectedGoLiveTo, setExpectedGoLiveTo] = useState("");
  const [expectedGoLiveNone, setExpectedGoLiveNone] = useState(false);

  // Sort
  const [sortField, setSortField] = useState("none");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Unique option lists derived from projects
  const uniquePlatforms = useMemo(
    () => [...new Set(projects.map(p => p.platform).filter(Boolean))].sort() as string[],
    [projects]
  );
  const uniqueCategories = useMemo(
    () => [...new Set(projects.map(p => p.category).filter(Boolean))].sort() as string[],
    [projects]
  );
  const uniqueOwners = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach(p => {
      if (p.assignedOwner && p.assignedOwnerName) map.set(p.assignedOwner, p.assignedOwnerName);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const toggleFilter = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string
  ) => {
    setter(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const activeFilterCount = [
    teamFilter.length > 0,
    ownerFilter.length > 0,
    stateFilter.length > 0,
    platformFilter.length > 0,
    categoryFilter.length > 0,
    responsibilityFilter.length > 0,
    !!arrMin, !!arrMax,
    !!kickOffFrom, !!kickOffTo,
    !!goLiveFrom, !!goLiveTo,
    !!expectedGoLiveFrom, !!expectedGoLiveTo,
    expectedGoLiveNone,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setTeamFilter([]); setOwnerFilter([]); setStateFilter([]);
    setPlatformFilter([]); setCategoryFilter([]); setResponsibilityFilter([]);
    setArrMin(""); setArrMax("");
    setKickOffFrom(""); setKickOffTo("");
    setGoLiveFrom(""); setGoLiveTo("");
    setExpectedGoLiveFrom(""); setExpectedGoLiveTo("");
    setExpectedGoLiveNone(false);
  };

  const filteredProjects = useMemo(() => {
    let result = projects.filter(p => {
      if (p.archived) return false;
      if (teamFilter.length > 0 && !teamFilter.includes(p.currentOwnerTeam)) return false;
      if (ownerFilter.length > 0) {
        if (ownerFilter.includes("unassigned")) {
          if (p.assignedOwner) return false;
        } else if (!ownerFilter.includes(p.assignedOwner || "")) return false;
      }
      if (stateFilter.length > 0 && !stateFilter.includes(p.projectState)) return false;
      if (platformFilter.length > 0 && !platformFilter.includes(p.platform || "")) return false;
      if (categoryFilter.length > 0 && !categoryFilter.includes(p.category || "")) return false;
      if (responsibilityFilter.length > 0 && !responsibilityFilter.includes(p.currentResponsibility || "")) return false;
      if (arrMin && p.arr < parseFloat(arrMin)) return false;
      if (arrMax && p.arr > parseFloat(arrMax)) return false;
      if (kickOffFrom && p.dates.kickOffDate < kickOffFrom) return false;
      if (kickOffTo && p.dates.kickOffDate > kickOffTo) return false;
      if (goLiveFrom) {
        const glDate = p.dates.goLiveDate || p.dates.expectedGoLiveDate || "";
        if (!glDate || glDate < goLiveFrom) return false;
      }
      if (goLiveTo) {
        const glDate = p.dates.goLiveDate || p.dates.expectedGoLiveDate || "";
        if (!glDate || glDate > goLiveTo) return false;
      }
      if (expectedGoLiveFrom && !(p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate >= expectedGoLiveFrom)) return false;
      if (expectedGoLiveTo && !(p.dates.expectedGoLiveDate && p.dates.expectedGoLiveDate <= expectedGoLiveTo)) return false;
      if (expectedGoLiveNone && p.dates.expectedGoLiveDate) return false;
      return true;
    });

    if (sortField !== "none") {
      result = [...result].sort((a, b) => {
        if (sortField === "arr") {
          const diff = a.arr - b.arr;
          return sortDir === "asc" ? diff : -diff;
        }
        let va = "", vb = "";
        switch (sortField) {
          case "merchantName": va = a.merchantName; vb = b.merchantName; break;
          case "platform": va = a.platform || ""; vb = b.platform || ""; break;
          case "owner": va = a.assignedOwnerName || ""; vb = b.assignedOwnerName || ""; break;
          case "state": va = a.projectState; vb = b.projectState; break;
          case "kickOffDate": va = a.dates.kickOffDate || ""; vb = b.dates.kickOffDate || ""; break;
          case "expectedGoLiveDate": va = a.dates.expectedGoLiveDate || ""; vb = b.dates.expectedGoLiveDate || ""; break;
          case "goLiveDate": va = a.dates.goLiveDate || ""; vb = b.dates.goLiveDate || ""; break;
        }
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }

    return result;
  }, [
    projects, teamFilter, ownerFilter, stateFilter, platformFilter, categoryFilter,
    responsibilityFilter, arrMin, arrMax, kickOffFrom, kickOffTo, goLiveFrom, goLiveTo,
    expectedGoLiveFrom, expectedGoLiveTo, expectedGoLiveNone, sortField, sortDir,
  ]);

  return {
    filteredProjects,
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
  };
}
