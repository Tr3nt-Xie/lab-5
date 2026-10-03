"""Local regression checks; no AWS access or real device credentials."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]


class UploadHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.server.requests.append((self.path, body))
        status, delay = self.server.status, self.server.delay
        time.sleep(delay)
        try:
            self.send_response(status)
            if status == 302:
                self.send_header('Location', '/redirect-target')
            self.end_headers()
            self.wfile.write(b'dummy-device-secret must never be printed')
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self.server.requests.append((self.path, b''))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args):
        pass


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), UploadHandler)
        self.server.status, self.server.delay, self.server.requests = 200, 0, []
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        self.thread.start()
        self.env = dict(os.environ, TB_HOST=f'http://127.0.0.1:{self.server.server_port}',
                        TB_TOKEN='dummy-device-secret', TB_CONNECT_TIMEOUT='1', TB_MAX_TIME='2',
                        NO_PROXY='127.0.0.1', no_proxy='127.0.0.1')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def run_upload(self, *coordinates, **environment):
        result = subprocess.run(['bash', str(ROOT / 'tools/send-test-location.sh'), *coordinates],
                                env=dict(self.env, **environment), text=True,
                                capture_output=True, timeout=5)
        self.assertNotIn('dummy-device-secret', result.stdout + result.stderr)
        return result

    def test_success_serializes_numeric_input_and_marks_test_data(self):
        result = self.run_upload('+034.0205', '-1.182856e2')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.server.requests), 1)
        path, body = self.server.requests[0]
        self.assertEqual(path, '/api/v1/dummy-device-secret/telemetry')
        data = json.loads(body)
        self.assertAlmostEqual(data['lat'], 34.0205)
        self.assertAlmostEqual(data['lon'], -118.2856)
        self.assertTrue(data['testData'])
        self.assertEqual(data['tid'], 'TS')
        self.assertLess(abs(data['tst'] - time.time()), 5)

    def test_accepts_boundary_coordinates_and_empty_204_response(self):
        self.server.status = 204
        result = self.run_upload('-90', '180')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('HTTP 204', result.stdout)

    def test_http_errors_return_failure_and_hide_response(self):
        for status in (400, 401, 403, 500):
            with self.subTest(status=status):
                self.server.status = status
                result = self.run_upload('0', '0')
                self.assertEqual(result.returncode, 22)
                self.assertIn(f'HTTP {status}', result.stderr)

    def test_redirect_is_rejected_without_forwarding_token(self):
        self.server.status = 302
        result = self.run_upload('0', '0')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.server.requests), 1)

    def test_invalid_coordinates_never_reach_server(self):
        for coordinates in [('91', '0'), ('0', '-180.1'), ('NaN', '0'),
                            ('0', 'Infinity'), ('1e999', '0'), ('', '0'),
                            ('0,"injected":true', '0'), ('0',), ('0', '0', '1')]:
            with self.subTest(coordinates=coordinates):
                self.assertEqual(self.run_upload(*coordinates).returncode, 2)
        self.assertEqual(self.server.requests, [])

    def test_invalid_configuration_never_reaches_server(self):
        for environment in [dict(TB_TOKEN=''), dict(TB_HOST=''),
                            dict(TB_HOST='https://user:dummy-device-secret@example.com'),
                            dict(TB_HOST=self.env['TB_HOST'] + '/api/v1/token'),
                            dict(TB_HOST=self.env['TB_HOST'] + '?token=dummy-device-secret'),
                            dict(TB_MAX_TIME='0'), dict(TB_MAX_TIME='NaN'),
                            dict(TB_CONNECT_TIMEOUT='301')]:
            with self.subTest(environment=list(environment)):
                self.assertEqual(self.run_upload('0', '0', **environment).returncode, 2)
        self.assertEqual(self.server.requests, [])

    def test_token_path_characters_are_encoded(self):
        result = self.run_upload('0', '0', TB_TOKEN='test/?#{}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.server.requests[0][0], '/api/v1/test%2F%3F%23%7B%7D/telemetry')

    def test_timeout_fails_once_without_retry(self):
        self.server.delay = 0.4
        result = self.run_upload('0', '0', TB_MAX_TIME='0.1')
        self.assertEqual(result.returncode, 28)
        self.assertIn('delivery is uncertain', result.stderr)
        self.assertEqual(len(self.server.requests), 1)

    def test_connection_failure_is_not_success(self):
        self.server.shutdown()
        self.server.server_close()
        result = self.run_upload('0', '0')
        self.assertEqual(result.returncode, 7)


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.bin = Path(self.temp.name)
        self.log = self.bin / 'calls'
        stubs = {
            'java': 'echo "openjdk version \\\"${MOCK_JAVA_VERSION:-17.0.20.1}\\\"" >&2',
            'id': 'printf "1000\\n"',
            'systemctl': '[[ " ${MOCK_INACTIVE:-} " != *" ${@: -1} "* ]]',
            'sudo': 'shift 3; exec "$@"',
            'timeout': 'shift; exec "$@"',
            'psql': '[[ ${MOCK_DB_FAILURE:-0} == 0 ]] || exit 2\nprintf "%s\\n" "${MOCK_DB_RESULT:-thingsboard|16|t|t}"',
            'curl': '''
target=${@: -1}
if [[ $target == http://127.0.0.1* ]]; then code=${MOCK_LOCAL_HTTP:-200}; else code=${MOCK_PUBLIC_HTTP:-200}; fi
printf '%s' "$code"
[[ ${MOCK_CURL_FAILURE:-0} == 0 ]] || exit "$MOCK_CURL_FAILURE"
[[ $code != [45]* ]] || exit 22
''',
        }
        for name, body in stubs.items():
            path = self.bin / name
            path.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "' + name
                            + '" >> "$MOCK_CALLS"\n' + body + '\n')
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        MOCK_CALLS=str(self.log), TB_JAVA_BIN=str(self.bin / 'java'),
                        TB_PUBLIC_URL='https://lab.example', TB_LOCAL_URL='http://127.0.0.1:8080')

    def tearDown(self):
        self.temp.cleanup()

    def run_health(self, *arguments, **environment):
        return subprocess.run(['bash', str(ROOT / 'server/check-health.sh'), *arguments],
                              env=dict(self.env, **environment), text=True,
                              capture_output=True, timeout=5)

    def test_full_success(self):
        result = self.run_health()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('7 passed, 0 failed (full mode)', result.stdout)

    def test_failed_services_do_not_skip_other_checks(self):
        result = self.run_health(MOCK_INACTIVE='thingsboard postgresql@16-main')
        self.assertEqual(result.returncode, 1)
        self.assertIn('5 passed, 2 failed', result.stdout)
        self.assertIn('[PASS] Public HTTPS', result.stdout)

    def test_database_failures(self):
        for environment in [dict(MOCK_DB_FAILURE='1'),
                            dict(MOCK_DB_RESULT='thingsboard|16|t|f'),
                            dict(MOCK_DB_RESULT='thingsboard|15|t|t')]:
            with self.subTest(environment=environment):
                result = self.run_health(**environment)
                self.assertEqual(result.returncode, 1)
                self.assertIn('[FAIL] Database', result.stdout)
                self.assertIn('[PASS] Public HTTPS', result.stdout)

    def test_wrong_java_is_reported(self):
        result = self.run_health(MOCK_JAVA_VERSION='11.0.28')
        self.assertEqual(result.returncode, 1)
        self.assertIn('[FAIL] Java 17', result.stdout)

    def test_http_failure_and_redirect(self):
        for environment in [dict(MOCK_LOCAL_HTTP='500'), dict(MOCK_PUBLIC_HTTP='302'),
                            dict(MOCK_PUBLIC_HTTP='000', MOCK_CURL_FAILURE='60')]:
            with self.subTest(environment=environment):
                result = self.run_health(**environment)
                self.assertEqual(result.returncode, 1)
                self.assertIn('[FAIL]', result.stdout)

    def test_http_only_skips_server_commands(self):
        result = self.run_health('--http-only')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('1 passed, 0 failed (HTTP-only mode)', result.stdout)
        calls = self.log.read_text().splitlines()
        self.assertEqual(calls, ['curl'])

    def test_rejects_insecure_or_secret_public_url(self):
        for url in ('http://lab.example', 'https://user:secret@lab.example',
                    'https://lab.example/?token=secret', ''):
            with self.subTest(url=url):
                result = self.run_health('--public-url', url)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn('secret', result.stdout + result.stderr)

    def test_missing_option_value_is_usage_error(self):
        self.assertEqual(self.run_health('--public-url').returncode, 2)


if __name__ == '__main__':
    unittest.main()
