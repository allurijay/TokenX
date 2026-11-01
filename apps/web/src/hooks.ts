import { useEffect, useState } from "react";
import { api } from "./api";
export function useResource(path: string, revision: number) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return { data, error };
}
