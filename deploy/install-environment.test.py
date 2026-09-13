#!/usr/bin/env python3
"""Hermetic installer preflight tests; no host Docker/sudo/package calls.

Run: python3 deploy/install-environment.test.py [--legacy]
--legacy exercises original install.sh functions from the pinned audited commit.
All commands reachable through PATH are allowlisted fakes, including uname.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "deploy/install-environment.sh"
BASH = os.environ.get("TG_VAULT_TEST_BASH", "/bin/bash")
PYTHON = sys.executable
LEGACY = "--legacy" in sys.argv
if LEGACY:
    sys.argv.remove("--legacy")
    original = subprocess.check_output(
        ["git", "show", "ab8d90e14f4170954bc32f2c1080e9fcd95484e7:deploy/install.sh"],
        cwd=ROOT, text=True)
    LEGACY_SOURCE = original[original.index("detect_package_manager() {"):original.index('\nif [[ ! -f docker-compose.yml ]]')]

FAKE = r'''import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['FAKE_ROOT'])
cfg = json.loads((root / 'fake.json').read_text())
with (root / 'commands.jsonl').open('a') as log:
    log.write(json.dumps([name, *args]) + '\n')
installed = (root / 'installed').exists() and cfg.get('repair', True)
def fail(message, status=1):
    print(message, file=sys.stderr)
    raise SystemExit(status)
if name == 'uname':
    print(cfg.get('os', 'Linux'))
elif name == 'docker':
    if args[:2] == ['compose', 'version']:
        if cfg.get('compose', True) or installed:
            print(cfg.get('compose_version', '2.39.0'))
        else:
            fail("docker: 'compose' is not a docker command")
    elif args[:2] == ['buildx', 'version']:
        if cfg.get('buildx', True) or installed:
            print('github.com/docker/buildx v0.28.0')
        else:
            fail("docker: 'buildx' is not a docker command")
    elif args == ['buildx', 'build', '--help']:
        print('--sbom --provenance --attest' if cfg.get('attest', True) or installed else '--tag')
    elif args == ['compose', 'up', '--help']:
        print('--wait --wait-timeout --no-recreate' if cfg.get('wait', True) or installed else '--wait')
    elif args == ['buildx', 'inspect']:
        if not cfg.get('builder', True):
            fail('selected builder is unreachable')
        print(cfg.get('inspect', 'Name: default\nDriver: docker\nStatus: running\nBuildKit: v0.23.2'))
    elif args and args[0] == 'info':
        if not cfg.get('daemon', True) or (installed and not cfg.get('daemon_after_install', True)):
            fail(cfg.get('daemon_error', 'Cannot connect to the Docker daemon'))
        if '{{json .DriverStatus}}' in args:
            print('[["driver-type","io.containerd.snapshotter.v1"]]' if cfg.get('containerd', True) else '[["Backing Filesystem","extfs"]]')
        else:
            print('28.4.0')
    elif args and args[0] == 'compose' and 'config' in args:
        probe = sys.stdin.read()
        (root / 'probe.yml').write_text(probe)
        if not cfg.get('schema', True) and 'sbom:' in probe and not installed:
            fail('services.preflight.build Additional property sbom is not allowed')
        if not cfg.get('base_schema', True):
            fail('base schema invalid')
        print('')
    else:
        fail('UNEXPECTED DOCKER COMMAND: ' + repr(args), 99)
elif name == 'apt-cache':
    assert args[0] == 'policy', args
    package = args[1]
    version = cfg.get('packages', {}).get(package)
    print(package + ':\n  Installed: (none)\n  Candidate: ' + (version or '(none)'))
elif name in ('dnf', 'yum') and 'list' in args:
    package = args[-1]
    version = cfg.get('packages', {}).get(package)
    if version is None:
        fail('No matching Packages to list')
    print('Available Packages\n' + package + '.x86_64 ' + version + ' configured-repo')
elif name in ('apt-get', 'dnf', 'yum'):
    if cfg.get('package_fail', False):
        fail('repository or signature failure')
    if 'install' in args:
        if cfg.get('install_fail', False):
            fail('package installation failed')
        (root / 'installed').touch()
        # Model the package manager making missing executables available.
        for tool in ('docker', 'git', 'python3'):
            destination = root / 'bin' / tool
            if not destination.exists():
                destination.symlink_to(root / 'fake-command')
elif name == 'sudo':
    if cfg.get('sudo_fail', False):
        fail('sudo denied')
    if args and args[0] == '--':
        args.pop(0)
    os.execvp(args[0], args)
elif name in ('git', 'python3'):
    print('Python 3.11.0' if name == 'python3' else 'git version 2.40.0')
else:
    fail('UNEXPECTED COMMAND: ' + name, 99)
'''


class Sandbox(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tg-vault-preflight-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o777)
        (self.root / "bin").mkdir(mode=0o777)
        (self.root / "bin").chmod(0o777)
        fake = self.root / "fake-command"
        fake.write_text(f"#!{PYTHON}\n" + FAKE)
        fake.chmod(0o755)
        self.config = {}
        self.tools = {"docker", "python3", "git", "uname"}

    def run_check(self, *, interactive=False, input="", code=None, as_user=None, existing_env=True):
        for tool in self.tools:
            dest = self.root / "bin" / tool
            if not dest.exists():
                dest.symlink_to(self.root / "fake-command")
        config = self.root / "fake.json"
        config.write_text(json.dumps(self.config))
        config.chmod(0o644)
        before = b"DB_PASSWORD=never-print-this-secret\n"
        envfile = self.root / ".env"
        if existing_env:
            envfile.write_bytes(before)
            envfile.chmod(0o600)
        source = LEGACY_SOURCE if LEGACY else HELPER.read_text()
        sourcefile = self.root / "helper.sh"
        sourcefile.write_text(source)
        sourcefile.chmod(0o644)
        script = "set -euo pipefail\nsource ./helper.sh\n" + (code or "check_environment")
        env = {
            "PATH": str(self.root / "bin"),
            "HOME": str(self.root),
            "LC_ALL": "C.UTF-8",
            "FAKE_ROOT": str(self.root),
            "NON_INTERACTIVE": "false" if interactive else "true",
        }
        result = subprocess.run([BASH, "--noprofile", "--norc", "-c", script],
                                cwd=self.root, env=env, input=input, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                timeout=10, **({"user": as_user} if as_user is not None else {}))
        self.output = result.stdout
        self.commands = [json.loads(line) for line in (self.root / "commands.jsonl").read_text().splitlines()] if (self.root / "commands.jsonl").exists() else []
        if existing_env:
            self.assertEqual(envfile.read_bytes(), before, "preflight must not change .env")
        else:
            self.assertFalse(envfile.exists(), "preflight must not create .env")
        self.assertNotIn("never-print-this-secret", result.stdout)
        self.assertNotIn("unbound variable", result.stdout)
        self.assertNotIn("syntax error", result.stdout)
        return result

    def assert_failed(self, result):
        self.assertNotEqual(result.returncode, 0, self.output)

    def assert_passed(self, result):
        self.assertEqual(result.returncode, 0, self.output)

    def assert_no_writes(self):
        for command in self.commands:
            self.assertNotEqual(command[0], "sudo", command)
            self.assertFalse(command[0] in ("apt-get", "dnf", "yum") and any(x in command for x in ("install", "update", "makecache")), command)
            if command[0] == "docker":
                self.assertNotIn(command[1], ("run", "start", "pull", "build"), command)
                self.assertNotIn("--bootstrap", command)


@unittest.skipUnless(LEGACY, "run --legacy before replacing original functions")
class LegacyReproduction(Sandbox):
    def test_missing_docker_falsely_reports_compose_installed(self):
        self.tools.remove("docker")
        self.assert_failed(self.run_check())
        self.assertRegex(self.output, r"Docker Compose 插件\s+✓ 已安装")
        print("REPRODUCED: absent Docker incorrectly labels Compose installed")

    def test_dead_daemon_old_compose_missing_buildx_pass_old_preflight(self):
        self.config.update(daemon=False, compose_version="2.20.0", schema=False, buildx=False)
        self.assert_passed(self.run_check())
        self.assertEqual(self.commands, [["docker", "compose", "version"]])
        print("REPRODUCED: Compose 2.20.0 + dead daemon + no Buildx pass old preflight")

    def test_apt_guesses_nonexistent_plugin_and_blank_authorizes_install(self):
        self.tools.add("apt-get")
        self.config.update(compose=False, repair=False, packages={"docker-compose-v2": "2.39.0"})
        self.assert_failed(self.run_check(interactive=True, input="\n"))
        self.assertIn(["apt-get", "install", "-y", "docker-compose-plugin"], self.commands)
        print("REPRODUCED: blank input installs guessed docker-compose-plugin despite only docker-compose-v2 available")


@unittest.skipIf(LEGACY, "new-helper suite")
class EnvironmentTests(Sandbox):
    def test_source_has_no_side_effects(self):
        self.assert_passed(self.run_check(code="declare -F check_environment >/dev/null"))
        self.assertEqual(self.commands, [])

    def test_healthy_environment_is_read_only(self):
        self.assert_passed(self.run_check())
        self.assert_no_writes()
        probe = (self.root / "probe.yml").read_text()
        self.assertIn("sbom: true", probe)
        self.assertIn("provenance: mode=max", probe)
        config = next(c for c in self.commands if c[0:2] == ["docker", "compose"] and "config" in c)
        self.assertIn("--env-file", config)
        self.assertIn("/dev/null", config)
        self.assertIn("--quiet", config)

    def test_missing_docker_also_reports_compose_and_buildx(self):
        self.tools.remove("docker")
        self.assert_failed(self.run_check())
        for tool in ("docker", "compose", "buildx"):
            self.assertIn(tool, self.output.lower())
        self.assertNotIn("已安装", self.output.split("Docker Compose")[1].splitlines()[0])
        self.assert_no_writes()

    def test_noninteractive_never_reads_input_or_invokes_sudo_or_packages(self):
        self.tools.update({"sudo", "apt-get", "apt-cache"})
        self.config["compose"] = False
        self.assert_failed(self.run_check(input="1\nyes\n"))
        self.assert_no_writes()
        self.assertFalse(any(c[0] in ("apt-get", "apt-cache", "sudo") for c in self.commands))

    def test_noninteractive_leaves_input_for_caller(self):
        self.tools.remove('docker')
        self.assert_passed(self.run_check(input='retained\n', code='''
if check_environment; then exit 90; fi
IFS= read -r next
[[ "$next" == retained ]]
'''))
        self.assert_no_writes()

    def test_preflight_never_creates_first_install_env(self):
        self.config['daemon'] = False
        self.assert_failed(self.run_check(existing_env=False))
        self.assert_no_writes()

    def test_undefined_noninteractive_is_safe(self):
        self.tools.remove("docker")
        self.tools.update({"apt-get", "apt-cache", "sudo"})
        self.assert_failed(self.run_check(code="unset NON_INTERACTIVE; check_environment", input="1\n"))
        self.assert_no_writes()

    def test_invalid_noninteractive_is_rejected(self):
        self.assert_failed(self.run_check(code="NON_INTERACTIVE=garbage; check_environment"))
        self.assert_no_writes()

    def test_daemon_failure_stops_before_install(self):
        self.config.update(daemon=False, compose=False)
        self.tools.update({"apt-get", "apt-cache", "sudo"})
        self.assert_failed(self.run_check(interactive=True, input="1\n"))
        self.assertIn("daemon", self.output.lower())
        self.assertIn("DOCKER_HOST", self.output)
        self.assert_no_writes()

    def test_permission_denied_is_actionable(self):
        self.config.update(daemon=False, daemon_error="permission denied while trying to connect")
        self.assert_failed(self.run_check())
        self.assertIn("权限", self.output)
        self.assertIn("rootless", self.output)
        self.assert_no_writes()

    def test_incompatible_compose_schema_is_rejected(self):
        self.config.update(compose_version="2.38.0", schema=False)
        self.assert_failed(self.run_check())
        self.assertIn("2.39.0", self.output)
        self.assertIn("sbom", self.output)
        self.assert_no_writes()

    def test_vendor_backport_passes_capability_probe(self):
        self.config.update(compose_version="2.38.0-vendor", schema=True)
        self.assert_passed(self.run_check())

    def test_new_version_does_not_override_failed_capability(self):
        self.config.update(compose_version="5.0.0", schema=False)
        self.assert_failed(self.run_check())

    def test_missing_buildx(self):
        self.config["buildx"] = False
        self.assert_failed(self.run_check())
        self.assertIn("Buildx", self.output)
        self.assertIn("provenance", self.output)

    def test_old_buildx_without_attest_flags(self):
        self.config["attest"] = False
        self.assert_failed(self.run_check())
        self.assertIn("Buildx", self.output)

    def test_broken_selected_builder(self):
        self.config["builder"] = False
        self.assert_failed(self.run_check())
        self.assertIn("docker buildx inspect", self.output)

    def test_builder_error_with_zero_exit_is_rejected(self):
        self.config['inspect'] = 'Name: bad\nDriver: docker-container\nError: permission denied'
        self.assert_failed(self.run_check())
        self.assertIn('Error', self.output)
        self.assert_no_writes()

    def test_stopped_builder_is_not_bootstrapped(self):
        self.config['inspect'] = 'Name: cold\nDriver: docker-container\nStatus: stopped'
        self.assert_failed(self.run_check())
        self.assert_no_writes()

    def test_old_buildkit_is_rejected_with_attestations(self):
        self.config['inspect'] = 'Name: old\nDriver: docker-container\nStatus: running\nBuildkit: v0.10.6'
        self.assert_failed(self.run_check())
        self.assertIn('0.11', self.output)

    def test_classic_image_store_rejected_with_attestations(self):
        self.config['containerd'] = False
        self.assert_failed(self.run_check())
        self.assertIn('containerd', self.output)
        self.assert_no_writes()

    def test_explicit_baseline_mode_accepts_older_compose_classic_store(self):
        self.config.update(compose_version='2.20.0', schema=False, attest=False, containerd=False)
        self.assert_passed(self.run_check(code='INSTALL_REQUIRE_ATTESTATIONS=false; check_environment'))
        probe = (self.root / 'probe.yml').read_text()
        self.assertNotIn('sbom:', probe)
        self.assertNotIn('provenance:', probe)
        self.assertIn('兼容模式', self.output)
        self.assert_no_writes()

    def test_baseline_mode_still_requires_buildx(self):
        self.config['buildx'] = False
        self.assert_failed(self.run_check(code='INSTALL_REQUIRE_ATTESTATIONS=false; check_environment'))

    def test_baseline_mode_rejects_absent_wait_timeout(self):
        self.config.update(compose_version='2.15.0', wait=False)
        self.assert_failed(self.run_check(code='INSTALL_REQUIRE_ATTESTATIONS=false; check_environment'))
        self.assertIn('2.18.0', self.output)

    def test_baseline_mode_config_failure_is_not_ignored(self):
        self.config['base_schema'] = False
        self.assert_failed(self.run_check(code='INSTALL_REQUIRE_ATTESTATIONS=false; check_environment'))

    def test_baseline_mode_accepts_capable_older_release(self):
        self.config.update(compose_version='2.17.3', schema=False)
        self.assert_passed(self.run_check(code='INSTALL_REQUIRE_ATTESTATIONS=false; check_environment'))

    def test_invalid_attestation_setting_is_rejected(self):
        self.assert_failed(self.run_check(code='INSTALL_REQUIRE_ATTESTATIONS=maybe; check_environment'))

    def test_baseline_mode_installs_compose_2_20(self):
        self.apt({'docker-compose-v2': '2.20.0'}, compose=False, compose_version='2.20.0')
        self.assert_passed(self.run_check(interactive=True, input='1\n',
                                        code='INSTALL_REQUIRE_ATTESTATIONS=false; check_environment'))

    def test_baseline_mode_never_installs_compose_below_2_18(self):
        self.apt({'docker-compose-v2': '2.17.0'}, compose=False, wait=False)
        self.assert_failed(self.run_check(interactive=True, input='1\n',
                                        code='INSTALL_REQUIRE_ATTESTATIONS=false; check_environment'))
        self.assertFalse(any('install' in c for c in self.commands))

    def test_legacy_buildkit_disabled(self):
        self.assert_failed(self.run_check(code="export DOCKER_BUILDKIT=0; check_environment"))
        self.assertIn("DOCKER_BUILDKIT", self.output)

    def test_non_linux_is_not_auto_installed(self):
        self.config["os"] = "Darwin"
        self.tools.remove("docker")
        self.tools.update({"apt-get", "apt-cache"})
        self.assert_failed(self.run_check(interactive=True, input="1\n"))
        self.assertIn("Linux", self.output)
        self.assert_no_writes()

    def test_unknown_linux_package_manager(self):
        self.tools.remove("docker")
        self.assert_failed(self.run_check(interactive=True, input="1\n"))
        self.assertIn("apt/dnf/yum", self.output)
        self.assert_no_writes()

    def test_unknown_linux_with_complete_tools_passes(self):
        self.assert_passed(self.run_check())

    def test_blank_is_not_install_consent(self):
        self.tools.remove("docker")
        self.tools.update({"apt-get", "apt-cache"})
        self.assert_failed(self.run_check(interactive=True, input="\n"))
        self.assert_no_writes()

    def test_manual_hint_and_eof_never_install(self):
        self.tools.remove("docker")
        self.tools.update({"apt-get", "apt-cache"})
        self.assert_failed(self.run_check(interactive=True, input="2\n"))
        self.assert_no_writes()
        self.assert_failed(self.run_check(interactive=True, input=""))
        self.assert_no_writes()

    def apt(self, packages, **config):
        self.tools.update({"apt-get", "apt-cache"})
        self.config.update(packages=packages, **config)

    def test_ubuntu_package_names(self):
        self.tools.remove("docker")
        self.apt({"docker.io": "28.2.2", "docker-compose-v2": "2.39.0", "docker-buildx": "0.28.0"})
        self.assert_passed(self.run_check(interactive=True, input="1\n"))
        install = next(c for c in self.commands if c[0] == "apt-get" and "install" in c)
        for package in self.config["packages"]:
            self.assertIn(package, install)
        self.assertIn("--no-remove", install)
        self.assertFalse(any("docker-compose-plugin" in c for c in self.commands if "install" in c))

    def test_debian_compose_v2_named_docker_compose(self):
        self.apt({"docker-compose": "2.39.0-1", "docker-buildx": "0.28.0-1"}, compose=False, buildx=False)
        self.assert_passed(self.run_check(interactive=True, input="1\n"))
        install = next(c for c in self.commands if c[0] == "apt-get" and "install" in c)
        self.assertIn("docker-compose", install)
        self.assertIn("docker-buildx", install)

    def test_debian_compose_v1_is_not_selected(self):
        self.apt({"docker-compose": "1.29.2-3"}, compose=False)
        self.assert_failed(self.run_check(interactive=True, input="1\n"))
        self.assertFalse(any("install" in c for c in self.commands))

    def test_official_repo_names_and_epoch_version(self):
        self.tools.remove("docker")
        self.apt({"docker-ce": "5:28.4.0", "docker-ce-cli": "5:28.4.0", "docker-compose-plugin": "2.39.0", "docker-buildx-plugin": "0.28.0"})
        self.assert_passed(self.run_check(interactive=True, input="1\n"))
        install = next(c for c in self.commands if c[0] == "apt-get" and "install" in c)
        for package in self.config["packages"]:
            self.assertIn(package, install)

    def test_dnf_existing_repositories_only(self):
        self.tools.remove("docker")
        self.tools.add("dnf")
        self.config["packages"] = {"docker-ce": "28.4.0", "docker-ce-cli": "28.4.0", "docker-compose-plugin": "2.39.0", "docker-buildx-plugin": "0.28.0"}
        self.assert_passed(self.run_check(interactive=True, input="1\n"))
        install = next(c for c in self.commands if c[0] == "dnf" and "install" in c)
        self.assertIn("--setopt=gpgcheck=1", install)
        self.assertFalse(any("config-manager" in c or "--nogpgcheck" in c for c in self.commands))

    def test_yum_moby_existing_repo_packages(self):
        self.tools.remove("docker")
        self.tools.add("yum")
        self.config["packages"] = {"moby-engine": "28.4.0", "moby-cli": "28.4.0", "docker-compose": "2.39.0", "docker-buildx": "0.28.0"}
        self.assert_passed(self.run_check(interactive=True, input="1\n"))
        install = next(c for c in self.commands if c[0] == "yum" and "install" in c)
        self.assertIn("moby-engine", install)
        self.assertIn("moby-cli", install)

    def test_unavailable_packages_never_guess_or_install_partial_set(self):
        self.tools.remove("docker")
        self.apt({"docker.io": "28.4.0"})
        self.assert_failed(self.run_check(interactive=True, input="1\n"))
        self.assertFalse(any("install" in c for c in self.commands))
        self.assertIn("仓库", self.output)

    def test_failed_install_is_not_reported_success(self):
        self.apt({"docker-compose-v2": "2.39.0"}, compose=False, package_fail=True)
        self.assert_failed(self.run_check(interactive=True, input="1\n"))

    def test_failed_package_install_after_successful_index_update(self):
        self.apt({'docker-compose-v2': '2.39.0'}, compose=False, install_fail=True)
        self.assert_failed(self.run_check(interactive=True, input='1\n'))
        self.assertTrue(any('install' in c for c in self.commands))

    def test_daemon_after_install_is_rechecked(self):
        self.tools.remove('docker')
        self.apt({'docker.io': '28.4.0', 'docker-compose-v2': '2.39.0', 'docker-buildx': '0.28.0'},
                 daemon_after_install=False)
        self.assert_failed(self.run_check(interactive=True, input='1\n'))
        self.assertIn('daemon', self.output)

    def test_incomplete_engine_cli_candidate_never_installed(self):
        self.tools.remove('docker')
        self.apt({'docker-ce': '28.4.0'})
        self.assert_failed(self.run_check(interactive=True, input='1\n'))
        self.assertFalse(any('install' in c for c in self.commands))

    def test_apt_without_apt_cache_is_unsupported(self):
        self.tools.remove('docker')
        self.tools.add('apt-get')
        self.assert_failed(self.run_check(interactive=True, input='1\n'))
        self.assert_no_writes()

    def test_install_is_rechecked_even_if_package_manager_returns_success(self):
        self.apt({"docker-compose-v2": "2.39.0"}, compose=False, repair=False)
        self.assert_failed(self.run_check(interactive=True, input="1\n"))
        self.assertGreaterEqual(sum(c[:3] == ["docker", "compose", "version"] for c in self.commands), 2)

    def test_missing_python_and_git_can_be_installed(self):
        self.tools.difference_update({"python3", "git"})
        self.apt({"python3": "3.11.0", "git": "2.40.0"})
        self.assert_passed(self.run_check(interactive=True, input="1\n"))
        install = next(c for c in self.commands if c[0] == "apt-get" and "install" in c)
        self.assertIn("python3", install)
        self.assertIn("git", install)

    @unittest.skipUnless(os.geteuid() == 0, "requires root to drop subprocess uid")
    def test_nonroot_without_sudo_does_not_install(self):
        self.apt({"docker-compose-v2": "2.39.0"}, compose=False)
        self.assert_failed(self.run_check(interactive=True, input="1\n", as_user=65534))
        self.assertIn("sudo", self.output)
        self.assertFalse(any("install" in c for c in self.commands))

    @unittest.skipUnless(os.geteuid() == 0, "requires root to drop subprocess uid")
    def test_nonroot_sudo_only_after_explicit_consent(self):
        self.tools.add("sudo")
        self.apt({"docker-compose-v2": "2.39.0"}, compose=False)
        self.assert_passed(self.run_check(interactive=True, input="1\n", as_user=65534))
        self.assertTrue(any(c[0] == "sudo" for c in self.commands))

    def test_no_test_bypass_for_failed_environment(self):
        self.config["compose"] = False
        self.assert_failed(self.run_check(code="export INSTALL_TEST_SKIP_ENV_RECHECK=true; check_environment"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
