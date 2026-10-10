import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  timeZone: string;
  chartCategories: string[];
  setTimeZone: (timeZone: string) => void;
  toggleCategory: (category: string) => void;
}

const ALL = ["known_external", "confirmed_team", "suspected_related", "known_contract", "unclassified"];

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      chartCategories: ALL,
      setTimeZone: (timeZone) => set({ timeZone }),
      toggleCategory: (category) => set((state) => ({
        chartCategories: state.chartCategories.includes(category) ? state.chartCategories.filter((item) => item !== category) : [...state.chartCategories, category],
      })),
    }),
    { name: "launchforensics-ui" },
  ),
);
