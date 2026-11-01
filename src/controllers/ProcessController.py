from .BaseController import BaseController
from .ProjectController import ProjectController
import os
from langchain_community.document_loaders import TextLoader
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from models import ProcessingEnum
from typing import List
from dataclasses import dataclass

@dataclass
class Document:
    page_content: str
    metadata: dict

class ProcessController(BaseController):

    def __init__(self, project_id: str):
        super().__init__()

        self.project_id = project_id
        self.project_path = ProjectController().get_project_path(project_id=project_id)

    def get_file_extension(self, file_id: str):
        return os.path.splitext(file_id)[-1]

    def is_zip_file(self, file_id: str):
        return self.get_file_extension(file_id=file_id).lower() == ProcessingEnum.ZIP.value

    def get_supported_text_extensions(self):
        """Text/code extensions indexable from an uploaded archive.

        Mirrors the GitHub repo ingestion set (controllers/GithubController.py)
        so both upload paths index the same kinds of source files.
        """
        return {
            ".py", ".md", ".txt", ".json", ".yml", ".yaml", ".toml",
            ".ini", ".cfg", ".conf", ".js", ".ts", ".tsx", ".jsx",
            ".html", ".css", ".scss", ".sql", ".sh", ".rb", ".go",
            ".rs", ".java", ".kt", ".c", ".cc", ".cpp", ".h", ".hpp",
            ".php", ".xml", ".csv", ".ipynb", ".log"
        }

    def is_supported_text_file(self, file_id: str):
        return self.get_file_extension(file_id=file_id).lower() in self.get_supported_text_extensions()

    def extract_zip_file(self, file_id: str):
        """Extract an uploaded archive into the project directory.

        Returns the list of extracted supported file ids (flat names, only the
        files this pipeline can index). Zip-slip is mitigated by copying each
        member under its basename only — no absolute/traversal paths land on disk.
        """
        import zipfile
        import shutil

        zip_path = os.path.join(self.project_path, file_id)
        if not os.path.exists(zip_path):
            return []

        processed_files = []
        try:
            with zipfile.ZipFile(zip_path) as archive:
                for member in archive.namelist():
                    if member.endswith("/"):
                        continue
                    file_name = os.path.basename(member)
                    if not file_name or not self.is_supported_text_file(file_name):
                        continue
                    target_path = os.path.join(self.project_path, file_name)
                    with archive.open(member) as source, open(target_path, "wb") as target:
                        shutil.copyfileobj(source, target)
                    processed_files.append(file_name)
        except (zipfile.BadZipFile, OSError):
            return []

        return processed_files

    def get_file_loader(self, file_id: str):

        file_ext = self.get_file_extension(file_id=file_id)
        file_path = os.path.join(
            self.project_path,
            file_id
        )

        if not os.path.exists(file_path):
            return None

        if file_ext == ProcessingEnum.TXT.value:
            return TextLoader(file_path, encoding="utf-8")

        if file_ext == ProcessingEnum.PDF.value:
            return PyMuPDFLoader(file_path)

        if self.is_supported_text_file(file_id=file_id):
            return TextLoader(file_path, encoding="utf-8")

        return None

    def get_file_content(self, file_id: str):

        loader = self.get_file_loader(file_id=file_id)
        if loader:
            try:
                loaded = loader.load()
                if loaded:
                    return loaded
            except Exception:
                # TextLoader is strict about encodings; fall back to a tolerant
                # read chain so mixed-source archives still index.
                if self.is_supported_text_file(file_id=file_id):
                    file_path = os.path.join(self.project_path, file_id)
                    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
                        try:
                            with open(file_path, "r", encoding=encoding) as file_handle:
                                text = file_handle.read()
                            if text and text.strip():
                                return [
                                    Document(page_content=text, metadata={"source": file_id})
                                ]
                        except Exception:
                            continue
                return None

        return None

    def process_file_content(self, file_content: list, file_id: str,
                            chunk_size: int=100, overlap_size: int=20):

        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=overlap_size,
            length_function=len,
        )

        file_content_texts = [
            rec.page_content
            for rec in file_content
        ]

        file_content_metadata = [
            rec.metadata
            for rec in file_content
        ]
        '''
        chunks = text_splitter.create_documents(
            file_content_texts,
            metadatas=file_content_metadata
        )

        return chunks
        '''
        chunks = self.process_simpler_splitter(
            texts=file_content_texts,
            metadatas=file_content_metadata,
            chunk_size=chunk_size
        )

        return chunks

    def process_simpler_splitter(self, texts: List[str], metadatas: List[dict], chunk_size: int, splitter_tag: str="\n"):
        
        full_text = " ".join(texts)

        # split by splitter_tag
        lines = [ doc.strip() for doc in full_text.split(splitter_tag) if len(doc.strip()) > 1 ]

        chunks = []
        current_chunk = ""

        for line in lines:
            current_chunk += line + splitter_tag
            if len(current_chunk) >= chunk_size:
                chunks.append(Document(
                    page_content=current_chunk.strip(),
                    metadata={}
                ))

                current_chunk = ""

        if len(current_chunk) >= 0:
            chunks.append(Document(
                page_content=current_chunk.strip(),
                metadata={}
            ))

        return chunks
    