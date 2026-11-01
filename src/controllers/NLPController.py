from .BaseController import BaseController
from models.db_schemes import Project, DataChunk
from stores.llm.LLMEnums import DocumentTypeEnum
from typing import List
import asyncio
import time
import json
import logging

logger = logging.getLogger(__name__)

class NLPController(BaseController):

    # Providers cap how many texts a single embed request may contain
    # (e.g. Cohere's API limit is 96).
    EMBED_BATCH_SIZE = 96
    # Pause between embed batches so trial-tier rate limits (e.g. tokens
    # per minute) are not exceeded by continuous requests.
    EMBED_BATCH_DELAY_SECONDS = 1.0
    # Retry a failed embed batch (rate limits, transient network errors).
    EMBED_MAX_RETRIES = 5
    EMBED_RETRY_BASE_DELAY_SECONDS = 20.0

    def __init__(self, vectordb_client, generation_client, 
                 embedding_client, template_parser):
        super().__init__()

        self.vectordb_client = vectordb_client
        self.generation_client = generation_client
        self.embedding_client = embedding_client
        self.template_parser = template_parser

    def create_collection_name(self, project_id: str):
        return f"collection_{self.vectordb_client.default_vector_size}_{project_id}".strip()
    
    async def reset_vector_db_collection(self, project: Project):
        collection_name = self.create_collection_name(project_id=project.project_id)
        return await self.vectordb_client.delete_collection(collection_name=collection_name)
    
    async def get_vector_db_collection_info(self, project: Project):
        collection_name = self.create_collection_name(project_id=project.project_id)
        collection_info = await self.vectordb_client.get_collection_info(collection_name=collection_name)

        return json.loads(
            json.dumps(collection_info, default=lambda x: x.__dict__)
        )
    
    async def _embed_in_batches(self, texts: List[str]) -> List[list]:
        """Embed texts in batches with retry/backoff for provider rate limits."""
        vectors: List[list] = []

        for batch_start in range(0, len(texts), self.EMBED_BATCH_SIZE):
            batch = texts[batch_start:batch_start + self.EMBED_BATCH_SIZE]

            if batch_start > 0:
                await asyncio.sleep(self.EMBED_BATCH_DELAY_SECONDS)

            for attempt in range(1, self.EMBED_MAX_RETRIES + 1):
                try:
                    batch_vectors = self.embedding_client.embed_text(
                        text=batch,
                        document_type=DocumentTypeEnum.DOCUMENT.value,
                    )
                except Exception as exc:
                    batch_vectors = None
                    logger.warning(
                        "Embedding batch failed (attempt %d/%d): %s",
                        attempt, self.EMBED_MAX_RETRIES, exc,
                    )

                if batch_vectors and len(batch_vectors) == len(batch):
                    break

                if attempt < self.EMBED_MAX_RETRIES:
                    delay = self.EMBED_RETRY_BASE_DELAY_SECONDS * attempt
                    logger.info("Retrying embedding batch in %.1fs", delay)
                    await asyncio.sleep(delay)
            else:
                raise RuntimeError(
                    f"Embedding failed after {self.EMBED_MAX_RETRIES} retries"
                )

            vectors.extend(batch_vectors)

        return vectors

    async def index_into_vector_db(self, project: Project, chunks: List[DataChunk],
                                   chunks_ids: List[int], 
                                   do_reset: bool = False):
        
        # step1: get collection name
        collection_name = self.create_collection_name(project_id=project.project_id)

        # step2: manage items — embed in batches to respect provider rate limits
        texts = [ c.chunk_text for c in chunks ]
        metadata = [ c.chunk_metadata for c in  chunks]
        vectors = await self._embed_in_batches(texts)

        # step3: create collection if not exists
        _ = await self.vectordb_client.create_collection(
            collection_name=collection_name,
            embedding_size=self.embedding_client.embedding_size,
            do_reset=do_reset,
        )

        # step4: insert into vector db
        _ = await self.vectordb_client.insert_many(
            collection_name=collection_name,
            texts=texts,
            metadata=metadata,
            vectors=vectors,
            record_ids=chunks_ids,
        )

        return True

    def _with_retries(self, func, describe="", *args, **kwargs):
        """Run a sync provider call with retry/backoff for transient errors."""
        for attempt in range(1, self.EMBED_MAX_RETRIES + 1):
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                if attempt == self.EMBED_MAX_RETRIES:
                    raise
                delay = self.EMBED_RETRY_BASE_DELAY_SECONDS * attempt
                desc = describe if describe else "Provider call"
                logger.warning(desc + " failed (attempt %d/%d): %s", attempt, self.EMBED_MAX_RETRIES, exc)
                time.sleep(delay)

    async def search_vector_db_collection(self, project: Project, text: str, limit: int = 10):

        # step1: get collection name
        query_vector = None
        collection_name = self.create_collection_name(project_id=project.project_id)

        # step2: get text embedding vector
        vectors = self._with_retries(
            self.embedding_client.embed_text,
            describe="Query embedding",
            text=text,
            document_type=DocumentTypeEnum.QUERY.value,
        )

        if not vectors or len(vectors) == 0:
            return False
        
        if isinstance(vectors, list) and len(vectors) > 0:
            query_vector = vectors[0]

        if not query_vector:
            return False    

        # step3: do semantic search
        results = await self.vectordb_client.search_by_vector(
            collection_name=collection_name,
            vector=query_vector,
            limit=limit
        )

        if not results:
            return False

        return results
    
    async def prepare_rag_prompts(self, project: Project, query: str, limit: int = 10):
        """Retrieve matching chunks and build the RAG prompt.

        Returns (full_prompt, chat_history) or (None, None) when no indexed
        content matches. Shared by the JSON and streaming answer paths so the
        wire payloads stay identical.
        """
        # step1: retrieve related documents
        retrieved_documents = await self.search_vector_db_collection(
            project=project,
            text=query,
            limit=limit,
        )

        if not retrieved_documents or len(retrieved_documents) == 0:
            return None, None

        # step2: Construct LLM prompt
        system_prompt = self.template_parser.get("rag", "system_prompt")

        documents_prompts = "\n".join([
            self.template_parser.get("rag", "document_prompt", {
                    "doc_num": idx + 1,
                    "chunk_text": self.generation_client.process_text(doc.text),
            })
            for idx, doc in enumerate(retrieved_documents)
        ])

        footer_prompt = self.template_parser.get("rag", "footer_prompt", {
            "query": query
        })

        # step3: Construct Generation Client Prompts
        chat_history = [
            self.generation_client.construct_prompt(
                prompt=system_prompt,
                role=self.generation_client.enums.SYSTEM.value,
            )
        ]

        full_prompt = "\n\n".join([ documents_prompts,  footer_prompt])

        return full_prompt, chat_history

    async def answer_rag_question(self, project: Project, query: str, limit: int = 10):

        answer, full_prompt, chat_history = None, None, None

        full_prompt, chat_history = await self.prepare_rag_prompts(
            project=project,
            query=query,
            limit=limit,
        )

        if not full_prompt:
            return answer, full_prompt, chat_history

        # Retrieve the Answer (retries cover transient provider failures).
        answer = self._with_retries(
            self.generation_client.generate_text,
            describe="RAG generation",
            prompt=full_prompt,
            chat_history=chat_history,
        )

        return answer, full_prompt, chat_history

    async def stream_rag_question(self, project: Project, query: str, limit: int = 10):
        """Async generator yielding answer tokens as they arrive.

        Retrieval + prompt building happen before the first yield (so missing
        context is observable before the stream starts). The generation client
        itself is a blocking SDK generator, so each token is pulled through a
        thread executor to keep the event loop responsive.
        """
        loop = asyncio.get_running_loop()
        full_prompt, chat_history = await self.prepare_rag_prompts(
            project=project,
            query=query,
            limit=limit,
        )

        if not full_prompt:
            yield ""
            return

        token_stream = self.generation_client.generate_text_stream(
            prompt=full_prompt,
            chat_history=chat_history,
        )
        sentinel = object()
        while True:
            token = await loop.run_in_executor(
                None, lambda: next(token_stream, sentinel)
            )
            if token is sentinel:
                break
            yield token
