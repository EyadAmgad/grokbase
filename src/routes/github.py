from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from controllers import GithubController
from models.ProjectModel import ProjectModel
from .schemes.github import GithubRequest
from models.enums import ResponseEnums

github_router = APIRouter(
	prefix="/api/v1/github",
	tags=["api_v1", "github"],
)

@github_router.post("/process/repo/{project_id}")
async def process_github_repo_endpoint(
	request: Request,
	project_id: int,
	process_request: GithubRequest,
):
	project_model = await ProjectModel.create_instance(
		db_client=request.app.db_client
	)

	project = await project_model.get_project_or_create_one(
		project_id=project_id
	)

	github_controller = GithubController()

	try:
		result = await github_controller.process_repo_for_vector_db(
			project=project,
			repo_url=process_request.repo_url,
			db_client=request.app.db_client,
			vectordb_client=request.app.vectordb_client,
			generation_client=request.app.generation_client,
			embedding_client=request.app.embedding_client,
			template_parser=request.app.template_parser,
			chunk_size=process_request.chunk_size,
			overlap_size=process_request.overlap_size,
			branch=process_request.branch,
			repo_dir_name=process_request.repo_dir_name,
			depth=process_request.depth,
			do_reset=process_request.do_reset == 1,
		)
		signal = result.get("signal", ResponseEnums.GITHUB_REPO_PROCESSED_SUCCESS.value)
		return JSONResponse(
			content={
				"signal": signal,
				"repo_path": result.get("repo_path"),
				"inserted_chunks": result.get("inserted_chunks", 0),
				"processed_files": result.get("processed_files", 0),
			}
		)
	except Exception as exc:
		return JSONResponse(
			status_code=status.HTTP_400_BAD_REQUEST,
			content={
				"signal": ResponseEnums.GITHUB_REPO_PROCESSING_FAILED.value,
				"detail": str(exc),
			}
		)
