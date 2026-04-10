---
name: langchain-clj-agents
description: Use when building agents with reasoning strategies, configuring agent callbacks, orchestrating multi-agent systems, or running agents with streaming and cancellation in langchain-clj
---

# langchain-clj Agents

## Overview

Autonomous agents that reason and act toward goals. Six reasoning strategies, streaming support, cancellation, and multi-agent orchestration. Agents are immutable -- `with-*` methods return new instances.

## Quick Start

```clojure
(require '[com.gutramine.langchain-clj.agents.core :as agents]
         '[com.gutramine.langchain-clj.services :as svc]
         '[clojure.core.async :as async])

(def service (svc/create-openai-service :model "gpt-4o"))
(def agent (agents/create-react-agent service :max-iterations 5))

;; run returns [result-chan cancel-fn]
(let [[result-ch cancel-fn] (agents/run agent "What is the capital of France?")]
  (println (async/<!! result-ch)))
```

## Strategy Selection

| Strategy | Function | Best For |
|----------|----------|----------|
| **ReAct** | `create-react-agent` | Tool-using tasks, research, multi-step reasoning |
| **Chain-of-Thought** | `create-cot-agent` | Logical reasoning, math, analysis |
| **Plan-Execute** | `create-plan-execute-agent` | Complex multi-step tasks needing upfront planning |
| **Reflexion** | `create-reflexion-agent` | Tasks needing iterative improvement, learning from mistakes |
| **Actor** | `create-actor-agent` | Persona-based conversations, roleplay, character consistency |
| **One-Shot** | `create-one-shot-agent` | Simple Q&A, single response, no iteration needed |

**Default choice: ReAct.** Use it unless you have a specific reason for another strategy.

## API Reference

### Agent Creation

All creation functions take `service` as first arg plus keyword opts:

```clojure
;; ReAct (default max-iterations: 10)
(agents/create-react-agent service :max-iterations 10 :description "desc" :callbacks cb-map)

;; Chain-of-Thought (default max-iterations: 5)
(agents/create-cot-agent service :max-iterations 5)

;; Plan-Execute (default max-iterations: 15)
(agents/create-plan-execute-agent service :max-iterations 15 :replanning-enabled? true)

;; Reflexion (default max-iterations: 10, max-reflections: 3)
(agents/create-reflexion-agent service :max-iterations 10 :max-reflections 3)

;; Actor (default max-iterations: 20, :persona REQUIRED)
(agents/create-actor-agent service :persona "Sherlock Holmes" :persona-description "...")

;; One-Shot (always 1 iteration, no max-iterations option)
(agents/create-one-shot-agent service :description "Simple Q&A agent")
```

### Running Agents

**`run`** `[agent goal]` or `[agent goal options]`
- Returns: `[result-chan cancel-fn]`
- `result-chan` delivers final result string, or `{:error :cancelled ...}`, or `{:status :max-iterations ...}`
- `cancel-fn` is a zero-arg function that stops the agent loop and any in-flight service request
- `options` map may contain `:max-iterations` to override the agent default

```clojure
(let [[result-ch cancel-fn] (agents/run agent "Solve this problem")]
  (let [result (async/<!! result-ch)]
    (cond
      (= :cancelled (:error result))  (println "Cancelled:" (:partial-result result))
      (= :max-iterations (:status result)) (println "Hit limit:" (:partial-result result))
      (:error result)                 (println "Error:" (:message result))
      :else                           (println "Answer:" result))))
```

**`run-stream`** `[agent goal stream-handlers]` or `[agent goal options stream-handlers]`
- Returns: `[nil cancel-fn]`
- Results delivered via stream-handlers (see below)
- `options` map may contain `:max-iterations`

### Agent Stream Handlers

**IMPORTANT**: Agent stream handlers are DIFFERENT from service stream handlers. Do not confuse them.

Agent handlers (used with `run-stream`):

```clojure
{:on-step-start    (fn [{:keys [iteration state]}] ...)
 :on-llm-chunk     (fn [{:keys [iteration chunk accumulated]}] ...)
 :on-llm-thinking-chunk (fn [{:keys [iteration thinking]}] ...)
 :on-step-complete (fn [{:keys [iteration state thought action]}] ...)
 :on-complete      (fn [{:keys [result state]}] ...)
 :on-error         (fn [{:keys [error state type]}] ...)
 :on-cancel        (fn [] ...)}
```

Service handlers (used with `svc/chat-stream`, NOT for agents):

```clojure
{:on-event  (fn [event] ...)
 :on-close  (fn [{:keys [message]}] ...)
 :on-error  (fn [error-event] ...)
 :on-open   (fn [] ...)
 :on-cancel (fn [] ...)}
```

### ConfigurableAgent Methods

All return a **new** agent (immutable):

| Method | Purpose |
|--------|---------|
| `with-max-iterations` | `[agent n]` -- set iteration limit |
| `with-strategy` | `[agent strategy-kw]` -- change strategy (`:react`, `:cot`, etc.) |
| `with-tools` | `[agent tools]` -- attach tools (delegates to `services/with-tools` on the agent's service) |
| `with-memory` | `[agent memory]` -- attach conversation memory (delegates to `services/with-memory`) |
| `with-callbacks` | `[agent callbacks]` -- set callbacks map |
| `with-reflection` | `[agent enabled?]` -- enable/disable self-reflection |
| `with-description` | `[agent desc]` -- set description |

### Agent State

```clojure
{:goal "..."
 :strategy :react
 :iterations 0
 :max-iterations 10
 :observations []
 :thoughts []
 :actions []
 :plan nil        ; plan-execute only
 :reflections []  ; reflexion only
 :status :running ; :running :completed :failed :cancelled :max-iterations
 :result nil
 :metadata {}}
```

Access with `(agents/get-state agent)`. Reset with `(agents/reset agent)`.

## Orchestration

```clojure
(require '[com.gutramine.langchain-clj.agents.orchestrator :as orch])

;; Create system: ->MultiAgentSystem takes {agents-map} and shared-memory (or nil)
(def system (orch/->MultiAgentSystem {} nil))
(def system (orch/add-agent system :researcher researcher-agent))
(def system (orch/add-agent system :writer writer-agent))

;; Sequential: output of each feeds into next. Returns [result-chan cancel-fn].
(let [[result-ch cancel-fn] (orch/run-sequential system [:researcher :writer] "Write about AI")]
  (println (async/<!! result-ch)))

;; Parallel: all agents run concurrently. Returns [result-chan cancel-fn].
;; Result is a vector of {:agent-id :result} maps.
(let [[result-ch _] (orch/run-parallel system [:agent-a :agent-b] "Analyze data")]
  (println (async/<!! result-ch)))

;; Hierarchical: supervisor delegates to workers via auto-injected delegation tool.
;; Workers MUST have :description set so supervisor knows their capabilities.
;; Returns [result-chan cancel-fn].
(let [[result-ch _] (orch/run-hierarchical system :supervisor [:worker1 :worker2] "Complex task")]
  (println (async/<!! result-ch)))
```

## Patterns

### ReAct agent with tools

```clojure
(require '[com.gutramine.langchain-clj.tools.tools :as tools])

(def weather-tool
  {:name "get_weather"
   :description "Get weather for a city"
   :input_schema {:type :object
                  :properties {:city {:type :string}}
                  :required [:city]}
   :handler (fn [{:keys [city]}] (str "72F in " city))})

(def registry (tools/create-tool-registry {"get_weather" weather-tool}))
(def service (svc/create-openai-service :model "gpt-4o" :tool-registry registry))
(def agent (agents/create-react-agent service :max-iterations 10))

(let [[result-ch _] (agents/run agent "What's the weather in Paris?")]
  (println (async/<!! result-ch)))
```

### Streaming with cancellation

```clojure
(let [done (promise)
      [_ cancel-fn] (agents/run-stream agent "Research quantum computing"
                       {:on-llm-chunk     #(do (print (:chunk %)) (flush))
                        :on-step-complete #(println "\nStep" (:iteration %) "done")
                        :on-complete      #(do (println "\nResult:" (:result %))
                                               (deliver done :ok))
                        :on-error         #(do (println "Error:" (:error %))
                                               (deliver done :error))
                        :on-cancel        #(do (println "Cancelled!")
                                               (deliver done :cancelled))})]
  ;; Cancel after 30 seconds
  (future (Thread/sleep 30000) (cancel-fn))
  ;; Block until done
  @done)
```

### Multi-agent pipeline: researcher then summarizer

```clojure
(def researcher (agents/create-react-agent research-service
                  :max-iterations 10
                  :description "Searches the web and gathers raw findings"))

(def summarizer (agents/create-react-agent summary-service
                  :max-iterations 5
                  :description "Distills research into concise summaries"))

(def system (-> (orch/->MultiAgentSystem {} nil)
                (orch/add-agent :researcher researcher)
                (orch/add-agent :summarizer summarizer)))

(let [[result-ch cancel-fn] (orch/run-sequential system [:researcher :summarizer]
                               "Investigate the state of quantum computing")]
  (let [result (async/<!! result-ch)]
    (if (= :cancelled (:error result))
      (println "Cancelled. Partial:" (:partial-result result))
      (println "Final:" result))))
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Treating `run` return as direct result | `run` returns `[result-chan cancel-fn]` -- destructure and `<!!` the channel |
| Using `run-stream` and expecting a return value | `run-stream` returns `[nil cancel-fn]` -- results come via handlers |
| Not setting `:max-iterations` for complex tasks | Default is 10 (5 for cot, 15 for plan-execute), may be too low |
| Using service stream handler keys with `run-stream` | Agent uses `:on-llm-chunk`, `:on-step-complete`, etc. NOT `:on-event`, `:on-close` |
| Forgetting tool registry on the service | Tools go on the service via `:tool-registry` at creation, not directly on the agent |
| Missing `:description` on workers for hierarchical orchestration | Supervisor needs descriptions to know what each worker does |
| Missing `:persona` on actor agent | `create-actor-agent` requires `:persona` -- throws if missing |
