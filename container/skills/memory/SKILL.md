---
name: langchain-clj-memory
description: Use when adding conversation memory, choosing between in-memory or SQLite backends, managing context windows, or handling multi-turn conversations in langchain-clj
---

# langchain-clj Memory

## Overview

Conversation memory for multi-turn chat. Three backends: in-memory (fast, ephemeral), SQLite (persistent), context-window (token-aware wrapper). All implement `ConversationMemory` protocol.

## Quick Start

```clojure
(require '[com.gutramine.langchain-clj.memory :as mem]
         '[com.gutramine.langchain-clj.services :as svc]
         '[clojure.core.async :as async])

;; Create persistent memory
(def memory (mem/create-sqlite-store :db-path "chat.db" :thread-id "user-123"))

;; Store a message in canonical format
(mem/store-message memory
  {:id (str (java.util.UUID/randomUUID))
   :role :user
   :content {:type :text :data "Hello, what is Clojure?"}
   :created_at (.toString (java.time.Instant/now))
   :metadata {}})

;; Retrieve messages
(mem/get-messages memory)       ;; most recent (default limit 50 for SQLite, 15 for in-memory)
(mem/get-messages memory 10)    ;; most recent 10
(mem/get-conversation-history memory)  ;; all messages, chronological

;; Attach to service for automatic multi-turn chat
(def service (-> (svc/create-openai-service)
                 (svc/with-memory memory)))

;; chat returns [result-chan cancel-fn], use core.async to read
(let [[result-ch _cancel] (svc/chat service "Tell me more about Clojure")]
  (println (async/<!! result-ch)))
```

## API Reference

### Memory Creation

| Function | Backend | Args |
|----------|---------|------|
| `create-in-memory-store` | In-memory | Keyword args: `:policy` |
| `create-sqlite-store` | SQLite | Keyword args: `:db-path` (default `"conversations.db"`), `:thread-id` (default `"default"`), `:policy` |
| `create-context-window-store` | Wrapper | Positional: `base-store`, `max-tokens`, `system-message` |

### ConversationMemory Protocol

| Method | Args | Purpose |
|--------|------|---------|
| `store-message` | `[mem message]` | Store message in canonical format |
| `get-messages` | `[mem]` or `[mem limit]` | Retrieve most recent messages |
| `get-conversation-history` | `[mem]` | All messages in chronological order |
| `clear-conversation` | `[mem]` | Clear all messages |
| `memory-stats` | `[mem]` | Get conversation statistics |
| `get-message` | `[mem message-id]` | Get a single message by ID |
| `delete-message` | `[mem message-id]` | Delete a single message by ID |

### Message Format (Canonical)

Every message stored must follow this format:

```clojure
{:id "uuid-string"                          ;; required, unique ID
 :role :user                                ;; required, keyword: :user, :assistant, or :system
 :content {:type :text :data "message text"} ;; required, nested map with :type and :data
 :created_at "2024-01-15T10:30:00Z"         ;; required, ISO timestamp string
 :metadata {:input_tokens 10                 ;; optional, used by token-based policies
            :output_tokens 50}}
```

Roles are **keywords** (`:user`, `:assistant`, `:system`), not strings. Content is a **nested map** `{:type :text :data "..."}`, not a plain string.

### Memory Management Strategies

For automatic memory management when conversations grow too long:

| Strategy | Function | Purpose |
|----------|----------|---------|
| Clear all | `create-clear-all-strategy` | Remove all messages |
| Clear N oldest | `create-clear-n-messages-strategy` | Remove oldest N messages |
| Clear by % | `create-clear-by-percentage-strategy` | Clear until under % of max tokens |
| Summarize + clear | `create-summarize-and-clear-strategy` | LLM summarizes then clears |
| Summarize + keep % | `create-summarize-and-keep-percentage-strategy` | Summarize old, keep recent |

### Policies (auto-trigger strategies)

Policies take **positional args**, not keyword args:

| Policy | Function | Positional Args |
|--------|----------|-----------------|
| Token threshold | `create-token-threshold-policy` | `threshold`, `strategy`, `options` |
| Message count | `create-message-count-policy` | `max-messages`, `strategy`, `options` |
| % of max | `create-percentage-of-max-policy` | `percentage`, `max-tokens`, `strategy`, `options` |
| Custom | `create-custom-policy` | `condition-fn`, `strategy`, `options` |

### Thread Management (SQLite only)

All take **keyword args** (not a map):

```clojure
(mem/list-threads :db-path "chat.db")
;; => ["user-123" "user-456"]

(mem/delete-thread :db-path "chat.db" :thread-id "old-thread")

(mem/export-thread :db-path "chat.db" :thread-id "user-123")
;; => vector of canonical messages
```

## Patterns

### Persistent chat with SQLite and auto-management

```clojure
(def policy (mem/create-token-threshold-policy
              4000
              (mem/create-clear-by-percentage-strategy)
              {:max-tokens 8000 :percentage 0.5}))

(def memory (mem/create-sqlite-store
              :db-path "chat.db"
              :thread-id "session-1"
              :policy policy))

(def service (-> (svc/create-openai-service)
                 (svc/with-memory memory)))

;; chat returns [result-chan cancel-fn]
(let [[result-ch _] (svc/chat service "Hello!")]
  (println (async/<!! result-ch)))
```

### Context-window aware memory

```clojure
(def base (mem/create-in-memory-store))
(def windowed (mem/create-context-window-store base 4096 "You are helpful."))
;; get-conversation-history on windowed store returns only messages
;; that fit within the 4096 token budget
```

### Store and retrieve a full exchange

```clojure
(def memory (mem/create-sqlite-store :db-path "chat.db" :thread-id "demo"))

(mem/store-message memory
  {:id (str (java.util.UUID/randomUUID))
   :role :user
   :content {:type :text :data "What is Clojure?"}
   :created_at (.toString (java.time.Instant/now))
   :metadata {}})

(mem/store-message memory
  {:id (str (java.util.UUID/randomUUID))
   :role :assistant
   :content {:type :text :data "Clojure is a dynamic, functional Lisp on the JVM."}
   :created_at (.toString (java.time.Instant/now))
   :metadata {:input_tokens 5 :output_tokens 12}})

(mem/get-conversation-history memory)
;; => [{:id "..." :role :user ...} {:id "..." :role :assistant ...}]

(mem/memory-stats memory)
;; => {:message_count 2, :first_message_at "...", :last_message_at "...", ...}
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `add-message` or `save-message` | The correct function is `store-message` |
| Using plain string for content | Content must be `{:type :text :data "message text"}`, not `"message text"` |
| Using string roles like `"user"` | Roles must be keywords: `:user`, `:assistant`, `:system` |
| Missing `:id` or `:created_at` in message | Both are required; use `(str (java.util.UUID/randomUUID))` and `(.toString (java.time.Instant/now))` |
| Passing a map to `create-sqlite-store` | Uses keyword args: `(mem/create-sqlite-store :db-path "x.db" :thread-id "t1")` |
| Forgetting `:thread-id` for multi-user apps | Each user/conversation needs a unique thread-id |
| Not attaching memory to service | Use `(svc/with-memory service memory)` -- returns a new service |
| Using in-memory store for data you need to persist | Use `create-sqlite-store` for persistence across restarts |
| Not using `core.async` for chat results | `svc/chat` returns `[result-chan cancel-fn]`; use `(async/<!! result-ch)` |
