import { type ClassArray, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, resolving Tailwind conflicts last-write-wins. */
export function cn(...inputs: ClassArray[]) {
  return twMerge(clsx(...inputs));
}
