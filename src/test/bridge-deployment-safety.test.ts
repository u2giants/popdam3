import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("bridge deployment safety", () => {
  it("never tears the Compose project down during an update", () => {
    const update = read("deploy/synology/update.sh");
    expect(update).not.toContain("docker compose down");
    expect(update).toContain("docker compose config --quiet");
    expect(update).toContain("previous_image_id=");
    expect(update).toContain("sleep 45");
  });

  it("keeps the production mount writable without unsupported Synology CPU controls", () => {
    const compose = read("deploy/synology/docker-compose.yml");
    expect(compose).toContain("/volume1/nas-share:/mnt/nas/mac  #");
    expect(compose).not.toContain("/mnt/nas/mac:ro");
    expect(compose).not.toContain("cpus:");
  });

  it("packages and imports the eligibility contract in the clean runtime image", () => {
    const dockerfile = read("apps/bridge-agent/Dockerfile");
    expect(dockerfile).toContain("/app/src/sg-eligibility-contract.json ./dist/sg-eligibility-contract.json");
    expect(dockerfile).toContain("import('./dist/sg-ingest-filter.js')");
  });

  it("does not synthesize unmanaged replacement containers", () => {
    const entrypoint = read("apps/bridge-agent/src/index.ts");
    expect(entrypoint).not.toContain("recreateViaDockerRun");
    expect(entrypoint).toContain("No Compose file found; self-update stopped without replacing the running container");
  });
});
