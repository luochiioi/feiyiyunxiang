# 阶段四：好友、双人合作与可选 PK 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阶段三单路线基线上实现好友申请、双人合作（固定路线版本、匿名共同成果）与独立的可选 PK（原子结算、72 小时失败任务）。

**Architecture:** 云端 `fy-api` 新增 `partnership-service.js`，通过 `index.js` 的 action 分发接入，与 `service.js` 的探索 run 并列。合作和 PK 各自创建 `purpose` 为 `coop`/`pk` 的新 run，复用现有打卡与文化任务完成判定。客户端把 `packages/partner` 的占位页换成真实入口。

**Tech Stack:** uniCloud 云函数（Node）、uni-app x（UTS）、`node:test`。

## Global Constraints

- 工作分支 `codex/stage-4`，基线本地标签 `stage-3-baseline`（`6bd77e1`）。不推送 GitHub，不部署云端，不上传素材。
- 身份与公开编号分离：好友查找只认公开编号，不暴露 uid。好友卡 DTO 只含公开昵称与头像。
- 对外成果、纪念图、分享载荷统一显示「澳门旅伴」「湖南旅伴」，详情页登录后才可见双方昵称。私密照片与位置不进成果。
- 开发用双账号与两地馆址夹具醒目标注 `testOnly`。
- 所有时间用 `now()` 服务端时间：邀请/准备 24 小时失效，失败任务 `rejectAvailableAt = assignedAt + 72h`。
- 并发写入走 `repo.tx`，用确定性 key 保证成果与结算只写一次。

---

### Task 1: 公开资料与好友关系

**Files:**
- Create: `app/uniCloud-alipay/cloudfunctions/fy-api/partnership-service.js`
- Modify: `app/uniCloud-alipay/cloudfunctions/fy-api/index.js`（action 分发）
- Create: `app/uniCloud-alipay/database/fy-profiles.schema.json`、`fy-friends.schema.json`
- Test: `app/tests/partnership-service.test.cjs`

**Interfaces:**
- Produces: `createPartnershipService({ repo, now })`，方法 `ensureProfile(u)`、`findByCode(u, { code })`、`requestFriend(u, { code, requestId })`、`respondFriend(u, { requestId, accept })`、`withdrawFriend(u, { requestId })`、`friends(u)`。

- [ ] **Step 1: 写失败测试**

```js
test('friend lookup uses public code and never returns uid', async () => {
  const f = await ready()
  await f.p.ensureProfile(f.a)
  const card = await f.p.findByCode(f.b, { code: f.codes.a })
  assert.equal(card.nickname.length > 0, true)
  assert.equal(card.uid, undefined)
  await assert.rejects(f.p.findByCode(f.b, { code: 'no-such-code' }), /NOT_FOUND/)
})

test('friend request expires after 24 hours and can be withdrawn', async () => {
  const f = await ready()
  await f.p.requestFriend(f.a, { code: f.codes.b, requestId: 'fr-1' })
  f.now = () => 1000000 + 24 * 3600 * 1000 + 1
  await assert.rejects(f.p.respondFriend(f.b, { requestId: 'fr-1', accept: true }), /EXPIRED/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test app/tests/partnership-service.test.cjs`
Expected: FAIL，`createPartnershipService` 未导出。

- [ ] **Step 3: 实现**

`fy-profiles` 存 `{ uid, code, nickname, avatar }`，`code` 为 8 位公开编号，生成时查重。`fy-friends` 以 `key(sortedUids)` 为文档 id，存 `{ from, to, status, createdAt, expiresAt }`，`status` 取 `pending`/`accepted`/`rejected`/`withdrawn`/`expired`。`respondFriend` 在事务内读到期时间，超时写 `expired` 并抛 `EXPIRED`。`friends()` 只回已接受关系的公开卡。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test app/tests/partnership-service.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/uniCloud-alipay app/tests/partnership-service.test.cjs
git commit -m "feat: add public profiles and friend requests"
```

---

### Task 2: 双人合作与匿名共同成果

**Files:**
- Modify: `app/uniCloud-alipay/cloudfunctions/fy-api/partnership-service.js`
- Create: `app/uniCloud-alipay/database/fy-teams.schema.json`
- Test: `app/tests/partnership-service.test.cjs`

**Interfaces:**
- Consumes: `service.start`、`service.progress`（读节点与文化任务完成度）。
- Produces: `inviteCoop(u, { friendUid, routeId, requestId })`、`respondCoop`、`withdrawCoop`、`leaveCoop`、`coopStatus(u, { teamId })`、`settleCoop(u, { teamId })`。

- [ ] **Step 1: 写失败测试**

```js
test('coop result is written once and anonymizes the partner', async () => {
  const f = await coopReady()
  await f.p.settleCoop(f.a, { teamId: f.team.id })
  await f.p.settleCoop(f.b, { teamId: f.team.id })
  const mine = await f.p.coopStatus(f.a, { teamId: f.team.id })
  assert.equal(mine.result.partnerLabel, '湖南旅伴')
  assert.equal(JSON.stringify(mine.public).includes(f.b.nickname), false)
  assert.equal((await f.repo.list('fy-results', {})).length, 1)
})

test('a user can hold only one active coop team', async () => {
  const f = await coopReady()
  await assert.rejects(f.p.inviteCoop(f.a, { friendUid: f.c.uid, routeId: f.routeId, requestId: 'co-2' }), /CONFLICT/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test app/tests/partnership-service.test.cjs`
Expected: FAIL，`inviteCoop` 不存在。

- [ ] **Step 3: 实现**

`fy-teams` 存 `{ members, seats: { macau, hunan }, routeId, version, status, invitedAt, expiresAt }`，状态 `invited`→`active`→`done`，另有 `declined`/`withdrawn`/`left`。邀请校验好友关系、24 小时失效、每人最多一队进行中。接受时为双方各建 `purpose:'coop'` 的新 run，席位按路线的澳门/湖南任务固定分配。`settleCoop` 在事务内确认双方节点与文化任务达标，以 `key(teamId, 'result')` 写入 `fy-results`，已存在则直接返回。公开视图替换对方身份为席位标签，剔除 `mediaId`、坐标与日记。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test app/tests/partnership-service.test.cjs app/tests/exploration-service.test.cjs`
Expected: PASS，阶段三探索测试无回归。

- [ ] **Step 5: 提交**

```bash
git commit -am "feat: settle cooperative teams into one anonymized result"
```

---

### Task 3: 可选 PK 与失败任务

**Files:**
- Modify: `app/uniCloud-alipay/cloudfunctions/fy-api/partnership-service.js`
- Create: `app/uniCloud-alipay/database/fy-matches.schema.json`、`fy-assignments.schema.json`
- Test: `app/tests/partnership-service.test.cjs`

**Interfaces:**
- Produces: `invitePk`、`readyPk`（双方就绪写唯一 `startedAt`）、`settlePk`、`forfeitPk`、`cancelPk`、`assignment(u)`、`completeAssignment`、`rejectAssignment`。

- [ ] **Step 1: 写失败测试**

```js
test('concurrent first submissions settle the match exactly once', async () => {
  const f = await pkStarted()
  const results = await Promise.all([f.p.settlePk(f.a, { matchId: f.match.id }), f.p.settlePk(f.b, { matchId: f.match.id })])
  assert.equal(results.filter(r => r.winner != null).length, 1)
  const loser = results.find(r => r.winner !== f.match.uids[0]) == null ? f.b : f.a
  assert.equal((await f.p.assignment(loser)).status, 'pending')
})

test('an unfinished match expires after 24 hours without an assignment', async () => {
  const f = await pkStarted()
  f.now = () => f.startedAt + 24 * 3600 * 1000 + 1
  const r = await f.p.settlePk(f.a, { matchId: f.match.id })
  assert.equal(r.expired, true)
  assert.equal(await f.p.assignment(f.b), null)
})

test('a failure task locks the next match until done or rejected after 72 hours', async () => {
  const f = await lost()
  await assert.rejects(f.p.invitePk(f.loser, pkInvite), /ASSIGNMENT_PENDING/)
  f.now = () => f.assignedAt + 72 * 3600 * 1000 - 1
  await assert.rejects(f.p.rejectAssignment(f.loser, { assignmentId: f.assignment.id }), /TOO_EARLY/)
  f.now = () => f.assignedAt + 72 * 3600 * 1000
  await f.p.rejectAssignment(f.loser, { assignmentId: f.assignment.id })
  assert.equal(await f.p.assignment(f.loser), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test app/tests/partnership-service.test.cjs`
Expected: FAIL，`invitePk` 不存在。

- [ ] **Step 3: 实现**

`fy-matches` 存 `{ uids, routeId, version, status, invitedAt, ready, startedAt, settledAt }`。`readyPk` 在双方都标记就绪的同一次事务里写 `startedAt`。`settlePk` 以 `key(matchId, 'settlement')` 抢占结算文档：首个提交且节点达标者获胜，事务内给败方建 `fy-assignments`（`assignedAt`、`rejectAvailableAt = assignedAt + 72h`、`status: 'pending'`）。局满 24 小时无人完成、或管理员无责终止，写 `fy-audit` 后结束且不建任务。`forfeitPk` 让认输者获得失败任务。`pending`/`doing` 的任务阻止该用户创建、接受或进入下一局；`completeAssignment` 随时可用，`rejectAssignment` 校验 `now >= rejectAvailableAt`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test app/tests/partnership-service.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git commit -am "feat: settle optional matches and gate them on failure tasks"
```

---

### Task 4: 旅伴页与合作详情

**Files:**
- Modify: `app/packages/partner/partner/partner.uvue`
- Create: `app/packages/partner/coop/coop.uvue`、`app/packages/partner/pk/pk.uvue`、`app/packages/partner/assignment/assignment.uvue`
- Modify: `app/pages.json`（分包页面注册）
- Create: `app/features/partner/partner.uts`（调用 `secured()` 的薄封装）

**Interfaces:**
- Consumes: Task 1–3 的全部 action，经 `features/api.uts` 的 `secured()`。

- [ ] **Step 1: 写页面状态测试**

在 `app/tests/partner-state.test.cjs` 用 `node:module` 的 `stripTypeScriptTypes` 加载纯函数：

```js
test('a pending failure task blocks the PK entry but not coop', () => {
  const view = partnerView({ assignment: { status: 'pending', rejectAvailableAt: 2000 }, now: 1000 })
  assert.equal(view.pkEnabled, false)
  assert.equal(view.coopEnabled, true)
  assert.equal(view.rejectEnabled, false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test app/tests/partner-state.test.cjs`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

`partner.uts` 导出 `partnerView` 与各 action 封装。旅伴页替换 `DemoNotice`，分好友、合作、PK、任务四块，沿用现有 `card` 样式与 `openPage`。合作详情页登录后显示双方昵称，对外成果区只渲染席位标签。PK 页显示规则、就绪按钮与用时。任务页在 `now >= rejectAvailableAt` 时显示拒绝按钮，否则显示剩余时间，不设定时器。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test app/tests/partner-state.test.cjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/packages/partner app/pages.json app/features/partner app/tests/partner-state.test.cjs
git commit -m "feat: replace the partner placeholder with live entries"
```

---

### Task 5: 网关接入与回归

**Files:**
- Modify: `app/uniCloud-alipay/cloudfunctions/fy-api/index.js`
- Modify: `app/tests/gateway.test.cjs`
- Create: `docs/validation/stage-4-acceptance.md`

- [ ] **Step 1: 写网关测试**

```js
test('partner actions require a member token and reject admin tokens', async () => {
  const res = await call({ action: 'friends', token: 'fy_admin_x' })
  assert.equal(res.code, 'AUTH_REQUIRED')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test app/tests/gateway.test.cjs`
Expected: FAIL，`friends` 返回 `NOT_FOUND`。

- [ ] **Step 3: 接入并补验收记录**

在 `serviceActions` 增加好友、合作、PK、任务 action，未登录走既有 `authenticate`。`docs/validation/stage-4-acceptance.md` 分开记录 Node 测试结果与真机/开发者工具结果，后者留空待授权后填写。回归项：单路线、打卡、私密日记、四项文化任务、章节解锁、阅读断点。

- [ ] **Step 4: 全量测试**

Run: `node --test app/tests/*.test.cjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/uniCloud-alipay/cloudfunctions/fy-api/index.js app/tests/gateway.test.cjs docs/validation/stage-4-acceptance.md
git commit -m "feat: route partner actions through the member gateway"
```
