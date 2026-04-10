---
name: langchain-clj-tools
description: Use when creating custom tools, configuring tool approval policies, setting up tool registries, or integrating MCP servers with langchain-clj agents
---

# langchain-clj Tools

## Overview

Tools give agents the ability to take actions. Define tools as maps, register them in a `ToolRegistry`, and optionally connect MCP servers for external tools. Approval policies control which tools run automatically vs. require user confirmation.

## Quick Start

```clojure
(require '[com.gutramine.langchain-clj.tools.tools :as tools]
         '[com.gutramine.langchain-clj.services :as svc])

(def weather-tool
  {:name        "get_weather"
   :description "Get current weather for a city"
   :input_schema {:type :object
                  :properties {:city {:type :string :description "City name"}}
                  :required [:city]}
   :handler     (fn [{:keys [city]}] (str "72F and sunny in " city))
   :approval-policy :auto-allow})

(def registry (tools/create-tool-registry {"get_weather" weather-tool}))

(def service (svc/create-openai-service :tool-registry registry))
```

## API Reference

### Tool Map Structure

```clojure
{:name            "tool_name"           ; String, unique identifier
 :description     "What the tool does"  ; String, shown to LLM
 :input_schema    {:type :object        ; JSON Schema for args
                   :properties {...}
                   :required [...]}
 :handler         (fn [args] ...)       ; Clojure function, receives parsed args map
 :approval-policy :auto-allow}          ; Optional, default :ask-once
```

### Approval Policies

| Policy | Behavior |
|--------|----------|
| `:auto-allow` | Execute immediately, no approval needed |
| `:ask-once` | Ask first time, cache decision (DEFAULT) |
| `:always-ask` | Ask every time, never cache |

### ToolRegistry

| Function | Purpose |
|----------|---------|
| `create-tool-registry` | Create registry, optionally with initial tools map |
| `register-tool` | `[registry name tool-spec]` - add a tool, returns new registry |
| `execute-tool` | `[registry name args]` - run a tool's handler |
| `list-tools` | `[registry]` - list all registered tool names |

### Tool Execution

```clojure
;; Internal function used by agents during tool loops
(tools/execute-tools registry :openai tool-calls
  :mcp-manager mcp-mgr
  :session session
  :model-name "gpt-4o")
```

### MCP Integration

```clojure
(require '[com.gutramine.langchain-clj.mcp.mcp-manager :as mcp])

;; Create from config file
(def mgr (mcp/create-mcp-manager :config-source "mcp-config.json"))

;; Or add servers programmatically
(def mgr (mcp/create-mcp-manager :auto-connect? false))
(mcp/add-server! mgr "my-server"
  {:type "stdio"
   :command "npx" :args ["-y" "some-mcp-server"]
   :alwaysAllow ["tool1" "tool2"]})

;; Attach to service
(def service (svc/with-mcp-tools (svc/create-openai-service) mgr))

;; Get all MCP tools
(mcp/get-all-tools mgr)

;; Call MCP tool directly
(mcp/call-mcp-tool mgr "tool-name" {:arg1 "value"})

;; Cleanup
(mcp/shutdown! mgr)
```

### MCP Config File Format

The JSON config file has server names as top-level keys (no wrapper object). Each server needs a `"type"` field (`"stdio"` or `"streamable-http"`).

```json
{
  "server-name": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "some-mcp-server"],
    "alwaysAllow": ["tool1", "tool2"]
  }
}
```

You can also pass the config as a Clojure map to `:config-source`:

```clojure
(mcp/create-mcp-manager
  :config-source {"my-server" {:type "stdio"
                               :command "npx"
                               :args ["-y" "some-mcp-server"]
                               :alwaysAllow ["tool1" "tool2"]}})
```

## Patterns

### Custom tool with schema validation

```clojure
(def search-tool
  {:name        "search_docs"
   :description "Search documentation by query"
   :input_schema {:type :object
                  :properties {:query   {:type :string :description "Search query"}
                               :max_results {:type :integer :description "Max results"}}
                  :required [:query]}
   :handler     (fn [{:keys [query max_results]}]
                  (let [max-r (or max_results 5)]
                    (search-index query max-r)))
   :approval-policy :auto-allow})
```

### Connecting MCP server to agent

```clojure
(def mgr (mcp/create-mcp-manager :config-source "mcp.json"))
(def service (-> (svc/create-openai-service :tool-registry registry)
                 (svc/with-mcp-tools mgr)))
(def agent (agents/create-react-agent service))
```

### Using tool registry with service

The tool registry holds tool handlers for execution. Pass it at service creation time via `:tool-registry`:

```clojure
(def my-tools {"get_weather" weather-tool
               "search_docs" search-tool})

(def registry (tools/create-tool-registry my-tools))

;; Pass registry at creation - this registers both schemas AND handlers
(def service (svc/create-openai-service :tool-registry registry))

;; Or build incrementally
(def registry (-> (tools/create-tool-registry)
                  (tools/register-tool "get_weather" weather-tool)
                  (tools/register-tool "search_docs" search-tool)))
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using keyword for tool name | Tool `:name` must be a string: `"get_weather"` not `:get-weather` |
| Forgetting `:input_schema` | LLM needs schema to know what args to pass |
| Not shutting down MCP manager | Call `(mcp/shutdown! mgr)` when done to clean up processes |
| Handler returning non-string | Tool handlers should return strings for best LLM compatibility |
| Missing `:type` in MCP server config | `add-server!` requires `:type` (`"stdio"` or `"streamable-http"`) |
| Using `{"mcpServers": {...}}` wrapper in config | Config file has server names as top-level keys, no wrapper |
