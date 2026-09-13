# 本地文件保存位置 / Local file location

新安装运行 `deploy/install.sh` 时只需填写服务器文件保存位置，默认是安装目录下的 `data`。可填写另一块已挂载磁盘下的专用新子目录，例如 `/mnt/archive/tg-vault-data`。非交互安装可使用 `INSTALL_STORAGE_PATH`。路径允许空格；明确不支持冒号、美元符号、引号、非 ASCII 字符及控制字符。

安装器只创建尚不存在的专用目录，权限为 `0700`，所有者为容器运行用户 UID/GID `1000:1000`。不会递归改动其他目录权限。上级目录须已存在，不能使用符号链接或系统/磁盘根目录。遇到权限错误请使用 sudo 重试。文件目录固定映射到容器 `/data`，原文件仍存于内部 `uploads` 子目录。

**升级不迁移文件。** `.env` 单独存在也按旧部署处理，不应用新默认位置。默认 Compose 仍保留历史 `file-storage` 卷。安装器核对现有 backend 的实际 `/data` 挂载与解析后的 Compose；不一致即停止，不覆盖旧文件。自定义旧 Compose 必须保留原挂载，不能先换成新默认再部署。丢失旧配置且没有容器可供检查时，需管理员恢复原配置再升级；系统不能从文件目录猜测历史挂载。

设置 → 存储的本地卡片显示一个可复制的**服务器文件位置**，文件不是保存在浏览器所在电脑。剩余容量来自实际上传目录所在文件系统，和其他应用共享，不代表 TG Vault 文件占用量。容器目录、挂载类型和校验说明在折叠详情中；网页不提供路径修改或迁移。

## 旧部署路径展示元数据

应用不访问 Docker socket。管理员在宿主机核对 `docker inspect <backend>` 的 `/data` Mounts（Type、Source、Destination、RW）后，可运行只读命令：

```bash
python3 deploy/install-storage.py metadata /实际宿主根目录 volume
# bind 挂载时最后一个参数改为 bind
```

将输出的 `LOCAL_STORAGE_HOST_ROOT`、`LOCAL_STORAGE_CONTAINER_ROOT`、`LOCAL_STORAGE_DEVICE`、`LOCAL_STORAGE_INODE`、`LOCAL_STORAGE_MOUNT_TYPE` 保存到原 `.env`，保留其他配置和秘密不变。不要更改 `LOCAL_STORAGE_SOURCE`，除非已经明确核对原 Compose 的 source。路径显示会校验容器目录的设备号/inode、真实路径及子目录关系。元数据缺失、失效、符号链接或不同文件系统时显示“未确认”；设备号/inode 在 rootless/远程 Docker 或重挂载后可能不同，此时需重新核对而不是伪造标识。此校验用于发现配置过期，不是对恶意宿主机的信任证明。

## 备份与恢复

`deploy/backup.sh` 从现有（可停止的）backend 读取挂载，使用只读 `--volumes-from` 归档 `/data`，兼容 named volume 和 bind，不再猜测卷名。容器不存在时停止而非创建空卷备份。备份过程中按原运行状态暂停/恢复 backend。备份位置应在另一块磁盘；`.env` 不在归档内，需单独安全备份。

`deploy/restore-verify.sh` 仅校验归档。恢复先在隔离项目中建好目标目录/卷，将 `file-storage.tar.gz` 解压到目标 `/data` 根（不要额外套一层 uploads），保留归档权限，并恢复数据库与原密钥。验证文件和 `/readyz` 后再安排生产切换。不要对运行中的数据目录解压覆盖，不要删除原卷。

## English

Fresh installs ask for a server folder (default: `<installation>/data`); use a new dedicated folder on an already-mounted disk. Existing installations keep their original mount, even when only `.env` remains. No automatic migration. Spaces work; special characters such as `:`, `$`, quotes and non-ASCII characters are rejected explicitly. The web card is read-only and shows the verified server uploads path, write status and shared filesystem free space. Unknown host paths stay unconfirmed. Backup uses the backend's actual mounts, supporting both bind directories and named volumes. Back up `.env` separately.

## Русский

При новой установке укажите новый отдельный каталог на сервере (по умолчанию `<каталог установки>/data`), при необходимости на другом подключённом диске. Пробелы поддерживаются; двоеточия, `$`, кавычки и символы вне ASCII не поддерживаются. При обновлении исходное хранилище сохраняется, даже если остался только `.env`. Автоматического переноса нет. Веб-интерфейс показывает подтверждённый путь к файлам на сервере, доступность записи и общее свободное место файловой системы. Изменить путь через веб нельзя. Резервное копирование поддерживает каталоги bind и именованные тома; `.env` сохраняйте отдельно.
