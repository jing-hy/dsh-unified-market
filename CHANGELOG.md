# 更新日志

本文件记录 dsh-unified-market 对外可见的变更。

## 0.4.1

**修复精选目录在站点改版后「静默塌缩」（issue #1）。**

- `parseSite()` 改为按 `data-cat` 属性识别卡片，不再绑定 `li class="item"`。
  站点 2026-09 改版把卡片 class 改成 `card`，旧正则恒返回 0 条 —— 而 0 条会被
  后续兜底盖住，用户看到的是"市场里就这些插件"，不报错也不超时。
- 修正静态解析的三处标记漂移：
  - 标题按 `<h3><a href="…"><span class="owner">owner/</span>name</a></h3>` 解析，
    `owner` 与 `name` 拆开还原；
  - `data-cmd` **取最后一个** —— 每张卡片的第一个是"通过 dsh-market · 推荐"的
    通用推广按钮（命令是装 `dshmarket` 自己），取第一个会让解析出的插件**全部
    装错包**；
  - 星级优先读 `data-stars`，同时读入 `data-added`；站内相对链接（`/zh/p/…`）
    补成绝对 URL，并按 `owner/repo` 还原 GitHub 身份（monorepo 子包
    `repo#packages/sub` → `github.com/owner/repo`），让"已安装/内置"判定与
    `plugins.json` 同一口径。
- 新增站点静态 JSON 目录源（`/zh/catalog.json` / `/catalog.json`，全量 4000+
  条、卡片同构），作为 `plugins.json` 之外的第二个在线源。
- 两个在线源**并行**发起，单源超时预算 12s（旧实现串行 10s + 10s，单源抖动
  固定空窗 20s）；权威源 `plugins.json` 保留 4s 优先宽限，超时即用已并行就绪的
  静态目录 —— 单源失败不再等于整份目录失败。
- 空目录守卫只看**该源自己的原始 payload**（不被后续合并/兜底掩盖）：任一源
  解析出 0 条都继续降级，而不是静默返回残缺目录。
- `whitelistSource()` 注释与行为对齐（该函数只接收已解析目录，自身不发起请求）。

## 0.4.0

**profile 配置写入从「单向复写」改为「双边同步」。**

背景：此前市场只经 `dsh plugin add/remove` 间接改配置，由 dsh 内核
`reconcilePlugins` 按 `dependencies` **整文件重写** `package.json`。整文件重写 =
「以内存状态覆盖磁盘」：读取之后、写入之前发生的一切外部改动（用户手编、
其他插件、壳侧 heal、并发会话）都会被丢掉。用户观感就是"页面状态单向复写到
文件，文件反被覆盖"。

- 新增 `lib/profile-sync.mjs`：profile 配置的唯一写层，语义为双边同步。
  - **每次重读磁盘**，无模块级缓存，绝不用操作开始前的快照覆盖当前状态；
  - 以 **id 为键做并集合并**，只增删本层管理的条目；外部行、未知行、注释、
    空行**原样保留**；
  - 写前 **CAS**（SHA256 + size + mtime）比对，冲突则重读重合并（最多 3 次），
    并发写不再互相覆盖；
  - 同目录临时文件 + `rename` **原子写**（`cordis.patch.yml` 被截断 = 启动死循环）；
  - 写前**校验**（空 `- insert:` 块、duplicate loader entry、JSON 可解析），
    非法产出**拒绝落盘**；
  - 写后**复核**，不一致自动**回滚**到操作前快照。
- 快照从「只备 `package.json` 且无还原」升级为**同时备 `cordis.patch.yml`**，
  并新增 `profile.restore` / `profile.snapshots` 还原接口（此前完全没有还原代码）。
- 新增四个 host 方法：`profile.state`（读实时状态 + 校验 + 快照列表）、
  `profile.toggle`（启用/禁用，双边同步落盘）、`profile.snapshots`、
  `profile.restore`。全部以每次重读磁盘为准，不使用页面侧缓存。
- CLI 操作（安装/卸载）成功后新增**后置同步**：以内核重写后的**磁盘现状**为
  基准做增量合并，把本次操作的意图落盘，同时保留期间的一切外部改动。
- 禁用插件改为写**顶层编辑型**行（`- id: X` / `name` / `disabled: true`），
  而非 `- insert:` 块 —— 桌面壳 boot 期 `removeBundledRowDuplicates`
  （`dsh-desktop/patch-row-heal.js`）会删除与 bundle 包内 patch 同 id 的
  insert 块（**即使带 `disabled: true`**），顶层编辑型行不受该去重影响。
  同时自动移除 insert 块内的同 id 内层条目，避免 duplicate loader entry；
  并清理因此产生的**孤立空 `- insert:` 块**。
- 未改动 YAML 解析方式：全程逐行文本手术，**不使用** js-yaml `load → dump`
  回写（那样会丢注释、改引号风格、破坏 `[]` 空块）。

> 注：`cordis.patch.yml` 中「手写在 `- insert:` 块内的 `disabled: true`」会在
> 下次启动被桌面壳去重删掉 —— 这是壳侧行为，不是市场行为。请改用本版写出的
> 顶层编辑型禁用行。

## 0.3.1

- 修复功能包 CLI 定位失败的误导性报错：0.3.0 及之前，「桌面壳未注入
  `DSH_DESKTOP_RESOURCE_ROOT`」与「CLI 文件不存在（客户端安装不完整或版本
  过旧）」两种失败统一误报"缺少 DSH_DESKTOP_RESOURCE_ROOT"，用户在桌面端
  却被提示去桌面端，排障困难。
- 现 `packCliStatus()` 区分两种原因并给出可行动提示（升级 / 重装桌面客户端），
  `pack.*` 全部方法同步使用新文案。

## 0.3.0

- 新增「📦 功能包」tab 与 `pack.*` host 方法：EAC 功能包（.dshpack）的交互编排层
  （安装 / 卸载 / 更新 / 导出 / 回滚 / 市场浏览 + 官方内核兼容扫描联动）。
- `SELF_VERSION` 与 package.json 同步至 0.3.0。
- 针对 DSH Desktop（EAC）5.1 与 dsh 0.1.1-rc.2 完成专项适配测试。

## 0.2.1

- 修复 README 编码问题（去除 BOM、修正 mojibake）。

## 0.2.0

- 三源合一：精选目录（awesome-dsh-plugin.com）+ GitHub `dsh-plugin` 生态 + npm registry。
- EAC 适配：web-desktop profile 解析链（DSH_DESKTOP_PROFILE → DSH_PROFILE → web）、
  文件锁排队与启动消费、link → 上游接管、24h 保护期、更新进度窗口。
