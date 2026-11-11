/** Admin-only "Older copies" actions (u2giants/popdam3#963). Logic: ../snapshot-requests.ts. */
import { json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { getResult, requestSnapshotRestore, requestSnapshotVersions, RESTORE_RESULT_KEY, VERSIONS_RESULT_KEY } from "../snapshot-requests.ts";

const send = (o: { status: number; body: Record<string, unknown> }) => json(o.body, o.status);

export async function handleRequestSnapshotVersions(body: Record<string, unknown>, userId: string) {
  return send(await requestSnapshotVersions(serviceClient(), body, userId));
}
export async function handleGetSnapshotVersionsResult(body: Record<string, unknown>) {
  return send(await getResult(serviceClient(), VERSIONS_RESULT_KEY, body));
}
export async function handleRequestSnapshotRestore(body: Record<string, unknown>, userId: string) {
  return send(await requestSnapshotRestore(serviceClient(), body, userId));
}
export async function handleGetSnapshotRestoreResult(body: Record<string, unknown>) {
  return send(await getResult(serviceClient(), RESTORE_RESULT_KEY, body));
}
