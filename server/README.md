# 作业勇者 · 账号与存档服务

家庭内网用的小服务：家长建号、孩子登录、游戏存档与作业数据云同步。**存档不再只躺在浏览器里。**

## 为什么是自己写的

游戏客户端本来就带着一整套账号 / 云存档的调用（`/account/login`、`/savedata/system/update` 等，共 14 个端点）。这个服务把这套协议实现了，所以**客户端一行都不用改**就有了账号和云存档；在此之上再加两组我们自己的：家长与孩子的关系，以及作业数据的同步。

上游那个 Go 服务器没有家长/孩子的概念，也不认识作业数据，所以没有复用。

## 跑起来

```bash
cd server
node --experimental-sqlite src/index.ts
```

零依赖：`node:http` + `node:sqlite` + `node:crypto`。**不需要 `npm install`，树莓派上也不用编译任何原生模块。** 需要 Node 22.5 以上（24 以上可以去掉 `--experimental-sqlite`）。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8001` | 监听端口，和客户端的 `VITE_SERVER_URL` 对上即可 |
| `DATA_DIR` | `./data` | 数据库和备份的存放目录 |

游戏那边设置 `VITE_SERVER_URL=http://这台机器的IP:8001`，并让 `bypassLogin` 关闭。

## 第一次使用

**在游戏里注册的第一个账号会成为家长账号**，之后注册接口就关闭了。孩子账号只能由家长创建——所以即使有人扫到这个端口，也没有可以注册的入口。

## 数据不丢，靠的是这三件事

1. **每次覆盖都留旧版本**。客户端是整份上传存档的，一次异常的写入本来会直接盖掉进度。现在每写一次都会把旧版本压进 `save_history`，每个存档位保留最近 20 份，「存档没了」变成「回滚一版」。
2. **定时整库备份**。每 6 小时把 SQLite 文件整个拷一份到 `data/backups/`，保留 28 份（约一周）。WAL 模式下可以热拷，不用停服。
3. **`synchronous = FULL`**。写入立刻落盘。这个服务存在的意义就是不丢最后那几秒的进度，而写入频率不过每分钟几次。

## 端点

复刻客户端已有的（不用改客户端）：

```
POST /account/login  /account/register  /account/changepw
GET  /account/info   /account/logout
GET  /savedata/system/get   /savedata/system/verify
POST /savedata/system/update
GET  /savedata/session/get  /savedata/session/delete
POST /savedata/session/update  /clear  /newclear
POST /savedata/updateall
```

我们自己的：

```
GET  /family/children          家长查看名下所有孩子（含最后游玩、最后存档时间）
POST /family/child/create      家长建号
POST /family/child/password    家长重置孩子密码（会踢掉该孩子所有已登录设备）
POST /family/child/disabled    停用 / 恢复（不删数据）
GET  /homework/get?account=…   作业数据（孩子读自己；家长可读自己孩子的）
POST /homework/update?account=…
GET  /health
```

## 几个刻意的取舍

- **密码用 `node:crypto` 的 scrypt**，不是 bcrypt/argon2。后两者都要编译原生模块，而这个服务要跑在家里那台一直开着的机器上——装不上的依赖等于起不来的服务。
- **停用不等于删除**。没有任何接口会删掉孩子的进度，因为这个服务的全部意义就是进度不会消失。
- **会话不过期**。在家庭网络里，会话过期的代价是孩子玩不了、要等家长，这比它防住的风险更糟。
- **作业数据原样存储，服务端不解析**。规则住在游戏里、还会继续调；一个理解数据形状的服务端就得跟着每次调参一起重新部署，对不上就是一份丢掉的计划。
