---
name: langchain-clj-rag
description: Use when building retrieval-augmented generation pipelines, processing PDFs, splitting documents, generating embeddings, or performing vector search with langchain-clj
---

# langchain-clj RAG

## Overview

Build retrieval-augmented generation pipelines: load documents, split into chunks, embed, store in vector store, search, and use results as context for LLM calls.

## Quick Start

```clojure
(require '[com.gutramine.langchain-clj.rag.pdf-to-text :as pdf]
         '[com.gutramine.langchain-clj.rag.simple-document-splitter :as splitter]
         '[com.gutramine.langchain-clj.embedding.core :as emb]
         '[com.gutramine.langchain-clj.services :as svc]
         '[clojure.core.async :as async])

;; 1. Load and split document
(def text (pdf/pdf->text "document.pdf"))
(def chunks (splitter/split-document {:text text :metadata {:source "document.pdf"}}
                                     500 50 count))
;; chunks => [{:text "segment text..." :metadata {:source "document.pdf" :start_line_number 1 :end_line_number 10}} ...]

;; 2. Embed and store
(def embed-svc (svc/create-in-memory-embedding-service))
(def store (emb/create-in-memory-embedding-store))

(let [ids (emb/generate-ids (count chunks))
      emb-results (svc/embedding embed-svc (mapv :text chunks))
      vectors (mapv second emb-results)]
  (dorun (emb/add-all! store ids vectors chunks)))
;; NOTE: chunks are already {:text ... :metadata ...} maps, which is the embedded format
;; NOTE: dorun forces the lazy seq returned by the in-memory store's add-all!

;; 3. Search
(let [query-results (svc/embedding embed-svc "What is the main topic?")
      query-vec (second (first query-results))
      results (emb/search store {:embedding query-vec :k 3})]
  (doseq [match (:matches results)]
    (println (:score match) (get-in match [:embedded :text]))))
```

## API Reference

### Document Processing

**PDF loading:**
```clojure
(pdf/pdf->text "path/to/file.pdf") ; => string of extracted text
```

**Document splitting:**

`split-document` takes a **document map** `{:text "..." :metadata {...}}` and returns a vector of **segment maps** with the same shape (metadata is preserved and augmented with `:start_line_number` and `:end_line_number`).

```clojure
;; Direct call
(splitter/split-document {:text text :metadata {:source "file.txt"}}
                         500    ; max-segment-size (tokens)
                         50     ; max-overlap-size (tokens)
                         count) ; token-count-estimator fn
;; => [{:text "segment 1..." :metadata {:source "file.txt" :start_line_number 1 :end_line_number 5}}
;;     {:text "segment 2..." :metadata {:source "file.txt" :start_line_number 4 :end_line_number 9}}]

;; Or create a reusable splitter function
(def split (splitter/create-simple-document-splitter 500 50 count))
(split {:text text :metadata {:source "file.txt"}})
;; => same result
```

### Embedding

**Embedding service:** Use `svc/create-in-memory-embedding-service` (local BGE-Small-EN model, no API key needed) or any provider service that supports embeddings.

**IMPORTANT:** `svc/embedding` returns a vector of `[input-text embedding-vector]` tuples (synchronous/blocking). You must extract the embedding vectors before storing:
```clojure
(let [results (svc/embedding embed-svc ["hello" "world"])]
  ;; results => [["hello" [0.1 0.2 ...]] ["world" [0.3 0.4 ...]]]
  (mapv second results))  ;; => [[0.1 0.2 ...] [0.3 0.4 ...]]
```

For a single string, it still returns a vector of one tuple:
```clojure
(svc/embedding embed-svc "hello") ;; => [["hello" [0.1 0.2 ...]]]
```

**EmbeddingStore protocol:**

| Method | Args | Purpose |
|--------|------|---------|
| `add!` | `[store id embedding embedded]` | Add one embedding. `embedded` is a map (e.g. `{:text "..." :metadata {...}}`) |
| `add-all!` | `[store ids embeddings embedded]` | Add batch. `ids` = seq of strings, `embeddings` = seq of vectors, `embedded` = seq of maps |
| `remove!` | `[store id]` | Remove by ID |
| `remove-multiple!` | `[store ids]` | Remove multiple by IDs |
| `remove-by-filter!` | `[store predicate]` | Remove by predicate on entries |
| `clear!` | `[store]` | Remove all |
| `search` | `[store request]` | Similarity search |

**ID generation:**
```clojure
(emb/generate-id)         ;; => "550e8400-e29b-..." (single UUID string)
(emb/generate-ids 5)      ;; => ["uuid1" "uuid2" "uuid3" "uuid4" "uuid5"]
```

**Search request:**
```clojure
{:embedding [0.1 0.2 ...]  ; query embedding vector (required)
 :k 10                      ; number of results (optional, default 10)
 :filter-pred (fn [entry] true)} ; optional metadata filter on stored entries
```

**Search response:**
```clojure
{:matches [{:id "uuid" :score 0.95 :embedding [...] :embedded {:text "..." :metadata {...}}}]
 :query-embedding [...]}
```

### Directory Embedding (Convenience)

```clojure
(require '[com.gutramine.langchain-clj.rag.embed-directory-tree :as edt])

;; Embed all source code (uses default extensions: clj, cljs, java, py, js, ts, go, rs, etc.)
(edt/embed-source-code-directory embed-svc store "/path/to/src")

;; Embed documentation (uses default extensions: md, txt, pdf, html, rst)
(edt/embed-documentation-directory embed-svc store "/path/to/docs")

;; Custom with options - NOTE: extensions are regex patterns, not strings
(edt/embed-directory-tree embed-svc store
  #{#"clj" #"md" #"txt"} "/path/to/dir"
  :max-segment-size 2000
  :max-overlap-size 100
  :batch-size 10
  :ignore-patterns #{#"\.git" #"node_modules"}
  :on-progress (fn [info] (println info)))
```

## Patterns

### PDF knowledge base with semantic search

```clojure
(defn create-knowledge-base [pdf-paths]
  (let [embed-svc (svc/create-in-memory-embedding-service)
        store     (emb/create-in-memory-embedding-store)]
    (doseq [path pdf-paths]
      (let [text    (pdf/pdf->text path)
            doc     {:text text :metadata {:source path}}
            chunks  (splitter/split-document doc 500 50 count)
            ids     (emb/generate-ids (count chunks))
            emb-results (svc/embedding embed-svc (mapv :text chunks))
            vectors (mapv second emb-results)]
        (dorun (emb/add-all! store ids vectors chunks))))
    {:embed-svc embed-svc :store store}))

(defn ask [{:keys [embed-svc store]} question]
  (let [chat-svc    (svc/create-openai-service)
        qe-results  (svc/embedding embed-svc question)
        query-vec   (second (first qe-results))
        results     (emb/search store {:embedding query-vec :k 3})
        context     (str/join "\n\n" (map #(get-in % [:embedded :text]) (:matches results)))
        prompt      (str "Context:\n" context "\n\nQuestion: " question)
        [result-ch _cancel] (svc/chat chat-svc prompt)]
    (async/<!! result-ch)))
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Passing raw text to `split-document` | It takes a document map: `{:text "..." :metadata {...}}` |
| Expecting string chunks from splitter | `split-document` returns segment maps `{:text "..." :metadata {...}}` |
| Passing raw embedding tuples to store | `svc/embedding` returns `[text vector]` tuples -- extract vectors with `(mapv second results)` |
| Searching with raw text instead of embedding | Must embed the query first, then pass the vector to `search` |
| Using string extensions in `embed-directory-tree` | Extensions must be regex patterns: `#{#"clj" #"md"}` not `#{".clj" ".md"}` |
| Not splitting documents before embedding | Long docs exceed embedding model limits. Always split first. |
| `add-all!` results not realized (in-memory store) | The in-memory `add-all!` returns a lazy seq. Wrap in `doall` or `dorun` if not at REPL: `(dorun (emb/add-all! store ids vectors chunks))` |
