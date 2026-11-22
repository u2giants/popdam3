"""Exercise image recovery without running Docker or contacting a registry."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


START = Path(__file__).with_name("start-ephemeral-contract-db.sh")
PRIMARY = "public.ecr.aws/supabase/postgres:17.6.1.132"
ALTERNATE = ("ghcr.io/supabase/postgres@"
             "sha256:9d50688a826cf1455a0e91013160171de73b4d31df1509014e73463fb276a84d")


class EphemeralStartup(unittest.TestCase):
    def run_start(self, scenario):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            supabase = root / "supabase"
            supabase.write_text("""#!/usr/bin/env bash
set -eu
printf 'start %s %s\n' "$SUPABASE_INTERNAL_IMAGE_REGISTRY" "$*" >> "$TRACE"
[[ $SCENARIO = ordinary || -f $RUNNER_TEMP/tagged ]] && exit 0
if [[ $SCENARIO = unrelated ]]; then
  printf 'failed to start Postgres: health check failed\n'
  exit 1
fi
printf '%s\n' "Retrying after 8s: $PRIMARY"
printf 'Stopping containers...\n'
printf 'failed to pull docker image: Error response from daemon: error from registry: Data limit exceeded\n'
if [[ $SCENARIO = unrelated_after_diagnostic ]]; then
  printf 'failed to start Postgres: health check failed\n'
fi
printf 'Try rerunning the command with --debug to troubleshoot the error.\n'
exit 1
""")
            docker = root / "docker"
            docker.write_text("""#!/usr/bin/env bash
set -eu
printf 'docker %s\n' "$*" >> "$TRACE"
case "$1 $2" in
  "pull --platform") test "$3 $4" = "linux/amd64 $ALTERNATE" ;;
  "image inspect")
    case "$4" in
      *RepoDigests*) [[ $SCENARIO != wrong_digest ]] && printf '%s\n' "$ALTERNATE" ;;
      *Architecture*) printf '%s\n' linux/amd64 ;;
      *Id*) printf '%s\n' sha256:fixture ;;
    esac ;;
  "image tag")
    test "$3 $4" = "$ALTERNATE $PRIMARY"
    touch "$RUNNER_TEMP/tagged" ;;
  *) exit 2 ;;
esac
""")
            for executable in (supabase, docker):
                executable.chmod(0o700)
            trace = root / "trace"
            env = {**os.environ, "PATH": f"{root}:{os.environ['PATH']}", "RUNNER_TEMP": str(root),
                   "TRACE": str(trace), "SCENARIO": scenario, "PRIMARY": PRIMARY, "ALTERNATE": ALTERNATE}
            result = subprocess.run(["bash", str(START)], env=env, text=True, capture_output=True)
            return result.returncode, trace.read_text().splitlines()

    def test_success_never_pulls_from_the_alternate(self):
        status, calls = self.run_start("ordinary")
        self.assertEqual((status, calls), (0, ["start public.ecr.aws db start"]))

    def test_recovers_only_with_identical_pinned_image_and_original_start(self):
        status, calls = self.run_start("quota")
        self.assertEqual(status, 0)
        self.assertEqual([line for line in calls if line.startswith("start ")],
                         ["start public.ecr.aws db start"] * 2)
        self.assertIn(f"docker pull --platform linux/amd64 {ALTERNATE}", calls)
        self.assertIn(f"docker image tag {ALTERNATE} {PRIMARY}", calls)

    def test_refuses_unrelated_failure_or_unverified_image(self):
        for scenario in ("unrelated", "unrelated_after_diagnostic", "wrong_digest"):
            with self.subTest(scenario=scenario):
                status, calls = self.run_start(scenario)
                self.assertNotEqual(status, 0)
                self.assertEqual([line for line in calls if line.startswith("start ")],
                                 ["start public.ecr.aws db start"])
                self.assertFalse(any(line.startswith("docker image tag") for line in calls))
                if scenario != "wrong_digest":
                    self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
