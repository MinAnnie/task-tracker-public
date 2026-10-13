import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { parseBoardFilters, writeBoardFilters, type BoardFilters } from "./board-model.ts";

type SetFilters = (filters: BoardFilters, options?: { replace?: boolean }) => void;

/**
 * The board's filters, kept in the query string (shareable, kept on reload and through
 * back/forward) and mirrored in local state.
 *
 * The router applies URL changes in a transition, so controls bound to the URL alone
 * would lag behind fast input (typed characters got lost). Changes made here update the
 * local copy at once and then the URL; URL changes made elsewhere (back/forward, links)
 * replace the local copy.
 */
export function useBoardFilters(): [BoardFilters, SetFilters] {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlKey = searchParams.toString();
  const [filters, setLocal] = useState(() => parseBoardFilters(searchParams));
  // Query strings this hook wrote and the router has not settled on yet.
  const written = useRef(new Set<string>());
  const latest = useRef(urlKey);

  useEffect(() => {
    if (written.current.has(urlKey)) {
      if (urlKey === latest.current) written.current.clear();
      return;
    }
    written.current.clear();
    latest.current = urlKey;
    setLocal(parseBoardFilters(new URLSearchParams(urlKey)));
  }, [urlKey]);

  const setFilters: SetFilters = (next, { replace = false } = {}) => {
    const params = writeBoardFilters(next, searchParams);
    const key = params.toString();
    written.current.add(key);
    latest.current = key;
    setLocal(next);
    setSearchParams(params, { replace });
  };

  return [filters, setFilters];
}
