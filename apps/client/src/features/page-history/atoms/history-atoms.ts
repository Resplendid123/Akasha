import { atom } from "jotai";

export const historyAtoms = atom<boolean>(false);
export const activeHistoryIdAtom = atom<string>("");
export const activeHistoryPrevIdAtom = atom<string>("");
export const highlightChangesAtom = atom<boolean>(true);

export type DiffCounts = { added: number; deleted: number; total: number };
export const diffCountsAtom = atom<DiffCounts | null>(null);

export type DiffState =
  | "idle"
  | "loadingPrevious"
  | "computing"
  | "ready"
  | "error"
  | "tooLarge";
export const diffStateAtom = atom<DiffState>("idle");
