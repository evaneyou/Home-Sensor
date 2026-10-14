import { Link, useSearchParams } from "react-router-dom";
import ConnectionMini from "./ConnectionMini";

export default function ConnectionDiagramLink({ monitorId }: { monitorId?: string }) {
  const [params] = useSearchParams();
  if (!monitorId) return null;
  const next = new URLSearchParams();
  const network = params.get("network");
  const link = params.get("link");
  if (network) next.set("network", network);
  next.set("detail", "connection");
  if (link) next.set("link", link);
  return (
    <Link
      className="connection-diagram-link"
      to={`/monitors/${monitorId}/connection?${next.toString()}`}
      aria-label="Open the detailed connection diagram"
    >
      <ConnectionMini />
    </Link>
  );
}
