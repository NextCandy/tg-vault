#!/usr/bin/env python3
"""Fail-closed storage selection. Never migrate or recursively change ownership."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def validate_path(value):
    # Deliberately narrow, portable syntax: no dotenv/Compose interpolation or
    # short-volume separators. Spaces are supported by long Compose syntax.
    if not re.fullmatch(r'/[A-Za-z0-9_./ -]+', value) or '..' in Path(value).parts:
        raise ValueError('保存位置必须为绝对路径，仅支持字母、数字、空格、/、-、_、.；不支持冒号、美元符号或换行。')
    p = Path(value)
    if len(p.parts) < 3 or p in [Path('/var/lib'), Path('/usr/local')]:
        raise ValueError('请选择专用应用子目录，不可使用系统根目录或磁盘根目录。')
    if p.resolve() != p:
        raise ValueError('保存位置不可经过符号链接或包含非规范路径。')
    return p


def create_directory(value):
    p = validate_path(value)
    if p.exists():
        raise ValueError('保存位置已存在；为保护原文件，请选择尚不存在的专用子目录。')
    if not p.parent.is_dir():
        raise ValueError('上级目录不存在；请先挂载磁盘或创建上级目录。')
    p.mkdir(mode=0o700)
    try:
        if os.geteuid() == 0:
            os.chown(p, 1000, 1000)
        elif os.geteuid() != 1000:
            subprocess.run(['sudo', '-n', 'chown', '1000:1000', '--', str(p)], check=True)
    except Exception:
        p.rmdir()
        raise ValueError('无法设置运行用户权限；请使用 sudo 运行安装器。')
    return p


def existing():
    # .env alone counts as an upgrade, including copied examples. Never allow
    # a new default to hide an unknown old mount. Daemon failures propagate.
    if Path('.env').exists():
        return True
    if docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + os.environ.get('COMPOSE_PROJECT_NAME', 'tg-vault')):
        return True
    return bool(docker('volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + os.environ.get('COMPOSE_PROJECT_NAME', 'tg-vault')))


def metadata(source, kind):
    p = Path(source).resolve(strict=True)
    stat = p.stat()
    return dict(LOCAL_STORAGE_HOST_ROOT=str(p), LOCAL_STORAGE_CONTAINER_ROOT='/data',
                LOCAL_STORAGE_DEVICE=str(stat.st_dev), LOCAL_STORAGE_INODE=str(stat.st_ino), LOCAL_STORAGE_MOUNT_TYPE=kind)


def verify(config):
    mounts = config['services']['backend'].get('volumes', [])
    target = [m for m in mounts if m['target'] == '/data']
    if len(target) != 1:
        raise ValueError('无法确认 /data 挂载，已停止。请保留原部署配置。')
    desired = target[0]
    selected = os.environ.get('LOCAL_STORAGE_SOURCE')
    if selected and os.environ.get('LOCAL_STORAGE_MOUNT_TYPE') == 'bind' and (desired['type'] != 'bind' or desired['source'] != selected):
        raise ValueError('当前 Compose 未使用选定目录，已停止。请保留原配置并核对安装版本。')
    ids = docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + config['name'], '--filter', 'label=com.docker.compose.service=backend').split()
    if not ids and os.environ.get('STORAGE_EXISTING') == 'true':
        # With no old container, require the original data source to exist.
        # A copied .env is not evidence that an empty legacy volume is safe.
        if desired['type'] == 'volume':
            docker('volume', 'inspect', config['volumes'][desired['source']]['name'])
        elif desired['type'] == 'bind':
            if not Path(desired['source']).is_dir():
                raise ValueError('原文件目录不存在，已停止；请恢复原磁盘挂载。')
        else:
            raise ValueError('无法确认原文件存储，已停止。')
    for cid in ids:
        actual = [m for m in json.loads(docker('inspect', cid))[0]['Mounts'] if m['Destination'] == '/data']
        source = desired['source']
        if desired['type'] == 'volume':
            source = config['volumes'][source]['name']
        if len(actual) != 1 or actual[0]['Type'] != desired['type'] or (actual[0].get('Name') if desired['type'] == 'volume' else actual[0]['Source']) != source or not actual[0]['RW'] or desired.get('read_only', False):
            raise ValueError('现有文件挂载与部署配置不一致，已停止。请恢复原挂载；不会自动迁移文件。')


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action == 'existing': print('true' if existing() else 'false')
        elif action == 'create': print(create_directory(sys.argv[2]))
        elif action == 'verify': verify(json.load(sys.stdin))
        elif action == 'metadata': print(json.dumps(metadata(sys.argv[2], sys.argv[3])))
        else: raise ValueError('未知存储操作')
    except Exception as e:
        print(str(e) if isinstance(e, ValueError) else '无法确认本地存储配置或权限，已停止。', file=sys.stderr)
        sys.exit(1)
