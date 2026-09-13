const unusableConnectorStatuses = new Set(["disconnected", "failed", "invalid", "revoked", "expired"]);

export function selectManagedConnection(
  connections: Array<{ id: string; status?: string | null }>,
) {
  const usable = connections.filter((connection) =>
    !unusableConnectorStatuses.has(connection.status?.toLowerCase() ?? ""),
  );
  if (usable.length === 0) return { kind: "missing" as const };
  if (usable.length > 1) return { kind: "ambiguous" as const };
  return { kind: "selected" as const, connection: usable[0] };
}

export const managedCredentialsReference = (connectorName: string, connectionId: string) =>
  `replit-connector:${connectorName}:${connectionId}`;