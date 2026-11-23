import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "popdam3";
export default defineRailway(() => {
  const popdam3 = service("popdam3", {
    source: github("u2giants/popdam3", { branch: "main", checkSuites: false, rootDirectory: "/apps/worker" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["/apps/worker/**"] },
    // Keep IPv4 and permit Meta Model API over the supported IPv6 path.
    deploy: { ipv6EgressEnabled: true, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    replicas: { "us-east4-eqdc4a": 1 },
  });

  return project("popdam", {
    variables: { managed: false },
    resources: [popdam3],
  });
});
