from fastapi import FastAPI, APIRouter, status, Request
from fastapi.responses import JSONResponse, StreamingResponse
from routes.schemes.nlp import PushRequest, SearchRequest
from models.ProjectModel import ProjectModel
from models.ChunkModel import ChunkModel
from controllers import NLPController
from models import ResponseSignal
from tasks.data_indexing import index_data_content

import json
import logging

logger = logging.getLogger('uvicorn.error')

nlp_router = APIRouter(
    prefix="/api/v1/nlp",
    tags=["api_v1", "nlp"],
)

@nlp_router.post("/index/push/{project_id}")
async def index_project(request: Request, project_id: int, push_request: PushRequest):

    task = index_data_content.delay(
        project_id=project_id,
        do_reset=push_request.do_reset
    )

    return JSONResponse(
        content={
            "signal": ResponseSignal.DATA_PUSH_TASK_READY.value,
            "task_id": task.id
        }
    )
    

@nlp_router.get("/index/info/{project_id}")
async def get_project_index_info(request: Request, project_id: int):
    
    project_model = await ProjectModel.create_instance(
        db_client=request.app.db_client
    )

    project = await project_model.get_project_or_create_one(
        project_id=project_id
    )

    nlp_controller = NLPController(
        vectordb_client=request.app.vectordb_client,
        generation_client=request.app.generation_client,
        embedding_client=request.app.embedding_client,
        template_parser=request.app.template_parser,
    )

    try:
        collection_info = await nlp_controller.get_vector_db_collection_info(project=project)
    except Exception:
        # Missing vector collection simply means "not indexed yet"; callers
        # poll this endpoint while ingestion completes in the background.
        collection_info = {"points_count": 0}

    return JSONResponse(
        content={
            "signal": ResponseSignal.VECTORDB_COLLECTION_RETRIEVED.value,
            "collection_info": collection_info
        }
    )

@nlp_router.post("/index/search/{project_id}")
async def search_index(request: Request, project_id: int, search_request: SearchRequest):
    
    project_model = await ProjectModel.create_instance(
        db_client=request.app.db_client
    )

    project = await project_model.get_project_or_create_one(
        project_id=project_id
    )

    nlp_controller = NLPController(
        vectordb_client=request.app.vectordb_client,
        generation_client=request.app.generation_client,
        embedding_client=request.app.embedding_client,
        template_parser=request.app.template_parser,
    )

    results = await nlp_controller.search_vector_db_collection(
        project=project, text=search_request.text, limit=search_request.limit
    )

    if not results:
        return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "signal": ResponseSignal.VECTORDB_SEARCH_ERROR.value
                }
            )
    
    return JSONResponse(
        content={
            "signal": ResponseSignal.VECTORDB_SEARCH_SUCCESS.value,
            "results": [ result.dict()  for result in results ]
        }
    )

@nlp_router.post("/index/answer/{project_id}")
async def answer_rag(request: Request, project_id: int, search_request: SearchRequest):
    
    project_model = await ProjectModel.create_instance(
        db_client=request.app.db_client
    )

    project = await project_model.get_project_or_create_one(
        project_id=project_id
    )

    nlp_controller = NLPController(
        vectordb_client=request.app.vectordb_client,
        generation_client=request.app.generation_client,
        embedding_client=request.app.embedding_client,
        template_parser=request.app.template_parser,
    )

    answer, full_prompt, chat_history = await nlp_controller.answer_rag_question(
        project=project,
        query=search_request.text,
        limit=search_request.limit,
    )

    if not answer:
        return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "signal": ResponseSignal.RAG_ANSWER_ERROR.value
                }
        )
    
    return JSONResponse(
        content={
            "signal": ResponseSignal.RAG_ANSWER_SUCCESS.value,
            "answer": answer,
            "full_prompt": full_prompt,
            "chat_history": chat_history
        }
    )


@nlp_router.post("/index/answer/stream/{project_id}")
async def answer_rag_stream(request: Request, project_id: int, search_request: SearchRequest):
    """SSE-streaming RAG answer.

    Wire format (parsed by the frontend workspace adapter):
        data: {"token": "..."}     (delta chunks)
        data: [DONE]               (final sentinel)
    Missing indexed context and provider errors surface as an error event.
    Streaming starts before generation begins, so the user sees tokens as
    they arrive rather than waiting for the whole answer.
    """
    project_model = await ProjectModel.create_instance(
        db_client=request.app.db_client
    )

    project = await project_model.get_project_or_create_one(
        project_id=project_id
    )

    nlp_controller = NLPController(
        vectordb_client=request.app.vectordb_client,
        generation_client=request.app.generation_client,
        embedding_client=request.app.embedding_client,
        template_parser=request.app.template_parser,
    )

    token_stream = nlp_controller.stream_rag_question(
        project=project,
        query=search_request.text,
        limit=search_request.limit,
    )

    async def sse_response():
        try:
            first = await token_stream.__anext__()
            if first == "":
                # No indexed content matched the question.
                yield "data: " + json.dumps({"error": "no_indexed_content"}) + "\n\n"
                yield "data: [DONE]\n\n"
                return
            if first:
                yield "data: " + json.dumps({"token": first}) + "\n\n"

            async for token in token_stream:
                if token:
                    yield "data: " + json.dumps({"token": token}) + "\n\n"

            yield "data: [DONE]\n\n"
        except Exception as exc:
            logger.error(f"Streaming answer failed: {exc}")
            yield "data: " + json.dumps(
                {"error": ResponseSignal.RAG_ANSWER_ERROR.value}
            ) + "\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        sse_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Tell nginx not to buffer this response, so tokens arrive live.
            "X-Accel-Buffering": "no",
        },
    )