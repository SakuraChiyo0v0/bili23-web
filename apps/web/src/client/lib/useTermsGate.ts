import { useEffect, useState } from "react";
import { loadJSON, saveJSON } from "../lib/storage";

const TERMS_KEY = "accepted_terms";
export const TERMS_VERSION = "2026-09";

export function useTermsGate(): [accepted: boolean, accept: () => void] {
  const [accepted, setAccepted] = useState<boolean>(() => loadJSON<boolean>(TERMS_KEY, false));
  useEffect(() => {
    if (accepted) saveJSON(TERMS_KEY, true);
  }, [accepted]);
  return [accepted, () => setAccepted(true)];
}
