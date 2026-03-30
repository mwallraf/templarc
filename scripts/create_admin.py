"""
Create or reset a local admin user.

Run via:  make create-admin
(the Makefile pipes this file to the container's Python stdin)
"""
import asyncio
import os
import sys
import uuid

import bcrypt as _b

from api.database import AsyncSessionLocal
from api.models.organization import Organization
from api.models.user import User
from sqlalchemy import select


async def run(username: str, password: str) -> None:
    h = _b.hashpw(password.encode(), _b.gensalt()).decode()

    async with AsyncSessionLocal() as db:
        # Ensure at least one organisation exists (fresh prod install)
        org = (await db.execute(select(Organization).limit(1))).scalar_one_or_none()
        if org is None:
            org = Organization(
                id=str(uuid.uuid4()),
                name="default",
                display_name="Default Organization",
            )
            db.add(org)
            await db.flush()
            print("Created default organization.")

        row = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()

        if row:
            row.password_hash = h
            row.role = "org_owner"
            row.is_ldap = False
            action = "updated"
        else:
            db.add(
                User(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    username=username,
                    email=f"{username}@localhost",
                    role="org_owner",
                    is_ldap=False,
                    password_hash=h,
                )
            )
            action = "created"

        await db.commit()
        print(f"Done: {action} admin user '{username}'.")


username = os.environ.get("_ADMIN_USER")
password = os.environ.get("_ADMIN_PASS")

if not username or not password:
    print("Error: _ADMIN_USER and _ADMIN_PASS environment variables required.")
    sys.exit(1)

asyncio.run(run(username, password))
