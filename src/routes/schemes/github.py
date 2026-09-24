from pydantic import BaseModel
from typing import Optional


class GithubRequest(BaseModel):
	repo_url: str
	branch: Optional[str] = None
	chunk_size: Optional[int] = 1000
	overlap_size: Optional[int] = 200
	do_reset: Optional[int] = 0
	repo_dir_name: Optional[str] = None
	depth: Optional[int] = 1
