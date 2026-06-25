# GrokBase 

> Ask questions about any codebase in plain language. GrokBase uses advanced RAG techniques — AST-aware chunking, hybrid search, and reranking — to give you precise, grounded answers from source code.

---

##  Features

- **AST-aware chunking** — splits code by functions and classes, not arbitrary token windows
- **Hybrid search** — combines dense embeddings with BM25 keyword search
- **Reranking** — cross-encoder reranking for high-precision retrieval
- **Multi-vector indexing** — separate embeddings for code, docstrings, and comments
---

## Requirements

- Python 3.10 or later
- [MiniConda](https://docs.anaconda.com/free/miniconda/#quick-command-line-install) (recommended)

### Create and activate environment

```bash
conda create -n grokbase python=3.10
conda activate grokbase
```

### (Optional) Improve terminal readability

```bash
export PS1="\[\033[01;32m\]\u@\h:\w\n\[\033[00m\]\$ "
```

---

## Installation

### Install dependencies

```bash
pip install -r requirements.txt
```

### Configure environment variables

```bash
cp .env.example .env
```

Then open `.env` and fill in your keys:

```env
OPENAI_API_KEY=your_key_here        # or ANTHROPIC_API_KEY
COHERE_API_KEY=your_key_here        # for reranking
QDRANT_URL=http://localhost:6333    # vector store
```

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

---

## License

[MIT](LICENSE)