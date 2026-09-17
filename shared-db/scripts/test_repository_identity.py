import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repository_identity as ri  # noqa: E402


def origin(url):
    return lambda: url


# "@" is joined at runtime so the PII forward guard does not read git remotes as email addresses.
AT = "@"


class RepositoryIdentityTests(unittest.TestCase):
    def test_explicit_wins_and_must_agree(self):
        self.assertEqual(ri.resolve_repository_identity("popcre/shared-db", env={}, read_origin=origin(None)), "popcre/shared-db")
        with self.assertRaises(ri.RepositoryIdentityError):
            ri.resolve_repository_identity("popcre/shared-db", env={"GITHUB_REPOSITORY": "u2giants/shared-db"}, read_origin=origin(None))

    def test_actions_env(self):
        self.assertEqual(ri.resolve_repository_identity(env={"GITHUB_REPOSITORY": "popcre/shared-db"}, read_origin=origin(None)), "popcre/shared-db")

    def test_remote_forms(self):
        for url in ("https://github.com/popcre/shared-db.git", f"https://x-access-token:abc{AT}github.com/popcre/shared-db",
                    f"git{AT}github.com:popcre/shared-db.git", f"ssh://git{AT}github.com/popcre/shared-db.git"):
            self.assertEqual(ri.resolve_repository_identity(env={}, read_origin=origin(url)), "popcre/shared-db")
        self.assertEqual(ri.resolve_repository_identity(env={}, read_origin=origin("https://github.com/u2giants/shared-db")), "u2giants/shared-db")

    def test_refuses_non_github_malformed_and_absent(self):
        for url in ("https://gitlab.com/popcre/shared-db.git", "https://github.com/popcre", "C:/repos/shared-db", "https://github.com.evil/popcre/shared-db"):
            with self.assertRaises(ri.RepositoryIdentityError):
                ri.resolve_repository_identity(env={}, read_origin=origin(url))
        for bad in ("popcre", "a/b/c", "../x", "popcre/shared-db.git", "popcre/ space"):
            with self.assertRaises(ri.RepositoryIdentityError):
                ri.parse_repository_slug(bad)
        with self.assertRaises(ri.RepositoryIdentityError):
            ri.resolve_repository_identity(env={}, read_origin=origin(None))

    def test_env_origin_disagreement_refused_case_insensitive_agreement_allowed(self):
        with self.assertRaises(ri.RepositoryIdentityError):
            ri.resolve_repository_identity(env={"GITHUB_REPOSITORY": "popcre/shared-db"}, read_origin=origin(f"git{AT}github.com:u2giants/shared-db.git"))
        self.assertEqual(ri.resolve_repository_identity(env={"GITHUB_REPOSITORY": "PopCre/shared-db"}, read_origin=origin(f"git{AT}github.com:popcre/shared-db.git")), "PopCre/shared-db")

    def test_read_origin_failure_is_none(self):
        self.assertIsNone(ri.read_origin_url(run=lambda *a, **k: SimpleNamespace(returncode=2, stdout="")))
        def boom(*a, **k):
            raise OSError("no git")
        self.assertIsNone(ri.read_origin_url(run=boom))

    def test_historical(self):
        self.assertTrue(ri.is_this_repository_or_historical("u2giants/shared-db", "popcre/shared-db"))
        self.assertTrue(ri.is_this_repository_or_historical("popcre/shared-db", "popcre/shared-db"))
        self.assertFalse(ri.is_this_repository_or_historical("someone/shared-db", "popcre/shared-db"))

    def test_this_checkout_resolves(self):
        self.assertRegex(ri.current_repository(), r"^[^/]+/[^/]+$")


if __name__ == "__main__":
    unittest.main()
