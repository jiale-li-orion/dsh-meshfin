---
description: "Durable per-turn context naming which class of client sent the open turn's prompt, for users and maintainers composing request context."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-origin

English | [中文](README.zh.md)

## Summary

`dsh-client-origin` tells the model which class of client sent the prompt of the open turn, so an answer can be written for the screen actually in hand. The class is read from the durable user message rather than from the transport, so what the model is told is exactly what the session log can replay. One message per turn states the class; a turn whose messages declare no class adds no message at all, and nothing is ever guessed. This distribution's `meshfin-surface` bundle carries the row; the official compositions do not.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when one session is driven from more than one kind of client, so the model can tell a phone app from a desktop browser without re-reading earlier turns. The plugin has no configuration and needs no client change of its own: it reads the class the client already declares on every `session.prompt`.

### What the model gets

One user-role message at the step that opens a turn, naming the class and what follows from it. Three classes exist: `mobile-app`, `mobile-browser`, and `desktop-browser`. A turn whose messages declare more than one class is stated as `mixed` with every class named; a turn that declares none leaves the step exactly as the chain decided.

### Where the class comes from

The client samples its own class and sends it with every `session.prompt`. A shell that knows it is an app rather than a browser page says so on the URL it loads; a browser reports the coarse screen class its platform exposes (`navigator.userAgentData.mobile`, else `(pointer: coarse)`); a runtime with no page to classify reports nothing. The Host validates the value against the closed set, refuses anything else as `session/invalid-client-device`, and records it on the exact durable user message beside the browser zone and the prompt's `rpcId`. This plugin only reads those messages: it does not read connection state, headers, or addresses, and it stores no device name, model, or address.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design of the plugin; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The plugin prepends an `agent/pre-step` listener that delegates first and appends one sourced `UserMessage` when the delegated decision enters step 1 of a turn and that step's admitted messages declare a class. Each statement uses the exact snapshot source `{ kind: 'client-origin', form: 'snapshot', sections: [{ name: 'client-origin', text }] }`, so a later turn's statement supersedes an earlier one and an undeclared turn leaves the previous statement to stand as history.

The class is derived from `payload.messages` — the inbox messages the loop claimed for this step — rather than from a log scan: at step 1 the turn's prompt has not been committed yet, so the step's own payload is the only place it exists.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: pre-step listener and source-kind declaration |
| [`src/origin.ts`](src/origin.ts) | Class derivation from open-turn `user-rpc` sources, and the model-facing statement |

### Main flow

At step 1 the listener asks `next()` for the decision, returns it untouched when the decision rejects, when the signal is already aborted, or when no message declares a class, and otherwise appends one message to `decision.messages`. The loop commits every non-`runtime-context` message of an entering step, so the statement becomes a durable `user/message` with its own source kind. The derivation throws on a value outside the closed set instead of coercing it: a producer that invents a bucket has a bug, and a fourth bucket nothing consumes is worse than a loud failure.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Context group map](../README.md) — sibling request-context packages.
- [Session-format change status](../../../docs/session-format-status.md) — why the optional `clientDevice` field and the new source kind keep the current format version.

-----

<a id="model-experience"></a>
## Model Experience

### Turn-start client-origin statement

#### What the model sees

One user-role message appended after the turn's own messages at the step that opens it. `<class>` is one of `mobile-app`, `mobile-browser`, or `desktop-browser`; the trailing sentence names only what that class implies, and a turn that declares no class adds no message.

##### One declared class

```markdown
Client that sent this request: <class>. <what that class implies>
```

##### Disagreeing declarations

```markdown
Client that sent this request: mixed ["<class>","<class>"]. This turn's messages did not all come from the same client; say which one an instruction is for.
```

#### Token effect

One sentence per resolved or mixed turn, added once at the opening step rather than at every step, so a turn of many steps pays it once.

#### KV Cache effect

The message extends the request prefix at the opening step; later steps of that turn reuse the prefix unchanged, and the next turn appends after the previous turn's cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **The class is coarse by design** — three buckets cannot separate a tablet from a phone, and `mobile-app` is a flag on the URL a shell loads rather than a property anything detects.
- **A turn that declares no class is silent** — a reader cannot tell "this client reported nothing" from "this deployment never states a client"; stating `unavailable` for every such request would spend context on turns that need nothing.
- **The class is stated once per turn** — a prompt queued into a later step of an already-open turn does not re-announce its own class, because the statement belongs to the turn rather than to each message.
- **A mixed turn names the classes, not their messages** — per-message attribution would require reading `clientDevice` on each durable user message rather than on the turn.
- **No shipped client declares `mobile-app`** — the official Web and desktop surfaces report a browser class; only a shell that loads its page with the `dsh-shell` query key reports the app class.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
