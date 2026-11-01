import { Download } from "lucide-react";
import { downloadCsv } from "../api";
import { Badge } from "../components/ui";
import { useResource } from "../hooks";
import type { Row } from "../types";
export default function Audit({ venue, revision }: any) {
  const { data, error } = useResource(
    "/audit-events?venueId=" + venue,
    revision,
  );
  return (
    <>
      <div className="section-head">
        <div>
          <h2>A clear record of every change.</h2>
          <p>Immutable history, scoped to your access.</p>
        </div>
        <button
          className="secondary"
          onClick={() => downloadCsv("tokenex-audit.csv", data || [])}
        >
          <Download size={16} />
          Export
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Reference</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((r: Row) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.actor_name || "System"}</td>
                <td>
                  <Badge>{r.action}</Badge>
                </td>
                <td>{r.resource_id.slice(0, 8)}</td>
                <td>
                  <details>
                    <summary>View evidence</summary>
                    <pre>{JSON.stringify(r.details, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
