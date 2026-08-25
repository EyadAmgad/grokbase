from .BaseController import BaseController
from .DataController import DataController
from .ProjectController import ProjectController
from .ProcessController import ProcessController, Document
from models.db_schemes import Project, DataChunk, Asset
from models import ResponseSignal

from typing import List, Optional
from urllib.parse import urlparse
import os
import re
import shutil
import subprocess


class GithubController(BaseController):

	SUPPORTED_EXTENSIONS = {
		".py", ".md", ".txt", ".json", ".yml", ".yaml", ".toml",
		".ini", ".cfg", ".conf", ".js", ".ts", ".tsx", ".jsx",
		".html", ".css", ".scss", ".sql", ".sh", ".rb", ".go",
		".rs", ".java", ".kt", ".c", ".cc", ".cpp", ".h", ".hpp",
		".php", ".xml", ".csv", ".ipynb"
	}

	IGNORED_DIRS = {
		".git", ".hg", ".svn", "node_modules", "dist", "build",
		"__pycache__", ".venv", "venv", "env", ".mypy_cache",
		".pytest_cache", ".tox", ".next", ".idea", ".vscode"
	}

	def __init__(self):
		super().__init__()

	def get_repo_name(self, repo_url: str):
		parsed_path = urlparse(repo_url).path.rstrip("/")
		repo_name = os.path.basename(parsed_path)
		repo_name = re.sub(r"\.git$", "", repo_name)

		if not repo_name:
			repo_name = "github_repo"

		return DataController().get_clean_file_name(repo_name)

	def clone_repo(
		self,
		repo_url: str,
		project_id: str,
		branch: Optional[str] = None,
		depth: int = 1,
		repo_dir_name: Optional[str] = None,
	):
		project_path = ProjectController().get_project_path(project_id=project_id)
		repo_name = repo_dir_name or self.get_repo_name(repo_url=repo_url)
		repo_path = os.path.join(project_path, repo_name)

		if os.path.exists(repo_path):
			shutil.rmtree(repo_path)

		clone_command = ["git", "clone", "--depth", str(depth)]

		if branch:
			clone_command.extend(["--branch", branch])

		clone_command.extend([repo_url, repo_path])

		subprocess.run(clone_command, check=True, capture_output=True, text=True)

		return repo_path

	def is_supported_file(self, file_path: str):
		file_ext = os.path.splitext(file_path)[-1].lower()
		return file_ext in self.SUPPORTED_EXTENSIONS

	def read_text_file(self, file_path: str):
		if not os.path.exists(file_path) or os.path.isdir(file_path):
			return None

		if not self.is_supported_file(file_path=file_path):
			return None

		for encoding in ("utf-8", "utf-8-sig", "latin-1"):
			try:
				with open(file_path, "r", encoding=encoding) as file_handle:
					text = file_handle.read()

				if text and text.strip():
					return text
			except Exception:
				continue

		return None

	def collect_repo_documents(
		self,
		repo_path: str,
		repo_url: Optional[str] = None,
		branch: Optional[str] = None,
	):
		documents = []

		for root, dirs, files in os.walk(repo_path):
			dirs[:] = [directory for directory in dirs if directory not in self.IGNORED_DIRS]

			for file_name in files:
				file_path = os.path.join(root, file_name)

				if any(part in self.IGNORED_DIRS for part in file_path.split(os.sep)):
					continue

				if not self.is_supported_file(file_path=file_path):
					continue

				file_text = self.read_text_file(file_path=file_path)
				if not file_text:
					continue

				relative_path = os.path.relpath(file_path, repo_path)

				documents.append({
					"page_content": file_text,
					"metadata": {
						"source": "github",
						"repo_url": repo_url,
						"branch": branch,
						"file_name": file_name,
						"file_path": relative_path,
						"absolute_path": file_path,
					},
				})

		return documents

	async def process_repo_for_vector_db(
		self,
		project: Project,
		repo_url: str,
		db_client: object,
		vectordb_client: object,
		generation_client: object,
		embedding_client: object,
		template_parser: object,
		chunk_size: int = 1000,
		overlap_size: int = 200,
		branch: Optional[str] = None,
		repo_dir_name: Optional[str] = None,
		depth: int = 1,
		do_reset: bool = False,
	):
		from controllers.NLPController import NLPController
		from models.AssetModel import AssetModel
		from models.ChunkModel import ChunkModel
		from models.db_schemes import Asset as AssetRecord, DataChunk as DataChunkRecord

		process_controller = ProcessController(project_id=project.project_id)

		repo_path = self.clone_repo(
			repo_url=repo_url,
			project_id=project.project_id,
			branch=branch,
			depth=depth,
			repo_dir_name=repo_dir_name,
		)

		repo_documents = self.collect_repo_documents(
			repo_path=repo_path,
			repo_url=repo_url,
			branch=branch,
		)

		if not repo_documents:
			return {
				"signal": ResponseSignal.NO_SUPPORTED_FILES_FOUND.value,
				"repo_path": repo_path,
				"inserted_chunks": 0,
				"processed_files": 0,
			}

		asset_model = await AssetModel.create_instance(db_client=db_client)
		chunk_model = await ChunkModel.create_instance(db_client=db_client)
		nlp_controller = NLPController(
			vectordb_client=vectordb_client,
			generation_client=generation_client,
			embedding_client=embedding_client,
			template_parser=template_parser,
		)

		if do_reset:
			collection_name = nlp_controller.create_collection_name(project_id=project.project_id)
			_ = await vectordb_client.delete_collection(collection_name=collection_name)
			_ = await chunk_model.delete_chunks_by_project_id(project_id=project.project_id)

		asset_records = []
		chunk_records = []
		chunk_ids = []

		for document in repo_documents:
			metadata = document.get("metadata", {})
			file_path = metadata.get("absolute_path")
			if not file_path or not os.path.exists(file_path):
				continue

			asset_record = await asset_model.create_asset(
				asset=AssetRecord(
					asset_project_id=project.project_id,
					asset_type="github_repo_file",
					asset_name=metadata.get("file_path", os.path.basename(file_path)),
					asset_size=os.path.getsize(file_path),
					asset_config={
						"source": "github",
						"repo_url": repo_url,
						"branch": branch,
						"file_path": metadata.get("file_path"),
					},
				)
			)

			asset_records.append(asset_record)

			file_chunks = process_controller.process_file_content(
				file_content=[Document(
					page_content=document.get("page_content", ""),
					metadata=metadata,
				)],
				file_id=metadata.get("file_path", os.path.basename(file_path)),
				chunk_size=chunk_size,
				overlap_size=overlap_size,
			)

			if not file_chunks:
				continue

			for chunk_index, chunk in enumerate(file_chunks):
				chunk_record = await chunk_model.create_chunk(
					chunk=DataChunkRecord(
						chunk_text=chunk.page_content,
						chunk_metadata={
							**(chunk.metadata or {}),
							"repo_url": repo_url,
							"branch": branch,
							"file_path": metadata.get("file_path"),
							"chunk_index": chunk_index + 1,
						},
						chunk_order=len(chunk_records) + 1,
						chunk_project_id=project.project_id,
						chunk_asset_id=asset_record.asset_id,
					)
				)

				chunk_records.append(chunk_record)
				chunk_ids.append(chunk_record.chunk_id)

		if not chunk_records:
			return {
				"signal": ResponseSignal.NO_CHUNKS_CREATED.value,
				"repo_path": repo_path,
				"inserted_chunks": 0,
				"processed_files": len(asset_records),
			}

		_ = await nlp_controller.index_into_vector_db(
			project=project,
			chunks=chunk_records,
			chunks_ids=chunk_ids,
			do_reset=do_reset,
		)

		return {
			"signal": ResponseSignal.GITHUB_REPO_PROCESSED_SUCCESS.value,
			"repo_path": repo_path,
			"inserted_chunks": len(chunk_records),
			"processed_files": len(asset_records),
		}
