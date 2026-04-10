---
name: langchain-clj-getting-started
description: Use when creating a new Clojure project that uses langchain-clj, or adding langchain-clj to an existing project
---

# Getting Started with langchain-clj

## Overview

Bootstrap a Clojure project with langchain-clj for building AI applications. Covers deps, provider setup, and first chat call.

## Quick Start

deps.edn:
```clojure
{:deps {com.gutramine/langchain-clj {:mvn/version "0.2.1"}}}
```

Environment variables (set whichever providers you use):
```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
```

Hello world:
```clojure
(ns myapp.core
  (:require [com.gutramine.langchain-clj.services :as services]
            [clojure.core.async :as async]))

;; Create a service (picks up API key from env automatically)
(def svc (services/create-openai-service :model "gpt-4o-mini"))

;; chat returns [result-chan cancel-fn] -- NOT a string or map
(let [[result-ch _cancel] (services/chat svc "Hello!")]
  (println (async/<!! result-ch)))
```

## Provider Setup

| Provider | Function | Default Model | Env Var |
|----------|----------|--------------|---------|
| OpenAI | `create-openai-service` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| Anthropic | `create-anthropic-service` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| Gemini | `create-gemini-service` | `gemini-2.5-flash` | `GEMINI_API_KEY` |
| Ollama | `create-ollama-service` | `gpt-oss:20b` | N/A (local) |

All creation functions accept keyword args: `:model`, `:api-key`, `:system-message`, `:tools`, `:tool-registry`, `:mcp-manager`, `:session`.

Ollama also accepts `:host` (default `"192.168.1.53"`) and `:port` (default `11434`).

Auto-detect provider from model name:
```clojure
(services/create-service-for-model "claude-sonnet-4-20250514")
```

## Key Namespace Map

| Need | Namespace |
|------|-----------|
| AI services | `com.gutramine.langchain-clj.services` |
| Agents | `com.gutramine.langchain-clj.agents.core` |
| Orchestration | `com.gutramine.langchain-clj.agents.orchestrator` |
| Tools | `com.gutramine.langchain-clj.tools.tools` |
| Memory | `com.gutramine.langchain-clj.memory` |
| MCP | `com.gutramine.langchain-clj.mcp.mcp-manager` |
| Embeddings | `com.gutramine.langchain-clj.embedding.core` |
| RAG/PDF | `com.gutramine.langchain-clj.rag.pdf-to-text` |
| Doc splitting | `com.gutramine.langchain-clj.rag.simple-document-splitter` |

## What to Use Next

- Building a chatbot or assistant -> `langchain-clj-agents`
- Adding tool/function calling -> `langchain-clj-tools`
- Persistent conversations -> `langchain-clj-memory`
- Knowledge base / document Q&A -> `langchain-clj-rag`
- Configuring streaming, cancellation -> `langchain-clj-services`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Treating `chat` return as a string or map | `chat` returns `[result-chan cancel-fn]` -- use `(async/<!! result-ch)` to get the result |
| Missing `core.async` require | Always require `[clojure.core.async :as async]` |
| Hardcoding API keys | Use environment variables; the library reads them automatically |
| Inventing message wrapper types | `chat` takes a plain string, not message objects. Use `(services/chat svc "Hello!")` |
| Wrong namespace like `langchain-clj.chat` | All namespaces start with `com.gutramine.langchain-clj.` -- the main one is `com.gutramine.langchain-clj.services` |
| Using `invoke` or `call` | The function is `services/chat` (protocol method on the service) |
