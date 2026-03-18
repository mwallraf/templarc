from datetime import datetime

from pydantic import BaseModel


class ProjectMembershipCreate(BaseModel):
    user_id: str
    role: str  # 'project_admin' | 'project_editor' | 'project_member' | 'guest'


class ProjectMembershipOut(BaseModel):
    id: str
    user_id: str
    project_id: str
    username: str
    email: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectMembershipsListOut(BaseModel):
    items: list[ProjectMembershipOut]
    total: int
