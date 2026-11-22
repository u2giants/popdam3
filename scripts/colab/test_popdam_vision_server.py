import ast
import hmac
import io
import json
import re
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest.mock import MagicMock, patch


class ColabProxyTest(unittest.TestCase):
    def setUp(self):
        notebook = json.loads(Path(__file__).with_name("popdam_vision_server.ipynb").read_text())
        cell = next(cell for cell in notebook["cells"] if any("class PopdamProxyHandler" in line for line in cell["source"]))
        code = ast.parse("".join(cell["source"]))
        code.body = [node for node in code.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))]
        self.shutdown_event = threading.Event()
        namespace = dict(globals(), API_KEY="fixture", VLLM_PORT=8001, shutdown_event=self.shutdown_event,
                         shutdown_reason={}, last_activity={"ts": 0})
        exec(compile(code, "popdam_vision_server.ipynb", "exec"), namespace)
        self.handler = namespace["PopdamProxyHandler"]

    def request(self, target, *, method="GET", headers=b"", body=b""):
        request = MagicMock()
        request.makefile.return_value = io.BytesIO(
            f"{method} {target} HTTP/1.1\r\nConnection: close\r\n".encode() + headers + b"\r\n" + body
        )
        self.handler(request, ("127.0.0.1", 1), None)
        return int(request.sendall.call_args_list[0].args[0].split()[1])

    def test_all_forwarded_routes_require_authentication(self):
        with patch("urllib.request.urlopen") as upstream:
            for path in ["/health", "/metrics", "/v1/models"]:
                with self.subTest(path=path):
                    self.assertEqual(self.request(path), 401)
            self.assertEqual(self.request("/popdam/shutdown?source=test", method="POST"), 401)
            self.assertEqual(self.request("/health", headers=b"Authorization: Bearer \xff\r\n"), 401)
            upstream.assert_not_called()
            self.assertFalse(self.shutdown_event.is_set())
            upstream.return_value.__enter__.return_value.status = 200
            upstream.return_value.__enter__.return_value.read.return_value = b"healthy"
            upstream.return_value.__enter__.return_value.headers = {}
            self.assertEqual(self.request("/health", headers=b"Authorization: Bearer fixture\r\n"), 200)
            upstream.assert_called_once()

    def test_shutdown_handles_query_and_rejects_bad_lengths(self):
        auth = b"Authorization: Bearer fixture\r\n"
        target = "/popdam/shutdown/?source=test"
        with patch("urllib.request.urlopen") as upstream:
            for framing in [b"Content-Length: invalid", b"Content-Length: -1",
                            b"Content-Length: 2\r\nContent-Length: 3", b"Transfer-Encoding: chunked",
                            b"Content-Length: 99999999999999999999999999999", b"Content-Length: 5"]:
                with self.subTest(framing=framing):
                    self.assertEqual(self.request(target, method="POST", headers=auth + framing + b"\r\n"), 400)
            self.assertEqual(self.request(target, headers=auth), 405)
            self.assertEqual(self.request("https://example.test/popdam/shutdown", method="POST", headers=auth), 400)
            self.assertFalse(self.shutdown_event.is_set())
            self.assertEqual(self.request(target, method="POST", headers=auth + b"Content-Length: 2\r\n", body=b"{}"), 200)
            self.assertTrue(self.shutdown_event.is_set())
            upstream.assert_not_called()


if __name__ == "__main__":
    unittest.main()
