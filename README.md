# GrokBase

GrokBase is a codebase question-answering service. It ingests uploaded files or GitHub repositories, splits the content into searchable chunks, stores project metadata and chunks in PostgreSQL, indexes embeddings in a vector database, and uses retrieval-augmented generation (RAG) to answer questions with project context.

## Features

- File upload and project-scoped asset management
- GitHub repository ingestion with branch, depth, chunk-size, and overlap controls
- Configurable LLM generation and embedding providers
- PostgreSQL persistence through SQLAlchemy and asyncpg
- PostgreSQL vector search through the PGVector provider, with Qdrant support
- Chunk processing, vector indexing, similarity search, and RAG answers
- FastAPI's generated OpenAPI documentation
- Prometheus metrics, Grafana dashboards, PostgreSQL exporter, and node exporter

## Technology Stack

| Layer | Technology |
| --- | --- |
| API | Python, FastAPI, Uvicorn, Pydantic |
| Application structure | Routes, controllers, models, provider factories |
| Relational database | PostgreSQL |
| Vector database | PGVector on PostgreSQL; Qdrant is also supported |
| Database access | SQLAlchemy 2, asyncpg, psycopg2 |
| Migrations | Alembic |
| LLM and embeddings | OpenAI, Cohere, or OpenRouter providers |
| Deployment | Docker Compose and Nginx |
| Monitoring | Prometheus, Grafana, node-exporter, postgres-exporter |
| Frontend | Static HTML, CSS, and JavaScript served by FastAPI |

## Architecture

1. A client uploads files or submits a GitHub repository for a project.
2. The data controller validates files and stores them under `src/assets/files/<project_id>`; project and asset records are stored in PostgreSQL.
3. The process controller extracts content and creates overlapping chunks. Chunk records are persisted in PostgreSQL.
4. The NLP controller creates a project collection and sends chunk embeddings to the configured vector database.
5. Search embeds a question and retrieves relevant chunks. The answer endpoint passes that context to the configured generation model.

Each project is identified by an integer `project_id`. Project records are created when an ingestion or NLP endpoint first receives a new project ID.

## Repository Layout

```text
src/
	main.py                         FastAPI application and startup wiring
	routes/                         API endpoints and request schemas
	controllers/                    Upload, project, processing, GitHub, and NLP logic
	models/                         Domain models and Alembic database schemes
	stores/                         LLM and vector database provider implementations
	helpers/config.py               Environment-backed application settings
	views/                          Browser UI and static assets
	assets/                         Uploaded files and local vector database data
docker/
	docker-compose.yml              Application, databases, proxy, and monitoring
	env/                            Environment file templates
	nginx/                          Reverse proxy configuration
```

## Requirements

### Local development

- Python 3.10 or later
- PostgreSQL with the `vector` extension, or a running Qdrant instance
- An API key for the selected generation and embedding provider
- Conda is recommended but not required

### Docker development or deployment

- Docker Engine
- Docker Compose v2

## Configuration

The application loads settings from `.env`. The Docker setup uses separate files under `docker/env/` so that application and database credentials can be configured independently.

The main application settings include:

```env
APP_NAME=GrokBase
APP_VERSION=1.0.0
OPENAI_API_KEY=your_key_here

POSTGRES_USERNAME=postgres
POSTGRES_PASSWORD=change_me
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_MAIN_DATABASE=minirag

GENERATION_BACKEND=openai
EMBEDDING_BACKEND=openai
GENERATION_MODEL_ID=your_generation_model
EMBEDDING_MODEL_ID=your_embedding_model
EMBEDDING_MODEL_SIZE=1536

VECTOR_DB_BACKEND=pgvector
VECTOR_DB_PATH=./assets/database/qdrant_db
FILE_ALLOWED_TYPES=[".txt", ".pdf", ".md", ".py"]
FILE_MAX_SIZE=10485760
FILE_DEFAULT_CHUNK_SIZE=1000
```

Provider-specific settings such as `COHERE_API_KEY`, `OPENROUTERS_API_KEY`, `OPENAI_API_URL`, and `OPENROUTERS_API_URL` may be added when those providers are selected. Use the names defined in `src/helpers/config.py` and the files in `docker/env/` as the source of truth for a deployment.

## Local Setup

```bash
conda create -n grokbase python=3.10
conda activate grokbase
cd src
pip install -r requirements.txt
```

Create `src/.env`, configure the required settings, run the database migrations, and start the API:

```bash
cd src/models/db_schemes/minirag
alembic upgrade head

cd ../../../../
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The local API is available at <http://localhost:8000>. The interactive documentation is at <http://localhost:8000/docs> and the ReDoc documentation is at <http://localhost:8000/redoc>.

## Docker Setup

The Compose stack includes:

- `fastapi`: the GrokBase API on port `8000`
- `nginx`: reverse proxy on port `80`
- `pgvector`: PostgreSQL 17 with the PGVector extension on port `5432`
- `qdrant`: optional vector database on ports `6333` and `6334`
- `prometheus`: metrics collection on port `9090`
- `grafana`: dashboards on port `3000`
- `node-exporter` and `postgres-exporter`: infrastructure and database metrics

Create the environment files from the provided examples, then start the stack:

```bash
cd docker/env
cp .env.example.app .env.app
cp .env.example.postgres .env.postgres
cp .env.example.grafana .env.grafana
cp .env.example.postgres-exporter .env.postgres-exporter

cd ..
docker compose up --build -d
```

Useful commands:

```bash
docker compose ps
docker compose logs --tail=100 fastapi
docker compose logs --tail=100 pgvector
docker compose down
```

The Docker application is available through Nginx at <http://localhost>, directly at <http://localhost:8000>, and in the browser at <http://localhost/docs>. Persistent data is stored in named volumes for PostgreSQL, Qdrant, uploaded assets, Prometheus, and Grafana.

## Database Migrations

The SQLAlchemy database schemes and Alembic environment are under `src/models/db_schemes/minirag`.

```bash
cd src/models/db_schemes/minirag
cp alembic.ini.example alembic.ini
# Set sqlalchemy.url or the database settings required by your environment.
alembic upgrade head
```

To create a migration after changing the database schemes:

```bash
alembic revision --autogenerate -m "Describe the schema change"
alembic upgrade head
```

## API Reference

All application endpoints are prefixed with `/api/v1`. Requests and responses are JSON unless stated otherwise. The full OpenAPI schema is available at `/docs`.

### Service

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/` | Serves the web interface. |
| `GET` | `/api/v1/` | Returns the configured application name and version. |
| `GET` | `/docs` | FastAPI Swagger UI. |
| `GET` | `/redoc` | FastAPI ReDoc UI. |
| `GET` | `/TrhBVe_m5gg2002_E5VVqS` | Prometheus metrics endpoint. |

### Data ingestion

| Method | Endpoint | Body or form data | Description |
| --- | --- | --- | --- |
| `POST` | `/api/v1/data/upload/{project_id}` | Multipart `file` | Validates and stores a file and creates an asset record. |
| `POST` | `/api/v1/data/process/{project_id}` | `file_id`, `chunk_size` (100), `overlap_size` (20), `do_reset` (0) | Extracts files into chunks and stores them in PostgreSQL. Omit `file_id` to process all project files. |
| `POST` | `/api/v1/github/process/{project_id}` | `repo_url`, `branch`, `chunk_size` (1000), `overlap_size` (200), `do_reset` (0), `repo_dir_name`, `depth` (1) | Clones and processes a GitHub repository for the project. |

Example GitHub request:

```json
{
	"repo_url": "https://github.com/example/project",
	"branch": "main",
	"chunk_size": 1000,
	"overlap_size": 200,
	"do_reset": 1,
	"depth": 1
}
```

### Indexing and RAG

| Method | Endpoint | Body | Description |
| --- | --- | --- | --- |
| `POST` | `/api/v1/nlp/index/push/{project_id}` | `do_reset` (0) | Embeds stored chunks and pushes them into the project's vector collection. |
| `GET` | `/api/v1/nlp/index/info/{project_id}` | None | Returns information about the project's vector collection. |
| `POST` | `/api/v1/nlp/index/search/{project_id}` | `text`, `limit` (5) | Performs vector search and returns matching chunks. |
| `POST` | `/api/v1/nlp/index/answer/{project_id}` | `text`, `limit` (5) | Retrieves relevant chunks and generates a grounded answer with the configured LLM. |

Example search or answer request:

```json
{
	"text": "How does authentication work?",
	"limit": 5
}
```

The `do_reset` flag is an integer where `1` resets the relevant project data or collection and `0` preserves existing data.

## Monitoring

Prometheus scrapes FastAPI, Qdrant, PostgreSQL, the host node, and Prometheus itself. FastAPI request counts and latency are exposed at `/TrhBVe_m5gg2002_E5VVqS`, which is intentionally excluded from the public OpenAPI schema. Grafana is available at <http://localhost:3000> when the Docker monitoring services are running.

## Contributing

Pull requests are welcome. For substantial changes, open an issue first to discuss the proposed approach.

## License

[MIT](LICENSE)