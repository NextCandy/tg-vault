#!/usr/bin/env python3
"""Installer configuration regressions; temporary files, no Docker daemon calls.

python3 deploy/install-configuration.test.py
Optional --compose also compares real Compose's read-only config --environment
and checks exported parsed values beat ambient overrides. No build/up/pull occurs.
"""
import importlib.util
import itertools
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "deploy/install-config.py"
COMPOSE = "--compose" in sys.argv
if COMPOSE:
    sys.argv.remove("--compose")
# Do not create __pycache__ in the shared checkout.
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("install_config", HELPER)
assert spec is not None and spec.loader is not None
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tg-vault-config-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / ".env"

    def cli(self, *args, env=None):
        return subprocess.run([sys.executable, str(HELPER), *map(str, args)],
                              env=env, text=True, capture_output=True, timeout=10)


class DotenvTests(Fixture):
    def test_supported_assignment_forms(self):
        for text in ["VALUE=secret", "VALUE='secret'", 'VALUE="secret"',
                     "export VALUE=secret", "  export\tVALUE = secret  ",
                     "VALUE = secret", "VALUE= secret ", "VALUE=secret # comment",
                     "VALUE='secret'#comment", "VALUE=secret\r\n"]:
            with self.subTest(text=text):
                self.path.write_bytes(text.encode())
                self.assertEqual(config.read_env("VALUE", self.path), "secret")

    def test_last_assignment_wins_and_empty_quotes_are_empty(self):
        self.path.write_text("VALUE=first\nexport VALUE = 'second'\nVALUE=\"\"\n")
        self.assertEqual(config.read_env("VALUE", self.path), "")
        config.upsert_env("VALUE", "kept", self.path)
        self.assertEqual(self.path.read_text(), "VALUE=kept\n")

    def test_nonexistent_read_and_remove_do_not_create_file(self):
        self.assertEqual(config.read_env("VALUE", self.path), "")
        config.remove_env(self.path, ["VALUE"])
        self.assertFalse(self.path.exists())

    def test_crlf_comments_unrelated_secrets_preserved_byte_for_byte(self):
        before = b"# operator note\r\nexport OTHER = 'a$b #secret'\r\n export VALUE = old\r\nVALUE=stale\r\n\r\n"
        self.path.write_bytes(before)
        config.upsert_env("VALUE", "https://api.example.cn", self.path)
        self.assertEqual(self.path.read_bytes(), b"# operator note\r\nexport OTHER = 'a$b #secret'\r\nVALUE=https://api.example.cn\r\n\r\n")
        config.remove_env(self.path, ["VALUE"])
        self.assertEqual(self.path.read_bytes(), b"# operator note\r\nexport OTHER = 'a$b #secret'\r\n\r\n")

    def test_empty_file_creation_and_missing_final_newline(self):
        config.upsert_env("VALUE", "", self.path)
        self.assertEqual(self.path.read_text(), "VALUE=\n")
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.path.write_text("OTHER=unchanged")
        config.upsert_env("VALUE", "hello", self.path)
        self.assertEqual(self.path.read_text(), "OTHER=unchanged\nVALUE=hello\n")

    def test_existing_file_mode_owner_and_noop_preserved(self):
        self.path.write_text("VALUE=secret\n")
        self.path.chmod(0o600)
        before = self.path.stat()
        config.upsert_env("VALUE", "secret", self.path)
        self.assertEqual(self.path.stat().st_ino, before.st_ino)
        config.upsert_env("VALUE", "different", self.path)
        after = self.path.stat()
        self.assertEqual((after.st_uid, after.st_gid), (before.st_uid, before.st_gid))
        self.assertEqual(stat.S_IMODE(after.st_mode), 0o600)

    def test_remove_all_exported_spaced_duplicates_and_multiple_keys(self):
        self.path.write_text("A=1\nexport A=2\n A = 3\nB=1\nC=2\n")
        config.remove_env(self.path, ["A", "B"])
        self.assertEqual(self.path.read_text(), "C=2\n")

    def test_literal_hash_and_compose_escapes(self):
        cases = {"word#hash": "word#hash", "word #comment": "word", "#comment": "",
                 "'a\\'b'": "a'b", "'a\\\\b'": "a\\\\b", "'a\\nb'": "a\\nb",
                 '"a\\\\b"': "a\\b", '"a\\tb"': "a\tb", '"a\\$b"': "a$b",
                 "'literal${MISSING}'": "literal${MISSING}", "$$literal": "$literal",
                 '"$${literal}"': "${literal}", '"$5"': "$5", "word\\": "word\\"}
        for encoded, value in cases.items():
            with self.subTest(encoded=encoded):
                self.assertEqual(config.parse_value(encoded), value)

    def test_roundtrip_arbitrary_single_line_secret_values(self):
        values = ["", "plain", " leading trailing ", "password'quoted\"", "$ENV ${VAR} $(touch ignored)",
                  "back\\slash\\", "raw`command`;:&|<>()#", "Unicode秘密пароль", "a\tb", "a\\'b"]
        values.extend("".join(p) for p in itertools.product("a'\"\\$#\t", repeat=3))
        for value in values:
            with self.subTest(value=value):
                self.assertEqual(config.parse_value(config.encode_value(value)), value)
        for value in values[:10]:
            config.upsert_env("VALUE", value, self.path)
            self.assertEqual(config.read_env("VALUE", self.path), value)

    def test_interpolation_and_unsupported_syntax_fail_without_mutation(self):
        rows = ["VALUE=$ENV", 'VALUE="${VAR:-secret}"', "VALUE=$(touch ignored)",
                "VALUE='one\ntwo'", 'VALUE="secret', "VALUE", "export VALUE", "bad-key=secret",
                "VALUE='secret' trailing", 'VALUE="secret\\q"', 'VALUE="secret\\n"',
                "VALUE=secret\rBAD=1", "VALUE=secret\x00", "\ufeffVALUE=secret"]
        for text in rows:
            with self.subTest(text=text):
                before = text.encode()
                self.path.write_bytes(before)
                for operation in [lambda: config.read_env("VALUE", self.path),
                                  lambda: config.upsert_env("VALUE", "new", self.path),
                                  lambda: config.remove_env(self.path, ["VALUE"])]:
                    with self.assertRaises(config.ConfigError):
                        operation()
                    self.assertEqual(self.path.read_bytes(), before)

    def test_controls_and_invalid_key_rejected_before_write(self):
        for value in ["a\nb", "a\rb", "a\x00b", "a\x7fb"]:
            with self.assertRaises(config.ConfigError):
                config.upsert_env("VALUE", value, self.path)
        for key in ["bad-key", "", "1VALUE", "VALUE\n"]:
            with self.assertRaises(config.ConfigError):
                config.upsert_env(key, "value", self.path)
        self.assertFalse(self.path.exists())

    def test_full_file_validation_and_secret_free_error(self):
        secret = "never-print-this-secret"
        self.path.write_text(f"VALUE=valid\nOTHER=\"{secret}\n")
        result = self.cli("read", "VALUE", self.path)
        self.assertEqual(result.returncode, 2)
        self.assertIn("line 2", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "")

    def test_env_values_are_not_executed_or_read_from_ambient(self):
        marker = Path(self.temp.name) / "executed"
        self.path.write_text(f"VALUE='$(touch {marker})'\n")
        result = self.cli("read", "VALUE", self.path, env=dict(os.environ, VALUE="ambient"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f"$(touch {marker})")
        self.assertFalse(marker.exists())
        self.path.write_text(f"VALUE=`touch {marker}`\n")
        self.assertEqual(config.read_env("VALUE", self.path), f"`touch {marker}`")
        self.assertFalse(marker.exists())

    def test_symlink_is_rejected_without_touching_target(self):
        target = Path(self.temp.name) / "target"
        target.write_text("VALUE=kept\n")
        self.path.symlink_to(target)
        result = self.cli("upsert", "VALUE", "new", self.path)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(target.read_text(), "VALUE=kept\n")

    def test_cli_contract_all_commands(self):
        self.assertEqual(self.cli("upsert", "VALUE", "secret", self.path).returncode, 0)
        self.assertEqual(self.cli("read", "VALUE", self.path).stdout, "secret\n")
        self.assertEqual(self.cli("remove", self.path, "VALUE").returncode, 0)
        self.assertEqual(self.cli("read", "VALUE", self.path).stdout, "\n")
        self.assertEqual(self.cli("origin", "https://api.example.cc/").stdout, "https://api.example.cc\n")

    def test_cli_leading_dash_secret_and_bad_arity_do_not_leak(self):
        secret = "--never-print-this-secret"
        result = self.cli("upsert", "VALUE", secret, self.path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(config.read_env("VALUE", self.path), secret)
        self.assertNotIn(secret, result.stdout + result.stderr)
        result = self.cli("upsert", "VALUE", secret)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(secret, result.stdout + result.stderr)


class OriginTests(unittest.TestCase):
    def test_valid_origins_preserve_domains_and_ports(self):
        values = ["https://cloud.example.cc", "https://api.example.cn", "https://web.files.example.xyz",
                  "https://files.example.com.cn:8443", "http://localhost:51947", "http://127.0.0.1:8080",
                  "https://[::1]:8443", "https://[2001:db8::1]", "https://xn--bcher-kva.example",
                  "https://cloud.example.org:65535", "https://api.example.cc:1", "https://Api.Example.CN"]
        for value in values:
            with self.subTest(value=value):
                self.assertEqual(config.normalize_origin(value), value)
                self.assertEqual(config.normalize_origin("  " + value + "/\t"), value)

    def test_invalid_origins_never_silently_repaired(self):
        values = ["cloud.example.cc", "ftp://cloud.example.cc", "https://user:pass@cloud.example.cc",
                  "https://cloud.example.cc:abc", "https://cloud.example.cc:65536", "https://cloud.example.cc:0",
                  "https://cloud.example.cc:", "https://:443", "https://cloud audit.cc", "https://cloud\naudit.cc",
                  "https://cloud\taudit.cc", "https://cloud.audit.cc\r", "https://cloud.example.cc/path",
                  "https://cloud.example.cc//", "https://cloud.example.cc?", "https://cloud.example.cc#",
                  "https://cloud.example.cc,https://other.cc", "https://cloud.example.cc\\path",
                  "https://cloud..example.cc", "https://-cloud.example.cc", "https://cloud_.example.cc",
                  "https://256.1.1.1", "https://127.1", "https://::1", "https://[::1", "https://[:::1]",
                  "https://[::1]:", "https://[fe80::1%eth0]", "https://[v1.test]", "https://host:１２３"]
        for value in values:
            with self.subTest(value=value):
                with self.assertRaises(config.ConfigError):
                    config.normalize_origin(value)


@unittest.skipUnless(COMPOSE, "add --compose for real read-only Compose syntax checks")
class ComposeTests(Fixture):
    def setUp(self):
        super().setUp()
        self.docker = shutil.which("docker")
        assert self.docker is not None, "--compose explicitly requires Docker Compose CLI"
        self.compose = Path(self.temp.name) / "compose.yml"
        self.compose.write_text("services:\n  fixture:\n    image: scratch\n    environment:\n      VALUE: ${VALUE:-}\n")

    def rendered_environment(self, extra=None):
        env = {"PATH": os.environ["PATH"], "HOME": self.temp.name, **(extra or {})}
        result = subprocess.run([self.docker, "compose", "-f", str(self.compose), "--env-file", str(self.path),
                                 "config", "--environment"], env=env, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return dict(line.split("=", 1) for line in result.stdout.split("\n") if "=" in line)

    def test_accepted_forms_agree_with_compose(self):
        cases = ["VALUE='secret'", 'VALUE="secret"', "export VALUE=secret", " VALUE = secret ",
                 "VALUE=secret\r\n", "VALUE=first\nexport VALUE = last", "VALUE=word # comment",
                 "VALUE='a\\'b'", "VALUE='a\\\\b'", "VALUE='a\\nb'", 'VALUE="a\\tb"',
                 "VALUE='literal$VARIABLE'", 'VALUE="a\\$b"', "VALUE=$$literal", 'VALUE="$${literal}"']
        for text in cases:
            with self.subTest(text=text):
                self.path.write_bytes(text.encode())
                self.assertEqual(config.read_env("VALUE", self.path), self.rendered_environment()["VALUE"])

    def test_saved_secret_values_agree_with_compose(self):
        for value in ["", "normal", " a b ", "quote'and\"", "back\\slash\\", "a\tb", "$VAR ${VAR} $$",
                      "`literal`;:#", "Unicode秘密", "a\\'b", "back\\$VAR"]:
            with self.subTest(value=value):
                config.upsert_env("VALUE", value, self.path)
                self.assertEqual(self.rendered_environment()["VALUE"], value)

    def test_parsed_exports_beat_ambient_values_in_actual_compose(self):
        self.path.write_text("CORS_ORIGIN='https://cloud.example.cc'\nVITE_API_URL=https://api.example.cn\nDB_PASSWORD=kept-password\n")
        self.compose.write_text("services:\n  fixture:\n    image: scratch\n    environment:\n      CORS_ORIGIN: ${CORS_ORIGIN}\n      VITE_API_URL: ${VITE_API_URL}\n      DB_PASSWORD: ${DB_PASSWORD}\n")
        ambient = {"CORS_ORIGIN": "http://127.0.0.1:9998", "VITE_API_URL": "http://127.0.0.1:9999", "DB_PASSWORD": "wrong-password"}
        before = self.rendered_environment(ambient)
        self.assertEqual({key: before[key] for key in ambient}, ambient, "--env-file alone does not win")
        selected = {key: config.read_env(key, self.path) for key in ambient}
        selected["CORS_ORIGIN"] = config.normalize_origin(selected["CORS_ORIGIN"])
        selected["VITE_API_URL"] = config.normalize_origin(selected["VITE_API_URL"])
        effective = self.rendered_environment({**ambient, **selected})
        self.assertEqual({key: effective[key] for key in selected}, selected)


if __name__ == "__main__":
    unittest.main(verbosity=2)
