---
description: "持久的按轮次上下文，说明当前开放轮次的 prompt 由哪一类客户端发送，供组合请求上下文的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-origin

[English](README.md) | 中文

## 概述

`dsh-client-origin` 告诉模型当前开放轮次的 prompt 由哪一类客户端发送，从而让回答能够针对实际上手中的屏幕来写。类别读取自持久用户消息而非传输层，因此模型看到的正是会话日志能够复现的内容。每轮一条消息声明类别；消息未声明类别的轮次不追加任何消息，也从不猜测。本发行版的 `meshfin-surface` bundle 包含该行；官方组合不包含。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当一个会话由多种客户端驱动、需要模型区分手机应用与桌面浏览器而不必回读先前轮次时，挂载此插件。该插件没有配置项，也不需要客户端为它做任何改动：它读取客户端已经在每次 `session.prompt` 上声明的类别。

### 模型能得到什么

在开启轮次的那一步追加一条 user 角色消息，给出类别以及由该类别可推出的内容。类别共三种：`mobile-app`、`mobile-browser` 与 `desktop-browser`。消息声明了多个类别的轮次会被表述为 `mixed` 并列出全部类别；未声明任何类别的轮次保持事件链原本的决定。

### 类别从何而来

客户端自行采样自己的类别，并在每次 `session.prompt` 中发送。知道自己属于应用而非浏览器页面的 shell 会在加载页面的 URL 上声明这一点；浏览器报告平台暴露的粗粒度屏幕类别（`navigator.userAgentData.mobile`，否则 `(pointer: coarse)`）；没有页面可供判断的运行时不上报任何类别。宿主按闭集校验该值，把闭集之外的取值以 `session/invalid-client-device` 拒绝，并把它记录在精确的那条持久用户消息上，与浏览器时区和 prompt 的 `rpcId` 并列。本插件只读取这些消息：不读取连接状态、请求头或地址，也不存储任何设备名称、型号或地址。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本节解释插件的设计；可观察行为见[使用本包](#use-this-package)。

### 设计概念

插件前置一个 `agent/pre-step` 监听器，先委派，然后在下游决定进入某轮次的第 1 步、且该步被接收的消息声明了类别时，追加一条带来源的 `UserMessage`。每条声明使用精确的 snapshot 来源 `{ kind: 'client-origin', form: 'snapshot', sections: [{ name: 'client-origin', text }] }`，因此后续轮次的声明会取代先前那条，而未声明的轮次把先前的声明留作历史。

类别派生自 `payload.messages`——循环为本步声明接收的 inbox 消息——而不做日志扫描：第 1 步时该轮次的 prompt 尚未提交，本步自身的 payload 是它唯一存在的地方。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：pre-step 监听器与来源 kind 声明 |
| [`src/origin.ts`](src/origin.ts) | 从开放轮次的 `user-rpc` 来源派生类别，并渲染模型可见声明 |

### 主流程

在第 1 步，监听器先向 `next()` 取决定；当决定为拒绝、信号已中止，或没有任何消息声明类别时原样返回，否则向 `decision.messages` 追加一条消息。循环会提交进入步骤中除 `runtime-context` 之外的每条消息，因此该声明会成为一条带自有来源 kind 的持久 `user/message`。派生遇到闭集之外的取值时抛出错误而不是做转换：发明新桶的生产方有 bug，而一个无人消费的第四桶比一次明确的失败更糟。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够时，阅读这些页面。

- [上下文分组地图](../README.zh.md) —— 同组的请求上下文包。
- [会话格式变更状态](../../../docs/session-format-status.zh.md) —— 为什么可选的 `clientDevice` 字段与新的来源 kind 保持当前格式版本不变。

-----

<a id="model-experience"></a>
## 模型体验

### 轮次起点的 client-origin 声明

#### 模型看到什么

一条 user 角色消息，追加在该轮次自身消息之后、开启该轮次的那一步。`<class>` 为 `mobile-app`、`mobile-browser` 或 `desktop-browser` 之一，其后的句子只说明该类别本身可推出的内容，而未声明任何类别的轮次不追加消息。

##### 声明了单一类别

```markdown
Client that sent this request: <class>. <what that class implies>
```

##### 声明相互矛盾

```markdown
Client that sent this request: mixed ["<class>","<class>"]. This turn's messages did not all come from the same client; say which one an instruction is for.
```

#### Token 影响

每个已解析或 mixed 的轮次一句，只在开启步骤添加一次而非每个步骤，因此多步骤轮次只付一次代价。

#### KV Cache 影响

该消息在开启步骤扩展请求前缀；该轮次后续步骤复用不变的前缀，下一轮次在上一轮次已缓存的前缀之后追加。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是本包当前的约束。

- **类别按设计是粗粒度的** —— 三个桶无法区分平板与手机，且 `mobile-app` 是 shell 在加载 URL 上声明的标记，而非被检测出的属性。
- **未声明类别的轮次保持沉默** —— 读取方无法区分「该客户端没有上报」与「该部署从不声明客户端」；为每个这样的请求声明 `unavailable` 会在无需任何信息的轮次上消耗上下文。
- **类别每轮只声明一次** —— 排入已开放轮次后续步骤的 prompt 不会重新声明自己的类别，因为该声明属于轮次而非每条消息。
- **mixed 轮次列出类别而非其消息** —— 按消息归因需要逐条读取持久用户消息上的 `clientDevice`，而不是在轮次层面读取。
- **没有已交付的客户端声明 `mobile-app`** —— 官方 Web 与桌面界面报告的都是浏览器类别；只有以 `dsh-shell` 查询键加载页面的 shell 才报告应用类别。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
