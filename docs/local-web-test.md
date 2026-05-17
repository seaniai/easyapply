# 本地浏览器测试 EasyApply（Web / easyapply-server）

在 Windows 上用浏览器访问本机 HTTP 服务，验证 `feat/azure-cicd` 的 Web 模式（非 Tauri 桌面窗口）。

## 前提

- 已安装 Node.js、Rust、Cargo
- 仓库路径示例：`C:\Users\wxpal\Desktop\Documents\toolbox\easyapply`
- 默认 HTTP 端口：**8787**（环境变量 `PORT` 或 `WEBSITES_PORT`；Azure App Service 请将两者都设为 `8787`）

## 命令流程

### 1. 构建前端（改过前端后执行）

```powershell
cd C:\Users\wxpal\Desktop\Documents\toolbox\easyapply
npm run build
```

产物目录：`dist/`

### 2. 启动 HTTP 服务（终端 A，保持运行）

```powershell
cd C:\Users\wxpal\Desktop\Documents\toolbox\easyapply\src-tauri

$env:EASYAPPLY_STATIC_DIR = "C:\Users\wxpal\Desktop\Documents\toolbox\easyapply\dist"
$env:EASYAPPLY_DATA_DIR = "C:\Users\wxpal\Desktop\Documents\toolbox\easyapply\data"
$env:EASYAPPLY_SECRET_ENCRYPTION_KEY = "easyapply-dev-key-do-not-use!!!!"
$env:PORT = "8787"

cargo run --bin easyapply-server --features server
```

成功标志：

```text
easyapply-server listening on http://0.0.0.0:8787
```

> `0.0.0.0` 仅表示服务监听所有网卡；**浏览器不要用该地址访问**。

### 3. 健康检查（可选，终端 B）

```powershell
curl.exe http://localhost:8787/health
```

预期输出：`ok`（PowerShell 中 `curl` 是别名时，可用 `curl.exe` 避免交互提示）。

### 4. 浏览器访问

| 地址 | 用途 |
|------|------|
| http://localhost:8787/health | 健康检查，应显示 `ok` |
| http://localhost:8787/ | 完整 Web UI（登录、Job Applied、Code 等） |

亦可使用：`http://127.0.0.1:8787/`

## 停止服务

在运行 `cargo run` 的终端按 **Ctrl+C**。

若再次 `cargo run` 报「拒绝访问」且无法覆盖 `easyapply-server.exe`，说明旧进程仍在：

```powershell
taskkill /IM easyapply-server.exe /F
```

然后重新执行第 2 步。

## 常见问题

| 现象 | 处理 |
|------|------|
| 浏览器打开 `http://0.0.0.0:8787` 报 `ERR_ADDRESS_INVALID` | 改用 `http://localhost:8787/` |
| 页面空白或 404 | 确认已 `npm run build`，且设置了 `EASYAPPLY_STATIC_DIR` 指向 `dist` 后**重启**服务 |
| `cargo run` 失败：拒绝访问 `easyapply-server.exe` | 先 `Ctrl+C` 或 `taskkill` 结束旧进程 |
| 仅改前端 | `npm run build` 后重启服务即可加载新静态资源 |

## 与桌面版区别

| 项目 | 本地 Web（本文） | Tauri 桌面 |
|------|------------------|------------|
| 启动 | `cargo run --bin easyapply-server --features server` | `npx tauri dev` |
| 访问 | 浏览器 `localhost:8787` | 应用窗口 |
| CSV | 下载 / 上传 | 文件夹选择器 |

更完整的 Azure / CI/CD 说明见 [plan.md](./plan.md) 第 10 节。

## 桌面版（Tauri）

与 Web 服务互不冲突，在项目根目录启动：

```powershell
cd C:\Users\wxpal\Desktop\Documents\toolbox\easyapply
npx tauri dev
```

`src-tauri/Cargo.toml` 中已设置 `default-run = "app"`，避免与 `easyapply-server` 二进制冲突导致 `cargo run` 无法选择目标。

## 多用户数据隔离

Job Applied / Code Management 按登录用户的 `user_id` 隔离。验证步骤：

1. 用户 A 登录 → 新增几条记录 → 登出。  
2. 用户 B 登录 → 应**看不到** A 的数据；新增 B 的记录。  
3. A 再登录 → 仅看到 A 自己的数据。

旧库首次启动会通过迁移为已有行补上 `user_id`（默认 `1`，通常对应首个 Admin）。
