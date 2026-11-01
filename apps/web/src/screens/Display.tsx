import { Badge } from "../components/ui";
import { useResource } from "../hooks";
import type { Row } from "../types";
export default function Display({ venue, revision }: any) {
  const { data, error } = useResource("/display?venueId=" + venue, revision);
  return (
    <div className="public-display">
      <h2>Freshly made. Almost yours.</h2>
      <p>Look out for your token at your cuisine’s collection counter.</p>
      {error && <p className="error">{error}</p>}
      <div className="cards">
        {data?.map((r: Row, i: number) => (
          <article className="display-token" key={i}>
            <strong>
              {r.token_prefix}-{String(r.token_seq).padStart(3, "0")}
            </strong>
            <h3>{r.alias}</h3>
            <p>{r.outlet}</p>
            <Badge
              tone={r.serve_state === "READY_FOR_PICKUP" ? "green" : "amber"}
            >
              {r.serve_state === "READY_FOR_PICKUP"
                ? "Ready for pickup"
                : "Preparing"}
            </Badge>
          </article>
        ))}
      </div>
    </div>
  );
}
