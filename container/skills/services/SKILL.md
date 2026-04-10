---
name: langchain-clj-services
description: Use when configuring AI providers (OpenAI, Anthropic, Gemini, Ollama), making chat calls, streaming responses, or handling cancellation in langchain-clj
---

# langchain-clj Services

## Overview

Unified interface for AI providers. All services implement `AIService` and `ConfigurableService` protocols. Services are immutable - `with-*` methods return new instances.

## Quick Start

```clojure
(require '[com.gutramine.langchain-clj.services :as svc]
         '[clojure.core.async :as async])

(def service (-> (svc/create-anthropic-service :model "claude-sonnet-4-20250514")
                 (svc/with-system-message "You are a helpful assistant.")))

(let [[result-ch cancel-fn] (svc/chat service "What is Clojure?")]
  (println (async/<!! result-ch)))
```

## API Reference

### Service Creation

| Function | Provider | Default Model | Extra Args |
|----------|----------|--------------|------------|
| `create-openai-service` | OpenAI | `gpt-4o-mini` | -- |
| `create-anthropic-service` | Anthropic | `claude-sonnet-4-20250514` | -- |
| `create-gemini-service` | Gemini | `gemini-2.5-flash` | -- |
| `create-ollama-service` | Ollama | `gpt-oss:20b` | `:host`, `:port` |
| `create-in-memory-embedding-service` | Local | `bge-small-en-v1.5` | `:executor` |
| `create-service-for-model` | Auto-detect | -- | All of the above |

All chat services accept keyword args: `:model`, `:api-key`, `:system-message`, `:tools`, `:tool-registry`, `:mcp-manager`, `:session`. The embedding service only accepts `:model` and `:executor`.

### ConfigurableService Methods

All return a **new** service instance (immutable):

| Method | Args | Purpose |
|--------|------|---------|
| `with-system-message` | `[svc msg]` | Set system prompt |
| `with-tools` | `[svc tools]` | Attach tool definitions |
| `with-mcp-tools` | `[svc mcp-mgr]` | Attach MCP tools |
| `with-memory` | `[svc memory]` | Attach conversation memory |
| `with-session` | `[svc session]` | Attach session for tool approval |

### Chat

**`chat`** `[service user-message]` or `[service user-message options]`
- Returns: `[result-chan cancel-fn]`
- `result-chan` delivers the provider response map
- `cancel-fn` is a zero-arg function that cancels the in-flight request

**`chat-stream`** `[service user-message stream-handlers]` or `[service user-message options stream-handlers]`
- Returns: `[nil cancel-fn]`
- Results delivered via callbacks in `stream-handlers`

### Stream Handlers

The stream-handlers map uses these keys (NOT `:on-chunk`/`:on-complete`):

```clojure
{:on-event  (fn [event] ...)                     ; Each SSE event from the provider
 :on-close  (fn [{:keys [message event]}] ...)        ; Final assembled response in :message
 :on-error  (fn [error] ...)                     ; Error occurred
 :on-open   (fn [event] ...)                     ; Connection opened (optional)
 :on-cancel (fn [] ...)}                         ; Cancelled (optional)
```

### Embedding

**`embedding`** `[service embed-req]` or `[service embed-req options]`
- `embed-req`: a string or vector of strings
- Returns: vector of `[input-text embedding-vector]` tuples (synchronous/blocking call)

## Patterns

### Streaming with cancellation

```clojure
(let [result (atom nil)
      [_ cancel-fn] (svc/chat-stream service "Tell me a long story"
                      {:on-event  (fn [event] (when-let [d (:data event)] (print d) (flush)))
                       :on-close  (fn [{:keys [message]}]
                                    (reset! result message))
                       :on-error  (fn [e] (println "Error:" e))
                       :on-cancel (fn [] (println "Cancelled"))})]
  ;; Cancel after 5 seconds
  (async/go
    (async/<! (async/timeout 5000))
    (cancel-fn)))
```

### Switch providers

```clojure
(defn make-service [provider]
  (case provider
    :openai    (svc/create-openai-service)
    :anthropic (svc/create-anthropic-service)
    :gemini    (svc/create-gemini-service)))

;; Same code works regardless of provider
(let [[result-ch _] (svc/chat (make-service :anthropic) "Hello")]
  (async/<!! result-ch))
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `:on-chunk` / `:on-complete` as handler keys | The correct keys are `:on-event` and `:on-close` |
| Calling `with-system-message` and discarding return | `with-*` returns a NEW service: `(def svc2 (svc/with-system-message svc1 "..."))` |
| Not using `core.async` to read chat result | `chat` returns `[result-chan cancel-fn]`, not a string. Use `(async/<!! result-ch)` |
| Expecting `:on-close` callback to receive a string | `:on-close` receives a map: `{:message ... :event ...}` |
| Using `chat` when you want streaming | Use `chat-stream` with handlers for token-by-token output |
